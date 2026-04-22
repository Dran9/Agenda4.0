const { Router } = require('express');
const { pool, withTransaction } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { publicRateLimit } = require('../middleware/publicRateLimit');
const { validate, clientSchema } = require('../middleware/validate');
const { calculateRetentionStatus } = require('../services/retention');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone, hasPhoneDigits, normalizedPhoneSql } = require('../utils/phone');
const { broadcast } = require('../services/adminEvents');
const { deleteFile } = require('../services/storage');
const { getAutomaticLocalFee, getSpecialFee } = require('../services/clientPricing');
const {
  autoFitColumns,
  createWorkbook,
  formatDateBolivia,
  freezeHeader,
  setAutoFilter,
  styleDataGrid,
  styleHeaderRow,
} = require('../services/excelExport');

const router = Router();

async function getPricingConfig(tenantId) {
  const [rows] = await pool.query(
    'SELECT default_fee, capital_fee, special_fee, capital_cities FROM config WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  return rows[0] || {};
}

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

function recurringPriority(schedule) {
  if (!schedule) return 99;
  if (!schedule.ended_at && !schedule.paused_at) return 0;
  if (schedule.paused_at && !schedule.ended_at) return 1;
  return 2;
}

function pickRecurringSchedule(current, candidate) {
  if (!current) return candidate;
  const currentPriority = recurringPriority(current);
  const candidatePriority = recurringPriority(candidate);
  if (candidatePriority !== currentPriority) {
    return candidatePriority < currentPriority ? candidate : current;
  }
  return new Date(candidate.updated_at || 0) > new Date(current.updated_at || 0) ? candidate : current;
}

function describeRecurringSchedule(schedule) {
  if (!schedule || schedule.ended_at) {
    return { status: 'No recurrente', day: '', time: '', startedAt: '' };
  }
  if (schedule.paused_at) {
    return { status: 'Pausada', day: schedule.day_of_week, time: schedule.time || '', startedAt: schedule.started_at || '' };
  }
  return { status: 'Recurrente', day: schedule.day_of_week, time: schedule.time || '', startedAt: schedule.started_at || '' };
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

    // Build filter conditions
    const filters = [deletedFilter];
    const filterParams = [];

    // Search filter (name, phone, city)
    const search = String(req.query.search || '').trim();
    if (search) {
      filters.push(`(c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ? OR c.city LIKE ?)`);
      const searchPattern = `%${search}%`;
      filterParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // City filter
    const city = String(req.query.city || '').trim();
    if (city && city !== 'all') {
      filters.push('c.city = ?');
      filterParams.push(city);
    }

    // Source filter
    const source = String(req.query.source || '').trim();
    if (source && source !== 'all') {
      filters.push('c.source = ?');
      filterParams.push(source);
    }

    // Status filter applied after calculation (see below)

    const whereClause = filters.join(' AND ');

    // Sorting
    const sortBy = String(req.query.sort_by || 'created');
    const sortDir = String(req.query.sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let orderBy;
    switch (sortBy) {
      case 'name':
        orderBy = `c.first_name ${sortDir}, c.last_name ${sortDir}`;
        break;
      case 'last_session':
        orderBy = `last_session ${sortDir} IS NULL, last_session ${sortDir}`;
        break;
      case 'next_session':
        orderBy = `next_session ${sortDir} IS NULL, next_session ${sortDir}`;
        break;
      case 'created':
      default:
        orderBy = `CASE WHEN c.deleted_at IS NULL THEN 0 ELSE 1 END, COALESCE(c.deleted_at, c.created_at) ${sortDir}`;
        break;
    }

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
       WHERE c.tenant_id = ? AND ${whereClause}
       ORDER BY ${orderBy}`,
      [req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, ...filterParams]
    );

    const [cfgRows] = await pool.query('SELECT retention_rules FROM config WHERE tenant_id = ? LIMIT 1', [req.tenantId]);
    const retentionRules = cfgRows[0]?.retention_rules || null;

    // Calculate status and retention for each
    let result = clients;
    
    for (const client of result) {
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

    // Apply status filter after calculation
    const statusFilter = String(req.query.status || '').trim();
    if (statusFilter && statusFilter !== 'all') {
      result = result.filter(client => 
        client.status_override === statusFilter || 
        (!client.status_override && client.calculated_status === statusFilter)
      );
    }

    res.json(result);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron cargar los clientes',
      logLabel: 'clients list',
    });
  }
});

router.get('/export', authMiddleware, async (req, res) => {
  try {
    const view = String(req.query.view || 'active');
    const search = String(req.query.search || '').trim();
    const deletedFilter = view === 'archived'
      ? 'c.deleted_at IS NOT NULL'
      : view === 'all'
        ? '1=1'
        : 'c.deleted_at IS NULL';
    const searchFilter = search
      ? ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ? OR c.city LIKE ?)'
      : '';
    const searchParam = `%${search}%`;
    const params = [req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId, req.tenantId];
    if (search) params.push(searchParam, searchParam, searchParam, searchParam);

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
       WHERE c.tenant_id = ? AND ${deletedFilter}${searchFilter}
       ORDER BY
         CASE WHEN c.deleted_at IS NULL THEN 0 ELSE 1 END,
         COALESCE(c.deleted_at, c.created_at) DESC`,
      params
    );

    const [cfgRows] = await pool.query('SELECT retention_rules FROM config WHERE tenant_id = ? LIMIT 1', [req.tenantId]);
    const retentionRules = cfgRows[0]?.retention_rules || null;

    const clientIds = clients.map((client) => client.id);
    const recurringByClient = new Map();
    if (clientIds.length > 0) {
      const [recurringRows] = await pool.query(
        `SELECT *
         FROM recurring_schedules
         WHERE tenant_id = ? AND client_id IN (?)
         ORDER BY updated_at DESC, id DESC`,
        [req.tenantId, clientIds]
      );
      for (const schedule of recurringRows) {
        recurringByClient.set(
          schedule.client_id,
          pickRecurringSchedule(recurringByClient.get(schedule.client_id), schedule)
        );
      }
    }

    for (const client of clients) {
      const futureAppt = client.next_session ? { date_time: client.next_session } : null;
      const lastAppt = client.last_session ? { date_time: client.last_session } : null;
      client.calculated_status = calculateStatus(client, lastAppt, futureAppt, client.completed_sessions);
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
    }

    const workbook = createWorkbook();
    const sheet = workbook.addWorksheet('Contactos');
    sheet.columns = [
      { header: 'ID', key: 'id' },
      { header: 'Nombre', key: 'first_name' },
      { header: 'Apellido', key: 'last_name' },
      { header: 'Celular', key: 'phone' },
      { header: 'Ciudad', key: 'city' },
      { header: 'Pais', key: 'country' },
      { header: 'Zona horaria', key: 'timezone' },
      { header: 'Status', key: 'status' },
      { header: 'Retencion', key: 'retention_status' },
      { header: 'Dias desde ultima sesion', key: 'days_since_last_session' },
      { header: 'Recurrencia', key: 'recurring_status' },
      { header: 'Dia recurrencia', key: 'recurring_day' },
      { header: 'Hora recurrencia', key: 'recurring_time' },
      { header: 'Inicio recurrencia', key: 'recurring_started_at' },
      { header: 'Modalidad', key: 'modality' },
      { header: 'Frecuencia', key: 'frequency' },
      { header: 'Fuente', key: 'source' },
      { header: 'Arancel', key: 'fee' },
      { header: 'Moneda', key: 'fee_currency' },
      { header: 'Tarifa especial', key: 'special_fee_enabled' },
      { header: 'Perfil Stripe', key: 'foreign_pricing_key' },
      { header: 'Sesiones completadas', key: 'completed_sessions' },
      { header: 'Total citas', key: 'total_appointments' },
      { header: 'Reagendadas', key: 'reschedule_count' },
      { header: 'Ultima sesion', key: 'last_session' },
      { header: 'Proxima sesion', key: 'next_session' },
      { header: 'Fecha registro', key: 'created_at' },
      { header: 'Archivado', key: 'is_archived' },
      { header: 'Fecha archivado', key: 'deleted_at' },
    ];

    for (const client of clients) {
      const recurring = describeRecurringSchedule(recurringByClient.get(client.id));
      sheet.addRow({
        id: client.id,
        first_name: client.first_name || '',
        last_name: client.last_name || '',
        phone: client.phone || '',
        city: client.city || '',
        country: client.country || '',
        timezone: client.timezone || 'America/La_Paz',
        status: client.status_override || client.calculated_status || '',
        retention_status: client.retention_status || '',
        days_since_last_session: client.days_since_last_session ?? '',
        recurring_status: recurring.status,
        recurring_day: recurring.day,
        recurring_time: recurring.time,
        recurring_started_at: recurring.startedAt,
        modality: client.modality || '',
        frequency: client.frequency || '',
        source: client.source || '',
        fee: Number(client.fee || 0),
        fee_currency: client.fee_currency || 'BOB',
        special_fee_enabled: client.special_fee_enabled ? 'Sí' : 'No',
        foreign_pricing_key: client.foreign_pricing_key || '',
        completed_sessions: Number(client.completed_sessions || 0),
        total_appointments: Number(client.total_appointments || 0),
        reschedule_count: Number(client.reschedule_count || 0),
        last_session: formatDateBolivia(client.last_session, true),
        next_session: formatDateBolivia(client.next_session, true),
        created_at: formatDateBolivia(client.created_at, true),
        is_archived: client.deleted_at ? 'Si' : 'No',
        deleted_at: formatDateBolivia(client.deleted_at, true),
      });
    }

    styleHeaderRow(sheet);
    styleDataGrid(sheet);
    freezeHeader(sheet);
    setAutoFilter(sheet);
    autoFitColumns(sheet);
    sheet.getColumn('fee').numFmt = '#,##0.00';

    const safeView = view === 'archived' ? 'archivados' : view === 'all' ? 'todos' : 'activos';
    const filename = `contactos_${safeView}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo exportar el Excel de contactos',
      logLabel: 'clients export',
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
    const specialFeeEnabled = !!data.special_fee_enabled;
    const [existing] = await pool.query(
      `SELECT id FROM clients
       WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [phone, req.tenantId]
    );
    if (existing.length > 0) return res.json({ client_id: existing[0].id, existing: true });

    let fee = data.fee || 250;
    let feeCurrency = data.fee_currency || 'BOB';
    let foreignPricingKey = data.foreign_pricing_key || null;
    if (specialFeeEnabled) {
      const pricingConfig = await getPricingConfig(req.tenantId);
      fee = getSpecialFee(pricingConfig);
      feeCurrency = 'BOB';
      foreignPricingKey = null;
    }

    const [result] = await pool.query(
      `INSERT INTO clients (tenant_id, phone, first_name, last_name, age, city, country, timezone, modality, frequency, source, referred_by, fee, fee_currency, foreign_pricing_key, special_fee_enabled, payment_method, rating, diagnosis, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, phone, data.first_name, data.last_name, data.age || null,
       data.city || 'Cochabamba', data.country || 'Bolivia', data.timezone || 'America/La_Paz',
       data.modality || 'Presencial', data.frequency || 'Semanal', data.source || 'Otro',
       data.referred_by || null, fee, feeCurrency,
       foreignPricingKey, specialFeeEnabled ? 1 : 0, data.payment_method || 'QR', data.rating || 0,
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
      'status_override', 'phone', 'fee_currency', 'foreign_pricing_key', 'special_fee_enabled'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    const [currentRows] = await pool.query(
      'SELECT * FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (currentRows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const currentClient = currentRows[0];

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

    if (updates.fee_currency !== undefined) {
      const normalizedCurrency = String(updates.fee_currency || '').trim().toUpperCase();
      if (!['BOB', 'USD'].includes(normalizedCurrency)) {
        return res.status(400).json({ error: 'Moneda de arancel inválida' });
      }
      updates.fee_currency = normalizedCurrency;
    }

    if (updates.foreign_pricing_key !== undefined) {
      const key = String(updates.foreign_pricing_key || '').trim();
      updates.foreign_pricing_key = key || null;
    }

    if (updates.special_fee_enabled !== undefined) {
      updates.special_fee_enabled = updates.special_fee_enabled ? 1 : 0;
    }

    const effectiveSpecialFeeEnabled = updates.special_fee_enabled !== undefined
      ? !!updates.special_fee_enabled
      : !!currentClient.special_fee_enabled;

    if (effectiveSpecialFeeEnabled) {
      const pricingConfig = await getPricingConfig(req.tenantId);
      updates.special_fee_enabled = 1;
      updates.fee = getSpecialFee(pricingConfig);
      updates.fee_currency = 'BOB';
      updates.foreign_pricing_key = null;
    } else if (currentClient.special_fee_enabled && updates.special_fee_enabled !== undefined) {
      const pricingConfig = await getPricingConfig(req.tenantId);
      const nextClient = { ...currentClient, ...updates, special_fee_enabled: 0 };
      const automaticFee = getAutomaticLocalFee({
        city: nextClient.city,
        country: nextClient.country,
        config: pricingConfig,
      });
      if (automaticFee != null) {
        updates.fee = automaticFee;
        updates.fee_currency = 'BOB';
        updates.foreign_pricing_key = null;
      }
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
router.post('/check', publicRateLimit, async (req, res) => {
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
