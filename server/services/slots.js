const { pool } = require('../db');
const { listEvents } = require('./calendar');
const { getLaPazDateKey, getLaPazMinutes, getBusyRangesForDate } = require('./calendarBusy');

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
  const todayKey = getLaPazDateKey(now);
  const today = new Date(`${todayKey}T00:00:00-04:00`);
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((targetDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays > windowDays) return [];

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

  const busyRanges = getBusyRangesForDate(events, date);

  // Current time in La Paz
  const nowMinutes = getLaPazMinutes(now);
  const isToday = diffDays === 0;

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

// Batch: compute slots for multiple dates with a SINGLE GCal call
async function getAvailableSlotsBatch(dates, tenantId) {
  if (!dates || dates.length === 0) return {};

  const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';

  // Load config once
  const [rows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [tenantId]);
  if (rows.length === 0) return {};
  const cfg = rows[0];

  const availableHours = typeof cfg.available_hours === 'string' ? JSON.parse(cfg.available_hours) : cfg.available_hours;
  const availableDays = typeof cfg.available_days === 'string' ? JSON.parse(cfg.available_days) : cfg.available_days;
  const duration = cfg.appointment_duration || 60;
  const bufferHours = cfg.buffer_hours || 3;
  const windowDays = cfg.window_days || 10;
  const breakStart = timeToMinutes(cfg.break_start || '13:00');
  const breakEnd = timeToMinutes(cfg.break_end || '14:00');

  const now = new Date();
  const todayKey = getLaPazDateKey(now);
  const today = new Date(`${todayKey}T00:00:00-04:00`);
  today.setHours(0, 0, 0, 0);
  const nowMinutes = getLaPazMinutes(now);

  // Sort dates and find range for single GCal call
  const sorted = [...dates].sort();
  const firstDate = sorted[0];
  const lastDate = sorted[sorted.length - 1];
  const timeMin = new Date(`${firstDate}T00:00:00-04:00`).toISOString();
  const timeMax = new Date(`${lastDate}T23:59:59-04:00`).toISOString();

  // ONE GCal call for entire range
  let allEvents;
  try {
    allEvents = await listEvents(calendarId, timeMin, timeMax);
  } catch (err) {
    console.error('[slots-batch] GCal error:', err.message);
    allEvents = [];
  }

  // Process each date using the shared events
  const result = {};
  for (const date of dates) {
    const targetDate = new Date(date + 'T00:00:00-04:00');
    const diffDays = Math.floor((targetDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > windowDays) { result[date] = []; continue; }

    const dayIndex = targetDate.getUTCDay();
    const dayName = DAY_NAMES[dayIndex];
    if (!availableDays.includes(dayName)) { result[date] = []; continue; }

    const hoursForDay = availableHours[dayName] || [];
    if (hoursForDay.length === 0) { result[date] = []; continue; }

    const busyRanges = getBusyRangesForDate(allEvents, date);
    const isToday = diffDays === 0;

    const freeSlots = [];
    for (const hour of hoursForDay) {
      const slotStart = timeToMinutes(hour);
      const slotEnd = slotStart + duration;
      if (slotStart >= breakStart && slotStart < breakEnd) continue;
      if (isToday && slotStart < nowMinutes + bufferHours * 60) continue;
      const isBusy = busyRanges.some(r => slotStart < r.end && slotEnd > r.start);
      if (isBusy) continue;
      freeSlots.push({ time: hour, block: slotStart < breakStart ? 'morning' : 'afternoon' });
    }
    result[date] = freeSlots;
  }

  return result;
}

module.exports = { getAvailableSlots, getPublicConfig, getAvailableSlotsBatch };
