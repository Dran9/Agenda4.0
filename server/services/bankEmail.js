const { google } = require('googleapis');
const { pool, withAdvisoryLock } = require('../db');
const { getOAuthClient, updateEventSummary } = require('./calendar');
const { buildCalendarSummary } = require('./calendarSummary');
const { broadcast } = require('./adminEvents');
const { sendTextMessage } = require('./whatsapp');

const DEFAULT_LABEL_NAME = 'QRterapia';
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_EMAIL_DELAY_MINUTES = 5;
const DEFAULT_QR_MATCH_WINDOW_HOURS = 24;
const DEFAULT_PAYMENT_LOOKBACK_DAYS = 14;
const DEFAULT_RECEIPT_MATCH_WINDOW_MINUTES = 15;
const DEFAULT_APPOINTMENT_PAST_HOURS = 24;
const DEFAULT_APPOINTMENT_FUTURE_HOURS = 36;
const BOLIVIA_OFFSET_MINUTES = -4 * 60;
const PAYMENT_OK_MESSAGE = '✅ Pago recibido correctamente, ¡Gracias!';

function isGmailPubSubEnabled() {
  return process.env.GMAIL_PUBSUB_ENABLED === '1';
}

function getGmailPubSubTopicName() {
  return String(process.env.GMAIL_PUBSUB_TOPIC || process.env.GMAIL_PUBSUB_TOPIC_NAME || '').trim();
}

function getValidDestinationAccounts() {
  return new Set(
    [
      '1006628555',
      '30151182874355',
      ...(process.env.VALID_DESTINATION_ACCOUNTS || '').split(','),
      ...(process.env.BANK_EMAIL_DESTINATION_ACCOUNTS || '').split(','),
    ]
      .map((value) => String(value || '').replace(/\D/g, ''))
      .filter(Boolean)
  );
}

