const { pool } = require('../db');
const { listEvents } = require('./calendar');
const { sendConfirmationTemplate, sendPaymentReminderTemplate, sendImageMessage } = require('./whatsapp');
const { resolveQrKey } = require('./clientPricing');
const { getFile } = require('./storage');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');
const {
  findRecurringScheduleForEventInstance,
  getDateKeyInLaPaz,
  materializeRecurringOccurrence,
} = require('./recurring');

const LA_PAZ_TIMEZONE = 'America/La_Paz';
const timezoneValidityCache = new Map();

function resolveTimeZone(timeZone) {
  const normalized = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!normalized) return LA_PAZ_TIMEZONE;
  if (!timezoneValidityCache.has(normalized)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalized });
      timezoneValidityCache.set(normalized, true);
    } catch (_) {
      timezoneValidityCache.set(normalized, false);
    }
  }
  return timezoneValidityCache.get(normalized) ? normalized : LA_PAZ_TIMEZONE;
}

function pad(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateKeyInTimeZone(value, timeZone = LA_PAZ_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey, days = 0) {
  const baseDate = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(baseDate.getTime())) return null;
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

function getTargetDateKeyForTimezone(date, timeZone, now = new Date()) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  if (!todayKey) return null;
  if (date === 'today') return todayKey;
  return addDaysToDateKey(todayKey, 1);
}

function getEventDateKeyInTimeZone(event, timeZone) {
  const eventStart = event.start?.dateTime
    || (event.start?.date ? `${event.start.date}T12:00:00Z` : null);
  if (!eventStart) return null;
  return getDateKeyInTimeZone(eventStart, timeZone);
}

