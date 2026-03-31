const { pool } = require('../db');
const { listEvents } = require('./calendar');
const { sendConfirmationTemplate, sendPaymentReminderTemplate } = require('./whatsapp');

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

async function checkAndSendPaymentReminders({ tenantId = 1, force = false } = {}) {
  try {
    const [cfgRows] = await pool.query(
      'SELECT payment_reminder_enabled, payment_reminder_hours FROM config WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );
    const cfg = cfgRows[0];
    if (!cfg?.payment_reminder_enabled) {
      return { sent: 0, skipped: 0, total: 0, enabled: false };
    }

    const leadHours = Math.max(1, parseInt(cfg.payment_reminder_hours, 10) || 2);
    const [rows] = await pool.query(
      `SELECT
         p.id AS payment_id,
         p.amount,
         p.tenant_id,
         p.client_id,
         p.appointment_id,
         a.date_time,
         c.phone,
         c.first_name
       FROM payments p
       JOIN appointments a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
       JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
       WHERE p.tenant_id = ?
         AND p.status = 'Pendiente'
         AND a.status IN ('Agendada','Confirmada')
         AND a.date_time > NOW()
         AND a.date_time <= DATE_ADD(NOW(), INTERVAL ? HOUR)
       ORDER BY a.date_time ASC`,
      [tenantId, leadHours]
    );

    let sent = 0;
    let skipped = 0;

    for (const row of rows) {
      const eventKey = `payment_reminder:${row.payment_id}`;

      if (!force) {
        const [alreadySent] = await pool.query(
          `SELECT id
           FROM webhooks_log
           WHERE tenant_id = ?
             AND type = 'message_sent'
             AND event = ?
             AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
           LIMIT 1`,
          [tenantId, eventKey]
        );

        if (alreadySent.length > 0) {
          skipped++;
          continue;
        }
      }

      try {
        const result = await sendPaymentReminderTemplate(
          row.phone,
          row.first_name,
          row.date_time,
          row.amount
        );

        await pool.query(
          `INSERT INTO wa_conversations
             (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
           VALUES (?, ?, ?, 'outbound', 'template', ?, ?)`,
          [
            tenantId,
            row.client_id,
            row.phone,
            `Recordatorio de pago pendiente enviado para cita ${row.appointment_id}`,
            result.messages?.[0]?.id || null,
          ]
        );

        await pool.query(
          `INSERT INTO webhooks_log
             (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
           VALUES (?, ?, 'message_sent', ?, 'enviado', ?, ?, ?)`,
          [
            tenantId,
            eventKey,
            JSON.stringify({
              kind: 'payment_reminder',
              payment_id: row.payment_id,
              amount: row.amount,
              hours_before: leadHours,
            }),
            row.phone,
            row.client_id,
            row.appointment_id,
          ]
        );

        sent++;
      } catch (waErr) {
        console.error(`[payment-reminder] Failed to send to ${row.phone}:`, waErr.message);
      }
    }

    return { sent, skipped, total: rows.length, enabled: true, hoursBefore: leadHours };
  } catch (err) {
    console.error('[payment-reminder] Error:', err.message);
    throw err;
  }
}

module.exports = { checkAndSendReminders, checkAndSendPaymentReminders };
