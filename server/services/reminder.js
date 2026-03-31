const { pool } = require('../db');
const { listEvents } = require('./calendar');
const { sendConfirmationTemplate } = require('./whatsapp');

function pad(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkAndSendReminders({ date, tenantId, force } = {}) {
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
      const summary = event.summary || '';

      // Only process events that contain "Terapia" (may have $, ✅ prefixes)
      if (!summary.includes('Terapia')) continue;

      // Try 1: Find appointment by gcal_event_id
      const tenantFilter = tenantId ? 'AND a.tenant_id = ?' : '';
      let params = tenantId ? [event.id, tenantId] : [event.id];
      let [appts] = await pool.query(
        `SELECT a.*, c.phone, c.first_name FROM appointments a
         JOIN clients c ON a.client_id = c.id
         WHERE a.gcal_event_id = ? AND a.status IN ('Agendada','Confirmada') ${tenantFilter}`,
        params
      );

      // Try 2: Fallback — extract phone from event name (format: "$ ✅ Terapia Name - 59172034151")
      if (appts.length === 0) {
        const phoneMatch = summary.match(/-\s*(\d{10,15})\s*$/);
        if (phoneMatch) {
          const phone = phoneMatch[1];
          const tenantFilterFb = tenantId ? 'AND c.tenant_id = ?' : '';
          const paramsFb = tenantId ? [phone, tenantId] : [phone];
          [appts] = await pool.query(
            `SELECT c.id AS client_id, c.phone, c.first_name, c.tenant_id FROM clients c
             WHERE c.phone = ? ${tenantFilterFb}`,
            paramsFb
          );
          // Wrap as pseudo-appointment for sending
          if (appts.length > 0) {
            const client = appts[0];
            const eventStart = event.start?.dateTime || event.start?.date;
            appts = [{
              id: null,
              client_id: client.client_id,
              phone: client.phone,
              first_name: client.first_name,
              tenant_id: client.tenant_id || 1,
              date_time: eventStart,
            }];
            console.log(`[reminder] Matched by phone from event name: ${phone}`);
          }
        }
      }

      if (appts.length === 0) {
        console.log(`[reminder] No match for event: ${summary}`);
        continue;
      }
      const appt = appts[0];

      // Dedup: check if reminder already sent for this specific appointment (by appointment_id or gcal event_id)
      // In force mode (devmode), skip this check
      if (!force) {
        const dedupKey = appt.id ? `appointment_id = ${appt.id}` : null;
        const [alreadySent] = await pool.query(
          `SELECT id FROM webhooks_log
           WHERE type = 'reminder_sent' AND tenant_id = ?
             AND (appointment_id = ? OR event = ?)
             AND created_at > DATE_SUB(NOW(), INTERVAL 48 HOUR)
           LIMIT 1`,
          [appt.tenant_id || 1, appt.id, event.id]
        );
        if (alreadySent.length > 0) {
          console.log(`[reminder] Already sent for appointment ${appt.id || event.id}, skipping (use force=1 to override)`);
          skipped++;
          continue;
        }
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

    return { sent, skipped, total: events.length, force: !!force };
  } catch (err) {
    console.error('[reminder] Error:', err.message);
    throw err;
  }
}

module.exports = { checkAndSendReminders };
