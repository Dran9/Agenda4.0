const crypto = require('crypto');
const { Router } = require('express');
const { pool } = require('../db');
const { getOperationalContext, classifyIncomingMessage, buildClassificationMetadata } = require('../services/messageContext');
const { buildCalendarSummary, hasCalendarPaymentMarker, stripCalendarMarkers } = require('../services/calendarSummary');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');

const router = Router();
const CALENDAR_ID = () => process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'danielmacleann@gmail.com';

function getWebhookAppSecret() {
  return process.env.WA_APP_SECRET || process.env.META_APP_SECRET || process.env.APP_SECRET || '';
}

function verifyWebhookSignature(req) {
  const appSecret = getWebhookAppSecret();
  if (!appSecret) {
    return { ok: false, status: 500, error: 'Webhook app secret no configurado' };
  }

  const signature = req.get('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) {
    return { ok: false, status: 401, error: 'Firma faltante o inválida' };
  }

  if (!Buffer.isBuffer(req.rawBody)) {
    return { ok: false, status: 400, error: 'Payload sin firma verificable' };
  }

  const expected = Buffer.from(
    `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`,
    'utf8'
  );
  const received = Buffer.from(signature, 'utf8');

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, status: 401, error: 'Firma inválida' };
  }

  return { ok: true };
}

function sanitizeReceiptDate(value) {
  return value ? String(value).trim().slice(0, 50) : null;
}

function sanitizeReceiptDestName(value) {
  return value ? String(value).trim().slice(0, 255) : null;
}

function parseReceiptDateKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();

  const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;

  const yyyymmdd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;

  const ddmmyyyyDash = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyyDash) return `${ddmmyyyyDash[3]}-${ddmmyyyyDash[2]}-${ddmmyyyyDash[1]}`;

  const spanishMatch = trimmed.match(/^(\d{1,2})\s+de\s+(\w+),?\s*(\d{4})$/i);
  if (spanishMatch) {
    const months = {
      enero: '01',
      febrero: '02',
      marzo: '03',
      abril: '04',
      mayo: '05',
      junio: '06',
      julio: '07',
      agosto: '08',
      septiembre: '09',
      octubre: '10',
      noviembre: '11',
      diciembre: '12',
    };
    const month = months[spanishMatch[2].toLowerCase()];
    if (month) return `${spanishMatch[3]}-${month}-${String(spanishMatch[1]).padStart(2, '0')}`;
  }

  return null;
}

