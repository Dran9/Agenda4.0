const { Router } = require('express');
const { pool, withTransaction } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { validate, clientSchema } = require('../middleware/validate');
const { calculateRetentionStatus } = require('../services/retention');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone, hasPhoneDigits, normalizedPhoneSql } = require('../utils/phone');
const { broadcast } = require('../services/adminEvents');
const { deleteFile } = require('../services/storage');

const router = Router();

// Helper: calculate client status based on rules from SPECS
function calculateStatus(client, lastAppt, futureAppt, completedCount) {
  if (client.deleted_at) return 'Archivado';
  if (client.status_override === 'Archivado') return 'Archivado';
  if (client.status_override) return client.status_override;
  if (client.has_active_recurring > 0) return 'Recurrente';
  if (client.has_paused_recurring > 0) return 'En pausa';
  if (completedCount === 0) return 'Nuevo';
  if (futureAppt || (lastAppt && daysSince(lastAppt.date_time) < 21)) {
    return completedCount >= 10 ? 'Recurrente' : 'Activo';
  }
  if (lastAppt && daysSince(lastAppt.date_time) <= 56) return 'En pausa';
  return 'Inactivo';
}

function daysSince(dateTime) {
  return Math.floor((Date.now() - new Date(dateTime).getTime()) / (1000 * 60 * 60 * 24));
}

function sanitizePublicClientStatus(result) {
  if (!result?.status) return { status: 'new' };
  if (result.status === 'has_appointment') {
    return {
      status: 'has_appointment',
      appointment: result.appointment,
      reschedule_token: result.reschedule_token,
    };
  }
  return { status: result.status };
}