function getValidRecipientNames() {
  return new Set(
    [
      'MAC LEAN ESTRADA OSCAR DANIEL',
      ...(process.env.BANK_EMAIL_RECIPIENT_NAMES || '').split(','),
    ]
      .map((value) => normalizeText(value).toUpperCase())
      .filter(Boolean)
  );
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBase64Url(value) {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function collectMessageBody(payload) {
  const plain = [];
  const html = [];

  function visit(part) {
    if (!part) return;
    const mimeType = String(part.mimeType || '').toLowerCase();
    const data = part.body?.data;

    if (data && mimeType === 'text/plain') {
      plain.push(decodeBase64Url(data));
    } else if (data && mimeType === 'text/html') {
      html.push(stripHtml(decodeBase64Url(data)));
    }

    for (const child of part.parts || []) visit(child);
  }

  visit(payload);
  return (plain.join('\n').trim() || html.join('\n').trim()).replace(/\r/g, '');
}

function parseBoliviaTransactionDate(datePart, timePart, meridiem) {
  const dateMatch = String(datePart || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timeMatch = String(timePart || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] || 0);
  const marker = String(meridiem || '').toLowerCase();

  if (marker === 'pm' && hours < 12) hours += 12;
  if (marker === 'am' && hours === 12) hours = 0;

  const utcMs = Date.UTC(year, month - 1, day, hours, minutes - BOLIVIA_OFFSET_MINUTES, seconds);
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMysqlDateTime(date) {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const boliviaDate = new Date(parsed.getTime() + BOLIVIA_OFFSET_MINUTES * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return [
    boliviaDate.getUTCFullYear(),
    pad(boliviaDate.getUTCMonth() + 1),
    pad(boliviaDate.getUTCDate()),
  ].join('-') + ' ' + [
    pad(boliviaDate.getUTCHours()),
    pad(boliviaDate.getUTCMinutes()),
    pad(boliviaDate.getUTCSeconds()),
  ].join(':');
}

function parseMercantilQrEmail(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  const recipientMatch = text.match(/Estimado\(a\)\s+([^,]+),/i);
  const transactionMatch = text.match(
    /Cr[eé]dito\s+Transferencia\s+QR,\s*por\s+concepto\s+de\s+([^,]+),\s*a\s+su\s+cuenta\s+(\d+)\s+de\s+la\s+cuenta\s+(\d+)\s+de\s+(.+?)\s+del\s+(.+?),\s*por\s+un\s+monto\s+de\s+Bs\.?\s*([\d.,]+)/i
  );
  if (!transactionMatch) return null;

  const dateMatch = text.match(
    /La\s+transacci[oó]n\s+fue\s+realizada\s+el\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+las\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(am|pm)?/i
  );
  const notificationMatch = text.match(/n[uú]mero\s+de\s+notificaci[oó]n[:\s]+([A-Z0-9-]+)/i);

  const amount = parseFloat(String(transactionMatch[6]).replace(/,/g, '').replace(/[^\d.].*$/, ''));
  const transactionAt = dateMatch
    ? parseBoliviaTransactionDate(dateMatch[1], dateMatch[2], dateMatch[3])
    : null;

  return {
    recipientName: recipientMatch?.[1]?.trim().replace(/\s+/g, ' ') || null,
    concept: transactionMatch[1].trim(),
    destinationAccount: String(transactionMatch[2]).replace(/\D/g, ''),
    originAccount: String(transactionMatch[3]).replace(/\D/g, ''),
    payerName: transactionMatch[4].trim().replace(/\s+/g, ' '),
    originBank: transactionMatch[5].trim().replace(/\s+/g, ' '),
    amount: Number.isFinite(amount) ? amount : null,
    currency: 'BOB',
    transactionAt,
    transactionDateText: dateMatch?.[1] || null,
    transactionTimeText: dateMatch?.[2] || null,
    notificationNumber: notificationMatch?.[1] || null,
    rawText,
  };
}

function getHeader(message, name) {
  const target = String(name || '').toLowerCase();
  return message.payload?.headers?.find((header) => String(header.name || '').toLowerCase() === target)?.value || null;
}

function isDestinationAccountValid(account) {
  return getValidDestinationAccounts().has(String(account || '').replace(/\D/g, ''));
}

function isRecipientNameValid(name) {
  return getValidRecipientNames().has(normalizeText(name).toUpperCase());
}

function isEmailDelayAcceptable(parsed, emailReceivedAt, maxDelayMinutes) {
  if (!parsed?.transactionAt || !emailReceivedAt) return false;
  const delayMs = Math.abs(emailReceivedAt.getTime() - parsed.transactionAt.getTime());
  return delayMs <= maxDelayMinutes * 60 * 1000;
}

function buildEmailDelayWarning(parsed, emailReceivedAt, maxDelayMinutes) {
  if (!parsed?.transactionAt || !emailReceivedAt) return null;
  if (isEmailDelayAcceptable(parsed, emailReceivedAt, maxDelayMinutes)) return null;
  const delayMinutes = Math.round(Math.abs(emailReceivedAt.getTime() - parsed.transactionAt.getTime()) / 60000);
  return `Email recibido ${delayMinutes} min después de la transacción; aceptable si el pago matchea por QR/pago pendiente`;
}

async function getGmailService() {
  return google.gmail({ version: 'v1', auth: getOAuthClient() });
}

async function findLabelId(gmail, labelName) {
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const wanted = String(labelName || DEFAULT_LABEL_NAME).trim().toLowerCase();
  return labels.data.labels?.find((label) => String(label.name || '').toLowerCase() === wanted)?.id || null;
}

function parseWatchExpiration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decodePubSubData(data) {
  if (!data) return null;
  const normalized = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function parsePubSubNotification(body) {
  const message = body?.message || {};
  const data = decodePubSubData(message.data);
  return {
    messageId: message.messageId || message.message_id || null,
    publishTime: message.publishTime || null,
    subscription: body?.subscription || null,
    emailAddress: data?.emailAddress || null,
    historyId: data?.historyId ? String(data.historyId) : null,
    raw: data,
  };
}

function parseDateValue(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinFutureWindow(anchor, value, windowMs) {
  const date = parseDateValue(value);
  if (!anchor || !date) return false;
  const diffMs = date.getTime() - anchor.getTime();
  return diffMs >= 0 && diffMs <= windowMs;
}

function isWithinCenteredWindow(anchor, value, windowMs) {
  const date = parseDateValue(value);
  if (!anchor || !date) return false;
  return Math.abs(date.getTime() - anchor.getTime()) <= windowMs;
}

function isAppointmentNearTransaction(row, transactionAt, { pastHours, futureHours }) {
  const appointmentAt = parseDateValue(row.date_time);
  if (!transactionAt || !appointmentAt) return false;
  const diffMs = appointmentAt.getTime() - transactionAt.getTime();
  return diffMs >= -pastHours * 60 * 60 * 1000 && diffMs <= futureHours * 60 * 60 * 1000;
}

function filterCandidatePaymentsForBankEmail(rows, {
  transactionAt,
  qrWindowHours = DEFAULT_QR_MATCH_WINDOW_HOURS,
  receiptWindowMinutes = DEFAULT_RECEIPT_MATCH_WINDOW_MINUTES,
  appointmentPastHours = DEFAULT_APPOINTMENT_PAST_HOURS,
  appointmentFutureHours = DEFAULT_APPOINTMENT_FUTURE_HOURS,
} = {}) {
  const txAt = parseDateValue(transactionAt);
  if (!txAt) return [];

  const qrWindowMs = qrWindowHours * 60 * 60 * 1000;
  const receiptWindowMs = receiptWindowMinutes * 60 * 1000;
  const scoped = rows
    .map((row) => {
      const hasRecentReceipt = isWithinCenteredWindow(txAt, row.recent_receipt_at, receiptWindowMs);
      const hasRecentQr = isWithinFutureWindow(parseDateValue(row.qr_sent_at), txAt, qrWindowMs);
      const hasNearAppointment = isAppointmentNearTransaction(row, txAt, {
        pastHours: appointmentPastHours,
        futureHours: appointmentFutureHours,
      });
      return {
        row,
        hasRecentReceipt,
        hasRecentQr,
        hasNearAppointment,
      };
    })
    .filter((item) => item.hasRecentReceipt || item.hasRecentQr || item.hasNearAppointment);

  const withReceipt = scoped.filter((item) => item.hasRecentReceipt);
  if (withReceipt.length > 0) {
    const withReceiptAndQr = withReceipt.filter((item) => item.hasRecentQr);
    if (withReceiptAndQr.length > 0) return withReceiptAndQr.map((item) => item.row);

    const withReceiptAndNearAppointment = withReceipt.filter((item) => item.hasNearAppointment);
    if (withReceiptAndNearAppointment.length > 0) {
      return withReceiptAndNearAppointment.map((item) => item.row);
    }

    return withReceipt.map((item) => item.row);
  }

  const withQrContext = scoped.filter((item) => item.hasRecentQr);
  if (withQrContext.length > 0) return withQrContext.map((item) => item.row);

  return scoped.map((item) => item.row);
}

async function getWatchState(tenantId) {
  const [rows] = await pool.query(
    'SELECT * FROM bank_email_watch_state WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  return rows[0] || null;
}

async function upsertWatchState({
  tenantId,
  emailAddress = null,
  labelName = null,
  labelId = null,
  pubsubTopic = null,
  lastHistoryId = null,
  watchExpirationAt = null,
  lastWatchAt = null,
  lastNotificationAt = null,
  lastError = null,
}) {
  await pool.query(
    `INSERT INTO bank_email_watch_state (
       tenant_id, email_address, label_name, label_id, pubsub_topic,
       last_history_id, watch_expiration_at, last_watch_at, last_notification_at, last_error
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email_address = COALESCE(VALUES(email_address), email_address),
       label_name = COALESCE(VALUES(label_name), label_name),
       label_id = COALESCE(VALUES(label_id), label_id),
       pubsub_topic = COALESCE(VALUES(pubsub_topic), pubsub_topic),
       last_history_id = COALESCE(VALUES(last_history_id), last_history_id),
       watch_expiration_at = COALESCE(VALUES(watch_expiration_at), watch_expiration_at),
       last_watch_at = COALESCE(VALUES(last_watch_at), last_watch_at),
       last_notification_at = COALESCE(VALUES(last_notification_at), last_notification_at),
       last_error = VALUES(last_error),
       updated_at = NOW()`,
    [
      tenantId,
      emailAddress,
      labelName,
      labelId,
      pubsubTopic,
      lastHistoryId,
      formatMysqlDateTime(watchExpirationAt),
      formatMysqlDateTime(lastWatchAt),
      formatMysqlDateTime(lastNotificationAt),
      lastError,
    ]
  );
}

async function findCandidatePayments({ tenantId, amount, transactionAt }) {
  const qrWindowHours = Math.max(1, Number(process.env.BANK_EMAIL_QR_MATCH_WINDOW_HOURS || DEFAULT_QR_MATCH_WINDOW_HOURS));
  const paymentLookbackDays = Math.max(1, Number(process.env.BANK_EMAIL_PAYMENT_LOOKBACK_DAYS || DEFAULT_PAYMENT_LOOKBACK_DAYS));
  const receiptWindowMinutes = Math.max(1, Number(process.env.BANK_EMAIL_RECEIPT_MATCH_WINDOW_MINUTES || DEFAULT_RECEIPT_MATCH_WINDOW_MINUTES));
  const appointmentPastHours = Math.max(1, Number(process.env.BANK_EMAIL_APPOINTMENT_PAST_HOURS || DEFAULT_APPOINTMENT_PAST_HOURS));
  const appointmentFutureHours = Math.max(1, Number(process.env.BANK_EMAIL_APPOINTMENT_FUTURE_HOURS || DEFAULT_APPOINTMENT_FUTURE_HOURS));
  const transactionSql = formatMysqlDateTime(transactionAt);
  if (!tenantId || !amount || !transactionSql) return [];

  const [rows] = await pool.query(
    `SELECT
       p.id,
       p.tenant_id,
       p.client_id,
       p.appointment_id,
       p.amount,
       p.currency,
       p.status,
       p.created_at AS payment_created_at,
       a.date_time,
       a.status AS appointment_status,
       a.gcal_event_id,
       c.first_name,
       c.last_name,
       c.phone,
       qr.created_at AS qr_sent_at,
       receipt.recent_receipt_at
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
     JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
     LEFT JOIN webhooks_log qr
       ON qr.tenant_id = p.tenant_id
      AND qr.appointment_id = p.appointment_id
      AND qr.type = 'message_sent'
      AND qr.status = 'enviado'
      AND qr.event = CONCAT('payment_qr_', p.appointment_id)
     LEFT JOIN (
       SELECT tenant_id, client_id, MAX(created_at) AS recent_receipt_at
       FROM wa_conversations
       WHERE direction = 'inbound'
         AND message_type IN ('image','document')
         AND created_at BETWEEN DATE_SUB(?, INTERVAL ? MINUTE) AND DATE_ADD(?, INTERVAL ? MINUTE)
       GROUP BY tenant_id, client_id
     ) receipt
       ON receipt.tenant_id = p.tenant_id
      AND receipt.client_id = p.client_id
     WHERE p.tenant_id = ?
       AND p.status IN ('Pendiente', 'Mismatch')
       AND UPPER(COALESCE(NULLIF(p.currency, ''), 'BOB')) = 'BOB'
       AND (p.amount = ? OR c.fee = ?)
       AND p.created_at <= DATE_ADD(?, INTERVAL 5 MINUTE)
       AND a.status IN ('Agendada','Confirmada','Reagendada','Completada')
       AND a.date_time >= DATE_SUB(?, INTERVAL ? DAY)
     ORDER BY
       CASE WHEN qr.created_at IS NULL THEN 1 ELSE 0 END,
       ABS(TIMESTAMPDIFF(SECOND, qr.created_at, ?)),
       ABS(TIMESTAMPDIFF(SECOND, a.date_time, ?)),
       p.id DESC`,
    [
      transactionSql,
      receiptWindowMinutes,
      transactionSql,
      receiptWindowMinutes,
      tenantId,
      amount,
      amount,
      transactionSql,
      transactionSql,
      paymentLookbackDays,
      transactionSql,
      transactionSql,
    ]
  );

  return filterCandidatePaymentsForBankEmail(rows, {
    transactionAt,
    qrWindowHours,
    receiptWindowMinutes,
    appointmentPastHours,
    appointmentFutureHours,
  });
}

async function updateGCalPaymentPrefix(payment) {
  try {
    const calendarId = process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId || !payment?.gcal_event_id) return;

    const baseSummary = `Terapia ${payment.first_name} ${payment.last_name || ''} - ${payment.phone}`.trim();
    const isConfirmed = ['Confirmada', 'Completada'].includes(payment.appointment_status);
    await updateEventSummary(
      calendarId,
      payment.gcal_event_id,
      buildCalendarSummary(baseSummary, { confirmed: isConfirmed, paid: true })
    );
  } catch (err) {
    console.error('[bank-email] GCal update failed (non-fatal):', err.message);
  }
}

async function sendPaymentConfirmationMessage(payment) {
  try {
    if (!payment?.phone) return;
    await sendTextMessage(payment.phone, PAYMENT_OK_MESSAGE);
  } catch (err) {
    console.error('[bank-email] WhatsApp payment reply failed (non-fatal):', err.message);
  }
}

async function upsertNotificationRecord({
  tenantId,
  message,
  labelName,
  emailReceivedAt,
  parsed,
  processedStatus,
  notes,
  matchedPaymentId = null,
  rawText,
}) {
  await pool.query(
    `INSERT INTO bank_email_notifications (
       tenant_id, gmail_message_id, gmail_thread_id, label_name, email_from, email_subject,
       email_received_at, transaction_at, amount, currency, destination_account, origin_account,
       payer_name, origin_bank, concept, notification_number, matched_payment_id,
       processed_status, notes, raw_text, payload
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       gmail_thread_id = VALUES(gmail_thread_id),
       label_name = VALUES(label_name),
       email_from = VALUES(email_from),
       email_subject = VALUES(email_subject),
       email_received_at = VALUES(email_received_at),
       transaction_at = VALUES(transaction_at),
       amount = VALUES(amount),
       currency = VALUES(currency),
       destination_account = VALUES(destination_account),
       origin_account = VALUES(origin_account),
       payer_name = VALUES(payer_name),
       origin_bank = VALUES(origin_bank),
       concept = VALUES(concept),
       notification_number = VALUES(notification_number),
       matched_payment_id = VALUES(matched_payment_id),
       processed_status = VALUES(processed_status),
       notes = VALUES(notes),
       raw_text = VALUES(raw_text),
       payload = VALUES(payload),
       updated_at = NOW()`,
    [
      tenantId,
      message.id,
      message.threadId || null,
      labelName,
      getHeader(message, 'from'),
      getHeader(message, 'subject'),
      formatMysqlDateTime(emailReceivedAt),
      formatMysqlDateTime(parsed?.transactionAt),
      parsed?.amount || null,
      parsed?.currency || 'BOB',
      parsed?.destinationAccount || null,
      parsed?.originAccount || null,
      parsed?.payerName || null,
      parsed?.originBank || null,
      parsed?.concept || null,
      parsed?.notificationNumber || null,
      matchedPaymentId,
      processedStatus,
      notes,
      rawText || parsed?.rawText || null,
      JSON.stringify({
        historyId: message.historyId || null,
        internalDate: message.internalDate || null,
        transactionDateText: parsed?.transactionDateText || null,
        transactionTimeText: parsed?.transactionTimeText || null,
      }),
    ]
  );
}

async function processBankEmailMessage({ tenantId, gmail, messageId, labelName }) {
  const [existing] = await pool.query(
    'SELECT id, processed_status FROM bank_email_notifications WHERE tenant_id = ? AND gmail_message_id = ? LIMIT 1',
    [tenantId, messageId]
  );
  if (existing.length > 0 && existing[0].processed_status === 'processed') {
    return { status: 'skipped', reason: 'already_processed' };
  }

  const messageRes = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const message = messageRes.data;
  const rawText = collectMessageBody(message.payload);
  const parsed = parseMercantilQrEmail(rawText);
  const emailReceivedAt = message.internalDate ? new Date(Number(message.internalDate)) : null;
  const maxDelayMinutes = Math.max(1, Number(process.env.BANK_EMAIL_MAX_DELAY_MINUTES || DEFAULT_EMAIL_DELAY_MINUTES));

  if (!parsed) {
    await upsertNotificationRecord({
      tenantId,
      message,
      labelName,
      emailReceivedAt,
      parsed: null,
      processedStatus: 'ignored',
      notes: 'No se pudo parsear como abono QR Mercantil',
      rawText,
    });
    return { status: 'ignored', reason: 'parse_failed' };
  }

  if (!isDestinationAccountValid(parsed.destinationAccount)) {
    await upsertNotificationRecord({
      tenantId,
      message,
      labelName,
      emailReceivedAt,
      parsed,
      processedStatus: 'ignored',
      notes: `Cuenta destino no permitida: ${parsed.destinationAccount || 'sin cuenta'}`,
      rawText,
    });
    return { status: 'ignored', reason: 'invalid_destination_account' };
  }

  if (!isRecipientNameValid(parsed.recipientName)) {
    await upsertNotificationRecord({
      tenantId,
      message,
      labelName,
      emailReceivedAt,
      parsed,
      processedStatus: 'ignored',
      notes: `Destinatario bancario no permitido: ${parsed.recipientName || 'sin destinatario'}`,
      rawText,
    });
    return { status: 'ignored', reason: 'invalid_recipient_name' };
  }

  if (!parsed.transactionAt) {
    await upsertNotificationRecord({
      tenantId,
      message,
      labelName,
      emailReceivedAt,
      parsed,
      processedStatus: 'ignored',
      notes: 'Email sin fecha/hora de transacción legible',
      rawText,
    });
    return { status: 'ignored', reason: 'missing_transaction_at' };
  }

  const delayWarning = buildEmailDelayWarning(parsed, emailReceivedAt, maxDelayMinutes);

  const candidates = await findCandidatePayments({
    tenantId,
    amount: parsed.amount,
    transactionAt: parsed.transactionAt,
  });

  if (candidates.length !== 1) {
    const processedStatus = candidates.length === 0 ? 'unmatched' : 'ambiguous';
    const baseNotes = candidates.length === 0
      ? `Sin pago pendiente único para Bs ${parsed.amount}`
      : `Pago ambiguo: ${candidates.length} candidatos para Bs ${parsed.amount}`;
    const notes = delayWarning ? `${baseNotes}. ${delayWarning}` : baseNotes;
    await upsertNotificationRecord({
      tenantId,
      message,
      labelName,
      emailReceivedAt,
      parsed,
      processedStatus,
      notes,
      rawText,
    });
    return { status: processedStatus, candidates: candidates.length };
  }

  const payment = candidates[0];
  await pool.query(
    `UPDATE payments
     SET status = 'Confirmado',
         confirmed_at = NOW(),
         settled_amount = ?,
         settled_currency = 'BOB',
         settled_source = 'BANK_EMAIL',
         ocr_extracted_amount = ?,
         ocr_extracted_ref = ?,
         ocr_extracted_date = ?,
         ocr_extracted_dest_name = ?,
         notes = NULL
     WHERE id = ? AND tenant_id = ?`,
    [
      parsed.amount,
      parsed.amount,
      parsed.notificationNumber || message.id,
      formatMysqlDateTime(parsed.transactionAt),
      parsed.payerName,
      payment.id,
      tenantId,
    ]
  );

  await upsertNotificationRecord({
    tenantId,
    message,
    labelName,
    emailReceivedAt,
    parsed,
    processedStatus: 'processed',
    notes: delayWarning
      ? `Pago confirmado automáticamente por email bancario. ${delayWarning}`
      : 'Pago confirmado automáticamente por email bancario',
    matchedPaymentId: payment.id,
    rawText,
  });

  await updateGCalPaymentPrefix(payment);
  await sendPaymentConfirmationMessage(payment);
  broadcast('payment:change', { id: Number(payment.id), action: 'confirmed', source: 'bank_email' }, tenantId);
  console.log(`[bank-email] Payment ${payment.id} confirmed from Gmail message ${message.id}`);

  return { status: 'processed', paymentId: payment.id };
}

async function pollBankPaymentEmails({ tenantId = 1, force = false } = {}) {
  if (process.env.GMAIL_QR_EMAIL_ENABLED !== '1' && !force) {
    return { enabled: false, processed: 0, ignored: 0, unmatched: 0, ambiguous: 0, errors: 0, skipped: 0 };
  }

  const labelName = process.env.GMAIL_QR_LABEL || DEFAULT_LABEL_NAME;
  const lookbackDays = Math.max(1, Number(process.env.GMAIL_QR_LOOKBACK_DAYS || DEFAULT_LOOKBACK_DAYS));
  const maxResults = Math.max(1, Number(process.env.GMAIL_QR_MAX_RESULTS || DEFAULT_MAX_RESULTS));
  const gmail = await getGmailService();
  const labelId = await findLabelId(gmail, labelName);
  if (!labelId) throw new Error(`No encontré la etiqueta Gmail "${labelName}"`);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [labelId],
    q: `newer_than:${lookbackDays}d`,
    maxResults,
  });

  const messages = listRes.data.messages || [];
  const result = { enabled: true, total: messages.length, processed: 0, ignored: 0, unmatched: 0, ambiguous: 0, errors: 0, skipped: 0 };

  for (const item of messages) {
    try {
      const itemResult = await processBankEmailMessage({ tenantId, gmail, messageId: item.id, labelName });
      if (itemResult.status === 'processed') result.processed++;
      else if (itemResult.status === 'ignored') result.ignored++;
      else if (itemResult.status === 'unmatched') result.unmatched++;
      else if (itemResult.status === 'ambiguous') result.ambiguous++;
      else result.skipped++;
    } catch (err) {
      result.errors++;
      console.error(`[bank-email] Message ${item.id} failed:`, err.message);
    }
  }

  return result;
}

async function watchBankPaymentEmails({ tenantId = 1, force = false } = {}) {
  if (!isGmailPubSubEnabled() && !force) {
    return { enabled: false, watched: false, reason: 'GMAIL_PUBSUB_ENABLED no está activo' };
  }

  const topicName = getGmailPubSubTopicName();
  if (!topicName) {
    throw new Error('GMAIL_PUBSUB_TOPIC no configurado');
  }

  const labelName = process.env.GMAIL_QR_LABEL || DEFAULT_LABEL_NAME;
  const gmail = await getGmailService();
  const labelId = await findLabelId(gmail, labelName);
  if (!labelId) throw new Error(`No encontré la etiqueta Gmail "${labelName}"`);

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: [labelId],
      labelFilterBehavior: 'INCLUDE',
    },
  });

  const expirationAt = parseWatchExpiration(res.data.expiration);
  await upsertWatchState({
    tenantId,
    emailAddress: res.data.emailAddress || null,
    labelName,
    labelId,
    pubsubTopic: topicName,
    lastHistoryId: res.data.historyId ? String(res.data.historyId) : null,
    watchExpirationAt: expirationAt,
    lastWatchAt: new Date(),
    lastError: null,
  });

  return {
    enabled: true,
    watched: true,
    labelName,
    labelId,
    topicName,
    historyId: res.data.historyId || null,
    expirationAt: expirationAt ? expirationAt.toISOString() : null,
  };
}

function collectHistoryMessageIds(historyItems = []) {
  const ids = new Set();
  for (const item of historyItems || []) {
    for (const added of item.messagesAdded || []) {
      if (added.message?.id) ids.add(added.message.id);
    }
    for (const labeled of item.labelsAdded || []) {
      if (labeled.message?.id) ids.add(labeled.message.id);
    }
    for (const message of item.messages || []) {
      if (message.id) ids.add(message.id);
    }
  }
  return [...ids];
}

async function listHistoryMessageIds({ gmail, startHistoryId, labelId }) {
  const messageIds = new Set();
  let pageToken = null;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      labelId,
      historyTypes: ['messageAdded', 'labelAdded'],
      pageToken,
    });
    for (const id of collectHistoryMessageIds(res.data.history || [])) {
      messageIds.add(id);
    }
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);

  return [...messageIds];
}

