function isStandaloneAppointment(appointment) {
  return Boolean(appointment) && !appointment.source_schedule_id;
}

const ALLOWED_RECURRING_SOURCE_STATUSES = new Set([
  'Agendada',
  'Confirmada',
  'Reagendada',
  'Completada',
]);

function getAppointmentDateMs(appointment) {
  const value = new Date(appointment?.date_time || '').getTime();
  return Number.isFinite(value) ? value : NaN;
}

function isEligibleRecurringSourceAppointment(appointment) {
  if (!isStandaloneAppointment(appointment)) return false;
  if (!ALLOWED_RECURRING_SOURCE_STATUSES.has(appointment.status)) return false;
  return Number.isFinite(getAppointmentDateMs(appointment));
}

function isFutureStandaloneAppointment(appointment) {
  if (!isEligibleRecurringSourceAppointment(appointment)) return false;
  if (!['Agendada', 'Confirmada', 'Reagendada'].includes(appointment.status)) return false;
  return getAppointmentDateMs(appointment) > Date.now();
}

export function pickDefaultRecurringSource(appointments = [], fallbackAppointment = null, options = {}) {
  const preferFallback = options?.preferFallback === true;

  if (preferFallback && isEligibleRecurringSourceAppointment(fallbackAppointment)) {
    return fallbackAppointment;
  }

  const standaloneAppointments = Array.isArray(appointments)
    ? appointments.filter(isEligibleRecurringSourceAppointment)
    : [];

  const completed = standaloneAppointments
    .filter((item) => item.status === 'Completada')
    .sort((a, b) => getAppointmentDateMs(b) - getAppointmentDateMs(a))[0];
  if (completed) return completed;

  const future = standaloneAppointments
    .filter(isFutureStandaloneAppointment)
    .sort((a, b) => getAppointmentDateMs(a) - getAppointmentDateMs(b))[0];
  if (future) return future;

  if (isEligibleRecurringSourceAppointment(fallbackAppointment)) {
    return fallbackAppointment;
  }

  return null;
}

export function getRecurringSyncIssue(schedule, mode = 'activate') {
  if (!schedule) return null;

  const syncFailed = schedule.gcal_sync_status === 'failed';
  const missingSeries = !schedule.gcal_recurring_event_id && mode === 'activate';
  if (!syncFailed && !missingSeries) return null;

  if (mode === 'update') {
    return 'La recurrencia se actualizó en la app, pero Google Calendar no confirmó el cambio de la serie semanal.';
  }

  if (mode === 'resume') {
    return 'La recurrencia se reactivó en la app, pero Google Calendar no confirmó la serie semanal.';
  }

  return 'La recurrencia se guardó en la app, pero Google Calendar no confirmó la serie semanal.';
}
