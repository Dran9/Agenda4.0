const { google } = require('googleapis');
const { pool } = require('../db');
const { getOAuthClient, updateEventSummary } = require('./calendar');
const { buildCalendarSummary } = require('./calendarSummary');
const { broadcast } = require('./adminEvents');

const DEFAULT_LABEL_NAME = 'QRterapia';
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_EMAIL_DELAY_MINUTES = 5;
const DEFAULT_QR_MATCH_WINDOW_HOURS = 12;
const DEFAULT_PAYMENT_LOOKBACK_DAYS = 14;
const BOLIVIA_OFFSET_MINUTES = -4 * 60;

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
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function parseMercantilQrEmail(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

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

function isEmailDelayAcceptable(parsed, emailReceivedAt, maxDelayMinutes) {
  if (!parsed?.transactionAt || !emailReceivedAt) return false;
  const delayMs = Math.abs(emailReceivedAt.getTime() - parsed.transactionAt.getTime());
  return delayMs <= maxDelayMinutes * 60 * 1000;
}

async function getGmailService() {
  return google.gmail({ version: 'v1', auth: getOAuthClient() });
}

async function findLabelId(gmail, labelName) {
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const wanted = String(labelName || DEFAULT_LABEL_NAME).trim().toLowerCase();
  return labels.data.labels?.find((label) => String(label.name || '').toLowerCase() === wanted)?.id || null;
}

async function findCandidatePayments({ tenantId, amount, transactionAt }) {
  const qrWindowHours = Math.max(1, Number(process.env.BANK_EMAIL_QR_MATCH_WINDOW_HOURS || DEFAULT_QR_MATCH_WINDOW_HOURS));
  const paymentLookbackDays = Math.max(1, Number(process.env.BANK_EMAIL_PAYMENT_LOOKBACK_DAYS || DEFAULT_PAYMENT_LOOKBACK_DAYS));
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
       qr.created_at AS qr_sent_at
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
     JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
     LEFT JOIN webhooks_log qr
       ON qr.tenant_id = p.tenant_id
      AND qr.appointment_id = p.appointment_id
      AND qr.type = 'message_sent'
      AND qr.status = 'enviado'
      AND qr.event = CONCAT('payment_qr_', p.appointment_id)
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
    [tenantId, amount, amount, transactionSql, transactionSql, paymentLookbackDays, transactionSql, transactionSql]
  );

  const withQrContext = rows.filter((row) => {
    if (!row.qr_sent_at) return false;
    const qrSentAt = new Date(row.qr_sent_at);
    const txAt = new Date(transactionAt);
    const diffMs = txAt.getTime() - qrSentAt.getTime();
    return diffMs >= 0 && diffMs <= qrWindowHours * 60 * 60 * 1000;
  });

  return withQrContext.length > 0 ? withQrContext : rows;
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

  if (!isEmailDelayAcceptable(parsed, emailReceivedAt, maxDelayMinutes)) {
    await upsertNotificationRecord({
      tenantId,
      message,
      labelName,
      emailReceivedAt,
      parsed,
      processedStatus: 'ignored',
      notes: `Email fuera de ventana de ${maxDelayMinutes} minutos respecto a la transacción`,
      rawText,
    });
    return { status: 'ignored', reason: 'stale_email' };
  }

  const candidates = await findCandidatePayments({
    tenantId,
    amount: parsed.amount,
    transactionAt: parsed.transactionAt,
  });

  if (candidates.length !== 1) {
    const processedStatus = candidates.length === 0 ? 'unmatched' : 'ambiguous';
    const notes = candidates.length === 0
      ? `Sin pago pendiente único para Bs ${parsed.amount}`
      : `Pago ambiguo: ${candidates.length} candidatos para Bs ${parsed.amount}`;
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
    notes: 'Pago confirmado automáticamente por email bancario',
    matchedPaymentId: payment.id,
    rawText,
  });

  await updateGCalPaymentPrefix(payment);
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

module.exports = {
  collectMessageBody,
  formatMysqlDateTime,
  parseMercantilQrEmail,
  pollBankPaymentEmails,
  processBankEmailMessage,
};