// GET /api/clients — list all (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const view = String(req.query.view || 'active');
    const deletedFilter = view === 'archived'
      ? 'c.deleted_at IS NOT NULL'
      : view === 'all'
        ? '1=1'
        : 'c.deleted_at IS NULL';

    const [clients] = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status = 'Completada') as completed_sessions,
        (SELECT MAX(date_time) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status = 'Completada') as last_session,
        (SELECT MIN(date_time) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status = 'Completada') as first_session,
        (SELECT MIN(date_time) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status IN ('Agendada','Confirmada','Reagendada') AND date_time > NOW()) as next_session,
        (SELECT COUNT(*) FROM appointments WHERE client_id = c.id AND tenant_id = ?) as total_appointments,
        (SELECT COUNT(*) FROM appointments WHERE client_id = c.id AND tenant_id = ? AND status = 'Reagendada') as reschedule_count,
        (SELECT COUNT(*) FROM recurring_schedules WHERE client_id = c.id AND tenant_id = ? AND ended_at IS NULL AND paused_at IS NULL) as has_active_recurring,
        (SELECT COUNT(*) FROM recurring_schedules WHERE client_id = c.id AND tenant_id = ? AND ended_at IS NULL AND paused_at IS NOT NULL) as has_paused_recurring
       FROM clients c
       WHERE c.tenant_id = ? AND ${deletedFilter}
       ORDER BY
         CASE WHEN c.deleted_at IS NULL THEN 0 ELSE 1 END,
         COALESCE(c.deleted_at, c.created_at) DESC`,
      [req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId]
    );

    const [cfgRows] = await pool.query('SELECT retention_rules FROM config WHERE tenant_id = ? LIMIT 1', [req.tenantId]);
    const retentionRules = cfgRows[0]?.retention_rules || null;

    // Calculate status and retention for each
    for (const client of clients) {
      const futureAppt = client.next_session ? { date_time: client.next_session } : null;
      const lastAppt = client.last_session ? { date_time: client.last_session } : null;
      client.calculated_status = calculateStatus(client, lastAppt, futureAppt, client.completed_sessions);
      client.next_appointment = futureAppt || null;

      const retention = calculateRetentionStatus({
        frequency: client.frequency,
        completedSessions: client.completed_sessions,
        lastSession: client.last_session,
        nextAppointment: client.next_session,
        rules: retentionRules,
        hasActiveRecurring: client.has_active_recurring > 0,
        hasPausedRecurring: client.has_paused_recurring > 0,
      });
      client.retention_status = retention.status;
      client.days_since_last_session = retention.days_since_last_session;
      client.retention_thresholds = retention.thresholds;
    }

    res.json(clients);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron cargar los clientes',
      logLabel: 'clients list',
    });
  }
});

// POST /api/clients/:id/restore — restore archived client (admin)
router.post('/:id/restore', authMiddleware, async (req, res) => {
  try {
    const [clientRows] = await pool.query(
      'SELECT id FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL',
      [req.params.id, req.tenantId]
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'Cliente archivado no encontrado' });
    }

    await pool.query(
      'UPDATE clients SET deleted_at = NULL WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    broadcast('client:change', { id: Number(req.params.id), action: 'restored' }, req.tenantId);
    res.json({ success: true, restored: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo restaurar el cliente',
      logLabel: 'clients restore',
    });
  }
});

// DELETE /api/clients/:id/purge — permanently delete archived client (admin)
router.delete('/:id/purge', authMiddleware, async (req, res) => {
  try {
    const receiptKeys = await withTransaction(async (conn) => {
      const [clientRows] = await conn.query(
        'SELECT id, phone FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL',
        [req.params.id, req.tenantId]
      );
      if (clientRows.length === 0) {
        return { notFound: true, receiptKeys: [] };
      }

      const client = clientRows[0];
      const [paymentRows] = await conn.query(
        'SELECT receipt_file_key FROM payments WHERE client_id = ? AND tenant_id = ?',
        [client.id, req.tenantId]
      );
      const fileKeys = paymentRows
        .map((payment) => payment.receipt_file_key)
        .filter(Boolean);

      await conn.query(
        'DELETE FROM webhooks_log WHERE tenant_id = ? AND (client_id = ? OR client_phone = ?)',
        [req.tenantId, client.id, client.phone]
      );
      await conn.query(
        'DELETE FROM wa_conversations WHERE tenant_id = ? AND client_id = ?',
        [req.tenantId, client.id]
      );
      await conn.query(
        'DELETE FROM payments WHERE tenant_id = ? AND client_id = ?',
        [req.tenantId, client.id]
      );
      await conn.query(
        'DELETE FROM appointments WHERE tenant_id = ? AND client_id = ?',
        [req.tenantId, client.id]
      );
      await conn.query(
        'DELETE FROM recurring_schedules WHERE tenant_id = ? AND client_id = ?',
        [req.tenantId, client.id]
      );
      await conn.query(
        'DELETE FROM clients WHERE tenant_id = ? AND id = ?',
        [req.tenantId, client.id]
      );

      return { notFound: false, receiptKeys: fileKeys };
    });

    if (receiptKeys.notFound) {
      return res.status(404).json({ error: 'Cliente archivado no encontrado' });
    }

    await Promise.all(receiptKeys.receiptKeys.map((fileKey) => deleteFile(req.tenantId, fileKey)));
    broadcast('client:change', { id: Number(req.params.id), action: 'purged' }, req.tenantId);
    res.json({ success: true, purged: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo borrar definitivamente el cliente',
      logLabel: 'clients purge',
    });
  }
});

// GET /api/clients/:id — single client detail (admin)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [clients] = await pool.query(
      'SELECT * FROM clients WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    const client = clients[0];

    // Appointments history
    const [appointments] = await pool.query(
      'SELECT * FROM appointments WHERE client_id = ? AND tenant_id = ? ORDER BY date_time DESC',
      [client.id, req.tenantId]
    );

    // Payments history
    const [payments] = await pool.query(
      'SELECT * FROM payments WHERE client_id = ? AND tenant_id = ? ORDER BY created_at DESC',
      [client.id, req.tenantId]
    );

    const [recurringRows] = await pool.query(
      `SELECT *
       FROM recurring_schedules
       WHERE tenant_id = ? AND client_id = ?
       ORDER BY
         CASE WHEN ended_at IS NULL AND paused_at IS NULL THEN 0 ELSE 1 END,
         updated_at DESC,
         id DESC
       LIMIT 1`,
      [req.tenantId, client.id]
    );

    res.json({ client, appointments, payments, recurring_schedule: recurringRows[0] || null });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el cliente',
      logLabel: 'clients detail',
    });
  }
});

// POST /api/clients — create client (admin)
router.post('/', authMiddleware, validate(clientSchema), async (req, res) => {
  try {
    const data = req.validated;
    const phone = normalizePhone(data.phone);
    const [existing] = await pool.query(
      `SELECT id FROM clients
       WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [phone, req.tenantId]
    );
    if (existing.length > 0) return res.json({ client_id: existing[0].id, existing: true });

    const [result] = await pool.query(
      `INSERT INTO clients (tenant_id, phone, first_name, last_name, age, city, country, timezone, modality, frequency, source, referred_by, fee, payment_method, rating, diagnosis, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, phone, data.first_name, data.last_name, data.age || null,
       data.city || 'Cochabamba', data.country || 'Bolivia', data.timezone || 'America/La_Paz',
       data.modality || 'Presencial', data.frequency || 'Semanal', data.source || 'Otro',
       data.referred_by || null, data.fee || 250, data.payment_method || 'QR', data.rating || 0,
       data.diagnosis || null, data.notes || null]
    );
    res.json({ client_id: result.insertId, existing: false });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo crear el cliente',
      logLabel: 'clients create',
    });
  }
});

// PUT /api/clients/:id — update client (admin)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const allowed = [
      'first_name', 'last_name', 'age', 'city', 'country', 'timezone', 'modality', 'frequency',
      'source', 'referred_by', 'fee', 'payment_method', 'rating', 'diagnosis', 'notes',
      'status_override', 'phone'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    if (updates.phone !== undefined) {
      const normalized = normalizePhone(updates.phone);
      if (!hasPhoneDigits(normalized)) {
        return res.status(400).json({ error: 'Telefono invalido' });
      }
      const [existing] = await pool.query(
        `SELECT id FROM clients
         WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? AND deleted_at IS NULL AND id <> ?
         LIMIT 1`,
        [normalized, req.tenantId, req.params.id]
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Ya existe un cliente con ese telefono' });
      }
      updates.phone = normalized;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id, req.tenantId];
    await pool.query(`UPDATE clients SET ${setClauses} WHERE id = ? AND tenant_id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo actualizar el cliente',
      logLabel: 'clients update',
    });
  }
});

// DELETE /api/clients/:id — archive client (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [clientRows] = await pool.query(
      'SELECT id FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [req.params.id, req.tenantId]
    );
    if (clientRows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    await pool.query(
      'UPDATE clients SET deleted_at = NOW() WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    broadcast('client:change', { id: Number(req.params.id), action: 'archived' }, req.tenantId);
    res.json({ success: true, archived: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo archivar el cliente',
      logLabel: 'clients archive',
    });
  }
});

// POST /api/client/check — public phone check (no auth)
router.post('/check', async (req, res) => {
  try {
    if (req.baseUrl === '/api/clients') {
      return res.status(404).json({ error: 'Endpoint no encontrado' });
    }

    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Campo requerido: phone' });
    const { checkClientByPhone } = require('../services/booking');
    const tenantId = req.tenantId || 1;
    const result = await checkClientByPhone(phone, tenantId, { reactivateDeleted: false });
    res.json(sanitizePublicClientStatus(result));
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo verificar el cliente',
      logLabel: 'client check',
    });
  }
});

module.exports = router;
