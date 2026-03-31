const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const { saveFile, getFile, listFiles } = require('../services/storage');
const { getSchedulerRuntime, refreshConfigSchedulers } = require('../cron/scheduler');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/config — get full config (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM config WHERE tenant_id = ?', [req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Config no encontrada' });
    res.json({ ...rows[0], _runtime: getSchedulerRuntime() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config — update config (admin)
router.put('/', authMiddleware, async (req, res) => {
  try {
    const allowed = [
      'available_hours', 'available_days', 'window_days', 'buffer_hours',
      'appointment_duration', 'break_start', 'break_end', 'min_age', 'max_age',
      'default_fee', 'capital_fee', 'special_fee', 'foreign_fee', 'foreign_currency',
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
      if (req.body[key] !== undefined) {
        updates[key] = typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.tenantId];
    await pool.query(`UPDATE config SET ${setClauses} WHERE tenant_id = ?`, values);
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/qr/:key — upload QR image (admin)
router.post('/qr/:key', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const validKeys = ['qr_300', 'qr_250', 'qr_150', 'qr_generico'];
    if (!validKeys.includes(req.params.key)) {
      return res.status(400).json({ error: 'Key inválido. Opciones: ' + validKeys.join(', ') });
    }
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    await saveFile(req.tenantId, req.params.key, req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config/qr/:key — get QR image (public)
router.get('/qr/:key', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const file = await getFile(tenantId, req.params.key);
    if (!file) return res.status(404).json({ error: 'QR no encontrado' });
    res.set('Content-Type', file.mime_type);
    res.send(file.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
