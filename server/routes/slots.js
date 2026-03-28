const { Router } = require('express');
const { getAvailableSlots, getPublicConfig } = require('../services/slots');

const router = Router();
const DEFAULT_TENANT = 1;

// GET /api/slots?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Falta parámetro: date' });
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const slots = await getAvailableSlots(date, tenantId);
    res.json({ slots, date });
  } catch (err) {
    console.error('[slots] Error:', err.message);
    // Return empty slots instead of 500 — GCal errors shouldn't break the UI
    res.json({ slots: [], date: req.query.date, warning: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
