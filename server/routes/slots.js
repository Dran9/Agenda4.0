const { Router } = require('express');
const { getAvailableSlots, getPublicConfig, getAvailableSlotsBatch } = require('../services/slots');
const { sendServerError } = require('../utils/httpErrors');

const router = Router();
const DEFAULT_TENANT = 1;

// GET /api/slots/batch?dates=2026-04-08,2026-04-09,...
router.get('/batch', async (req, res) => {
  try {
    const { dates } = req.query;
    if (!dates) return res.status(400).json({ error: 'Falta parámetro: dates' });
    const dateList = dates.split(',').filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (dateList.length === 0) return res.status(400).json({ error: 'Sin fechas válidas' });
    if (dateList.length > 45) return res.status(400).json({ error: 'Máximo 45 fechas por lote' });
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const result = await getAvailableSlotsBatch(dateList, tenantId);
    res.json(result);
  } catch (err) {
    console.error('[slots-batch] Error:', err.message);
    res.json({});
  }
});

// GET /api/slots?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Falta parámetro: date' });
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const slots = await getAvailableSlots(date, tenantId);
    res.json({ slots, date });
  } catch (err) {
    console.error('[slots] Error:', err.message, err.response?.data || '');
    // Return empty slots instead of 500 — GCal errors shouldn't break the UI
    const payload = { slots: [], date: req.query.date, warning: 'No se pudieron cargar los horarios' };
    if (process.env.NODE_ENV !== 'production') {
      payload.debug = {
        message: err.message,
        response: err.response?.data || null,
      };
    }
    res.json(payload);
  }
});

// GET /api/config/public
router.get('/config/public', async (req, res) => {
  try {
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const config = await getPublicConfig(tenantId);
    if (!config) return res.status(404).json({ error: 'Config no encontrada' });
    res.json(config);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar la configuración pública',
      logLabel: 'slots public-config',
    });
  }
});

module.exports = router;
