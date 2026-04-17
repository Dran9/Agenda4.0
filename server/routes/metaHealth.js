const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { sendServerError } = require('../utils/httpErrors');
const {
  getMetaHealthPanel,
  listMetaHealthEvents,
  getMetaHealthEventDetail,
  listMetaHealthHistory,
  listMetaHealthAlerts,
  getMetaHealthConfig,
  updateMetaHealthConfig,
  rebuildMetaHealthState,
  runMetaHealthWatchdogForTenant,
} = require('../services/metaHealth');

const router = Router();

// GET /api/meta-health — summary dashboard + timeline preview
router.get('/', authMiddleware, async (req, res) => {
  try {
    const timelineLimit = Number(req.query.timeline_limit || req.query.limit || 50);
    const panel = await getMetaHealthPanel(req.tenantId, { timelineLimit });
    res.json(panel);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el panel de Meta health',
      logLabel: 'meta-health panel',
    });
  }
});

// POST /api/meta-health/refresh — manual recompute (+ optional watchdog run)
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    const runWatchdog = req.body?.run_watchdog !== false;
    let watchdog = null;

    if (runWatchdog) {
      watchdog = await runMetaHealthWatchdogForTenant(req.tenantId, { force: true });
    }

    const state = await rebuildMetaHealthState(req.tenantId, { trigger: 'manual_refresh' });
    res.json({ success: true, watchdog, state });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo refrescar Meta health',
      logLabel: 'meta-health refresh',
    });
  }
});

// GET /api/meta-health/events — timeline with filters
router.get('/events', authMiddleware, async (req, res) => {
  try {
    const data = await listMetaHealthEvents(req.tenantId, {
      page: req.query.page,
      limit: req.query.limit,
      severity: req.query.severity,
      field: req.query.field,
      phone: req.query.phone,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
    });
    res.json(data);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el historial de eventos',
      logLabel: 'meta-health events',
    });
  }
});

// GET /api/meta-health/events/:id — single event + raw payload + alerts
router.get('/events/:id', authMiddleware, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ error: 'ID de evento inválido' });
    }

    const detail = await getMetaHealthEventDetail(req.tenantId, eventId);
    if (!detail) return res.status(404).json({ error: 'Evento no encontrado' });

    res.json(detail);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el detalle del evento',
      logLabel: 'meta-health event detail',
    });
  }
});

// GET /api/meta-health/history — state snapshots
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const history = await listMetaHealthHistory(req.tenantId, { limit });
    res.json({ items: history, total: history.length });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el historial de salud',
      logLabel: 'meta-health history',
    });
  }
});

// GET /api/meta-health/alerts — recently emitted alerts
router.get('/alerts', authMiddleware, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const alerts = await listMetaHealthAlerts(req.tenantId, { limit });
    res.json({ items: alerts, total: alerts.length });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el historial de alertas',
      logLabel: 'meta-health alerts',
    });
  }
});

// GET /api/meta-health/config — monitoring configuration
router.get('/config', authMiddleware, async (req, res) => {
  try {
    const config = await getMetaHealthConfig(req.tenantId);
    res.json(config);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar la configuración de Meta health',
      logLabel: 'meta-health config get',
    });
  }
});

// PUT /api/meta-health/config — update monitoring configuration
router.put('/config', authMiddleware, async (req, res) => {
  try {
    const updated = await updateMetaHealthConfig(req.tenantId, req.body || {});
    await rebuildMetaHealthState(req.tenantId, { trigger: 'config_update' });
    res.json({ success: true, config: updated });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo guardar la configuración de Meta health',
      logLabel: 'meta-health config update',
    });
  }
});

module.exports = router;
