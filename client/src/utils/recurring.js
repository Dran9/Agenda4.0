function isStandaloneAppointment(appointment) {
  return Boolean(appointment) && !appointment.source_schedule_id;
}

function isFutureStandaloneAppointment(appointment) {
  if (!isStandaloneAppointment(appointment)) return false;
  if (!['Agendada', 'Confirmada', 'Reagendada'].includes(appointment.status)) return false;
  if (!appointment.date_time) return false;
  return new Date(appointment.date_time).getTime() > Date.now();
}

export function pickDefaultRecurringSource(appointments = [], fallbackAppointment = null) {
  const standaloneAppointments = Array.isArray(appointments)
    ? appointments.filter(isStandaloneAppointment)
    : [];

  const completed = standaloneAppointments.find((item) => item.status === 'Completada');
  if (completed) return completed;

  const future = standaloneAppointments
    .filter(isFutureStandaloneAppointment)
    .sort((a, b) => new Date(a.date_time) - new Date(b.date_time))[0];
  if (future) return future;

  if (isFutureStandaloneAppointment(fallbackAppointment)) {
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
