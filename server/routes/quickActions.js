const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendTextMessage } = require('../services/whatsapp');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone } = require('../utils/phone');
const { endRecurringSchedule } = require('../services/recurring');
const { broadcast } = require('../services/adminEvents');

const router = Router();

// ─── Helper: get tenant domain ──────────────────────────────────
async function getTenantDomain(tenantId) {
  const [rows] = await pool.query('SELECT domain FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  return rows[0]?.domain || '';
}

// ─── Helper: get client's next appointment ──────────────────────
async function getNextAppointment(clientId, tenantId) {
  const [rows] = await pool.query(
    `SELECT a.*, c.first_name, c.last_name, c.phone
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.client_id = ? AND a.tenant_id = ?
       AND a.status IN ('Agendada','Confirmada','Reagendada')
       AND a.date_time > NOW()
     ORDER BY a.date_time ASC
     LIMIT 1`,
    [clientId, tenantId]
  );
  return rows[0] || null;
}

// ─── Helper: get active recurring schedule ──────────────────────
async function getActiveRecurring(clientId, tenantId) {
  const [rows] = await pool.query(
    `SELECT * FROM recurring_schedules
     WHERE client_id = ? AND tenant_id = ? AND ended_at IS NULL AND paused_at IS NULL
     LIMIT 1`,
    [clientId, tenantId]
  );
  return rows[0] || null;
}

// ─── GET /api/quick-actions/clients — lightweight search ────────
router.get('/clients', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    const t = req.tenantId;

    let where = 'c.tenant_id = ? AND c.deleted_at IS NULL';
    const params = [t];

    if (q && q.trim()) {
      where += ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)';
      const s = `%${q.trim()}%`;
      params.push(s, s, s);
    }

    const [clients] = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.phone, c.fee, c.frequency, c.city,
        (SELECT MIN(a2.date_time) FROM appointments a2
         WHERE a2.client_id = c.id AND a2.tenant_id = ?
           AND a2.status IN ('Agendada','Confirmada','Reagendada')
           AND a2.date_time > NOW()) as next_appointment,
        (SELECT a2.id FROM appointments a2
         WHERE a2.client_id = c.id AND a2.tenant_id = ?
           AND a2.status IN ('Agendada','Confirmada','Reagendada')
           AND a2.date_time > NOW()
         ORDER BY a2.date_time ASC LIMIT 1) as next_appointment_id,
        (SELECT a3.id FROM appointments a3
         WHERE a3.client_id = c.id AND a3.tenant_id = ?
           AND a3.status = 'Completada'
         ORDER BY a3.date_time DESC LIMIT 1) as last_completed_id,
        (SELECT a3.date_time FROM appointments a3
         WHERE a3.client_id = c.id AND a3.tenant_id = ?
           AND a3.status = 'Completada'
         ORDER BY a3.date_time DESC LIMIT 1) as last_completed_date,
        (SELECT COUNT(*) FROM recurring_schedules rs
         WHERE rs.client_id = c.id AND rs.tenant_id = ?
           AND rs.ended_at IS NULL AND rs.paused_at IS NULL) as has_recurring,
        (SELECT COUNT(*) FROM recurring_schedules rs
         WHERE rs.client_id = c.id AND rs.tenant_id = ?
           AND rs.ended_at IS NULL AND rs.paused_at IS NOT NULL) as has_paused_recurring,
        (SELECT rs2.day_of_week FROM recurring_schedules rs2
         WHERE rs2.client_id = c.id AND rs2.tenant_id = ?
           AND rs2.ended_at IS NULL
         ORDER BY CASE WHEN rs2.paused_at IS NULL THEN 0 ELSE 1 END
         LIMIT 1) as recurring_day,
        (SELECT rs2.time FROM recurring_schedules rs2
         WHERE rs2.client_id = c.id AND rs2.tenant_id = ?
           AND rs2.ended_at IS NULL
         ORDER BY CASE WHEN rs2.paused_at IS NULL THEN 0 ELSE 1 END
         LIMIT 1) as recurring_time,
        (SELECT COUNT(*) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status = 'Completada') as completed_sessions
       FROM clients c
       WHERE ${where}
       ORDER BY c.first_name ASC
       LIMIT 20`,
      [t, t, t, t, t, t, t, t, t, ...params]
    );

    res.json(clients);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron buscar clientes',
      logLabel: 'quick-actions search',
    });
  }
});

// ─── GET /api/quick-actions/clients/:id — single client refresh ──
router.get('/clients/:id', authMiddleware, async (req, res) => {
  try {
    const t = req.tenantId;
    const clientId = Number(req.params.id);

    const [clients] = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.phone, c.fee, c.frequency, c.city,
        (SELECT MIN(a2.date_time) FROM appointments a2
         WHERE a2.client_id = c.id AND a2.tenant_id = ?
           AND a2.status IN ('Agendada','Confirmada','Reagendada')
           AND a2.date_time > NOW()) as next_appointment,
        (SELECT a2.id FROM appointments a2
         WHERE a2.client_id = c.id AND a2.tenant_id = ?
           AND a2.status IN ('Agendada','Confirmada','Reagendada')
           AND a2.date_time > NOW()
         ORDER BY a2.date_time ASC LIMIT 1) as next_appointment_id,
        (SELECT a3.id FROM appointments a3
         WHERE a3.client_id = c.id AND a3.tenant_id = ?
           AND a3.status = 'Completada'
         ORDER BY a3.date_time DESC LIMIT 1) as last_completed_id,
        (SELECT a3.date_time FROM appointments a3
         WHERE a3.client_id = c.id AND a3.tenant_id = ?
           AND a3.status = 'Completada'
         ORDER BY a3.date_time DESC LIMIT 1) as last_completed_date,
        (SELECT COUNT(*) FROM recurring_schedules rs
         WHERE rs.client_id = c.id AND rs.tenant_id = ?
           AND rs.ended_at IS NULL AND rs.paused_at IS NULL) as has_recurring,
        (SELECT COUNT(*) FROM recurring_schedules rs
         WHERE rs.client_id = c.id AND rs.tenant_id = ?
           AND rs.ended_at IS NULL AND rs.paused_at IS NOT NULL) as has_paused_recurring,
        (SELECT rs2.day_of_week FROM recurring_schedules rs2
         WHERE rs2.client_id = c.id AND rs2.tenant_id = ?
           AND rs2.ended_at IS NULL
         ORDER BY CASE WHEN rs2.paused_at IS NULL THEN 0 ELSE 1 END
         LIMIT 1) as recurring_day,
        (SELECT rs2.time FROM recurring_schedules rs2
         WHERE rs2.client_id = c.id AND rs2.tenant_id = ?
           AND rs2.ended_at IS NULL
         ORDER BY CASE WHEN rs2.paused_at IS NULL THEN 0 ELSE 1 END
         LIMIT 1) as recurring_time,
        (SELECT COUNT(*) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status = 'Completada') as completed_sessions
       FROM clients c
       WHERE c.id = ? AND c.tenant_id = ? AND c.deleted_at IS NULL`,
      [t, t, t, t, t, t, t, t, t, clientId, t]
    );

    if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(clients[0]);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el cliente',
      logLabel: 'quick-actions client-detail',
    });
  }
});