function getBoliviaDateKey(dateStr) {
  if (!dateStr) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dateStr));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function formatWhatsappName(name) {
  if (!name) return 'hola';
  const first = String(name).trim().split(/\s+/)[0] || 'hola';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatDisplayDate(value) {
  if (!value) return '—';
  const key = parseReceiptDateKey(value);
  if (!key) return String(value);
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

function formatMismatchProblem(problem) {
  if (problem.type === 'fecha_pasada') {
    return `FECHA PASADA (comprobante ${problem.receiptDate} es anterior a la sesión ${problem.sessionDate})`;
  }
  if (problem.type === 'monto') {
    return 'MONTO';
  }
  if (problem.type === 'destinatario') {
    return 'DESTINATARIO';
  }
  return 'VALIDACIÓN';
}

function buildMismatchNotes(problems) {
  return `Problemas: ${problems.map(formatMismatchProblem).join(', ')}`;
}

function buildMismatchReasonLines(problems) {
  return problems.map((problem) => {
    if (problem.type === 'fecha_pasada') {
      return 'La fecha del comprobante es anterior a la fecha de la sesión.';
    }
    if (problem.type === 'monto') {
      return 'El monto del comprobante no coincide con el valor registrado de la sesión.';
    }
    if (problem.type === 'destinatario') {
      return 'El destinatario no coincide claramente con la cuenta registrada para el pago.';
    }
    return 'No se pudo validar automáticamente el comprobante.';
  });
}

function buildMismatchWhatsappMessage(firstName, problems) {
  const saludo = formatWhatsappName(firstName);
  const reasonLines = buildMismatchReasonLines(problems);

  return [
    `Hola ${saludo}, gracias por enviar tu comprobante 😊`,
    '',
    `No pude validarlo automáticamente por ${problems.length === 1 ? 'este motivo' : 'estos motivos'}:`,
    ...reasonLines.map((line) => `• ${line}`),
    '',
    'Por favor, revisa el comprobante y envíalo nuevamente.',
    '🤑 Si hubo un error de mi parte o consideras que la información sí es correcta, puedes escribirle a Daniel por aquí mismo.',
  ].join('\n');
}

// GET /api/webhook — Meta verification
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('[webhook] Verification OK');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// POST /api/webhook — WhatsApp incoming messages & button replies
router.post('/', async (req, res) => {
  const signatureCheck = verifyWebhookSignature(req);
  if (!signatureCheck.ok) {
    console.error('[webhook] Signature verification failed:', signatureCheck.error);
    return res.sendStatus(signatureCheck.status);
  }

  // Respond quickly once the request is authenticated.
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.entry) return;

    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const tenantId = 1; // Default tenant for now

        if (Array.isArray(value.statuses) && value.statuses.length > 0) {
          for (const statusItem of value.statuses) {
            const waStatus = statusItem.status || 'unknown';
            const recipientPhone = statusItem.recipient_id ? normalizePhone(statusItem.recipient_id) : null;
            let clientId = null;

            if (recipientPhone) {
              const [clients] = await pool.query(
                `SELECT id FROM clients
                 WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? LIMIT 1`,
                [recipientPhone, tenantId]
              );
              clientId = clients[0]?.id || null;
            }

            await pool.query(
              `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
               VALUES (?, ?, 'status_change', ?, ?, ?, ?)`,
              [
                tenantId,
                statusItem.id || `wa_status_${Date.now()}`,
                JSON.stringify({
                  kind: 'whatsapp_status',
                  wa_status: waStatus,
                  recipient_id: recipientPhone,
                  conversation: statusItem.conversation || null,
                  pricing: statusItem.pricing || null,
                  errors: statusItem.errors || null,
                  raw: statusItem,
                }),
                waStatus === 'failed' ? 'error' : 'procesado',
                recipientPhone,
                clientId,
              ]
            ).catch((err) => {
              console.error('[webhook] Failed to store WhatsApp status:', err.message);
            });

            console.log(`[webhook] WA status ${waStatus} for ${recipientPhone || 'unknown'} (${statusItem.id || 'no-id'})`);
          }
        }

        if (!value.messages) continue;

        for (const msg of value.messages) {
          const phone = normalizePhone(msg.from);
          const tenantId = 1; // Default tenant for now

          // Mark as read immediately (blue checkmarks ✓✓)
          try {
            const token = process.env.WA_TOKEN;
            const phoneNumberId = process.env.WA_PHONE_ID;
            await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: msg.id }),
            });
          } catch (readErr) {
            // Non-fatal — don't block processing
          }

          // Resolve client
          const [clients] = await pool.query(
            `SELECT id, first_name FROM clients
             WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? LIMIT 1`,
            [phone, tenantId]
          );
          const clientId = clients[0]?.id || null;

          if (msg.type === 'button') {
            // Button reply from template
            const payload = msg.button?.payload;
            const text = msg.button?.text || '';
            console.log(`[webhook] Button reply from ${phone}: ${payload} (${text})`);

            // Log to wa_conversations
            await pool.query(
              `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, button_payload, wa_message_id)
               VALUES (?, ?, ?, 'inbound', 'button_reply', ?, ?, ?)`,
              [tenantId, clientId, phone, text, payload, msg.id]
            );

            // Log to webhooks_log
            await pool.query(
              `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
               VALUES (?, ?, 'button_reply', ?, 'recibido', ?, ?)`,
              [tenantId, `button_${payload}_${phone}`, JSON.stringify({ payload, text, wa_message_id: msg.id }), phone, clientId]
            );

            let confirmedAppointmentId = null;

            // ─── CONFIRM_NOW: add ✅ to GCal without losing 💰 if already paid ───
            if (payload === 'CONFIRM_NOW') {
              try {
                const { updateEventSummary, listEvents } = require('../services/calendar');
                const calendarId = CALENDAR_ID();
                const phoneShort = phone.slice(-8);
                const now = new Date();
                const timeMin = new Date(`${now.toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' })}T00:00:00-04:00`).toISOString();
                const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
                const events = await listEvents(calendarId, timeMin, timeMax);
                const match = events.find(e =>
                  e.summary && e.summary.includes('Terapia') && !e.summary.includes('✅')
                  && (e.summary.includes(phone) || e.summary.includes(phoneShort))
                );
                if (match) {
                  await updateEventSummary(
                    calendarId,
                    match.id,
                    buildCalendarSummary(match.summary, {
                      confirmed: true,
                      paid: hasCalendarPaymentMarker(match.summary),
                    })
                  );
                  await pool.query(
                    `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
                     VALUES (?, ?, 'status_change', ?, 'procesado', ?, ?)`,
                    [tenantId, `gcal_check_${match.id}`, JSON.stringify({ action: 'added_check', summary: match.summary, eventId: match.id }), phone, clientId]
                  );
                } else {
                  await pool.query(
                    `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
                     VALUES (?, ?, 'status_change', ?, 'error', ?, ?)`,
                    [tenantId, `gcal_check_miss_${phone}`, JSON.stringify({ action: 'no_match', phone, phoneShort, totalEvents: events.length, terapiaCount: events.filter(e => e.summary?.startsWith('Terapia')).length, terapiaSummaries: events.filter(e => e.summary?.startsWith('Terapia')).map(e => e.summary) }), phone, clientId]
                  );
                }
              } catch (gcalErr) {
                await pool.query(
                  `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
                   VALUES (?, ?, 'status_change', ?, 'error', ?, ?)`,
                  [tenantId, `gcal_check_error_${phone}`, JSON.stringify({ action: 'error', message: gcalErr.message, stack: gcalErr.stack?.split('\n').slice(0, 3) }), phone, clientId]
                ).catch(() => {});
              }

              // Mark DB appointment as confirmed (if exists)
              if (clientId) {
                const [appts] = await pool.query(
                  `SELECT id FROM appointments
                   WHERE client_id = ? AND tenant_id = ? AND status IN ('Agendada','Confirmada','Reagendada') AND date_time > NOW()
                   ORDER BY date_time LIMIT 1`,
                  [clientId, tenantId]
                );
                if (appts[0]) {
                  confirmedAppointmentId = appts[0].id;
                  await pool.query(
                    `UPDATE appointments SET status = 'Confirmada', confirmed_at = NOW() WHERE id = ? AND tenant_id = ?`,
                    [appts[0].id, tenantId]
                  );
                }
              }
            }

            // Auto-reply based on config
            if (payload && clientId) {
              const [cfgRows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [tenantId]);
              const cfg = cfgRows[0];
              const { sendTextMessage, sendImageMessage } = require('../services/whatsapp');

              let replyText = null;
              if (payload === 'CONFIRM_NOW') {
                const nombre = clients[0]?.first_name || '';
                replyText = `\ud83d\udc4f Perfecto ${nombre}, te esperamos para darle un giro a tu vida.\n\nEn un momento te mandamos el *QR* o _enlace_ para pago adelantado por favor.`;
              } else if (payload === 'REAGEN_NOW') {
                const nombre = clients[0]?.first_name || '';
                const domain = (await pool.query('SELECT domain FROM tenants WHERE id = ?', [tenantId]))[0]?.[0]?.domain || '';
                replyText = `${nombre}, vamos a reprogramar tu cita.\n\nhttps://${domain}/?r=${phone}`;
              } else if (payload === 'DANIEL_NOW' && cfg?.auto_reply_contact) {
                replyText = cfg.auto_reply_contact;
              }

              if (replyText) {
                try {
                  const result = await sendTextMessage(phone, replyText);
                  await pool.query(
                    `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
                     VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?)`,
                    [tenantId, clientId, phone, replyText, result.messages?.[0]?.id]
                  );

                  // Send QR payment image after confirmation (delayed 60s to feel natural)
                  if (payload === 'CONFIRM_NOW') {
                    setTimeout(async () => {
                      try {
                        if (!confirmedAppointmentId) {
                          console.log(`[webhook] Skipping automatic Bolivian QR for ${phone}: missing appointment context`);
                          return;
                        }

                        const [appointmentRows] = await pool.query(
                          `SELECT a.phone, a.booking_context, c.fee
                           FROM appointments a
                           JOIN clients c ON c.id = a.client_id
                           WHERE a.id = ? AND a.tenant_id = ?
                           LIMIT 1`,
                          [confirmedAppointmentId, tenantId]
                        );
                        const appointment = appointmentRows[0];
                        if (!appointment) return;

                        let bookingContext = appointment.booking_context || null;
                        if (bookingContext && typeof bookingContext === 'string') {
                          try {
                            bookingContext = JSON.parse(bookingContext);
                          } catch (_) {
                            bookingContext = null;
                          }
                        }

                        const normalizedPhone = String(appointment.phone || phone || '').replace(/\D/g, '');
                        const isBoliviaPhone = normalizedPhone.startsWith('591');
                        const ipCountryCode = String(bookingContext?.ip_country_code || '').toUpperCase();
                        const locationCountryCode = String(bookingContext?.location_country_code || '').toUpperCase();
                        const locationConfirmedManually = !!bookingContext?.location_confirmed_manually;
                        const isBoliviaLocation = locationCountryCode === 'BO'
                          && (ipCountryCode === 'BO' || locationConfirmedManually);

                        if (!(isBoliviaPhone && isBoliviaLocation)) {
                          console.log(
                            `[webhook] Skipping automatic Bolivian QR for ${phone}: phone_prefix=${isBoliviaPhone ? 'BO' : 'other'}, ip=${ipCountryCode || 'unknown'}, location=${locationCountryCode || 'unknown'}, manual_confirm=${locationConfirmedManually}`
                          );
                          return;
                        }

                        let qrKey;
                        const fee = parseInt(appointment.fee, 10);
                        if (fee === parseInt(cfg.capital_fee, 10)) qrKey = 'qr_300';
                        else if (fee === parseInt(cfg.special_fee, 10)) qrKey = 'qr_150';
                        else if (fee === parseInt(cfg.default_fee, 10)) qrKey = 'qr_250';
                        else qrKey = 'qr_generico';

                        const { getFile } = require('../services/storage');
                        const qrFile = await getFile(tenantId, qrKey);
                        if (qrFile) {
                          const domain = (await pool.query('SELECT domain FROM tenants WHERE id = ?', [tenantId]))[0]?.[0]?.domain || '';
                          const qrUrl = `https://${domain}/api/config/qr/${qrKey}`;
                          const qrResult = await sendImageMessage(phone, qrUrl, `QR de pago - Bs ${fee}`);
                          await pool.query(
                            `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
                             VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?)`,
                            [tenantId, clientId, phone, `QR de pago enviado (${qrKey})`, qrResult.messages?.[0]?.id]
                          );
                          console.log(`[webhook] QR sent to ${phone}: ${qrKey}`);
                        }
                      } catch (qrErr) {
                        console.error(`[webhook] QR send failed for ${phone}:`, qrErr.message);
                      }
                    }, 15000); // 15 second delay
                  }
                } catch (waErr) {
                  console.error(`[webhook] Auto-reply failed for ${phone}:`, waErr.message);
                }
              }
            }
          } else if (msg.type === 'text') {
            // Regular text message
            const operationalContext = await getOperationalContext({ tenantId, phone, clientId });
            const classification = classifyIncomingMessage({
              messageType: 'text',
              text: msg.text?.body,
              context: operationalContext,
            });

            if (!classification.shouldStore) {
              console.log(`[webhook] Ignored non-operational text from ${phone}: ${classification.reason}`);
              continue;
            }

            console.log(`[webhook] Text from ${phone}: ${msg.text?.body?.substring(0, 50)} [${classification.contextType}]`);
            await pool.query(
              `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id, metadata)
               VALUES (?, ?, ?, 'inbound', 'text', ?, ?, ?)`,
              [
                tenantId,
                clientId,
                phone,
                msg.text?.body,
                msg.id,
                buildClassificationMetadata(classification, operationalContext),
              ]
            );
          } else if (msg.type === 'image' || msg.type === 'document') {
            // Image or document (comprobante de pago)
            const mediaId = msg.image?.id || msg.document?.id;
            const caption = msg.image?.caption || msg.document?.caption || '';
            const filename = msg.document?.filename || '';
            const mimeType = msg.image?.mime_type || msg.document?.mime_type || '';

            const operationalContext = await getOperationalContext({ tenantId, phone, clientId });
            const classification = classifyIncomingMessage({
              messageType: msg.type,
              caption,
              filename,
              context: operationalContext,
            });

            if (!classification.shouldStore) {
              console.log(`[webhook] Ignored non-operational ${msg.type} from ${phone}: ${classification.reason}`);
              continue;
            }

            console.log(`[webhook] ${msg.type} from ${phone}: ${mediaId} (${filename || caption || 'sin caption'})`);

            // Download media from WhatsApp
            let mediaData = null;
            let ocrResult = null;
            try {
              const token = process.env.WA_TOKEN;
              // Step 1: Get media URL
              const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const mediaInfo = await mediaRes.json();

              if (mediaInfo.url) {
                // Step 2: Download the file
                const fileRes = await fetch(mediaInfo.url, {
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                const buffer = Buffer.from(await fileRes.arrayBuffer());

                // Step 3: Store in DB
                const { saveFile } = require('../services/storage');
                const fileKey = `comprobante_${phone}_${Date.now()}`;
                await saveFile(tenantId, fileKey, buffer, mimeType, filename || `${msg.type}_${Date.now()}`);
                mediaData = fileKey;
                console.log(`[webhook] Media saved: ${fileKey} (${buffer.length} bytes)`);

                // ─── OCR + Auto-match payment by phone ──────────────
                // Only process OCR if there's payment context in recent conversation
                // (avoids wasting Vision API on random photos like wedding pics)
                if (clientId && (mimeType.startsWith('image/') || msg.type === 'image' || mimeType === 'application/pdf')) {
                  let hasPaymentContext = classification.contextType === 'payment';
                  try {
                    if (!hasPaymentContext) {
                      // Legacy fallback: if the classifier didn't mark this as payment, do one last check
                      const [recentCtx] = await pool.query(
                        `SELECT content, direction, message_type FROM wa_conversations
                         WHERE ${normalizedPhoneSql('client_phone')} = ? AND tenant_id = ?
                           AND created_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE)
                         ORDER BY created_at DESC LIMIT 10`,
                        [phone, tenantId]
                      );
                      hasPaymentContext = recentCtx.some(r =>
                        /QR de pago|CONFIRM_NOW|comprobante|pago|transferencia/i.test(r.content)
                      );
                      if (!hasPaymentContext) {
                        const [pending] = await pool.query(
                          `SELECT id FROM payments
                           WHERE client_id = ? AND tenant_id = ?
                             AND status IN ('Pendiente', 'Mismatch')
                           LIMIT 1`,
                          [clientId, tenantId]
                        );
                        hasPaymentContext = pending.length > 0;
                      }
                    }
                  } catch (ctxErr) {
                    console.error('[webhook] Context check failed:', ctxErr.message);
                    hasPaymentContext = false;
                  }

                  if (!hasPaymentContext) {
                    console.log(`[webhook] Image from ${phone} ignored — no payment context`);
                  } else try {
                    const { extractReceiptData } = require('../services/ocr');
                    ocrResult = await extractReceiptData(buffer, mimeType);

                    if (ocrResult && ocrResult.amount) {
                      console.log(`[webhook] OCR: ${ocrResult.name}, Bs ${ocrResult.amount}, ${ocrResult.date}, ref: ${ocrResult.reference}, destVerified: ${ocrResult.destVerified}`);

                      // Find unresolved payment for this client.
                      // Keep mismatch retryable so a second valid receipt can fix the same appointment.
                      const [pendingPayments] = await pool.query(
                        `SELECT p.id, p.amount, p.appointment_id, p.status,
                                a.date_time, a.gcal_event_id, a.status as appointment_status,
                                c.first_name, c.last_name, c.phone as client_phone, c.fee
                         FROM payments p
                         JOIN appointments a ON p.appointment_id = a.id
                         JOIN clients c ON p.client_id = c.id
                         WHERE p.client_id = ? AND p.tenant_id = ?
                           AND p.status IN ('Pendiente', 'Mismatch')
                         ORDER BY
                           CASE p.status
                             WHEN 'Mismatch' THEN 0
                             WHEN 'Pendiente' THEN 1
                             ELSE 2
                           END,
                           p.updated_at DESC,
                           a.date_time ASC
                         LIMIT 5`,
                        [clientId, tenantId]
                      );

                      if (pendingPayments.length > 0) {
                        // Find best match: amount matches fee, or closest upcoming appointment
                        let bestMatch = pendingPayments[0];
                        for (const pp of pendingPayments) {
                          if (parseInt(pp.fee) === ocrResult.amount || parseInt(pp.amount) === ocrResult.amount) {
                            bestMatch = pp;
                            break;
                          }
                        }

                        // ─── 3 validations: destinatario, monto, fecha ───
                        const problems = [];

                        // 1. Destinatario: destination account must match one of Daniel's valid accounts
                        const recipientMismatch = ocrResult.destVerified === false
                          || (ocrResult.destName && ocrResult.destNameVerified === false)
                          || (ocrResult.destAccount && ocrResult.destAccountVerified === false);
                        if (recipientMismatch) {
                          problems.push({ type: 'destinatario' });
                        }

                        // 2. Monto: OCR amount must match client fee or payment amount
                        const expectedAmount = parseInt(bestMatch.fee) || parseInt(bestMatch.amount);
                        if (expectedAmount && ocrResult.amount !== expectedAmount) {
                          problems.push({ type: 'monto', expectedAmount, receivedAmount: ocrResult.amount });
                        }

                        // 3. Fecha: receipt date must not be before the session date
                        if (ocrResult.date && bestMatch.date_time) {
                          const receiptDateKey = parseReceiptDateKey(ocrResult.date);
                          const sessionDateKey = getBoliviaDateKey(bestMatch.date_time);

                          if (receiptDateKey && sessionDateKey && receiptDateKey < sessionDateKey) {
                            problems.push({
                              type: 'fecha_pasada',
                              receiptDate: ocrResult.date,
                              sessionDate: sessionDateKey,
                            });
                          }
                        }

                        if (problems.length === 0) {
                          // All validations passed → Confirmado
                          await pool.query(
                            `UPDATE payments SET status = 'Confirmado', confirmed_at = NOW(),
                             receipt_file_key = ?, ocr_extracted_amount = ?, ocr_extracted_ref = ?,
                             ocr_extracted_date = ?, ocr_extracted_dest_name = ?,
                             notes = NULL
                             WHERE id = ? AND tenant_id = ?`,
                            [
                              fileKey,
                              ocrResult.amount,
                              ocrResult.reference,
                              sanitizeReceiptDate(ocrResult.date),
                              sanitizeReceiptDestName(ocrResult.destName),
                              bestMatch.id,
                              tenantId,
                            ]
                          );

                          // Update GCal with ✅ 💰 prefix
                          try {
                            const calendarId = CALENDAR_ID();
                            if (calendarId && bestMatch.gcal_event_id) {
                              const { updateEventSummary } = require('../services/calendar');
                              const currentSummary = `Terapia ${bestMatch.first_name} ${bestMatch.last_name || ''} - ${bestMatch.client_phone}`.trim();
                              await updateEventSummary(
                                calendarId,
                                bestMatch.gcal_event_id,
                                buildCalendarSummary(currentSummary, {
                                  confirmed: ['Confirmada', 'Completada'].includes(bestMatch.appointment_status),
                                  paid: true,
                                })
                              );
                              console.log(`[webhook] GCal updated with 💰 for payment ${bestMatch.id}`);
                            }
                          } catch (gcalErr) {
                            console.error(`[webhook] GCal 💰 update failed (non-fatal):`, gcalErr.message);
                          }

                          // Send confirmation reply
                          try {
                            const { sendTextMessage } = require('../services/whatsapp');
                            const paymentOkMessage = bestMatch.first_name
                              ? `✅ Pago recibido correctamente. Gracias ${formatWhatsappName(bestMatch.first_name)}. Hasta pronto.`
                              : '✅ Pago recibido correctamente. Gracias. Hasta pronto.';
                            await sendTextMessage(phone, paymentOkMessage);
                          } catch (replyErr) {
                            console.error(`[webhook] Payment reply failed:`, replyErr.message);
                          }

                          console.log(`[webhook] Payment ${bestMatch.id} auto-confirmed via OCR for client ${clientId}`);
                        } else {
                          // Validation failed → Mismatch
                          await pool.query(
                            `UPDATE payments SET status = 'Mismatch', receipt_file_key = ?,
                             ocr_extracted_amount = ?, ocr_extracted_ref = ?, ocr_extracted_date = ?, ocr_extracted_dest_name = ?,
                             notes = ?
                             WHERE id = ? AND tenant_id = ?`,
                            [
                              fileKey,
                              ocrResult.amount,
                              ocrResult.reference,
                              sanitizeReceiptDate(ocrResult.date),
                              sanitizeReceiptDestName(ocrResult.destName),
                              buildMismatchNotes(problems),
                              bestMatch.id,
                              tenantId,
                            ]
                          );
                          try {
                            const { sendTextMessage } = require('../services/whatsapp');
                            await sendTextMessage(phone, buildMismatchWhatsappMessage(bestMatch.first_name, problems));
                          } catch (replyErr) {
                            console.error(`[webhook] Payment mismatch reply failed:`, replyErr.message);
                          }

                          console.log(`[webhook] Payment ${bestMatch.id} MISMATCH: ${buildMismatchNotes(problems)}`);
                        }
                      } else {
                        console.log(`[webhook] OCR detected Bs ${ocrResult.amount} but no unresolved payment for client ${clientId}`);
                      }
                    }
                  } catch (ocrErr) {
                    console.error(`[webhook] OCR processing failed (non-fatal):`, ocrErr.message);
                  }
                }
              }
            } catch (mediaErr) {
              console.error(`[webhook] Media download failed:`, mediaErr.message);
            }

            const content = mediaData
              ? `[${msg.type === 'image' ? 'Imagen' : 'Documento'}] ${caption || filename || ''} (guardado: ${mediaData})`
              : `[${msg.type === 'image' ? 'Imagen' : 'Documento'}] ${caption || filename || ''} (no descargado)`;

            // Build metadata with OCR data if available
            const metadata = buildClassificationMetadata(classification, operationalContext, ocrResult ? {
              ocr_name: ocrResult.name || null,
              ocr_amount: ocrResult.amount || null,
              ocr_date: ocrResult.date || null,
              ocr_reference: ocrResult.reference || null,
              ocr_dest_name: ocrResult.destName || null,
              ocr_dest_account_verified: ocrResult.destAccountVerified || false,
              ocr_dest_name_verified: ocrResult.destNameVerified || false,
              ocr_dest_verified: ocrResult.destVerified || false,
              ocr_bank: ocrResult.bank || null,
            } : {});

            await pool.query(
              `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id, metadata)
               VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?)`,
              [tenantId, clientId, phone, msg.type, content, msg.id, metadata]
            );

            // Log as potential payment proof
            await pool.query(
              `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
               VALUES (?, ?, 'message_sent', ?, 'recibido', ?, ?)`,
              [tenantId, `media_${mediaData || mediaId}`, JSON.stringify({ type: msg.type, caption, filename, file_key: mediaData }), phone, clientId]
            );
          }
        }
      }
    }
  } catch (err) {
    console.error('[webhook] Processing error:', err.message);
  }
});

