const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const { saveFile, getFile, deleteFile } = require('../services/storage');
const { getSchedulerRuntime, refreshConfigSchedulers } = require('../cron/scheduler');
const { createPublicFeeToken } = require('../services/publicBookingToken');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone } = require('../utils/phone');
const { broadcast } = require('../services/adminEvents');
const { getSpecialFee } = require('../services/clientPricing');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const VALID_QR_KEYS = ['qr_300', 'qr_250', 'qr_150', 'qr_generico'];

function buildTenantBaseUrl(req, domain) {
  const trimmed = String(domain || '').trim().replace(/\/+$/, '');
  if (trimmed) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function normalizeForeignPricingProfiles(input) {
  if (input == null || input === '') return [];

  let parsed = input;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const usedKeys = new Set();
  const normalized = [];

  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const baseKey = String(row.key || row.name || row.label || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
    const key = baseKey || `usd-${normalized.length + 1}`;
    if (usedKeys.has(key)) continue;

    const amount = Number(row.amount);
    const url = String(row.url || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !url) continue;
    const stripeFeePercent = Math.max(0, Number(row.stripe_fee_percent ?? row.stripeFeePercent ?? 0) || 0);
    const meruFeePercent = Math.max(0, Number(row.meru_fee_percent ?? row.meruFeePercent ?? 0) || 0);
    const stripeFeeFixed = Math.max(0, Number(row.stripe_fee_fixed ?? row.stripeFeeFixed ?? 0) || 0);

    let parsedUrl = null;
    try {
      parsedUrl = new URL(url);
    } catch {
      parsedUrl = null;
    }
    if (!parsedUrl || !/^https?:$/i.test(parsedUrl.protocol)) continue;

    usedKeys.add(key);
    normalized.push({
      key,
      name: String(row.name || row.label || key).trim().slice(0, 80),
      amount: Math.round(amount * 100) / 100,
      currency: String(row.currency || 'USD').trim().toUpperCase() === 'BOB' ? 'BOB' : 'USD',
      stripe_fee_percent: Math.round(stripeFeePercent * 100) / 100,
      meru_fee_percent: Math.round(meruFeePercent * 100) / 100,
      stripe_fee_fixed: Math.round(stripeFeeFixed * 100) / 100,
      url: parsedUrl.toString(),
    });
    if (normalized.length >= 6) break;
  }

  return normalized;
}

// GET /api/config — get full config (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Config no encontrada' });
    res.json({ ...rows[0], _runtime: getSchedulerRuntime() });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar la configuración',
      logLabel: 'config get',
    });
  }
});

// PUT /api/config — update config (admin)
router.put('/', authMiddleware, async (req, res) => {
  try {
    const allowed = [
      'available_hours', 'available_days', 'window_days', 'buffer_hours',
      'appointment_duration', 'break_start', 'break_end', 'min_age', 'max_age',
      'default_fee', 'capital_fee', 'special_fee', 'foreign_fee', 'foreign_currency',
      'foreign_pricing_profiles', 'stripe_webhook_url', 'stripe_webhook_secret',
      'capital_cities', 'reminder_time', 'reminder_enabled',
      'payment_reminder_enabled', 'payment_reminder_hours',
      'payment_reminder_template', 'retention_risk_template', 'retention_lost_template', 'whatsapp_template_language',
      'auto_reply_confirm', 'auto_reply_reschedule', 'auto_reply_contact',
      'qr_url_capital', 'qr_url_provincia', 'qr_url_especial', 'qr_url_generico',
      'rate_limit_booking', 'rate_limit_window',
      'custom_statuses', 'custom_sources', 'retention_rules'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      if (key === 'foreign_pricing_profiles') {
        updates[key] = JSON.stringify(normalizeForeignPricingProfiles(req.body[key]));
        continue;
      }
      if (key === 'stripe_webhook_url') {
        const value = String(req.body[key] || '').trim().slice(0, 500);
        updates[key] = value || null;
        continue;
      }
      if (key === 'stripe_webhook_secret') {
        const value = String(req.body[key] || '').trim().slice(0, 255);
        updates[key] = value || null;
        continue;
      }
      updates[key] = typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.tenantId];
    await pool.query(`UPDATE config SET ${setClauses} WHERE tenant_id = ?`, values);
    if (updates.special_fee !== undefined) {
      const specialFee = getSpecialFee({ special_fee: updates.special_fee });
      await pool.query(
        `UPDATE clients
         SET fee = ?, fee_currency = 'BOB', foreign_pricing_key = NULL
         WHERE tenant_id = ? AND special_fee_enabled = 1 AND deleted_at IS NULL`,
        [specialFee, req.tenantId]
      );
      broadcast('client:change', { action: 'special_fee_sync' }, req.tenantId);
    }
    if (
      updates.reminder_time !== undefined ||
      updates.reminder_enabled !== undefined ||
      updates.payment_reminder_enabled !== undefined ||
      updates.payment_reminder_hours !== undefined
    ) {
      refreshConfigSchedulers();
    }
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo guardar la configuración',
      logLabel: 'config update',
    });
  }
});

// POST /api/config/special-fee-link — generate signed public link (admin)
router.post('/special-fee-link', authMiddleware, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (phone.length < 8 || phone.length > 20) {
      return res.status(400).json({ error: 'Teléfono inválido' });
    }

    const code = createPublicFeeToken({
      tenantId: req.tenantId,
      phone,
      feeMode: 'pe',
    });

    const [tenantResult, cfgResult] = await Promise.all([
      pool.query('SELECT domain FROM tenants WHERE id = ? LIMIT 1', [req.tenantId]),
      pool.query('SELECT special_fee FROM config WHERE tenant_id = ? LIMIT 1', [req.tenantId]),
    ]);
    const tenant = tenantResult[0]?.[0] || null;
    const cfg = cfgResult[0]?.[0] || null;

    const baseUrl = buildTenantBaseUrl(req, tenant?.domain);
    const url = `${baseUrl}/?t=${encodeURIComponent(phone)}&f=pe&code=${encodeURIComponent(code)}`;

    res.json({
      phone,
      fee_mode: 'pe',
      fee_amount: parseInt(cfg?.special_fee, 10) || null,
      code,
      url,
      expires_in: '30d',
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo generar el link de precio especial',
      logLabel: 'config special-fee-link',
    });
  }
});

// POST /api/config/qr/:key — upload QR image (admin)
router.post('/qr/:key', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!VALID_QR_KEYS.includes(req.params.key)) {
      return res.status(400).json({ error: 'Key inválido. Opciones: ' + VALID_QR_KEYS.join(', ') });
    }
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    await saveFile(req.tenantId, req.params.key, req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo subir el archivo',
      logLabel: 'config upload',
    });
  }
});

router.delete('/qr/:key', authMiddleware, async (req, res) => {
  try {
    if (!VALID_QR_KEYS.includes(req.params.key)) {
      return res.status(400).json({ error: 'Key inválido. Opciones: ' + VALID_QR_KEYS.join(', ') });
    }

    await deleteFile(req.tenantId, req.params.key);
    res.json({ success: true, deleted: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo borrar el QR',
      logLabel: 'config qr delete',
    });
  }
});

// GET /api/config/qr/:key — get QR image (public)
router.get('/qr/:key', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const file = await getFile(tenantId, req.params.key);
    if (!file) return res.status(404).json({ error: 'QR no encontrado' });
    res.set('Content-Type', file.mime_type);
    res.set('Cache-Control', 'no-store, max-age=0');
    res.send(file.data);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el archivo',
      logLabel: 'config qr',
    });
  }
});

module.exports = router;
