const { formatInTimeZone } = require('date-fns-tz');
const { pool, withTransaction, withAdvisoryLock } = require('../db');
const {
  createEvent,
  createRecurringEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} = require('./calendar');
const {
  createAppointmentSlotClaims,
  isSlotClaimConflictError,
} = require('./appointmentSlotClaims');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');

const LA_PAZ_TZ = 'America/La_Paz';
const CALENDAR_ID = () => process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
const BYDAY_MAP = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const PAYMENT_JOIN = `
  LEFT JOIN payments p ON p.id = (
    SELECT p2.id
    FROM payments p2
    WHERE p2.appointment_id = a.id AND p2.tenant_id = a.tenant_id
    ORDER BY
      CASE p2.status
        WHEN 'Confirmado' THEN 0
        WHEN 'Pendiente' THEN 1
        WHEN 'Mismatch' THEN 2
        WHEN 'Rechazado' THEN 3
        ELSE 4
      END,
      p2.updated_at DESC,
      p2.id DESC
    LIMIT 1
  )
`;

function recurringError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function isValidDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''));
}

function isValidTime(time) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(time || ''));
}

function toDateKey(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (isValidDateKey(raw)) return raw;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatInTimeZone(parsed, LA_PAZ_TZ, 'yyyy-MM-dd');
}

function dateKeyToDate(dateKey) {
  if (!isValidDateKey(dateKey)) {
    throw recurringError(400, 'Fecha inválida');
  }
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}

function getDateKeyInLaPaz(value) {
  return formatInTimeZone(new Date(value), LA_PAZ_TZ, 'yyyy-MM-dd');
}

function getTimeInLaPaz(value) {
  return formatInTimeZone(new Date(value), LA_PAZ_TZ, 'HH:mm');
}

function getDayOfWeekInLaPaz(value) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: LA_PAZ_TZ,
    weekday: 'short',
  }).format(new Date(value));

  const map = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[weekday] ?? null;
}

function getDayOfWeekFromDateKey(dateKey) {
  return dateKeyToDate(dateKey).getUTCDay();
}

function getTodayDateKeyInLaPaz() {
  return formatInTimeZone(new Date(), LA_PAZ_TZ, 'yyyy-MM-dd');
}

function addDaysToDateKey(dateKey, days) {
  const next = dateKeyToDate(dateKey);
  next.setUTCDate(next.getUTCDate() + days);
  return formatInTimeZone(next, LA_PAZ_TZ, 'yyyy-MM-dd');
}

function compareDateKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function getNextOccurrenceDateKey(startedAt, dayOfWeek) {
  let current = toDateKey(startedAt);
  if (!isValidDateKey(current)) {
    throw recurringError(400, 'Fecha inválida');
  }
  for (let i = 0; i < 7; i += 1) {
    if (getDayOfWeekFromDateKey(current) === Number(dayOfWeek)) return current;
    current = addDaysToDateKey(current, 1);
  }
  return current;
}

function buildLocalDateTime(dateKey, time) {
  return `${dateKey} ${time}:00`;
}

function buildGCalDateTime(dateKey, time) {
  return `${dateKey}T${time}:00-04:00`;
}

function buildEndTime(time, duration) {
  const [hours, minutes] = String(time).split(':').map(Number);
  const total = (hours * 60) + minutes + Number(duration || 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function buildEventSummary(client) {
  return `Terapia ${client.first_name} ${client.last_name} - ${client.phone}`;
}

function buildEventDescription(client) {
  return `Teléfono: ${client.phone}`;
}

function isScheduleActive(schedule) {
  return !schedule.ended_at && !schedule.paused_at;
}

function isScheduleActiveOnDate(schedule, dateKey) {
  const startedAt = toDateKey(schedule.started_at);
  const pausedAt = toDateKey(schedule.paused_at);
  const endedAt = toDateKey(schedule.ended_at);

  if (startedAt && compareDateKeys(dateKey, startedAt) < 0) return false;
  if (pausedAt && compareDateKeys(dateKey, pausedAt) >= 0) return false;
  if (endedAt && compareDateKeys(dateKey, endedAt) >= 0) return false;
  return true;
}

async function getClientForRecurring(tenantId, clientId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, tenant_id, first_name, last_name, phone, fee, frequency
     FROM clients
     WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, clientId]
  );
  return rows[0] || null;
}

