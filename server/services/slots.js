const { pool } = require('../db');
const { listEvents } = require('./calendar');

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

async function getAvailableSlots(date, tenantId) {
  const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';

  // Load config
  const [rows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [tenantId]);
  if (rows.length === 0) throw new Error('Config no encontrada');
  const cfg = rows[0];

  const availableHours = typeof cfg.available_hours === 'string' ? JSON.parse(cfg.available_hours) : cfg.available_hours;
  const availableDays = typeof cfg.available_days === 'string' ? JSON.parse(cfg.available_days) : cfg.available_days;
  const duration = cfg.appointment_duration || 60;
  const bufferHours = cfg.buffer_hours || 3;
  const windowDays = cfg.window_days || 10;
  const breakStart = timeToMinutes(cfg.break_start || '13:00');
  const breakEnd = timeToMinutes(cfg.break_end || '14:00');

  // Check if date is within window
  const now = new Date();
  const targetDate = new Date(date + 'T00:00:00-04:00');
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
  today.setHours(0, 0, 0, 0);

  if (targetDate < today) return [];
  // Count weekdays (Mon-Fri) between today and targetDate to match client calendar
  let weekdaysCounted = 0;
  const cursor = new Date(today);
  while (cursor < targetDate) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) weekdaysCounted++;
  }
  if (weekdaysCounted > windowDays) return [];

  // Check if day is available
  const dayIndex = targetDate.getUTCDay();
  const dayName = DAY_NAMES[dayIndex];
  if (!availableDays.includes(dayName)) return [];

  // Get hours for this day
  const hoursForDay = availableHours[dayName] || [];
  if (hoursForDay.length === 0) return [];

  // Fetch GCal events for this day
  const timeMin = new Date(`${date}T00:00:00-04:00`).toISOString();
  const timeMax = new Date(`${date}T23:59:59-04:00`).toISOString();
  const events = await listEvents(calendarId, timeMin, timeMax);

  // Parse events to La Paz time ranges
  const busyRanges = events.map(e => {
    const start = new Date(e.start.dateTime || e.start.date);
    const end = new Date(e.end.dateTime || e.end.date);
    const startLP = new Date(start.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    const endLP = new Date(end.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    return {
      start: startLP.getHours() * 60 + startLP.getMinutes(),
      end: endLP.getHours() * 60 + endLP.getMinutes(),
    };
  });

  // Current time in La Paz
  const nowLP = new Date(now.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
  const nowMinutes = nowLP.getHours() * 60 + nowLP.getMinutes();
  const isToday = targetDate.toDateString() === today.toDateString();

  // Filter slots
  const freeSlots = [];
  for (const hour of hoursForDay) {
    const slotStart = timeToMinutes(hour);
    const slotEnd = slotStart + duration;

    // Skip if in break
    if (slotStart >= breakStart && slotStart < breakEnd) continue;

    // Skip if too soon (buffer)
    if (isToday && slotStart < nowMinutes + bufferHours * 60) continue;

    // Skip if busy in GCal
    const isBusy = busyRanges.some(r => slotStart < r.end && slotEnd > r.start);
    if (isBusy) continue;

    freeSlots.push({
      time: hour,
      block: slotStart < breakStart ? 'morning' : 'afternoon',
    });
  }

  return freeSlots;
}

// Get public config (for client-side calendar)
async function getPublicConfig(tenantId) {
  const [rows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [tenantId]);
  if (rows.length === 0) return null;
  const cfg = rows[0];
  return {
    available_days: typeof cfg.available_days === 'string' ? JSON.parse(cfg.available_days) : cfg.available_days,
    window_days: cfg.window_days,
    min_age: cfg.min_age,
    max_age: cfg.max_age,
    appointment_duration: cfg.appointment_duration,
  };
}

module.exports = { getAvailableSlots, getPublicConfig };