// GET /api/webhook/conversations — admin: list WhatsApp conversations
const { authMiddleware } = require('../middleware/auth');

router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const { phone, direction, type, page = 1, limit = 50 } = req.query;
    let where = 'w.tenant_id = ?';
    const params = [req.tenantId];

    if (phone) {
      const canonicalPhone = normalizePhone(phone);
      if (canonicalPhone) {
        where += ` AND ${normalizedPhoneSql('w.client_phone')} LIKE ?`;
        params.push(`%${canonicalPhone}%`);
      }
    }
    if (direction) { where += ' AND w.direction = ?'; params.push(direction); }
    if (type) { where += ' AND w.message_type = ?'; params.push(type); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    const [rows] = await pool.query(
      `SELECT w.*, w.metadata, c.first_name, c.last_name
       FROM wa_conversations w
       LEFT JOIN clients c ON w.client_id = c.id
       WHERE ${where}
       ORDER BY w.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    const countParams = params.slice(0, -2);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM wa_conversations w WHERE ${where}`,
      countParams
    );

    res.json({ conversations: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron cargar las conversaciones',
      logLabel: 'webhook conversations',
    });
  }
});

// GET /api/webhook/log — admin: list webhooks_log
router.get('/log', authMiddleware, async (req, res) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    let where = 'tenant_id = ?';
    const params = [req.tenantId];

    if (type) { where += ' AND type = ?'; params.push(type); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    const [rows] = await pool.query(
      `SELECT * FROM webhooks_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );

    const countParams = params.slice(0, -2);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM webhooks_log WHERE ${where}`,
      countParams
    );

    res.json({ logs: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el activity log',
      logLabel: 'webhook log',
    });
  }
});