// ─── POST /api/quick-actions/send-reschedule-link ───────────────
router.post('/send-reschedule-link', authMiddleware, async (req, res) => {
  try {
    const { client_id } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id requerido' });

    const [clients] = await pool.query(
      'SELECT id, phone, first_name FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [client_id, req.tenantId]
    );
    if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    const client = clients[0];
    const domain = await getTenantDomain(req.tenantId);
    if (!domain) return res.status(500).json({ error: 'Dominio del tenant no configurado' });

    const phone = normalizePhone(client.phone);
    const link = `https://${domain}/?r=${phone}`;
    const nombre = client.first_name.split(' ')[0];
    const text = `Hola ${nombre}, puedes reprogramar tu cita desde aquí:\n\n${link}`;

    const result = await sendTextMessage(phone, text);

    // Log in webhooks_log
    await pool.query(
      `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id)
       VALUES (?, 'reschedule_link_sent', 'message_sent', ?, 'enviado', ?, ?)`,
      [req.tenantId, JSON.stringify({ wa_message_id: result.messages?.[0]?.id, link }), phone, client_id]
    );

    res.json({ success: true, message_id: result.messages?.[0]?.id, link });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo enviar el link de reagendamiento',
      logLabel: 'quick-actions reschedule-link',
    });
  }
});

