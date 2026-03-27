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
              const { sendTextMessage } = require('../services/whatsapp');

              let replyText = null;
              if (payload === 'CONFIRM_NOW' && cfg?.auto_reply_confirm) {
                // Get next appointment for personalization
                const [appts] = await pool.query(
                  `SELECT date_time FROM appointments WHERE client_id = ? AND status = 'Confirmada' AND date_time > NOW() ORDER BY date_time LIMIT 1`,
                  [clientId]
                );
                replyText = cfg.auto_reply_confirm
                  .replace('{{nombre}}', clients[0]?.first_name || '')
                  .replace('{{dia}}', appts[0] ? new Date(appts[0].date_time).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' }) : '')
                  .replace('{{hora}}', appts[0] ? new Date(appts[0].date_time).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }) : '');

                // Mark appointment as confirmed
                if (appts[0]) {
                  await pool.query(
                    `UPDATE appointments SET confirmed_at = NOW() WHERE client_id = ? AND status = 'Confirmada' AND date_time > NOW()`,
                    [clientId]
                  );
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
          }
        }
      }
    }
  } catch (err) {
    console.error('[webhook] Processing error:', err.message);
  }
});

module.exports = router;