// GET /api/webhook/file/:key — serve stored media file (admin)
router.get('/file/:key', authMiddleware, async (req, res) => {
  try {
    const { getFile } = require('../services/storage');
    const file = await getFile(req.tenantId, req.params.key);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.set('Content-Type', file.mime_type);
    res.send(file.data);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el archivo',
      logLabel: 'webhook file',
    });
  }
});

// GET /api/webhook/debug-check/:phone — test ✅ GCal logic without WhatsApp (admin, temporary)
router.get('/debug-check/:phone', authMiddleware, async (req, res) => {
  try {
    const { updateEventSummary, listEvents } = require('../services/calendar');
    const calendarId = CALENDAR_ID();
    const phone = normalizePhone(req.params.phone);
    const dryRun = req.query.dry !== '0'; // default: dry run (don't actually update)

    // Search from start of today to 7 days ahead
    const now = new Date();
    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    todayStart.setHours(0, 0, 0, 0);
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await listEvents(calendarId, todayStart.toISOString(), weekLater.toISOString());
    const phoneShort = phone.slice(-8);

    const allTerapia = events.filter(e => stripCalendarMarkers(e.summary || '').startsWith('Terapia'));
    const matchEvent = events.find(e =>
      e.summary && stripCalendarMarkers(e.summary).startsWith('Terapia') && !e.summary.includes('✅')
      && (e.summary.includes(phone) || e.summary.includes(phoneShort))
    );

    const result = {
      phone,
      phoneShort,
      searchRange: { from: todayStart.toISOString(), to: weekLater.toISOString() },
      totalEvents: events.length,
      terapiaEvents: allTerapia.map(e => ({ id: e.id, summary: e.summary, start: e.start?.dateTime })),
      matchEvent: matchEvent ? { id: matchEvent.id, summary: matchEvent.summary, start: matchEvent.start?.dateTime } : null,
      dryRun,
    };

    if (matchEvent && !dryRun) {
      await updateEventSummary(
        calendarId,
        matchEvent.id,
        buildCalendarSummary(matchEvent.summary, {
          confirmed: true,
          paid: hasCalendarPaymentMarker(matchEvent.summary),
        })
      );
      result.updated = true;
    }

    res.json(result);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo ejecutar la validación de calendario',
      logLabel: 'webhook debug-check',
    });
  }
});

module.exports = router;
