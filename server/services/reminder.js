const { pool } = require('../db');
const { listEvents } = require('./calendar');
const { sendConfirmationTemplate } = require('./whatsapp');

function pad(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkAndSendReminders({ date, tenantId } = {}) {
  try {
    const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';

    // Determine target day in La Paz
    let targetDay;
    if (date === 'today') {
      targetDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
      targetDay.setHours(0, 0, 0, 0);
    } else {
      targetDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
      targetDay.setDate(targetDay.getDate() + 1);
      targetDay.setHours(0, 0, 0, 0);
    }

    const dayAfter = new Date(targetDay);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const timeMin = new Date(`${pad(targetDay)}T00:00:00-04:00`).toISOString();
    const timeMax = new Date(`${pad(dayAfter)}T00:00:00-04:00`).toISOString();

    const label = date === 'today' ? 'today' : 'tomorrow';
    const events = await listEvents(calendarId, timeMin, timeMax);
    console.log(`[reminder] Found ${events.length} events for ${label}`);

    let sent = 0;
    let skipped = 0;

    for (const event of events) {
      // Find appointment by gcal_event_id
      const tenantFilter = tenantId ? 'AND a.tenant_id = ?' : '';
      const params = tenantId ? [event.id, tenantId] : [event.id];
      const [appts] = await pool.query(
        `SELECT a.*, c.phone, c.first_name FROM appointments a
         JOIN clients c ON a.client_id = c.id
         WHERE a.gcal_event_id = ? AND a.status = 'Confirmada' ${tenantFilter}`,
        params
      );

      if (appts.length === 0) continue;
      const appt = appts[0];

      // Check if reminder already sent (within last 24h)
      const [logs] = await pool.query(
        `SELECT id FROM webhooks_log WHERE client_phone = ? AND type = 'reminder_sent' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [appt.phone]
      );

      if (logs.length > 0) {
        console.log(`[reminder] Already sent to ${appt.phone}, skipping`);
        skipped++;
        continue;
      }

      // Send WhatsApp reminder
      try {
        await sendConfirmationTemplate(appt.phone, appt.first_name, appt.date_time);
        await pool.query(
          `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
           VALUES (?, ?, 'reminder_sent', ?, 'enviado', ?, ?, ?)`,
          [appt.tenant_id, event.id, JSON.stringify({ appointment_id: appt.id }), appt.phone, appt.client_id, appt.id]
        );
        console.log(`[reminder] Sent to ${appt.phone}`);
        sent++;
      } catch (waErr) {
        console.error(`[reminder] Failed to send to ${appt.phone}:`, waErr.message);
      }
    }

    return { sent, skipped, total: events.length };
  } catch (err) {
    console.error('[reminder] Error:', err.message);
    throw err;
  }
}

module.exports = { checkAndSendReminders };