async function processBankEmailPubSubNotification({ tenantId = 1, body }) {
  if (!isGmailPubSubEnabled()) {
    return { enabled: false, processed: 0, ignored: 0, unmatched: 0, ambiguous: 0, errors: 0, skipped: 0 };
  }

  const notification = parsePubSubNotification(body);
  if (!notification.historyId) {
    throw new Error('Notificación Pub/Sub sin historyId');
  }

  return withAdvisoryLock(`bank_email_pubsub_${tenantId}`, 10, async () => {
    const labelName = process.env.GMAIL_QR_LABEL || DEFAULT_LABEL_NAME;
    const gmail = await getGmailService();
    const labelId = await findLabelId(gmail, labelName);
    if (!labelId) throw new Error(`No encontré la etiqueta Gmail "${labelName}"`);

    const state = await getWatchState(tenantId);
    const startHistoryId = state?.last_history_id ? String(state.last_history_id) : null;

    if (!startHistoryId) {
      const fallback = await pollBankPaymentEmails({ tenantId, force: true });
      await upsertWatchState({
        tenantId,
        emailAddress: notification.emailAddress,
        labelName,
        labelId,
        lastHistoryId: notification.historyId,
        lastNotificationAt: new Date(),
        lastError: null,
      });
      return { ...fallback, source: 'pubsub_bootstrap_poll', historyId: notification.historyId };
    }

    let messageIds = [];
    try {
      messageIds = await listHistoryMessageIds({ gmail, startHistoryId, labelId });
    } catch (err) {
      if (err.code !== 404) throw err;
      const fallback = await pollBankPaymentEmails({ tenantId, force: true });
      await upsertWatchState({
        tenantId,
        emailAddress: notification.emailAddress,
        labelName,
        labelId,
        lastHistoryId: notification.historyId,
        lastNotificationAt: new Date(),
        lastError: 'history_expired_fallback_poll',
      });
      return { ...fallback, source: 'pubsub_history_expired_poll', historyId: notification.historyId };
    }

    const result = {
      enabled: true,
      source: 'pubsub',
      historyId: notification.historyId,
      total: messageIds.length,
      processed: 0,
      ignored: 0,
      unmatched: 0,
      ambiguous: 0,
      errors: 0,
      skipped: 0,
    };

    for (const messageId of messageIds) {
      try {
        const itemResult = await processBankEmailMessage({ tenantId, gmail, messageId, labelName });
        if (itemResult.status === 'processed') result.processed++;
        else if (itemResult.status === 'ignored') result.ignored++;
        else if (itemResult.status === 'unmatched') result.unmatched++;
        else if (itemResult.status === 'ambiguous') result.ambiguous++;
        else result.skipped++;
      } catch (err) {
        result.errors++;
        console.error(`[bank-email] Pub/Sub message ${messageId} failed:`, err.message);
      }
    }

    await upsertWatchState({
      tenantId,
      emailAddress: notification.emailAddress,
      labelName,
      labelId,
      lastHistoryId: notification.historyId,
      lastNotificationAt: new Date(),
      lastError: result.errors ? `Errores en ${result.errors} mensajes` : null,
    });

    return result;
  });
}

module.exports = {
  collectMessageBody,
  collectHistoryMessageIds,
  buildEmailDelayWarning,
  decodePubSubData,
  filterCandidatePaymentsForBankEmail,
  formatMysqlDateTime,
  isRecipientNameValid,
  parseMercantilQrEmail,
  parsePubSubNotification,
  pollBankPaymentEmails,
  processBankEmailMessage,
  processBankEmailPubSubNotification,
  watchBankPaymentEmails,
};
