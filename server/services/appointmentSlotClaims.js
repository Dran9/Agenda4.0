const LA_PAZ_TIME_ZONE = 'America/La_Paz';
const ACTIVE_APPOINTMENT_STATUSES = new Set(['Agendada', 'Confirmada', 'Reagendada']);
const SLOT_CLAIM_KEY_NAME = 'unique_slot_claim_minute';

function isSlotBlockingStatus(status) {
  return ACTIVE_APPOINTMENT_STATUSES.has(String(status || ''));
}

function getDatePartsInLaPaz(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_PAZ_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function formatDateTimeInLaPaz(date) {
  const { year, month, day, hour, minute, second } = getDatePartsInLaPaz(date);
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error('No se pudo formatear la fecha en Bolivia');
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function normalizeDateTimeInput(value) {
  if (value instanceof Date) return formatDateTimeInLaPaz(value);

  const match = String(value || '').trim().match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    throw new Error(`Fecha/hora inválida para claims: ${value}`);
  }

  return `${match[1]} ${match[2]}:${match[3]}:${match[4] || '00'}`;
}

function buildClaimTimes(dateTime, durationMinutes) {
  const normalized = normalizeDateTimeInput(dateTime);
  const duration = Math.max(1, parseInt(durationMinutes, 10) || 60);
  const start = new Date(normalized.replace(' ', 'T') + '-04:00');

  if (Number.isNaN(start.getTime())) {
    throw new Error(`Fecha/hora inválida para claims: ${dateTime}`);
  }

  const claims = [];
  for (let minute = 0; minute < duration; minute += 1) {
    const claimDate = new Date(start.getTime() + minute * 60 * 1000);
    claims.push(formatDateTimeInLaPaz(claimDate));
  }
  return claims;
}

async function createAppointmentSlotClaims(conn, appointment, options = {}) {
  const { ignoreConflicts = false } = options;
  const claimTimes = buildClaimTimes(appointment.date_time, appointment.duration);
  if (!claimTimes.length) return { inserted: 0, total: 0 };

  const insertVerb = ignoreConflicts ? 'INSERT IGNORE' : 'INSERT';
  const placeholders = claimTimes.map(() => '(?, ?, ?)').join(', ');
  const params = [];

  for (const claimTime of claimTimes) {
    params.push(appointment.tenant_id, appointment.id, claimTime);
  }

  const [result] = await conn.query(
    `${insertVerb} INTO appointment_slot_claims (tenant_id, appointment_id, claim_time) VALUES ${placeholders}`,
    params
  );

  return {
    inserted: Number(result?.affectedRows || 0),
    total: claimTimes.length,
  };
}

async function releaseAppointmentSlotClaims(conn, appointmentId, tenantId) {
  await conn.query(
    'DELETE FROM appointment_slot_claims WHERE appointment_id = ? AND tenant_id = ?',
    [appointmentId, tenantId]
  );
}

async function syncSlotClaimsForStatusTransition(conn, appointment, nextStatus) {
  const wasBlocking = isSlotBlockingStatus(appointment.status);
  const isBlocking = isSlotBlockingStatus(nextStatus);

  if (wasBlocking && !isBlocking) {
    await releaseAppointmentSlotClaims(conn, appointment.id, appointment.tenant_id);
    return;
  }

  if (!wasBlocking && isBlocking) {
    await createAppointmentSlotClaims(conn, appointment);
  }
}

function isSlotClaimConflictError(err) {
  const message = String(err?.sqlMessage || err?.message || '');
  return err?.code === 'ER_DUP_ENTRY' && message.includes(SLOT_CLAIM_KEY_NAME);
}

async function backfillActiveAppointmentSlotClaims(conn) {
  const [appointments] = await conn.query(
    `SELECT id, tenant_id, date_time, COALESCE(duration, 60) AS duration, status
     FROM appointments
     WHERE status IN ('Agendada', 'Confirmada', 'Reagendada')
     ORDER BY tenant_id ASC, date_time ASC, id ASC`
  );

  let backfilledAppointments = 0;
  let conflictingAppointments = 0;

  for (const appointment of appointments) {
    const result = await createAppointmentSlotClaims(conn, appointment, { ignoreConflicts: true });
    if (result.inserted > 0) backfilledAppointments += 1;
    if (result.inserted < result.total) conflictingAppointments += 1;
  }

  return {
    appointments: appointments.length,
    backfilledAppointments,
    conflictingAppointments,
  };
}

module.exports = {
  ACTIVE_APPOINTMENT_STATUSES,
  SLOT_CLAIM_KEY_NAME,
  isSlotBlockingStatus,
  createAppointmentSlotClaims,
  releaseAppointmentSlotClaims,
  syncSlotClaimsForStatusTransition,
  isSlotClaimConflictError,
  backfillActiveAppointmentSlotClaims,
};
