const { pool } = require('../db');
const { listEvents } = require('./calendar');
const { sendConfirmationTemplate, sendPaymentReminderTemplate } = require('./whatsapp');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');
const {
  findRecurringScheduleForEventInstance,
  getDateKeyInLaPaz,
  materializeRecurringOccurrence,
} = require('./recurring');

function pad(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseJsonSafe(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

async function wasReminderAlreadySent({ tenantId, appointmentId, eventId, hours = 48 }) {
  const [rows] = await pool.query(
    `SELECT id, payload FROM webhooks_log
     WHERE type = 'reminder_sent' AND tenant_id = ?
       AND (appointment_id = ? OR event = ?)
       AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, appointmentId || null, eventId || null, hours]
  );
  const latestAttempt = rows[0];
  if (!latestAttempt) return false;

  const waMessageId = parseJsonSafe(latestAttempt.payload)?.wa_message_id;
  if (!waMessageId) return true;

  const [failedStatuses] = await pool.query(
    `SELECT id FROM webhooks_log
     WHERE tenant_id = ?
       AND type = 'status_change'
       AND event = ?
       AND status = 'error'
     LIMIT 1`,
    [tenantId, waMessageId]
  );

  return failedStatuses.length === 0;
}

async function sendAppointmentReminder(appt, eventId) {
  const result = await sendConfirmationTemplate(appt.phone, appt.first_name, appt.date_time);
  await pool.query(
    `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
     VALUES (?, ?, 'reminder_sent', ?, 'enviado', ?, ?, ?)`,
    [
      appt.tenant_id,
      eventId,
      JSON.stringify({
        appointment_id: appt.id || null,
        wa_message_id: result.messages?.[0]?.id || null,
      }),
      appt.phone,
      appt.client_id,
      appt.id || null,
    ]
  );
}

async function checkAndSendReminders({ date, tenantId, force = false, appointmentId = null, clientId = null, phone = null } = {}) {
  try {
    const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
    const canonicalPhone = phone ? normalizePhone(phone) : null;
    const targeted = !!(appointmentId || clientId || canonicalPhone);

    // Determine target day in La Paz
    let targetDay;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      targetDay = new Date(`${date}T00:00:00-04:00`);
      targetDay.setHours(0, 0, 0, 0);
    } else if (date === 'today') {
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

    const label = date === 'today' || date === 'tomorrow' ? date : pad(targetDay);
    const events = await listEvents(calendarId, timeMin, timeMax);
    console.log(`[reminder] Found ${events.length} events for ${label}`);

    let sent = 0;
    let skipped = 0;
    let matched = 0;
    let failed = 0;
    let targetFound = false;
    const errors = [];

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
         WHERE a.gcal_event_id = ? AND a.status IN ('Agendada','Confirmada','Reagendada') ${tenantFilter}`,
        params
      );

      // Try 2: Recurring schedule match — materialize the occurrence before sending
      if (appts.length === 0) {
        const dateKey = event.start?.dateTime ? getDateKeyInLaPaz(event.start.dateTime) : null;
        if (event.recurringEventId && dateKey) {
          const schedule = await findRecurringScheduleForEventInstance(
            tenantId || 1,
            event.recurringEventId,
            dateKey
          );
          if (schedule) {
            const materialized = await materializeRecurringOccurrence({
              tenantId: tenantId || 1,
              scheduleId: schedule.id,
              date: dateKey,
              eventInstance: event,
            });
            if (materialized?.appointment) {
              appts = [materialized.appointment];
              console.log(
                `[reminder] Matched recurring schedule ${schedule.id} and ${materialized.created ? 'materialized' : 'reused'} appointment ${materialized.appointment.id}`
              );
            }
          }
        }
      }

      // Try 3: Fallback — extract phone from event name (format: "$ ✅ Terapia Name - 59172034151")
      if (appts.length === 0) {
        const phoneMatch = summary.match(/-\s*(\d{10,15})\s*$/);
        if (phoneMatch) {
          const phone = normalizePhone(phoneMatch[1]);
          const tenantFilterFb = tenantId ? 'AND c.tenant_id = ?' : '';
          const paramsFb = tenantId ? [phone, tenantId] : [phone];
          [appts] = await pool.query(
            `SELECT c.id AS client_id, c.phone, c.first_name, c.tenant_id FROM clients c
             WHERE ${normalizedPhoneSql('c.phone')} = ? ${tenantFilterFb}`,
            paramsFb
          );
          // Wrap as pseudo-appointment for sending
          if (appts.length > 0) {
            const client = appts[0];
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
      matched++;

      if (appointmentId && String(appt.id) !== String(appointmentId)) continue;
      if (clientId && String(appt.client_id) !== String(clientId)) continue;
      if (canonicalPhone && normalizePhone(appt.phone) !== canonicalPhone) continue;
      if (targeted) {
        targetFound = true;
      }

      // Dedup: check if reminder already sent for this specific appointment (by appointment_id or gcal event_id)
      if (!force) {
        const alreadySent = await wasReminderAlreadySent({
          tenantId: appt.tenant_id || 1,
          appointmentId: appt.id,
          eventId: event.id,
        });
        if (alreadySent) {
          console.log(`[reminder] Already sent for appointment ${appt.id || event.id}, skipping (use force=1 to override)`);
          skipped++;
          if (targeted) break;
          continue;
        }
      }

      // Send WhatsApp reminder
      try {
        await sendAppointmentReminder(appt, event.id);
        console.log(`[reminder] Sent to ${appt.phone}`);
        sent++;
        if (targeted) break;
      } catch (waErr) {
        console.error(`[reminder] Failed to send to ${appt.phone}:`, waErr.message);
        failed++;
        errors.push({
          phone: appt.phone,
          appointment_id: appt.id || null,
          event_id: event.id,
          message: waErr.message,
        });
        if (targeted) break;
      }
    }

    if (targeted && !targetFound) {
      return {
        sent,
        skipped,
        failed,
        total: events.length,
        matched,
        errors,
        force: !!force,
        targeted: true,
        targetFound: false,
      };
    }

    return { sent, skipped, failed, total: events.length, matched, errors, force: !!force, targeted };
  } catch (err) {
    console.error('[reminder] Error:', err.message);
    throw err;
  }
}

async function checkAndSendPaymentReminders({ tenantId = 1, force = false } = {}) {
  try {
    const [cfgRows] = await pool.query(
      `SELECT
         payment_reminder_enabled,
         payment_reminder_hours,
         payment_reminder_template,
         whatsapp_template_language
       FROM config
       WHERE tenant_id = ?
       LIMIT 1`,
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
         AND a.status IN ('Agendada','Confirmada','Reagendada')
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
          row.amount,
          {
            templateName: cfg.payment_reminder_template || process.env.WA_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago_pendiente',
            languageCode: cfg.whatsapp_template_language || 'es',
          }
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
