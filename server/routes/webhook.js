const { Router } = require('express');
const { pool } = require('../db');

const router = Router();
const CALENDAR_ID = () => process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'danielmacleann@gmail.com';

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
  // Always respond 200 immediately (Meta requirement)
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.entry) return;

    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value.messages) continue;

        for (const msg of value.messages) {
          const phone = msg.from;
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
            'SELECT id, first_name FROM clients WHERE phone = ? AND tenant_id = ?',
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

            // ─── CONFIRM_NOW: Add ✅ to GCal (runs independently, no DB dependency) ───
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
                  await updateEventSummary(calendarId, match.id, `✅ ${match.summary}`);
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
                   WHERE client_id = ? AND tenant_id = ? AND status IN ('Agendada','Confirmada') AND date_time > NOW()
                   ORDER BY date_time LIMIT 1`,
                  [clientId, tenantId]
                );
                if (appts[0]) {
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
                      const [clientRows] = await pool.query('SELECT fee, city FROM clients WHERE id = ?', [clientId]);
                      const client = clientRows[0];
                      if (client) {
                        const capitalCities = (cfg.capital_cities || '').split(',').map(c => c.trim());
                        let qrKey;
                        const fee = parseInt(client.fee);
                        if (fee === parseInt(cfg.capital_fee)) qrKey = 'qr_300';
                        else if (fee === parseInt(cfg.special_fee)) qrKey = 'qr_150';
                        else if (fee === parseInt(cfg.default_fee)) qrKey = 'qr_250';
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
                      }
                    } catch (qrErr) {
                      console.error(`[webhook] QR send failed for ${phone}:`, qrErr.message);
                    }
                    }, 60000); // 60 second delay
                  }
                } catch (waErr) {
                  console.error(`[webhook] Auto-reply failed for ${phone}:`, waErr.message);
                }
              }
            }
          } else if (msg.type === 'text') {
            // Regular text message
            console.log(`[webhook] Text from ${phone}: ${msg.text?.body?.substring(0, 50)}`);
            await pool.query(
              `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
               VALUES (?, ?, ?, 'inbound', 'text', ?, ?)`,
              [tenantId, clientId, phone, msg.text?.body, msg.id]
            );
          } else if (msg.type === 'image' || msg.type === 'document') {
            // Image or document (comprobante de pago)
            const mediaId = msg.image?.id || msg.document?.id;
            const caption = msg.image?.caption || msg.document?.caption || '';
            const filename = msg.document?.filename || '';
            const mimeType = msg.image?.mime_type || msg.document?.mime_type || '';
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
                  let hasPaymentContext = false;
                  try {
                    // Check last 60 min of conversation for payment-related context
                    const [recentCtx] = await pool.query(
                      `SELECT content, direction, message_type FROM wa_conversations
                       WHERE client_phone = ? AND tenant_id = ?
                         AND created_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE)
                       ORDER BY created_at DESC LIMIT 10`,
                      [phone, tenantId]
                    );
                    // Context clues: QR sent, CONFIRM button pressed, or payment keywords
                    hasPaymentContext = recentCtx.some(r =>
                      /QR de pago|CONFIRM_NOW|comprobante|pago|transferencia/i.test(r.content)
                    );
                    // Also check: does this client have any pending payment?
                    if (!hasPaymentContext) {
                      const [pending] = await pool.query(
                        `SELECT id FROM payments WHERE client_id = ? AND tenant_id = ? AND status = 'Pendiente' LIMIT 1`,
                        [clientId, tenantId]
                      );
                      hasPaymentContext = pending.length > 0;
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

                      // Find pending payment for this client (match by phone → client_id)
                      const [pendingPayments] = await pool.query(
                        `SELECT p.id, p.amount, p.appointment_id, a.date_time, a.gcal_event_id,
                                c.first_name, c.last_name, c.phone as client_phone, c.fee
                         FROM payments p
                         JOIN appointments a ON p.appointment_id = a.id
                         JOIN clients c ON p.client_id = c.id
                         WHERE p.client_id = ? AND p.tenant_id = ? AND p.status = 'Pendiente'
                         ORDER BY a.date_time ASC LIMIT 5`,
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

                        // ─── 3 validations: dest, amount, date ───
                        const problems = [];

                        // 1. Destinatario: "Daniel Mac" must appear near dest keywords
                        if (!ocrResult.destVerified) {
                          problems.push('destinatario');
                        }

                        // 2. Monto: OCR amount must match client fee or payment amount
                        const expectedAmount = parseInt(bestMatch.fee) || parseInt(bestMatch.amount);
                        if (expectedAmount && ocrResult.amount !== expectedAmount) {
                          problems.push(`monto (esperado Bs ${expectedAmount}, recibido Bs ${ocrResult.amount})`);
                        }

                        // 3. Fecha: receipt date must not be before appointment booking date
                        if (ocrResult.date && bestMatch.date_time) {
                          let receiptDate = null;
                          // Parse DD/MM/YYYY
                          const ddmmyyyy = ocrResult.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                          if (ddmmyyyy) receiptDate = new Date(ddmmyyyy[3], ddmmyyyy[2] - 1, ddmmyyyy[1]);
                          // Parse YYYY-MM-DD
                          const yyyymmdd = ocrResult.date.match(/(\d{4})-(\d{2})-(\d{2})/);
                          if (!receiptDate && yyyymmdd) receiptDate = new Date(yyyymmdd[1], yyyymmdd[2] - 1, yyyymmdd[3]);
                          // Parse "23 de marzo, 2026"
                          if (!receiptDate) {
                            const spanishMatch = ocrResult.date.match(/(\d{1,2})\s+de\s+(\w+),?\s*(\d{4})/i);
                            if (spanishMatch) {
                              const months = { enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6, agosto:7, septiembre:8, octubre:9, noviembre:10, diciembre:11 };
                              const mo = months[spanishMatch[2].toLowerCase()];
                              if (mo !== undefined) receiptDate = new Date(spanishMatch[3], mo, spanishMatch[1]);
                            }
                          }

                          if (receiptDate) {
                            // Appointment date (Bolivia time)
                            const apptDate = new Date(bestMatch.date_time);
                            apptDate.setHours(0, 0, 0, 0);
                            receiptDate.setHours(0, 0, 0, 0);
                            // Receipt date must not be more than 30 days before appointment
                            const daysDiff = (apptDate - receiptDate) / (1000 * 60 * 60 * 24);
                            if (daysDiff > 30) {
                              problems.push(`fecha (comprobante ${ocrResult.date} muy antiguo)`);
                            }
                          }
                        }

                        if (problems.length === 0) {
                          // All validations passed → Confirmado
                          await pool.query(
                            `UPDATE payments SET status = 'Confirmado', confirmed_at = NOW(),
                             receipt_file_key = ?, ocr_extracted_amount = ?, ocr_extracted_ref = ?
                             WHERE id = ? AND tenant_id = ?`,
                            [fileKey, ocrResult.amount, ocrResult.reference, bestMatch.id, tenantId]
                          );

                          // Update GCal with $ prefix
                          try {
                            const calendarId = CALENDAR_ID();
                            if (calendarId && bestMatch.gcal_event_id) {
                              const { updateEventSummary } = require('../services/calendar');
                              const currentSummary = `Terapia ${bestMatch.first_name} ${bestMatch.last_name || ''} - ${bestMatch.client_phone}`.trim();
                              const base = currentSummary.replace(/^[\$✅]\s*/, '');
                              await updateEventSummary(calendarId, bestMatch.gcal_event_id, `$ ✅ ${base}`);
                              console.log(`[webhook] GCal updated with $ for payment ${bestMatch.id}`);
                            }
                          } catch (gcalErr) {
                            console.error(`[webhook] GCal $ update failed (non-fatal):`, gcalErr.message);
                          }

                          // Send confirmation reply
                          try {
                            const { sendTextMessage } = require('../services/whatsapp');
                            await sendTextMessage(phone, `Pago recibido: Bs ${ocrResult.amount}. Gracias, ${bestMatch.first_name}.`);
                          } catch (replyErr) {
                            console.error(`[webhook] Payment reply failed:`, replyErr.message);
                          }

                          console.log(`[webhook] Payment ${bestMatch.id} auto-confirmed via OCR for client ${clientId}`);
                        } else {
                          // Validation failed → Mismatch
                          await pool.query(
                            `UPDATE payments SET status = 'Mismatch', receipt_file_key = ?,
                             ocr_extracted_amount = ?, ocr_extracted_ref = ?,
                             notes = ?
                             WHERE id = ? AND tenant_id = ?`,
                            [fileKey, ocrResult.amount, ocrResult.reference, `Problemas: ${problems.join(', ')}`, bestMatch.id, tenantId]
                          );
                          console.log(`[webhook] Payment ${bestMatch.id} MISMATCH: ${problems.join(', ')}`);
                        }
                      } else {
                        console.log(`[webhook] OCR detected Bs ${ocrResult.amount} but no pending payment for client ${clientId}`);
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
            const metadata = ocrResult ? JSON.stringify({
              ocr_name: ocrResult.name || null,
              ocr_amount: ocrResult.amount || null,
              ocr_date: ocrResult.date || null,
              ocr_reference: ocrResult.reference || null,
              ocr_dest_name: ocrResult.destName || null,
              ocr_dest_verified: ocrResult.destVerified || false,
              ocr_bank: ocrResult.bank || null,
            }) : null;

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

    if (phone) { where += ' AND w.client_phone LIKE ?'; params.push(`%${phone}%`); }
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webhook/debug-check/:phone — test ✅ GCal logic without WhatsApp (admin, temporary)
router.get('/debug-check/:phone', authMiddleware, async (req, res) => {
  try {
    const { updateEventSummary, listEvents } = require('../services/calendar');
    const calendarId = CALENDAR_ID();
    const phone = req.params.phone;
    const dryRun = req.query.dry !== '0'; // default: dry run (don't actually update)

    // Search from start of today to 7 days ahead
    const now = new Date();
    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    todayStart.setHours(0, 0, 0, 0);
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await listEvents(calendarId, todayStart.toISOString(), weekLater.toISOString());
    const phoneShort = phone.slice(-8);

    const allTerapia = events.filter(e => e.summary?.startsWith('Terapia'));
    const matchEvent = events.find(e =>
      e.summary && e.summary.startsWith('Terapia') && !e.summary.startsWith('✅')
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
      await updateEventSummary(calendarId, matchEvent.id, `✅ ${matchEvent.summary}`);
      result.updated = true;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
