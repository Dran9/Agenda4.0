const { pool } = require('../db');
const { sendButtonMessage, sendTextMessage } = require('./whatsapp');
const { sendTelegramOperationalNotice } = require('./metaHealth');
const { normalizePhone } = require('../utils/phone');

const KEEP_RECURRING_PAYLOAD = 'KEEP_RECURRING';
const CHANGE_RECURRING_PAYLOAD = 'CHANGE_RECURRING';
const PROMPT_DEDUPE_DAYS = 30;

const WEEKDAY_LABELS = [
  'domingos',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábados',
];

function parsePayloadJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function formatScheduleTime(time) {
  return String(time || '').slice(0, 5);
}

function buildRecurringReschedulePrompt(client, schedule) {
  const firstName = String(client?.first_name || '').trim().split(/\s+/)[0] || 'Hola';
  const dayLabel = WEEKDAY_LABELS[Number(schedule?.day_of_week)] || 'días programados';
  const timeLabel = formatScheduleTime(schedule?.time);

  return `${firstName}, qué tal. Notamos que tus sesiones están programadas de forma recurrente todos los ${dayLabel} a las ${timeLabel}, pero has reprogramado las últimas 2. ¿Estos cambios fueron algo puntual, o te gustaría revisar el día y la hora que tienes fijos?`;
}

async function getLatestRecurringReschedules(tenantId, clientId) {
  const [rows] = await pool.query(
    `SELECT id, payload, created_at
     FROM webhooks_log
     WHERE tenant_id = ?
       AND client_id = ?
       AND type = 'reschedule'
     ORDER BY created_at DESC, id DESC
     LIMIT 2`,
    [tenantId, clientId]
  );

  return rows.map((row) => ({
    ...row,
    parsed: parsePayloadJson(row.payload),
  }));
}

async function wasPromptRecentlySent(tenantId, clientId, scheduleId) {
  const [rows] = await pool.query(
    `SELECT id
     FROM webhooks_log
     WHERE tenant_id = ?
       AND client_id = ?
       AND type = 'message_sent'
       AND event = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     LIMIT 1`,
    [tenantId, clientId, `recurring_reschedule_prompt_${scheduleId}`, PROMPT_DEDUPE_DAYS]
  );
  return rows.length > 0;
}

async function maybeSendRecurringReschedulePrompt({ tenantId, clientId, scheduleId, phone, bsuid = null } = {}) {
  if (!tenantId || !clientId || !scheduleId || (!phone && !bsuid)) {
    return { sent: false, skipped: true, reason: 'missing_context' };
  }

  const latest = await getLatestRecurringReschedules(tenantId, clientId);
  if (latest.length < 2) return { sent: false, skipped: true, reason: 'not_enough_reschedules' };

  const sameSchedule = latest.every((row) => Number(row.parsed?.schedule_id) === Number(scheduleId));
  if (!sameSchedule) return { sent: false, skipped: true, reason: 'not_consecutive_for_schedule' };

  if (await wasPromptRecentlySent(tenantId, clientId, scheduleId)) {
    return { sent: false, skipped: true, reason: 'recently_sent' };
  }

  const [rows] = await pool.query(
    `SELECT c.first_name, c.last_name, c.phone, rs.day_of_week, rs.time
     FROM recurring_schedules rs
     JOIN clients c ON c.id = rs.client_id AND c.tenant_id = rs.tenant_id
     WHERE rs.tenant_id = ?
       AND rs.id = ?
       AND rs.client_id = ?
     LIMIT 1`,
    [tenantId, scheduleId, clientId]
  );
  const row = rows[0];
  if (!row) return { sent: false, skipped: true, reason: 'schedule_not_found' };

  const message = buildRecurringReschedulePrompt(row, row);
  const target = phone || { bsuid };
  const result = await sendButtonMessage(target, message, [
    { id: KEEP_RECURRING_PAYLOAD, title: 'Mantengo programación' },
    { id: CHANGE_RECURRING_PAYLOAD, title: 'Voy a cambiar' },
  ]);

  const waMessageId = result.messages?.[0]?.id || null;
  await pool.query(
    `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id, metadata, bsuid)
     VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?, ?, ?)`,
    [
      tenantId,
      clientId,
      phone,
      message,
      waMessageId,
      JSON.stringify({
        kind: 'recurring_reschedule_prompt',
        schedule_id: scheduleId,
        latest_reschedule_ids: latest.map((item) => item.id),
      }),
      bsuid || null,
    ]
  );

  await pool.query(
    `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, bsuid)
     VALUES (?, ?, 'message_sent', ?, 'enviado', ?, ?, ?)`,
    [
      tenantId,
      `recurring_reschedule_prompt_${scheduleId}`,
      JSON.stringify({
        kind: 'recurring_reschedule_prompt',
        schedule_id: scheduleId,
        wa_message_id: waMessageId,
        latest_reschedule_ids: latest.map((item) => item.id),
      }),
      phone,
      clientId,
      bsuid || null,
    ]
  );

  return { sent: true, skipped: false, wa_message_id: waMessageId };
}

async function handleRecurringRescheduleButton({ tenantId, clientId, phone, bsuid, payload } = {}) {
  if (payload === KEEP_RECURRING_PAYLOAD) {
    const text = 'Perfecto, entonces mantenemos.';
    const result = await sendTextMessage(phone || { bsuid }, text);
    await pool.query(
      `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id, bsuid)
       VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?, ?)`,
      [tenantId, clientId, phone, text, result.messages?.[0]?.id || null, bsuid || null]
    ).catch(() => {});
    return { handled: true };
  }

  if (payload === CHANGE_RECURRING_PAYLOAD) {
    const text = 'Perfecto, te paso con Daniel.';
    const result = await sendTextMessage(phone || { bsuid }, text);
    await pool.query(
      `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id, bsuid)
       VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?, ?)`,
      [tenantId, clientId, phone, text, result.messages?.[0]?.id || null, bsuid || null]
    ).catch(() => {});

    const [clientRows] = await pool.query(
      'SELECT first_name, last_name, phone FROM clients WHERE tenant_id = ? AND id = ? LIMIT 1',
      [tenantId, clientId]
    );
    const client = clientRows[0] || {};
    const clientPhone = normalizePhone(client.phone || phone || '');
    const name = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Cliente';
    const waLink = clientPhone
      ? `https://api.whatsapp.com/send/?phone=${clientPhone}&text&type=phone_number&app_absent=0`
      : '';

    await sendTelegramOperationalNotice(tenantId, {
      text: `⚠️ ${name} quiere interrumpir recurrencia. Tomar acción ${waLink}`,
      alertType: 'recurring_change_request',
      severity: 'warning',
      payload: {
        source: 'recurring_reschedule_prompt',
        client_id: clientId,
        client_name: name,
        phone: clientPhone || null,
        wa_link: waLink || null,
      },
    });
    return { handled: true };
  }

  return { handled: false };
}

module.exports = {
  KEEP_RECURRING_PAYLOAD,
  CHANGE_RECURRING_PAYLOAD,
  buildRecurringReschedulePrompt,
  maybeSendRecurringReschedulePrompt,
  handleRecurringRescheduleButton,
};
