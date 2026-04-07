const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { sendServerError } = require('../utils/httpErrors');
const { broadcast } = require('../services/adminEvents');
const {
  createRecurringSchedule,
  endRecurringSchedule,
  getUpcomingRecurringSessions,
  listRecurringSchedules,
  materializeRecurringOccurrence,
  pauseRecurringSchedule,
  resumeRecurringSchedule,
  updateRecurringSchedule,
} = require('../services/recurring');

const router = Router();

function handleRecurringError(res, req, err, logLabel, defaultMessage) {
  if (err?.status) {
    return res.status(err.status).json({ error: err.message });
  }
  return sendServerError(res, req, err, {
    message: defaultMessage,
    logLabel,
  });
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const schedules = await listRecurringSchedules(req.tenantId);
    res.json(schedules);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring list', 'No se pudieron cargar las sesiones recurrentes');
  }
});

router.get('/upcoming', authMiddleware, async (req, res) => {
  try {
    const { from, to } = req.query;
    const items = await getUpcomingRecurringSessions(req.tenantId, String(from || ''), String(to || ''));
    res.json(items);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring upcoming', 'No se pudieron calcular las sesiones recurrentes');
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const schedule = await createRecurringSchedule(req.tenantId, req.body || {});
    broadcast('recurring:change', { id: schedule.id, action: 'created' }, req.tenantId);
    res.status(201).json(schedule);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring create', 'No se pudo crear la sesión recurrente');
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schedule = await updateRecurringSchedule(req.tenantId, Number(req.params.id), req.body || {});
    broadcast('recurring:change', { id: schedule.id, action: 'updated' }, req.tenantId);
    res.json(schedule);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring update', 'No se pudo actualizar la sesión recurrente');
  }
});

router.put('/:id/pause', authMiddleware, async (req, res) => {
  try {
    const schedule = await pauseRecurringSchedule(req.tenantId, Number(req.params.id));
    broadcast('recurring:change', { id: schedule.id, action: 'paused' }, req.tenantId);
    res.json(schedule);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring pause', 'No se pudo pausar la sesión recurrente');
  }
});

router.put('/:id/resume', authMiddleware, async (req, res) => {
  try {
    const schedule = await resumeRecurringSchedule(req.tenantId, Number(req.params.id));
    broadcast('recurring:change', { id: schedule.id, action: 'resumed' }, req.tenantId);
    res.json(schedule);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring resume', 'No se pudo reactivar la sesión recurrente');
  }
});

router.put('/:id/end', authMiddleware, async (req, res) => {
  try {
    const schedule = await endRecurringSchedule(req.tenantId, Number(req.params.id));
    broadcast('recurring:change', { id: schedule.id, action: 'ended' }, req.tenantId);
    res.json(schedule);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring end', 'No se pudo finalizar la sesión recurrente');
  }
});

router.post('/:id/materialize', authMiddleware, async (req, res) => {
  try {
    const result = await materializeRecurringOccurrence({
      tenantId: req.tenantId,
      scheduleId: Number(req.params.id),
      date: String(req.body?.date || ''),
    });
    if (result.created) {
      broadcast('appointment:change', { id: result.appointment?.id, action: 'created', source: 'recurring' }, req.tenantId);
    }
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    handleRecurringError(res, req, err, 'recurring materialize', 'No se pudo materializar la sesión recurrente');
  }
});

module.exports = router;
