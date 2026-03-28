const { Router } = require('express');
const { pool } = require('../db');

const router = Router();

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

          // Resolve client
          const [clients] = await pool.query(
            'SELECT id, first_name FROM clients WHERE phone = ? AND tenant_id = ? AND deleted_at IS NULL',
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

            // Auto-reply based on config
            if (payload && clientId) {
              const [cfgRows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [tenantId]);
              const cfg = cfgRows[0];
              const { sendTextMessage, sendImageMessage } = require('../services/whatsapp');

              let replyText = null;
              if (payload === 'CONFIRM_NOW' && cfg?.auto_reply_confirm) {
                // Get next appointment for personalization
                const [appts] = await pool.query(
                  `SELECT id, date_time, gcal_event_id FROM appointments WHERE client_id = ? AND status = 'Confirmada' AND date_time > NOW() ORDER BY date_time LIMIT 1`,
                  [clientId]
                );
                replyText = cfg.auto_reply_confirm
                  .replace('{{nombre}}', clients[0]?.first_name || '')
                  .replace('{{dia}}', appts[0] ? new Date(appts[0].date_time).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' }) : '')
                  .replace('{{hora}}', appts[0] ? new Date(appts[0].date_time).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }) : '');

                // Mark appointment as confirmed (if exists in DB)
                if (appts[0]) {
                  await pool.query(
                    `UPDATE appointments SET confirmed_at = NOW() WHERE id = ?`,
                    [appts[0].id]
                  );
                }

                // Add ✅ to GCal event summary
                try {
                  const { updateEventSummary, listEvents, getCalendar } = require('../services/calendar');
                  const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
                  let checkDone = false;

                  // Try direct update by event ID first
                  if (appts[0]?.gcal_event_id) {
                    try {
                      const cal = getCalendar();
                      const ev = await cal.events.get({ calendarId, eventId: appts[0].gcal_event_id });
                      const currentSummary = ev.data.summary || '';
                      if (!currentSummary.startsWith('✅')) {
                        await updateEventSummary(calendarId, appts[0].gcal_event_id, `✅ ${currentSummary}`);
                        console.log(`[webhook] GCal updated: ✅ ${currentSummary}`);
                      }
                      checkDone = true;
                    } catch (directErr) {
                      console.log(`[webhook] Direct GCal update failed, trying fallback: ${directErr.message}`);
                    }
                  }

                  // Fallback: search upcoming events by phone number (handles moved/manual events)
                  if (!checkDone) {
                    // Search from start of today (BOT) to 7 days ahead
                    const now = new Date();
                    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
                    todayStart.setHours(0, 0, 0, 0);
                    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                    const events = await listEvents(calendarId, todayStart.toISOString(), weekLater.toISOString());
                    // Match by last 8 digits (phone in GCal may not have country code)
                    const phoneShort = phone.slice(-8);
                    const matchEvent = events.find(e =>
                      e.summary && e.summary.startsWith('Terapia') && !e.summary.startsWith('✅')
                      && (e.summary.includes(phone) || e.summary.includes(phoneShort))
                    );
                    if (matchEvent) {
                      await updateEventSummary(calendarId, matchEvent.id, `✅ ${matchEvent.summary}`);
                      console.log(`[webhook] GCal updated (by phone): ✅ ${matchEvent.summary}`);
                    } else {
                      console.log(`[webhook] No GCal event found for phone ${phone} (short: ${phoneShort})`);
                    }
                  }
                } catch (gcalErr) {
                  console.error(`[webhook] GCal update failed:`, gcalErr.message);
                }
              } else if (payload === 'REAGEN_NOW' && cfg?.auto_reply_reschedule) {
                const domain = (await pool.query('SELECT domain FROM tenants WHERE id = ?', [tenantId]))[0]?.[0]?.domain || '';
                replyText = cfg.auto_reply_reschedule.replace('{{link}}', `https://${domain}`);
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

                  // Send QR payment image after confirmation
                  if (payload === 'CONFIRM_NOW') {
                    try {
                      const [clientRows] = await pool.query('SELECT fee, city FROM clients WHERE id = ?', [clientId]);
                      const client = clientRows[0];
                      if (client) {
                        const capitalCities = (cfg.capital_cities || '').split(',').map(c => c.trim());
                        let qrKey;
                        const fee = parseFloat(client.fee);
                        if (fee === parseFloat(cfg.capital_fee)) qrKey = 'qr_300';
                        else if (fee === parseFloat(cfg.special_fee)) qrKey = 'qr_150';
                        else if (fee === parseFloat(cfg.default_fee)) qrKey = 'qr_250';
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
              }
            } catch (mediaErr) {
              console.error(`[webhook] Media download failed:`, mediaErr.message);
            }

            const content = mediaData
              ? `[${msg.type === 'image' ? 'Imagen' : 'Documento'}] ${caption || filename || ''} (guardado: ${mediaData})`
              : `[${msg.type === 'image' ? 'Imagen' : 'Documento'}] ${caption || filename || ''} (no descargado)`;

            await pool.query(
              `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
               VALUES (?, ?, ?, 'inbound', ?, ?, ?)`,
              [tenantId, clientId, phone, msg.type, content, msg.id]
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
      `SELECT w.*, c.first_name, c.last_name
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
    const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
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