function getTimeKeyInTimeZone(value, timeZone = LA_PAZ_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

function isAtOrAfterTimeKey(currentTime, targetTime) {
  if (!/^\d{2}:\d{2}$/.test(String(currentTime || ''))) return false;
  if (!/^\d{2}:\d{2}$/.test(String(targetTime || ''))) return false;
  return String(currentTime) >= String(targetTime);
}

function isReminderDueForTimezone({
  event,
  timeZone,
  date = 'tomorrow',
  reminderTime = null,
  now = new Date(),
} = {}) {
  const safeTimezone = resolveTimeZone(timeZone);
  const eventDateKey = getEventDateKeyInTimeZone(event, safeTimezone);
  const targetDateKey = getTargetDateKeyForTimezone(date, safeTimezone, now);
  if (!eventDateKey || !targetDateKey || eventDateKey !== targetDateKey) return false;

  if (!reminderTime || date === 'today' || /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return true;
  }

  const localTime = getTimeKeyInTimeZone(now, safeTimezone);
  return isAtOrAfterTimeKey(localTime, reminderTime);
}

function buildEventScanWindow(date) {
  let anchorDay;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    anchorDay = new Date(`${date}T00:00:00-04:00`);
    anchorDay.setHours(0, 0, 0, 0);
  } else {
    anchorDay = new Date(new Date().toLocaleString('en-US', { timeZone: LA_PAZ_TIMEZONE }));
    anchorDay.setHours(0, 0, 0, 0);
    if (date !== 'today') {
      anchorDay.setDate(anchorDay.getDate() + 1);
    }
  }

  const windowStart = new Date(anchorDay);
  windowStart.setDate(windowStart.getDate() - 1);
  windowStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date(anchorDay);
  windowEnd.setDate(windowEnd.getDate() + 3);
  windowEnd.setHours(0, 0, 0, 0);

  return {
    timeMin: new Date(`${pad(windowStart)}T00:00:00-04:00`).toISOString(),
    timeMax: new Date(`${pad(windowEnd)}T00:00:00-04:00`).toISOString(),
    label: date === 'today' || date === 'tomorrow' ? date : pad(anchorDay),
  };
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
  const tz = resolveTimeZone(appt.timezone);
  const result = await sendConfirmationTemplate(appt.phone, appt.first_name, appt.date_time, tz);
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

async function checkAndSendReminders({
  date,
  tenantId,
  force = false,
  appointmentId = null,
  clientId = null,
  phone = null,
  reminderTime = null,
} = {}) {
  try {
    const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
    const canonicalPhone = phone ? normalizePhone(phone) : null;
    const targeted = !!(appointmentId || clientId || canonicalPhone);
    const { timeMin, timeMax, label } = buildEventScanWindow(date);
    const events = await listEvents(calendarId, timeMin, timeMax);
    console.log(`[reminder] Found ${events.length} events for ${label} (scan ${timeMin} -> ${timeMax})`);

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
        `SELECT a.*, c.phone, c.first_name, c.timezone FROM appointments a
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
        // If this is a recurring GCal instance, check if its schedule is paused/ended.
        // If so, skip — pausing in the app must be authoritative even though GCal series survives.
        if (event.recurringEventId) {
          const effectiveTenant = tenantId || 1;
          const [pausedRows] = await pool.query(
            `SELECT id FROM recurring_schedules
             WHERE tenant_id = ? AND gcal_recurring_event_id = ?
               AND ended_at IS NULL AND paused_at IS NOT NULL
             LIMIT 1`,
            [effectiveTenant, event.recurringEventId]
          );
          const [endedRows] = await pool.query(
            `SELECT id FROM recurring_schedules
             WHERE tenant_id = ? AND gcal_recurring_event_id = ?
               AND ended_at IS NOT NULL
             LIMIT 1`,
            [effectiveTenant, event.recurringEventId]
          );
          if (pausedRows.length > 0 || endedRows.length > 0) {
            console.log(`[reminder] Skipping recurring GCal event ${event.id} — schedule paused or ended in app`);
            skipped++;
            continue;
          }
        }

        const phoneMatch = summary.match(/-\s*(\d{10,15})\s*$/);
        if (phoneMatch) {
          const phone = normalizePhone(phoneMatch[1]);
          const tenantFilterFb = tenantId ? 'AND c.tenant_id = ?' : '';
          const paramsFb = tenantId ? [phone, tenantId] : [phone];
          [appts] = await pool.query(
            `SELECT c.id AS client_id, c.phone, c.first_name, c.tenant_id, c.timezone FROM clients c
             WHERE ${normalizedPhoneSql('c.phone')} = ? ${tenantFilterFb}`,
            paramsFb
          );
          // Wrap as pseudo-appointment for sending
          if (appts.length > 0) {
            const client = appts[0];
            const eventDateTime = event.start?.dateTime || event.start?.date;
            appts = [{
              id: null,
              client_id: client.client_id,
              phone: client.phone,
              first_name: client.first_name,
              tenant_id: client.tenant_id || 1,
              timezone: client.timezone,
              date_time: eventDateTime,
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
      const apptTimezone = resolveTimeZone(appt.timezone);
      appt.timezone = apptTimezone;
      matched++;

      if (appointmentId && String(appt.id) !== String(appointmentId)) continue;
      if (clientId && String(appt.client_id) !== String(clientId)) continue;
      if (canonicalPhone && normalizePhone(appt.phone) !== canonicalPhone) continue;
      if (targeted) {
        targetFound = true;
      }

      if (!appointmentId) {
        const due = force || isReminderDueForTimezone({
          event,
          timeZone: apptTimezone,
          date,
          reminderTime,
        });
        if (!due) {
          continue;
        }
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

async function checkAndSendPaymentReminders({
  tenantId = 1,
  force = false,
  clientId = null,
  phone = null,
  ignoreEnabled = false,
  ignoreWindow = false,
} = {}) {
  try {
    const canonicalPhone = phone ? normalizePhone(phone) : null;
    const targeted = !!(clientId || canonicalPhone);
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
    if (!cfg?.payment_reminder_enabled && !ignoreEnabled) {
      return { sent: 0, skipped: 0, total: 0, enabled: false };
    }

    const leadHours = Math.max(1, parseInt(cfg.payment_reminder_hours, 10) || 2);
    const params = [tenantId];
    const filters = [
      `p.tenant_id = ?`,
      `p.status = 'Pendiente'`,
      `a.status IN ('Agendada','Confirmada','Reagendada')`,
      `a.date_time > NOW()`,
    ];

    if (!ignoreWindow) {
      filters.push(`a.date_time <= DATE_ADD(NOW(), INTERVAL ? HOUR)`);
      params.push(leadHours);
    }

    if (clientId) {
      filters.push(`p.client_id = ?`);
      params.push(clientId);
    }

    if (canonicalPhone) {
      filters.push(`${normalizedPhoneSql('c.phone')} = ?`);
      params.push(canonicalPhone);
    }

    const [rows] = await pool.query(
      `SELECT
         p.id AS payment_id,
         p.amount,
         p.tenant_id,
         p.client_id,
         p.appointment_id,
         a.date_time,
         c.phone,
         c.first_name,
         c.fee,
         c.special_fee_enabled,
         c.country
       FROM payments p
       JOIN appointments a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
       JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
       WHERE ${filters.join('\n         AND ')}
       ORDER BY a.date_time ASC`,
      params
    );

    const [tenantRows] = await pool.query('SELECT domain FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
    const tenantDomain = tenantRows[0]?.domain || '';

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let targetFound = false;
    const errors = [];

    for (const row of rows) {
      if (targeted) targetFound = true;
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
            templateName: cfg.payment_reminder_template || process.env.WA_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago',
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

        // Send QR alongside the payment reminder (Bolivia clients only).
        // Anti-dup: skip if a QR was already sent for this appointment in the last 24h.
        try {
          const normalizedPhone = String(row.phone || '').replace(/\D/g, '');
          const isBoliviaPhone = normalizedPhone.startsWith('591');
          if (isBoliviaPhone) {
            const qrEventKey = `payment_qr_${row.appointment_id}`;
            const [qrAlready] = await pool.query(
              `SELECT id FROM webhooks_log
               WHERE tenant_id = ? AND event = ? AND status = 'enviado'
                 AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`,
              [tenantId, qrEventKey]
            );
            if (qrAlready.length === 0) {
              const fee = parseInt(row.fee, 10) || parseInt(row.amount, 10);
              const qrKey = resolveQrKey({
                client: { fee: row.fee, special_fee_enabled: row.special_fee_enabled, country: row.country },
                fee,
                config: cfg,
              });
              const qrFile = await getFile(tenantId, qrKey);
              if (qrFile && tenantDomain) {
                const qrUrl = `https://${tenantDomain}/api/config/qr/${qrKey}`;
                const qrCaption = `QR de pago - Bs ${fee}\n\n👉 Por favor sube en este mismo chat el comprobante de tu pago.\nGracias.`;
                const qrResult = await sendImageMessage(row.phone, qrUrl, qrCaption);
                await pool.query(
                  `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
                   VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?)`,
                  [tenantId, row.client_id, row.phone, `QR de pago enviado (${qrKey})`, qrResult.messages?.[0]?.id || null]
                );
                await pool.query(
                  `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
                   VALUES (?, ?, 'message_sent', ?, 'enviado', ?, ?, ?)`,
                  [
                    tenantId,
                    qrEventKey,
                    JSON.stringify({
                      action: 'payment_qr_sent',
                      source: 'payment_reminder',
                      qr_key: qrKey,
                      fee,
                      qr_url: qrUrl,
                      wa_message_id: qrResult.messages?.[0]?.id || null,
                    }),
                    row.phone,
                    row.client_id,
                    row.appointment_id,
                  ]
                );
                console.log(`[payment-reminder] QR sent to ${row.phone}: ${qrKey}`);
              } else {
                console.log(`[payment-reminder] QR skipped for ${row.phone}: missing ${!qrFile ? 'qr_file' : 'tenant_domain'}`);
              }
            }
          }
        } catch (qrErr) {
          console.error(`[payment-reminder] QR send failed for ${row.phone} (non-fatal):`, qrErr.message);
        }

        sent++;
      } catch (waErr) {
        console.error(`[payment-reminder] Failed to send to ${row.phone}:`, waErr.message);
        failed++;
        errors.push({
          phone: row.phone,
          client_id: row.client_id,
          payment_id: row.payment_id,
          appointment_id: row.appointment_id,
          message: waErr.message,
        });
      }
    }

    if (targeted && !targetFound) {
      return {
        sent,
        skipped,
        failed,
        total: rows.length,
        enabled: !!cfg?.payment_reminder_enabled,
        hoursBefore: leadHours,
        targeted: true,
        targetFound: false,
        errors,
      };
    }

    return {
      sent,
      skipped,
      failed,
      total: rows.length,
      enabled: !!cfg?.payment_reminder_enabled,
      hoursBefore: leadHours,
      targeted,
      targetFound: targeted ? targetFound : null,
      errors,
    };
  } catch (err) {
    console.error('[payment-reminder] Error:', err.message);
    throw err;
  }
}

module.exports = {
  checkAndSendReminders,
  checkAndSendPaymentReminders,
  getDateKeyInTimeZone,
  getTimeKeyInTimeZone,
  getTargetDateKeyForTimezone,
  getEventDateKeyInTimeZone,
  isReminderDueForTimezone,
};