// ─── POST /api/quick-actions/cancel ─────────────────────────────
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { client_id, end_recurring = false, send_whatsapp = false } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id requerido' });

    const appt = await getNextAppointment(client_id, req.tenantId);
    const actions = [];

    // Cancel next appointment if exists
    if (appt) {
      await pool.query(
        "UPDATE appointments SET status = 'Cancelada' WHERE id = ? AND tenant_id = ?",
        [appt.id, req.tenantId]
      );

      // Try to delete GCal event
      if (appt.gcal_event_id) {
        try {
          const { deleteEvent } = require('../services/calendar');
          const calendarId = process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
          await deleteEvent(calendarId, appt.gcal_event_id);
        } catch (gcalErr) {
          if (![404, 410].includes(gcalErr.code)) {
            console.error('[quick-actions] GCal delete failed:', gcalErr.message);
          }
        }
      }

      actions.push({ type: 'appointment_cancelled', appointment_id: appt.id });
    }

    // End recurring schedule if requested (uses service function → also deletes GCal series)
    if (end_recurring) {
      const schedule = await getActiveRecurring(client_id, req.tenantId);
      if (schedule) {
        await endRecurringSchedule(req.tenantId, schedule.id);
        actions.push({ type: 'recurring_ended', schedule_id: schedule.id });
      }
    }

    // Send WhatsApp notification
    if (send_whatsapp && appt) {
      try {
        const nombre = appt.first_name.split(' ')[0];
        const text = `Hola ${nombre}, tu cita ha sido cancelada. Si necesitas reagendar, no dudes en escribirme.`;
        const result = await sendTextMessage(normalizePhone(appt.phone), text);
        actions.push({ type: 'whatsapp_sent', message_id: result.messages?.[0]?.id });
      } catch (waErr) {
        actions.push({ type: 'whatsapp_failed', error: waErr.message });
      }
    }

    // Log
    await pool.query(
      `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_id)
       VALUES (?, 'quick_action_cancel', 'cancel', ?, 'procesado', ?)`,
      [req.tenantId, JSON.stringify({ actions, end_recurring }), client_id]
    );

    broadcast('appointment:change', { action: 'cancelled', client_id }, req.tenantId);
    if (end_recurring) broadcast('recurring:change', { action: 'ended', client_id }, req.tenantId);
    res.json({ success: true, actions, had_appointment: !!appt });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cancelar',
      logLabel: 'quick-actions cancel',
    });
  }
});

// ─── POST /api/quick-actions/noshow ─────────────────────────────
router.post('/noshow', authMiddleware, async (req, res) => {
  try {
    const { client_id, send_whatsapp = false } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id requerido' });

    // Find today's or most recent upcoming appointment
    const [rows] = await pool.query(
      `SELECT a.*, c.first_name, c.phone
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       WHERE a.client_id = ? AND a.tenant_id = ?
         AND a.status IN ('Agendada','Confirmada','Reagendada')
         AND DATE(a.date_time) <= CURDATE()
       ORDER BY a.date_time DESC
       LIMIT 1`,
      [client_id, req.tenantId]
    );

    if (rows.length === 0) {
      // Fallback: check next future appointment
      const nextAppt = await getNextAppointment(client_id, req.tenantId);
      if (!nextAppt) return res.status(404).json({ error: 'No se encontró cita para marcar como no-show' });
      rows.push(nextAppt);
    }

    const appt = rows[0];
    await pool.query(
      "UPDATE appointments SET status = 'No-show' WHERE id = ? AND tenant_id = ?",
      [appt.id, req.tenantId]
    );

    const actions = [{ type: 'marked_noshow', appointment_id: appt.id }];

    if (send_whatsapp) {
      try {
        const nombre = appt.first_name.split(' ')[0];
        const text = `Hola ${nombre}, no pudimos verte hoy. Si quieres reagendar tu cita, escríbeme y coordinamos.`;
        const result = await sendTextMessage(normalizePhone(appt.phone), text);
        actions.push({ type: 'whatsapp_sent', message_id: result.messages?.[0]?.id });
      } catch (waErr) {
        actions.push({ type: 'whatsapp_failed', error: waErr.message });
      }
    }

    await pool.query(
      `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_id, appointment_id)
       VALUES (?, 'quick_action_noshow', 'status_change', ?, 'procesado', ?, ?)`,
      [req.tenantId, JSON.stringify({ actions }), client_id, appt.id]
    );

    broadcast('appointment:change', { id: appt.id, action: 'noshow' }, req.tenantId);
    res.json({ success: true, actions, appointment_id: appt.id });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo marcar como no-show',
      logLabel: 'quick-actions noshow',
    });
  }
});

// ─── POST /api/quick-actions/update-fee ─────────────────────────
router.post('/update-fee', authMiddleware, async (req, res) => {
  try {
    const { client_id, fee } = req.body;
    if (!client_id || fee === undefined) return res.status(400).json({ error: 'client_id y fee requeridos' });
    if (isNaN(fee) || fee < 0) return res.status(400).json({ error: 'Arancel inválido' });

    await pool.query(
      'UPDATE clients SET fee = ? WHERE id = ? AND tenant_id = ?',
      [parseInt(fee, 10), client_id, req.tenantId]
    );

    broadcast('client:change', { id: client_id, action: 'fee_updated', fee: parseInt(fee, 10) }, req.tenantId);
    res.json({ success: true, fee: parseInt(fee, 10) });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo actualizar el arancel',
      logLabel: 'quick-actions fee',
    });
  }
});

// ─── POST /api/quick-actions/send-reminder ──────────────────────
router.post('/send-reminder', authMiddleware, async (req, res) => {
  try {
    const { client_id } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id requerido' });

    const { checkAndSendReminders } = require('../services/reminder');
    const result = await checkAndSendReminders({
      tenantId: req.tenantId,
      force: true,
      clientId: String(client_id),
    });

    res.json({ success: true, ...result });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo enviar el recordatorio',
      logLabel: 'quick-actions reminder',
    });
  }
});

module.exports = router;