async function getDefaultDuration(tenantId, conn = pool) {
  const [rows] = await conn.query(
    'SELECT appointment_duration FROM config WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  return Number(rows[0]?.appointment_duration || 60);
}

async function getSourceAppointment(tenantId, sourceAppointmentId, conn = pool) {
  if (!sourceAppointmentId) return null;
  const [rows] = await conn.query(
    `SELECT id, client_id, duration, date_time, gcal_event_id, source_schedule_id
     FROM appointments
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, sourceAppointmentId]
  );
  return rows[0] || null;
}

async function findDefaultRecurringSourceAppointment(tenantId, clientId, conn = pool) {
  if (!clientId) return null;

  const [completedRows] = await conn.query(
    `SELECT id, client_id, duration, date_time, gcal_event_id, status, source_schedule_id
     FROM appointments
     WHERE tenant_id = ?
       AND client_id = ?
       AND status = 'Completada'
       AND source_schedule_id IS NULL
     ORDER BY date_time DESC
     LIMIT 1`,
    [tenantId, clientId]
  );
  if (completedRows[0]) return completedRows[0];

  const [futureRows] = await conn.query(
    `SELECT id, client_id, duration, date_time, gcal_event_id, status, source_schedule_id
     FROM appointments
     WHERE tenant_id = ?
       AND client_id = ?
       AND status IN ('Agendada','Confirmada','Reagendada')
       AND source_schedule_id IS NULL
       AND date_time > NOW()
     ORDER BY date_time ASC
     LIMIT 1`,
    [tenantId, clientId]
  );

  return futureRows[0] || null;
}

function canConvertSourceAppointment(sourceAppointment, dayOfWeek, time, startedAt = null) {
  if (!sourceAppointment?.gcal_event_id || sourceAppointment?.source_schedule_id) return false;
  if (startedAt) {
    const startedAtKey = toDateKey(startedAt);
    if (!startedAtKey || getDateKeyInLaPaz(sourceAppointment.date_time) !== startedAtKey) return false;
  }

  return (
    getDayOfWeekInLaPaz(sourceAppointment.date_time) === Number(dayOfWeek) &&
    getTimeInLaPaz(sourceAppointment.date_time) === String(time)
  );
}

function attachRecurringSyncMetadata(schedule, syncResult) {
  if (!schedule) return schedule;
  if (!syncResult) {
    return {
      ...schedule,
      gcal_sync_status: schedule.gcal_recurring_event_id ? 'ok' : 'unknown',
      integration_warning: null,
    };
  }

  return {
    ...schedule,
    gcal_sync_status: syncResult.ok ? 'ok' : 'failed',
    integration_warning: syncResult.ok
      ? null
      : (syncResult.warning || 'google_calendar_recurring_sync_failed'),
  };
}

async function ensureNoActiveScheduleForClient(tenantId, clientId, ignoreScheduleId = null, conn = pool) {
  const params = [tenantId, clientId];
  let sql = `
    SELECT id
    FROM recurring_schedules
    WHERE tenant_id = ?
      AND client_id = ?
      AND ended_at IS NULL
      AND paused_at IS NULL
  `;
  if (ignoreScheduleId) {
    sql += ' AND id <> ?';
    params.push(ignoreScheduleId);
  }
  sql += ' LIMIT 1';
  const [rows] = await conn.query(sql, params);
  if (rows.length > 0) {
    throw recurringError(409, 'El cliente ya tiene una sesión recurrente activa');
  }
}

async function getRecurringSchedule(tenantId, scheduleId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT rs.*,
            c.first_name,
            c.last_name,
            c.phone,
            c.fee,
            c.frequency,
            CASE WHEN rs.ended_at IS NULL AND rs.paused_at IS NULL THEN 1 ELSE 0 END AS is_active
     FROM recurring_schedules rs
     JOIN clients c ON c.id = rs.client_id AND c.tenant_id = rs.tenant_id
     WHERE rs.tenant_id = ? AND rs.id = ?
     LIMIT 1`,
    [tenantId, scheduleId]
  );
  return rows[0] || null;
}

async function fetchAppointmentById(tenantId, appointmentId) {
  const [rows] = await pool.query(
    `SELECT a.*, c.first_name, c.last_name, c.phone AS client_phone,
            p.status AS payment_status, p.id AS payment_id, p.amount AS payment_amount,
            p.ocr_extracted_amount, p.ocr_extracted_ref, p.ocr_extracted_date, p.ocr_extracted_dest_name,
            p.receipt_file_key, p.notes AS payment_notes
     FROM appointments a
     JOIN clients c ON a.client_id = c.id
     ${PAYMENT_JOIN}
     WHERE a.tenant_id = ? AND a.id = ?
     LIMIT 1`,
    [tenantId, appointmentId]
  );
  return rows[0] || null;
}

async function findAppointmentByOccurrence(tenantId, clientId, dateKey, time, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, gcal_event_id, source_schedule_id
     FROM appointments
     WHERE tenant_id = ?
       AND client_id = ?
       AND date_time = ?
     LIMIT 1`,
    [tenantId, clientId, buildLocalDateTime(dateKey, time)]
  );
  return rows[0] || null;
}

async function syncAppointmentArtifacts(appointment, client) {
  try {
    const { syncBookingToSheet } = require('./sheets');
    syncBookingToSheet(appointment, client).catch((err) => {
      console.error('[sheets] Booking sync failed (non-fatal):', err.message);
    });
  } catch (err) {
    console.error('[sheets] Import failed:', err.message);
  }
}

async function createOrUpdateRecurringEvent(schedule, client, dayOfWeek, time, duration, sourceAppointment = null) {
  const scheduleStartDate = toDateKey(schedule.started_at);
  if (!isValidDateKey(scheduleStartDate)) {
    throw recurringError(400, 'Fecha inválida');
  }

  const shouldConvertSource = canConvertSourceAppointment(
    sourceAppointment,
    dayOfWeek,
    time,
    scheduleStartDate
  );
  const startDateKey = getNextOccurrenceDateKey(scheduleStartDate, dayOfWeek);
  const endTime = buildEndTime(time, duration);
  const recurrenceRule = `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY_MAP[Number(dayOfWeek)]}`;
  const payload = {
    summary: buildEventSummary(client),
    description: buildEventDescription(client),
    startDateTime: buildGCalDateTime(startDateKey, time),
    endDateTime: buildGCalDateTime(startDateKey, endTime),
    recurrenceRule,
  };

  if (schedule.gcal_recurring_event_id) {
    return updateEvent(CALENDAR_ID(), schedule.gcal_recurring_event_id, {
      summary: payload.summary,
      description: payload.description,
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      recurrence: [payload.recurrenceRule],
    });
  }

  if (shouldConvertSource) {
    return updateEvent(CALENDAR_ID(), sourceAppointment.gcal_event_id, {
      summary: payload.summary,
      description: payload.description,
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      recurrence: [payload.recurrenceRule],
    });
  }

  return createRecurringEvent(CALENDAR_ID(), payload);
}

async function syncRecurringScheduleWithGoogle({
  tenantId,
  schedule,
  client,
  dayOfWeek,
  time,
  duration,
  sourceAppointment = null,
} = {}) {
  try {
    const recurringEvent = await createOrUpdateRecurringEvent(
      schedule,
      client,
      dayOfWeek,
      time,
      duration,
      sourceAppointment
    );

    if (!recurringEvent?.id) {
      return { ok: false, warning: 'google_calendar_recurring_sync_failed' };
    }

    await pool.query(
      `UPDATE recurring_schedules
       SET gcal_recurring_event_id = ?
       WHERE tenant_id = ? AND id = ?`,
      [recurringEvent.id, tenantId, schedule.id]
    );

    return { ok: true, recurringEventId: recurringEvent.id };
  } catch (err) {
    console.error('[recurring] No se pudo sincronizar evento recurrente en GCal:', err.message);
    return {
      ok: false,
      warning: err.message || 'google_calendar_recurring_sync_failed',
    };
  }
}

async function listRecurringSchedules(tenantId) {
  const [rows] = await pool.query(
    `SELECT rs.*,
            c.first_name,
            c.last_name,
            c.phone,
            c.fee,
            c.frequency,
            CASE WHEN rs.ended_at IS NULL AND rs.paused_at IS NULL THEN 1 ELSE 0 END AS is_active
     FROM recurring_schedules rs
     JOIN clients c ON c.id = rs.client_id AND c.tenant_id = rs.tenant_id
     WHERE rs.tenant_id = ?
     ORDER BY
       CASE WHEN rs.ended_at IS NULL AND rs.paused_at IS NULL THEN 0 ELSE 1 END,
       rs.updated_at DESC,
       rs.id DESC`,
    [tenantId]
  );
  return rows;
}

async function createRecurringSchedule(tenantId, data = {}) {
  const clientId = Number(data.client_id || 0);
  const dayOfWeek = Number(data.day_of_week);
  const time = String(data.time || '').trim();
  const startedAt = String(data.started_at || '').trim();
  const explicitSourceAppointmentId = data.source_appointment_id ? Number(data.source_appointment_id) : null;
  const notes = data.notes != null ? String(data.notes) : null;

  if (!clientId) throw recurringError(400, 'client_id es obligatorio');
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw recurringError(400, 'day_of_week debe estar entre 0 y 6');
  }
  if (!isValidTime(time)) throw recurringError(400, 'Hora inválida');
  if (!isValidDateKey(startedAt)) throw recurringError(400, 'Fecha de inicio inválida');

  const client = await getClientForRecurring(tenantId, clientId);
  if (!client) throw recurringError(404, 'Cliente no encontrado');

  await ensureNoActiveScheduleForClient(tenantId, clientId);

  let duration = await getDefaultDuration(tenantId);
  let sourceAppointment = null;
  if (explicitSourceAppointmentId) {
    sourceAppointment = await getSourceAppointment(tenantId, explicitSourceAppointmentId);
    if (!sourceAppointment) throw recurringError(404, 'source_appointment_id inválido');
    if (Number(sourceAppointment.client_id) !== clientId) {
      throw recurringError(400, 'La cita fuente no pertenece al cliente');
    }
    if (sourceAppointment.source_schedule_id) {
      throw recurringError(409, 'La cita fuente ya pertenece a otra recurrencia');
    }
    duration = Number(sourceAppointment.duration || duration || 60);
  } else {
    sourceAppointment = await findDefaultRecurringSourceAppointment(tenantId, clientId);
    if (sourceAppointment) {
      duration = Number(sourceAppointment.duration || duration || 60);
    }
  }

  const persistedSourceAppointmentId = canConvertSourceAppointment(
    sourceAppointment,
    dayOfWeek,
    time,
    startedAt
  )
    ? Number(sourceAppointment.id)
    : null;

  const created = await withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO recurring_schedules (
         tenant_id, client_id, day_of_week, time, duration, source_appointment_id, started_at, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, clientId, dayOfWeek, time, duration || 60, persistedSourceAppointmentId, startedAt, notes]
    );

    await conn.query(
      `UPDATE clients
       SET frequency = 'Semanal'
       WHERE tenant_id = ? AND id = ?`,
      [tenantId, clientId]
    );

    if (persistedSourceAppointmentId) {
      await conn.query(
        `UPDATE appointments
         SET source_schedule_id = ?
         WHERE tenant_id = ? AND id = ?`,
        [result.insertId, tenantId, persistedSourceAppointmentId]
      );
    }

    return result.insertId;
  });

  const schedule = await getRecurringSchedule(tenantId, created);
  const syncResult = await syncRecurringScheduleWithGoogle({
    tenantId,
    schedule,
    client,
    dayOfWeek,
    time,
    duration: schedule.duration,
    sourceAppointment,
  });

  return attachRecurringSyncMetadata(await getRecurringSchedule(tenantId, created), syncResult);
}

async function updateRecurringSchedule(tenantId, scheduleId, updates = {}) {
  const schedule = await getRecurringSchedule(tenantId, scheduleId);
  if (!schedule) throw recurringError(404, 'Sesión recurrente no encontrada');

  const currentStartedAt = toDateKey(schedule.started_at);
  const nextDayOfWeek = updates.day_of_week !== undefined ? Number(updates.day_of_week) : Number(schedule.day_of_week);
  const nextTime = updates.time !== undefined ? String(updates.time).trim() : schedule.time;
  const nextStartedAt = updates.started_at !== undefined
    ? String(updates.started_at).trim()
    : currentStartedAt;
  const nextNotes = updates.notes !== undefined ? (updates.notes != null ? String(updates.notes) : null) : schedule.notes;

  if (!Number.isInteger(nextDayOfWeek) || nextDayOfWeek < 0 || nextDayOfWeek > 6) {
    throw recurringError(400, 'day_of_week debe estar entre 0 y 6');
  }
  if (!isValidTime(nextTime)) throw recurringError(400, 'Hora inválida');
  if (!isValidDateKey(nextStartedAt)) throw recurringError(400, 'Fecha de inicio inválida');

  await pool.query(
    `UPDATE recurring_schedules
     SET day_of_week = ?, time = ?, started_at = ?, notes = ?
     WHERE tenant_id = ? AND id = ?`,
    [nextDayOfWeek, nextTime, nextStartedAt, nextNotes, tenantId, scheduleId]
  );

  const updated = await getRecurringSchedule(tenantId, scheduleId);
  let syncResult = null;

  if (
    nextDayOfWeek !== Number(schedule.day_of_week) ||
    nextTime !== schedule.time ||
    nextStartedAt !== currentStartedAt ||
    !updated.gcal_recurring_event_id
  ) {
    const sourceAppointment = updated.source_appointment_id
      ? await getSourceAppointment(tenantId, updated.source_appointment_id)
      : await findDefaultRecurringSourceAppointment(tenantId, updated.client_id);

    syncResult = await syncRecurringScheduleWithGoogle({
      tenantId,
      schedule: updated,
      client: updated,
      dayOfWeek: nextDayOfWeek,
      time: nextTime,
      duration: updated.duration,
      sourceAppointment,
    });
  }

  return attachRecurringSyncMetadata(await getRecurringSchedule(tenantId, scheduleId), syncResult);
}

async function pauseRecurringSchedule(tenantId, scheduleId) {
  const schedule = await getRecurringSchedule(tenantId, scheduleId);
  if (!schedule) throw recurringError(404, 'Sesión recurrente no encontrada');
  if (schedule.ended_at) throw recurringError(409, 'La sesión recurrente ya está finalizada');

  await pool.query(
    `UPDATE recurring_schedules
     SET paused_at = CURDATE()
     WHERE tenant_id = ? AND id = ?`,
    [tenantId, scheduleId]
  );
  return getRecurringSchedule(tenantId, scheduleId);
}

async function resumeRecurringSchedule(tenantId, scheduleId) {
  const schedule = await getRecurringSchedule(tenantId, scheduleId);
  if (!schedule) throw recurringError(404, 'Sesión recurrente no encontrada');
  if (schedule.ended_at) throw recurringError(409, 'La sesión recurrente ya está finalizada');

  await ensureNoActiveScheduleForClient(tenantId, schedule.client_id, scheduleId);
  await pool.query(
    `UPDATE recurring_schedules
     SET paused_at = NULL
     WHERE tenant_id = ? AND id = ?`,
    [tenantId, scheduleId]
  );
  const resumed = await getRecurringSchedule(tenantId, scheduleId);
  let syncResult = null;

  if (!resumed.gcal_recurring_event_id) {
    const sourceAppointment = resumed.source_appointment_id
      ? await getSourceAppointment(tenantId, resumed.source_appointment_id)
      : await findDefaultRecurringSourceAppointment(tenantId, resumed.client_id);

    syncResult = await syncRecurringScheduleWithGoogle({
      tenantId,
      schedule: resumed,
      client: resumed,
      dayOfWeek: resumed.day_of_week,
      time: resumed.time,
      duration: resumed.duration,
      sourceAppointment,
    });
  }

  return attachRecurringSyncMetadata(await getRecurringSchedule(tenantId, scheduleId), syncResult);
}

async function endRecurringSchedule(tenantId, scheduleId) {
  const schedule = await getRecurringSchedule(tenantId, scheduleId);
  if (!schedule) throw recurringError(404, 'Sesión recurrente no encontrada');

  // Remove recurrence from GCal master event (best effort, never blocks)
  if (schedule.gcal_recurring_event_id) {
    try {
      await deleteEvent(CALENDAR_ID(), schedule.gcal_recurring_event_id);
      console.log(`[recurring] Deleted GCal recurring series ${schedule.gcal_recurring_event_id} for schedule ${scheduleId}`);
    } catch (gcalErr) {
      // 404/410 = already gone, that's fine
      if ([404, 410].includes(gcalErr.code || gcalErr.status)) {
        console.log(`[recurring] GCal series already gone for schedule ${scheduleId}`);
      } else {
        console.error(`[recurring] Failed to delete GCal series for schedule ${scheduleId}:`, gcalErr.message);
      }
    }
  }

  await pool.query(
    `UPDATE recurring_schedules
     SET ended_at = CURDATE()
     WHERE tenant_id = ? AND id = ?`,
    [tenantId, scheduleId]
  );
  return getRecurringSchedule(tenantId, scheduleId);
}

async function materializeRecurringOccurrence({ tenantId, scheduleId, date, eventInstance = null } = {}) {
  if (!Number(scheduleId)) throw recurringError(400, 'scheduleId es obligatorio');
  if (!isValidDateKey(date)) throw recurringError(400, 'Fecha inválida');

  const schedule = await getRecurringSchedule(tenantId, scheduleId);
  if (!schedule) throw recurringError(404, 'Sesión recurrente no encontrada');
  if (getDayOfWeekFromDateKey(date) !== Number(schedule.day_of_week)) {
    throw recurringError(400, 'La fecha no coincide con el día configurado');
  }
  if (!isScheduleActiveOnDate(schedule, date)) {
    throw recurringError(409, 'La sesión recurrente no está activa para esa fecha');
  }

  return withAdvisoryLock(`recurring:${tenantId}:${scheduleId}:${date}`, 10, async () => {
    const existing = await findAppointmentByOccurrence(tenantId, schedule.client_id, date, schedule.time);
    if (existing) {
      if ((!existing.gcal_event_id || !existing.source_schedule_id) && (eventInstance?.id || scheduleId)) {
        await pool.query(
          `UPDATE appointments
           SET gcal_event_id = COALESCE(gcal_event_id, ?),
               source_schedule_id = COALESCE(source_schedule_id, ?)
           WHERE tenant_id = ? AND id = ?`,
          [eventInstance?.id || null, scheduleId, tenantId, existing.id]
        );
      }
      return {
        created: false,
        appointment: await fetchAppointmentById(tenantId, existing.id),
      };
    }

    const client = await getClientForRecurring(tenantId, schedule.client_id);
    if (!client) throw recurringError(404, 'Cliente no encontrado');

    let createdEventId = null;
    if (!eventInstance?.id && !schedule.gcal_recurring_event_id) {
      const endTime = buildEndTime(schedule.time, schedule.duration);
      try {
        const gcalEvent = await createEvent(CALENDAR_ID(), {
          summary: buildEventSummary(client),
          description: buildEventDescription(client),
          startDateTime: buildGCalDateTime(date, schedule.time),
          endDateTime: buildGCalDateTime(date, endTime),
        });
        createdEventId = gcalEvent.id;
      } catch (err) {
        console.error('[recurring] No se pudo crear evento individual en GCal:', err.message);
        throw recurringError(502, 'No se pudo crear el evento en Google Calendar');
      }
    }

    try {
      const result = await withTransaction(async (conn) => {
        const duplicate = await findAppointmentByOccurrence(tenantId, schedule.client_id, date, schedule.time, conn);
        if (duplicate) return { duplicateId: duplicate.id };

        const [prevAppts] = await conn.query(
          'SELECT COUNT(*) AS cnt FROM appointments WHERE tenant_id = ? AND client_id = ?',
          [tenantId, schedule.client_id]
        );
        const sessionNumber = Number(prevAppts[0]?.cnt || 0) + 1;
        const isFirst = sessionNumber === 1;
        const dateTime = buildLocalDateTime(date, schedule.time);
        const gcalEventId = eventInstance?.id || createdEventId || null;

        const [insertResult] = await conn.query(
          `INSERT INTO appointments (
             tenant_id, client_id, date_time, duration, gcal_event_id, status, is_first,
             session_number, phone, source_schedule_id
           ) VALUES (?, ?, ?, ?, ?, 'Agendada', ?, ?, ?, ?)`,
          [
            tenantId,
            schedule.client_id,
            dateTime,
            schedule.duration || 60,
            gcalEventId,
            isFirst,
            sessionNumber,
            client.phone,
            scheduleId,
          ]
        );

        await createAppointmentSlotClaims(conn, {
          id: insertResult.insertId,
          tenant_id: tenantId,
          date_time: dateTime,
          duration: schedule.duration || 60,
        });

        await conn.query(
          `INSERT INTO payments (tenant_id, client_id, appointment_id, amount, status)
           VALUES (?, ?, ?, ?, 'Pendiente')`,
          [tenantId, schedule.client_id, insertResult.insertId, client.fee || 250]
        );

        await conn.query(
          `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
           VALUES (?, ?, 'booking', ?, 'procesado', ?, ?, ?)`,
          [
            tenantId,
            `recurring_materialize_${insertResult.insertId}`,
            JSON.stringify({
              date_time: dateTime,
              source: 'recurring_materialize',
              schedule_id: scheduleId,
            }),
            client.phone,
            schedule.client_id,
            insertResult.insertId,
          ]
        );

        return { duplicateId: null, appointmentId: insertResult.insertId };
      });

      const appointmentId = result.duplicateId || result.appointmentId;
      const appointment = await fetchAppointmentById(tenantId, appointmentId);
      if (result.appointmentId) {
        syncAppointmentArtifacts(appointment, client);
      }
      return {
        created: !!result.appointmentId,
        appointment,
      };
    } catch (err) {
      if (createdEventId) {
        try {
          await deleteEvent(CALENDAR_ID(), createdEventId);
        } catch (_) {
          // best effort
        }
      }
      if (isSlotClaimConflictError(err)) {
        throw recurringError(409, 'El horario ya no está disponible');
      }
      throw err;
    }
  });
}

async function getUpcomingRecurringSessions(tenantId, from, to) {
  if (!isValidDateKey(from) || !isValidDateKey(to)) {
    throw recurringError(400, 'Rango de fechas inválido');
  }
  if (compareDateKeys(from, to) > 0) {
    throw recurringError(400, 'El rango de fechas es inválido');
  }

  const [schedules] = await pool.query(
    `SELECT rs.*, c.first_name, c.last_name, c.phone, c.fee
     FROM recurring_schedules rs
     JOIN clients c ON c.id = rs.client_id AND c.tenant_id = rs.tenant_id
     WHERE rs.tenant_id = ?
       AND rs.started_at <= ?
       AND rs.paused_at IS NULL
       AND (rs.ended_at IS NULL OR rs.ended_at > ?)
     ORDER BY rs.time ASC, c.first_name ASC`,
    [tenantId, to, from]
  );

  const [appointments] = await pool.query(
    `SELECT a.*, c.first_name, c.last_name, c.phone AS client_phone,
            p.status AS payment_status, p.id AS payment_id, p.amount AS payment_amount,
            p.ocr_extracted_amount, p.ocr_extracted_ref, p.ocr_extracted_date, p.ocr_extracted_dest_name,
            p.receipt_file_key, p.notes AS payment_notes
     FROM appointments a
     JOIN clients c ON a.client_id = c.id
     ${PAYMENT_JOIN}
     WHERE a.tenant_id = ?
       AND a.date_time >= ?
       AND a.date_time <= ?
     ORDER BY a.date_time ASC`,
    [tenantId, `${from} 00:00:00`, `${to} 23:59:59`]
  );

  const appointmentMap = new Map();
  for (const appointment of appointments) {
    const key = `${appointment.client_id}|${getDateKeyInLaPaz(appointment.date_time)}|${getTimeInLaPaz(appointment.date_time)}`;
    appointmentMap.set(key, appointment);
  }

  const items = [];
  for (const schedule of schedules) {
    let current = from;
    while (compareDateKeys(current, to) <= 0) {
      if (
        getDayOfWeekFromDateKey(current) === Number(schedule.day_of_week) &&
        isScheduleActiveOnDate(schedule, current)
      ) {
        const key = `${schedule.client_id}|${current}|${schedule.time}`;
        const appointment = appointmentMap.get(key);
        if (appointment) {
          items.push({
            ...appointment,
            type: 'materialized',
            schedule_id: schedule.id,
          });
        } else {
          items.push({
            id: `virtual-${schedule.id}-${current}`,
            type: 'virtual',
            schedule_id: schedule.id,
            client_id: schedule.client_id,
            first_name: schedule.first_name,
            last_name: schedule.last_name,
            client_name: `${schedule.first_name} ${schedule.last_name}`.trim(),
            client_phone: schedule.phone,
            phone: schedule.phone,
            fee: schedule.fee,
            date_time: buildLocalDateTime(current, schedule.time),
            day_of_week: schedule.day_of_week,
            time: schedule.time,
            duration: schedule.duration,
            status: 'Recurrente',
          });
        }
      }
      current = addDaysToDateKey(current, 1);
    }
  }

  return items.sort((a, b) => new Date(a.date_time) - new Date(b.date_time));
}

async function findRecurringScheduleForEventInstance(tenantId, recurringEventId, dateKey) {
  if (!recurringEventId || !isValidDateKey(dateKey)) return null;

  const [rows] = await pool.query(
    `SELECT rs.*,
            c.first_name,
            c.last_name,
            c.phone,
            c.fee
     FROM recurring_schedules rs
     JOIN clients c ON c.id = rs.client_id AND c.tenant_id = rs.tenant_id
     WHERE rs.tenant_id = ?
       AND rs.gcal_recurring_event_id = ?
     ORDER BY
       CASE WHEN rs.ended_at IS NULL AND rs.paused_at IS NULL THEN 0 ELSE 1 END,
       rs.id DESC`,
    [tenantId, recurringEventId]
  );

  const matching = rows.find((row) =>
    Number(row.day_of_week) === getDayOfWeekFromDateKey(dateKey) &&
    isScheduleActiveOnDate(row, dateKey)
  );

  return matching || null;
}

async function syncRecurringFromGCal(tenantId) {
  const from = getTodayDateKeyInLaPaz();
  const to = addDaysToDateKey(from, 14);
  const events = await listEvents(
    CALENDAR_ID(),
    `${from}T00:00:00-04:00`,
    `${to}T23:59:59-04:00`
  );

  const grouped = new Map();
  for (const event of events) {
    if (!event.recurringEventId) continue;
    if (!(event.summary || '').includes('Terapia')) continue;
    if (!event.start?.dateTime) continue;
    const key = event.recurringEventId;
    const bucket = grouped.get(key) || [];
    bucket.push(event);
    grouped.set(key, bucket);
  }

  let created = 0;
  let alreadyExists = 0;
  let noClientMatch = 0;

  for (const [recurringEventId, instances] of grouped.entries()) {
    const phoneMatch = instances
      .map((instance) => String(instance.summary || '').match(/-\s*(\d{10,15})\s*$/))
      .find(Boolean);
    if (!phoneMatch?.[1]) {
      noClientMatch += 1;
      continue;
    }

    const phone = normalizePhone(phoneMatch[1]);
    const [clients] = await pool.query(
      `SELECT id, first_name, last_name, phone
       FROM clients
       WHERE tenant_id = ?
         AND deleted_at IS NULL
         AND ${normalizedPhoneSql('phone')} = ?
       LIMIT 1`,
      [tenantId, phone]
    );

    if (clients.length === 0) {
      noClientMatch += 1;
      continue;
    }

    const client = clients[0];
    const [existingSchedules] = await pool.query(
      `SELECT *
       FROM recurring_schedules
       WHERE tenant_id = ? AND client_id = ?
       ORDER BY id DESC`,
      [tenantId, client.id]
    );

    const sameGcalSchedule = existingSchedules.find((row) => row.gcal_recurring_event_id === recurringEventId);
    if (sameGcalSchedule) {
      alreadyExists += 1;
      continue;
    }

    const activeSchedule = existingSchedules.find((row) => row.ended_at == null && row.paused_at == null);
    const modes = new Map();
    for (const instance of instances) {
      const dateKey = getDateKeyInLaPaz(instance.start.dateTime);
      const time = getTimeInLaPaz(instance.start.dateTime);
      const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
      const modeKey = `${dayOfWeek}|${time}`;
      const current = modes.get(modeKey) || 0;
      modes.set(modeKey, current + 1);
    }
    const [modeKey] = [...modes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (!modeKey) continue;
    const [dayOfWeekRaw, time] = modeKey.split('|');
    const dayOfWeek = Number(dayOfWeekRaw);
    const startedAt = instances
      .map((instance) => getDateKeyInLaPaz(instance.start.dateTime))
      .sort()[0];

    if (activeSchedule) {
      if (Number(activeSchedule.day_of_week) !== dayOfWeek || activeSchedule.time !== time) {
        console.log(`[recurring-sync] Cliente ${client.first_name} ${client.last_name} ya tiene schedule activo distinto (${activeSchedule.day_of_week}/${activeSchedule.time})`);
      }
      alreadyExists += 1;
      continue;
    }

    try {
      await withTransaction(async (conn) => {
        const duration = await getDefaultDuration(tenantId, conn);
        await conn.query(
          `INSERT INTO recurring_schedules (
             tenant_id, client_id, day_of_week, time, duration,
             gcal_recurring_event_id, started_at, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            client.id,
            dayOfWeek,
            time,
            duration,
            recurringEventId,
            startedAt,
            'Detectado automáticamente desde Google Calendar',
          ]
        );

        await conn.query(
          `UPDATE clients
           SET frequency = 'Semanal'
           WHERE tenant_id = ? AND id = ?`,
          [tenantId, client.id]
        );
      });
      created += 1;
      console.log(`[recurring-sync] Auto-created schedule for ${client.first_name} ${client.last_name} - ${dayOfWeek} ${time}`);
    } catch (err) {
      console.error('[recurring-sync] No se pudo crear recurring_schedule:', err.message);
    }
  }

  return {
    created,
    already_exists: alreadyExists,
    no_client_match: noClientMatch,
    scanned_series: grouped.size,
  };
}

module.exports = {
  recurringError,
  listRecurringSchedules,
  createRecurringSchedule,
  findDefaultRecurringSourceAppointment,
  updateRecurringSchedule,
  pauseRecurringSchedule,
  resumeRecurringSchedule,
  endRecurringSchedule,
  getUpcomingRecurringSessions,
  materializeRecurringOccurrence,
  findRecurringScheduleForEventInstance,
  getRecurringSchedule,
  syncRecurringFromGCal,
  getTodayDateKeyInLaPaz,
  getDateKeyInLaPaz,
  getTimeInLaPaz,
  isValidDateKey,
  isValidTime,
};
