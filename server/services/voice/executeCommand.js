const { pool } = require('../../db');
const { createBooking } = require('../booking');
const { getTodayContext } = require('./parseCommand');
const { checkAndSendReminders } = require('../reminder');
const { refreshConfigSchedulers } = require('../../cron/scheduler');
const {
  createRecurringSchedule,
  endRecurringSchedule,
  pauseRecurringSchedule,
  resumeRecurringSchedule,
  updateRecurringSchedule,
} = require('../recurring');

function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatDateTime(dateTime) {
  const parts = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(dateTime));
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  return `${day} de ${month}, ${hour}:${minute}`;
}

function formatDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return label;
}

function formatMonthYear(month, year) {
  const label = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return label;
}

function getRelativeDateLabel(dateKey) {
  const today = getTodayContext();
  const tomorrow = addDays(today, 1);
  if (dateKey === today) return 'hoy';
  if (dateKey === tomorrow) return 'mañana';
  return null;
}

function shortList(items, max = 5) {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `y ${items.length - max} más`];
}

function formatClientOption(client) {
  const suffix = client.phone ? String(client.phone).slice(-4) : null;
  const details = [client.city || null, suffix ? `...${suffix}` : null].filter(Boolean);
  return details.length > 0
    ? `${client.first_name} ${client.last_name} (${details.join(', ')})`
    : `${client.first_name} ${client.last_name}`;
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

const WEEKDAY_LABELS = {
  lunes: 'lunes',
  martes: 'martes',
  miercoles: 'miércoles',
  jueves: 'jueves',
  viernes: 'viernes',
  sabado: 'sábado',
  domingo: 'domingo',
};

  const WEEKDAY_ORDER = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const WEEKDAY_TO_INDEX = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function weekdayNameFromIndex(dayIndex) {
  return Object.keys(WEEKDAY_TO_INDEX).find((key) => WEEKDAY_TO_INDEX[key] === Number(dayIndex)) || 'lunes';
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function buildHourlySlots(startTime, endTime) {
  if (!startTime || !endTime) return [];
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const slots = [];
  for (let current = start; current <= end; current += 60) {
    slots.push(minutesToTime(current));
  }
  return slots;
}

function describeSlots(slots) {
  if (!slots.length) return 'sin horarios';
  if (slots.length === 1) return `${slots[0]}`;
  return `${slots[0]} a ${slots[slots.length - 1]}`;
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function getCurrentMonthYear() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return { month, year };
}

function getTomorrowKey() {
  return addDays(getTodayContext(), 1);
}

function buildDateTimeKey(dateKey, timeHhmm) {
  if (!dateKey || !timeHhmm) return null;
  return `${dateKey}T${timeHhmm}`;
}

async function findClientsByName(tenantId, clientName) {
  if (!clientName) return [];
  const normalized = `%${String(clientName).trim().replace(/\s+/g, '%')}%`;
  const [rows] = await pool.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone, c.city, c.fee,
            (
              SELECT MIN(a.date_time)
              FROM appointments a
              WHERE a.client_id = c.id
                AND a.tenant_id = c.tenant_id
                AND a.status IN ('Agendada','Confirmada','Reagendada')
                AND a.date_time > NOW()
            ) AS next_appointment
     FROM clients c
     WHERE c.tenant_id = ?
       AND c.deleted_at IS NULL
       AND CONCAT_WS(' ', c.first_name, c.last_name) LIKE ?
     ORDER BY
       CASE WHEN CONCAT_WS(' ', c.first_name, c.last_name) = ? THEN 0 ELSE 1 END,
       c.first_name ASC,
       c.last_name ASC
     LIMIT 6`,
    [tenantId, normalized, clientName]
  );
  return rows;
}

async function findClientById(tenantId, clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone, c.city, c.fee,
            (
              SELECT MIN(a.date_time)
              FROM appointments a
              WHERE a.client_id = c.id
                AND a.tenant_id = c.tenant_id
                AND a.status IN ('Agendada','Confirmada','Reagendada')
                AND a.date_time > NOW()
            ) AS next_appointment
     FROM clients c
     WHERE c.tenant_id = ?
       AND c.id = ?
       AND c.deleted_at IS NULL
     LIMIT 1`,
    [tenantId, clientId]
  );
  return rows[0] || null;
}

async function resolveClientReference(tenantId, { clientId = null, clientName = null } = {}) {
  if (clientId) {
    const client = await findClientById(tenantId, clientId);
    if (client) return { kind: 'single', client, matches: [client] };
  }

  if (!clientName) {
    return { kind: 'missing', client: null, matches: [] };
  }

  const matches = await findClientsByName(tenantId, clientName);
  if (!matches.length) return { kind: 'none', client: null, matches: [] };
  if (matches.length === 1) return { kind: 'single', client: matches[0], matches };
  return { kind: 'multiple', client: null, matches };
}

async function findLatestRecurringScheduleForClient(tenantId, clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query(
    `SELECT *
     FROM recurring_schedules
     WHERE tenant_id = ? AND client_id = ?
     ORDER BY
       CASE WHEN ended_at IS NULL AND paused_at IS NULL THEN 0 ELSE 1 END,
       updated_at DESC,
       id DESC
     LIMIT 1`,
    [tenantId, clientId]
  );
  return rows[0] || null;
}

function buildPendingAction(intent, entities = {}) {
  return {
    intent,
    entities: {
      client_id: entities.client_id ?? null,
      client_name: entities.client_name ?? null,
      date_key: entities.date_key ?? null,
      agenda_scope: entities.agenda_scope ?? null,
      time_hhmm: entities.time_hhmm ?? null,
      goal_amount: entities.goal_amount ?? null,
      month: entities.month ?? null,
      year: entities.year ?? null,
      reminder_enabled: entities.reminder_enabled ?? null,
      reminder_date: entities.reminder_date ?? null,
      weekday_name: entities.weekday_name ?? null,
      morning_mode: entities.morning_mode ?? null,
      morning_start: entities.morning_start ?? null,
      morning_end: entities.morning_end ?? null,
      afternoon_mode: entities.afternoon_mode ?? null,
      afternoon_start: entities.afternoon_start ?? null,
      afternoon_end: entities.afternoon_end ?? null,
    },
  };
}

function buildClientClarificationReply(clientName, matches, pendingAction) {
  const lines = matches.map((client) => formatClientOption(client));
  return {
    status: 'clarification',
    replyText: [`Encontré varias opciones para "${clientName}". ¿Te refieres a:`, ...shortList(lines)].join('\n'),
    data: {
      total: matches.length,
      matches,
      clarification_type: 'client_disambiguation',
      pending_action: pendingAction,
    },
  };
}

function resolveAgendaDayKey(entities = {}) {
  if (entities.date_key) return entities.date_key;
  if (entities.reminder_date === 'tomorrow') return addDays(getTodayContext(), 1);
  if (entities.reminder_date === 'today') return getTodayContext();
  return getTodayContext();
}

function getWeekRange(weekOffset = 0) {
  const todayKey = getTodayContext();
  const [year, month, day] = todayKey.split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const weekday = today.getUTCDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  today.setUTCDate(today.getUTCDate() + diffToMonday + (weekOffset * 7));
  const startKey = today.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    startKey,
    endKey: end.toISOString().slice(0, 10),
  };
}

async function buildWeekAgendaReply(tenantId, weekOffset = 0) {
  const { startKey, endKey } = getWeekRange(weekOffset);
  const scopeLabel = weekOffset === 0 ? 'esta semana' : 'la próxima semana';
  const [rows] = await pool.query(
    `SELECT a.id, a.date_time, a.status, c.first_name, c.last_name,
            (
              SELECT p.status
              FROM payments p
              WHERE p.appointment_id = a.id AND p.tenant_id = a.tenant_id
              ORDER BY p.updated_at DESC, p.id DESC
              LIMIT 1
            ) AS payment_status
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = ?
       AND a.date_time >= ?
       AND a.date_time < ?
       AND a.status IN ('Agendada','Confirmada','Reagendada','Completada','No-show')
     ORDER BY a.date_time ASC
     LIMIT 20`,
    [tenantId, `${startKey} 00:00:00`, `${endKey} 00:00:00`]
  );

  if (!rows.length) {
    return {
      status: 'resolved',
      replyText: `No tienes citas para ${scopeLabel}.`,
      data: { agenda_scope: weekOffset === 0 ? 'this_week' : 'next_week', total: 0, items: [], week_start: startKey, week_end: endKey },
    };
  }

  const lines = rows.map((row) =>
    `${formatDateTime(row.date_time)}: ${row.first_name} ${row.last_name} (${row.status}${row.payment_status ? `, ${row.payment_status}` : ''})`
  );

  return {
    status: 'resolved',
    replyText: [
      `Tienes ${rows.length} ${pluralize(rows.length, 'cita', 'citas')} para ${scopeLabel}.`,
      ...shortList(lines, 8),
    ].join('\n'),
    data: {
      agenda_scope: weekOffset === 0 ? 'this_week' : 'next_week',
      total: rows.length,
      items: rows,
      week_start: startKey,
      week_end: endKey,
    },
  };
}

async function buildAgendaReply(tenantId, entities = {}) {
  if (entities.agenda_scope === 'this_week') {
    return buildWeekAgendaReply(tenantId, 0);
  }
  if (entities.agenda_scope === 'next_week') {
    return buildWeekAgendaReply(tenantId, 1);
  }

  const dayKey = resolveAgendaDayKey(entities);
  const nextDayKey = addDays(dayKey, 1);
  const relativeLabel = getRelativeDateLabel(dayKey);
  const [rows] = await pool.query(
    `SELECT a.id, a.date_time, a.status, c.first_name, c.last_name,
            (
              SELECT p.status
              FROM payments p
              WHERE p.appointment_id = a.id AND p.tenant_id = a.tenant_id
              ORDER BY p.updated_at DESC, p.id DESC
              LIMIT 1
            ) AS payment_status
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = ?
       AND a.date_time >= ?
       AND a.date_time < ?
       AND a.status IN ('Agendada','Confirmada','Reagendada','Completada','No-show')
     ORDER BY a.date_time ASC
     LIMIT 12`,
    [tenantId, `${dayKey} 00:00:00`, `${nextDayKey} 00:00:00`]
  );

  if (!rows.length) {
    return {
      status: 'resolved',
      replyText: relativeLabel
        ? `No tienes citas para ${relativeLabel}.`
        : `No tienes citas para el ${formatDateKey(dayKey)}.`,
      data: { date_key: dayKey, agenda_scope: 'day', total: 0, items: [] },
    };
  }

  const lines = rows.map((row) =>
    `${formatDateTime(row.date_time)}: ${row.first_name} ${row.last_name} (${row.status}${row.payment_status ? `, ${row.payment_status}` : ''})`
  );

  return {
    status: 'resolved',
    replyText: [
      relativeLabel
        ? `Tienes ${rows.length} ${pluralize(rows.length, 'cita', 'citas')} para ${relativeLabel}.`
        : `Tienes ${rows.length} ${pluralize(rows.length, 'cita', 'citas')} para el ${formatDateKey(dayKey)}.`,
      ...shortList(lines),
    ].join('\n'),
    data: { date_key: dayKey, agenda_scope: 'day', total: rows.length, items: rows },
  };
}

async function buildPendingPaymentsReply(tenantId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.amount, a.date_time, c.first_name, c.last_name
     FROM payments p
     JOIN clients c ON c.id = p.client_id
     LEFT JOIN appointments a ON a.id = p.appointment_id
     WHERE p.tenant_id = ?
       AND p.status = 'Pendiente'
     ORDER BY a.date_time ASC, p.created_at ASC
     LIMIT 8`,
    [tenantId]
  );

  if (!rows.length) {
    return {
      status: 'resolved',
      replyText: 'No hay pagos pendientes.',
      data: { total: 0, items: [] },
    };
  }

  const lines = rows.map((row) =>
    `${row.first_name} ${row.last_name}, Bs ${row.amount}${row.date_time ? `, ${formatDateTime(row.date_time)}` : ''}`
  );

  return {
    status: 'resolved',
    replyText: [`Tienes ${rows.length} ${pluralize(rows.length, 'pago pendiente', 'pagos pendientes')}.`, ...shortList(lines)].join('\n'),
    data: { total: rows.length, items: rows },
  };
}

async function buildPendingAmountReply(tenantId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM payments
     WHERE tenant_id = ?
       AND status = 'Pendiente'`,
    [tenantId]
  );

  const total = Number(row?.total || 0);
  return {
    status: 'resolved',
    replyText: total > 0 ? `Tienes Bs ${total} pendientes de cobro.` : 'No tienes dinero pendiente de cobro.',
    data: { total_amount: total },
  };
}

async function buildReminderToggleReply(tenantId, reminderEnabled) {
  if (typeof reminderEnabled !== 'boolean') {
    return {
      status: 'clarification',
      replyText: 'Dime si quieres activar o desactivar los recordatorios.',
      data: {},
    };
  }

  await pool.query(
    'UPDATE config SET reminder_enabled = ? WHERE tenant_id = ?',
    [reminderEnabled ? 1 : 0, tenantId]
  );
  refreshConfigSchedulers();

  return {
    status: 'resolved',
    replyText: reminderEnabled ? 'Recordatorios activados.' : 'Recordatorios desactivados.',
    data: { reminder_enabled: reminderEnabled },
  };
}

async function buildSendRemindersReply(tenantId, reminderDate) {
  const date = reminderDate === 'today' ? 'today' : 'tomorrow';
  const result = await checkAndSendReminders({ tenantId, date, force: false });
  return {
    status: 'resolved',
    replyText:
      `Recordatorios para ${date === 'today' ? 'hoy' : 'mañana'}: ` +
      `${result.sent} enviados, ${result.skipped} omitidos, ${result.failed || 0} fallidos.`,
    data: result,
  };
}

async function buildSessionsToGoalReply(tenantId, goalAmount) {
  const [[incomeRow]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS income_this_month
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     WHERE p.tenant_id = ?
       AND p.status = 'Confirmado'
       AND MONTH(a.date_time) = MONTH(NOW())
       AND YEAR(a.date_time) = YEAR(NOW())`,
    [tenantId]
  );

  const [[configRow]] = await pool.query(
    `SELECT default_fee, monthly_goal
     FROM config
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );

  const targetAmount = goalAmount || Number(configRow?.monthly_goal || 0);
  const fee = Number(configRow?.default_fee || 250);
  const income = Number(incomeRow?.income_this_month || 0);

  if (!targetAmount) {
    return {
      status: 'clarification',
      replyText: 'Dime el monto meta. Ejemplo: para llegar a 5000.',
      data: { total_income: income, default_fee: fee },
    };
  }

  const remaining = Math.max(0, targetAmount - income);
  const sessionsNeeded = remaining === 0 ? 0 : Math.ceil(remaining / fee);

  return {
    status: 'resolved',
    replyText:
      `Llevas Bs ${income} este mes. ` +
      `Meta: Bs ${targetAmount}. ` +
      `Faltan Bs ${remaining}. ` +
      `Con tarifa base de Bs ${fee}, necesitas ${sessionsNeeded} sesiones.`,
    data: { target_amount: targetAmount, income_this_month: income, default_fee: fee, sessions_needed: sessionsNeeded },
  };
}

async function buildClientLookupReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('client_lookup', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('client_lookup', { client_name: clientName, client_id: clientId }),
      },
    };
  }
  if (resolution.kind === 'none') {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (resolution.kind === 'single') {
    const client = resolution.client;
    return {
      status: 'resolved',
      replyText:
        `${client.first_name} ${client.last_name}. ` +
        `${client.city || 'Sin ciudad'}. ` +
        `Arancel Bs ${client.fee}. ` +
        `${client.next_appointment ? `Próxima cita: ${formatDateTime(client.next_appointment)}.` : 'Sin próxima cita.'}`,
      data: { total: 1, matches: [client], client },
    };
  }

  return buildClientClarificationReply(
    clientName,
    resolution.matches,
    buildPendingAction('client_lookup', { client_name: clientName, client_id: clientId })
  );
}

async function buildClientUpcomingAppointmentsReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('client_upcoming_appointments', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('client_upcoming_appointments', { client_name: clientName, client_id: clientId }),
      },
    };
  }
  if (resolution.kind === 'none') {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('client_upcoming_appointments', { client_name: clientName, client_id: clientId })
    );
  }

  const client = resolution.client;
  const [appointments] = await pool.query(
    `SELECT id, date_time, status
     FROM appointments
     WHERE tenant_id = ?
       AND client_id = ?
       AND status IN ('Agendada','Confirmada','Reagendada')
       AND date_time > NOW()
     ORDER BY date_time ASC
     LIMIT 6`,
    [tenantId, client.id]
  );

  if (!appointments.length) {
    return {
      status: 'resolved',
      replyText: `${client.first_name} ${client.last_name} no tiene próximas citas.`,
      data: { client, total: 0, items: [] },
    };
  }

  const lines = appointments.map((row) => `${formatDateTime(row.date_time)} (${row.status})`);
  return {
    status: 'resolved',
    replyText: [`${client.first_name} ${client.last_name} tiene ${appointments.length} ${pluralize(appointments.length, 'próxima cita', 'próximas citas')}.`, ...shortList(lines)].join('\n'),
    data: { client, total: appointments.length, items: appointments },
  };
}

async function buildReminderCheckReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('reminder_check', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('reminder_check', { client_name: clientName, client_id: clientId }),
      },
    };
  }
  if (resolution.kind === 'none') {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('reminder_check', { client_name: clientName, client_id: clientId })
    );
  }

  const client = resolution.client;
  const [[row]] = await pool.query(
    `SELECT wl.created_at, wl.appointment_id
     FROM webhooks_log wl
     WHERE wl.tenant_id = ?
       AND wl.client_id = ?
       AND wl.type = 'reminder_sent'
     ORDER BY wl.created_at DESC
     LIMIT 1`,
    [tenantId, client.id]
  );

  if (!row) {
    return {
      status: 'resolved',
      replyText: `No, no hay recordatorio enviado a ${client.first_name} ${client.last_name}.`,
      data: { client, sent: false },
    };
  }

  return {
    status: 'resolved',
    replyText: `Sí. El último recordatorio a ${client.first_name} ${client.last_name} fue el ${formatDateTime(row.created_at)}.`,
    data: { client, sent: true, last_reminder_at: row.created_at, appointment_id: row.appointment_id || null },
  };
}

async function buildConfirmationCheckReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('confirmation_check', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('confirmation_check', { client_name: clientName, client_id: clientId }),
      },
    };
  }
  if (resolution.kind === 'none') {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('confirmation_check', { client_name: clientName, client_id: clientId })
    );
  }

  const client = resolution.client;
  const [[appointment]] = await pool.query(
    `SELECT id, date_time, status, confirmed_at
     FROM appointments
     WHERE tenant_id = ?
       AND client_id = ?
       AND status IN ('Agendada','Confirmada','Reagendada')
       AND date_time > NOW()
     ORDER BY date_time ASC
     LIMIT 1`,
    [tenantId, client.id]
  );

  if (!appointment) {
    return {
      status: 'resolved',
      replyText: `${client.first_name} ${client.last_name} no tiene una próxima cita para revisar confirmación.`,
      data: { client, confirmed: false, appointment: null },
    };
  }

  if (appointment.status === 'Confirmada') {
    return {
      status: 'resolved',
      replyText: `Sí. ${client.first_name} ${client.last_name} confirmó su cita del ${formatDateTime(appointment.date_time)}.`,
      data: { client, confirmed: true, appointment },
    };
  }

  return {
    status: 'resolved',
    replyText: `No. ${client.first_name} ${client.last_name} todavía no confirmó su cita del ${formatDateTime(appointment.date_time)}.`,
    data: { client, confirmed: false, appointment },
  };
}

async function buildRescheduledListReply(tenantId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.date_time, c.first_name, c.last_name
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = ?
       AND a.status = 'Reagendada'
     ORDER BY a.updated_at DESC
     LIMIT 8`,
    [tenantId]
  );

  if (!rows.length) {
    return {
      status: 'resolved',
      replyText: 'No hay citas reagendadas.',
      data: { total: 0, items: [] },
    };
  }

  const lines = rows.map((row) => `${row.first_name} ${row.last_name}, ${formatDateTime(row.date_time)}`);
  return {
    status: 'resolved',
    replyText: [`Hay ${rows.length} ${pluralize(rows.length, 'cita reagendada', 'citas reagendadas')}.`, ...shortList(lines)].join('\n'),
    data: { total: rows.length, items: rows },
  };
}

async function buildNewClientsCountReply(tenantId, month, year) {
  const current = getCurrentMonthYear();
  const targetMonth = month || current.month;
  const targetYear = year || current.year;

  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM clients
     WHERE tenant_id = ?
       AND deleted_at IS NULL
       AND MONTH(created_at) = ?
       AND YEAR(created_at) = ?`,
    [tenantId, targetMonth, targetYear]
  );

  return {
    status: 'resolved',
    replyText: `Tuviste ${Number(row?.total || 0)} clientes nuevos en ${formatMonthYear(targetMonth, targetYear)}.`,
    data: { total: Number(row?.total || 0), month: targetMonth, year: targetYear },
  };
}

async function buildUnconfirmedTomorrowReply(tenantId) {
  const tomorrowKey = getTomorrowKey();
  const dayAfterKey = addDays(tomorrowKey, 1);
  const [rows] = await pool.query(
    `SELECT a.id, a.date_time, a.status, c.first_name, c.last_name
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = ?
       AND a.date_time >= ?
       AND a.date_time < ?
       AND a.status IN ('Agendada','Reagendada')
     ORDER BY a.date_time ASC
     LIMIT 10`,
    [tenantId, `${tomorrowKey} 00:00:00`, `${dayAfterKey} 00:00:00`]
  );

  if (!rows.length) {
    return {
      status: 'resolved',
      replyText: 'Mañana no tienes citas sin confirmar.',
      data: { total: 0, items: [] },
    };
  }

  const lines = rows.map((row) => `${row.first_name} ${row.last_name}, ${formatDateTime(row.date_time)}`);
  return {
    status: 'resolved',
    replyText: [`Mañana tienes ${rows.length} ${pluralize(rows.length, 'cita sin confirmar', 'citas sin confirmar')}.`, ...shortList(lines)].join('\n'),
    data: { total: rows.length, items: rows },
  };
}

async function buildConfirmedTodayReply(tenantId) {
  const todayKey = getTodayContext();
  const tomorrowKey = addDays(todayKey, 1);
  const [rows] = await pool.query(
    `SELECT a.id, a.date_time, c.first_name, c.last_name
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = ?
       AND a.date_time >= ?
       AND a.date_time < ?
       AND a.status = 'Confirmada'
     ORDER BY a.date_time ASC
     LIMIT 10`,
    [tenantId, `${todayKey} 00:00:00`, `${tomorrowKey} 00:00:00`]
  );

  if (!rows.length) {
    return {
      status: 'resolved',
      replyText: 'Hoy no hay citas confirmadas.',
      data: { total: 0, items: [] },
    };
  }

  const lines = rows.map((row) => `${row.first_name} ${row.last_name}, ${formatDateTime(row.date_time)}`);
  return {
    status: 'resolved',
    replyText: [`Hoy tienes ${rows.length} ${pluralize(rows.length, 'cita confirmada', 'citas confirmadas')}.`, ...shortList(lines)].join('\n'),
    data: { total: rows.length, items: rows },
  };
}

async function buildAppointmentsThisWeekReply(tenantId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM appointments
     WHERE tenant_id = ?
       AND YEARWEEK(date_time, 1) = YEARWEEK(CURDATE(), 1)
       AND status IN ('Agendada','Confirmada','Reagendada','Completada','No-show')`,
    [tenantId]
  );

  const total = Number(rows?.[0]?.total || 0);
  return {
    status: 'resolved',
    replyText: `Tienes ${total} ${pluralize(total, 'cita', 'citas')} esta semana.`,
    data: { total },
  };
}

async function buildCreateAppointmentReply(tenantId, clientName, dateKey, timeHhmm, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        clarification_type: 'missing_fields',
        pending_action: buildPendingAction('create_appointment', {
          client_name: clientName,
          client_id: clientId,
          date_key: dateKey,
          time_hhmm: timeHhmm,
        }),
      },
    };
  }

  if (!dateKey || !timeHhmm) {
    return {
      status: 'clarification',
      replyText: 'Dime fecha y hora. Ejemplo: crear cita para Cecilia de Ugarte el 8 de abril a las 08:00.',
      data: {
        clarification_type: 'missing_fields',
        pending_action: buildPendingAction('create_appointment', {
          client_name: clientName,
          client_id: clientId,
          date_key: dateKey,
          time_hhmm: timeHhmm,
        }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        clarification_type: 'missing_fields',
        pending_action: buildPendingAction('create_appointment', {
          client_name: clientName,
          client_id: clientId,
          date_key: dateKey,
          time_hhmm: timeHhmm,
        }),
      },
    };
  }
  if (resolution.kind === 'none') {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('create_appointment', {
        client_name: clientName,
        client_id: clientId,
        date_key: dateKey,
        time_hhmm: timeHhmm,
      })
    );
  }

  const client = resolution.client;
  const dateTime = buildDateTimeKey(dateKey, timeHhmm);
  let result;
  try {
    result = await createBooking(client, dateTime, tenantId, {
      user_agent: 'voice-shortcut',
      device_type: 'shortcut',
    });
  } catch (err) {
    const message = String(err?.message || '');
    if (message.includes('invalid_grant')) {
      return {
        status: 'clarification',
        replyText: 'No pude crear la cita porque Google Calendar perdió autorización. Hay que reconectar la cuenta de Google primero.',
        data: {
          client,
          date_time: dateTime,
          integration_error: 'google_calendar_invalid_grant',
        },
      };
    }

    return {
      status: 'clarification',
      replyText: `No pude crear la cita por un error externo: ${message || 'error desconocido'}.`,
      data: {
        client,
        date_time: dateTime,
        integration_error: message || 'unknown',
      },
    };
  }

  if (result?.error) {
    return {
      status: 'clarification',
      replyText: result.error,
      data: { client, date_time: dateTime, booking_result: result },
    };
  }

  return {
    status: 'resolved',
    replyText: `Cita creada para ${client.first_name} ${client.last_name}: ${formatDateTime(`${dateTime}:00-04:00`)}.`,
    data: {
      client,
      appointment: result.appointment,
    },
  };
}

async function buildActivateRecurringReply(tenantId, clientName, weekdayName, timeHhmm, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        clarification_type: 'missing_fields',
        pending_action: buildPendingAction('activate_recurring', {
          client_name: clientName,
          client_id: clientId,
          weekday_name: weekdayName,
          time_hhmm: timeHhmm,
        }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        clarification_type: 'missing_fields',
        pending_action: buildPendingAction('activate_recurring', {
          client_name: clientName,
          client_id: clientId,
          weekday_name: weekdayName,
          time_hhmm: timeHhmm,
        }),
      },
    };
  }
  if (resolution.kind === 'none') {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }
  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('activate_recurring', {
        client_name: clientName,
        client_id: clientId,
        weekday_name: weekdayName,
        time_hhmm: timeHhmm,
      })
    );
  }

  const client = resolution.client;
  const latestSchedule = await findLatestRecurringScheduleForClient(tenantId, client.id);
  const dayIndex = weekdayName ? WEEKDAY_TO_INDEX[weekdayName] : null;

  if (!latestSchedule && (dayIndex == null || !timeHhmm)) {
    return {
      status: 'clarification',
      replyText: `¿Qué día y a qué hora es la sesión semanal de ${client.first_name}?`,
      data: {
        clarification_type: 'missing_fields',
        pending_action: buildPendingAction('activate_recurring', {
          client_name: clientName,
          client_id: client.id,
          weekday_name: weekdayName,
          time_hhmm: timeHhmm,
        }),
      },
    };
  }

  if (latestSchedule?.ended_at == null && latestSchedule?.paused_at == null) {
    if (dayIndex != null && timeHhmm && (Number(latestSchedule.day_of_week) !== dayIndex || latestSchedule.time !== timeHhmm)) {
      const updated = await updateRecurringSchedule(tenantId, latestSchedule.id, {
        day_of_week: dayIndex,
        time: timeHhmm,
        notes: latestSchedule.notes,
      });
      return {
        status: 'resolved',
        replyText: `Listo, ${client.first_name} ahora tiene sesión semanal los ${WEEKDAY_LABELS[weekdayName]} a las ${updated.time}.`,
        data: { client, recurring_schedule: updated },
      };
    }

    return {
      status: 'resolved',
      replyText: `${client.first_name} ya tiene sesión semanal los ${WEEKDAY_LABELS[weekdayNameFromIndex(latestSchedule.day_of_week)]} a las ${latestSchedule.time}.`,
      data: { client, recurring_schedule: latestSchedule },
    };
  }

  if (latestSchedule?.paused_at && !latestSchedule.ended_at) {
    let updated = latestSchedule;
    if (dayIndex != null && timeHhmm) {
      updated = await updateRecurringSchedule(tenantId, latestSchedule.id, {
        day_of_week: dayIndex,
        time: timeHhmm,
        notes: latestSchedule.notes,
      });
    }
    const resumed = await resumeRecurringSchedule(tenantId, latestSchedule.id);
    return {
      status: 'resolved',
      replyText: `Listo, ${client.first_name} volvió a modo semanal los ${WEEKDAY_LABELS[weekdayNameFromIndex(resumed.day_of_week)]} a las ${resumed.time}.`,
      data: { client, recurring_schedule: resumed },
    };
  }

  const created = await createRecurringSchedule(tenantId, {
    client_id: client.id,
    day_of_week: dayIndex,
    time: timeHhmm,
    started_at: getTodayContext(),
    notes: 'Activado desde comando de voz',
  });

  return {
    status: 'resolved',
    replyText: `Listo, ${client.first_name} ahora tiene sesión semanal los ${WEEKDAY_LABELS[weekdayName]} a las ${timeHhmm}.`,
    data: { client, recurring_schedule: created },
  };
}

async function buildPauseRecurringReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('pause_recurring', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'none') {
    return { status: 'resolved', replyText: `No encontré clientes para "${clientName}".`, data: { total: 0, matches: [] } };
  }
  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('pause_recurring', { client_name: clientName, client_id: clientId })
    );
  }
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: { pending_action: buildPendingAction('pause_recurring', { client_name: clientName, client_id: clientId }) },
    };
  }

  const client = resolution.client;
  const schedule = await findLatestRecurringScheduleForClient(tenantId, client.id);
  if (!schedule || schedule.ended_at || schedule.paused_at) {
    return {
      status: 'resolved',
      replyText: `${client.first_name} no tiene una recurrencia activa para pausar.`,
      data: { client, recurring_schedule: schedule },
    };
  }

  const paused = await pauseRecurringSchedule(tenantId, schedule.id);
  return {
    status: 'resolved',
    replyText: `Listo, se pausó la recurrencia de ${client.first_name}.`,
    data: { client, recurring_schedule: paused },
  };
}

async function buildResumeRecurringReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('resume_recurring', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'none') {
    return { status: 'resolved', replyText: `No encontré clientes para "${clientName}".`, data: { total: 0, matches: [] } };
  }
  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('resume_recurring', { client_name: clientName, client_id: clientId })
    );
  }
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: { pending_action: buildPendingAction('resume_recurring', { client_name: clientName, client_id: clientId }) },
    };
  }

  const client = resolution.client;
  const schedule = await findLatestRecurringScheduleForClient(tenantId, client.id);
  if (!schedule || schedule.ended_at || !schedule.paused_at) {
    return {
      status: 'resolved',
      replyText: `${client.first_name} no tiene una recurrencia pausada para reactivar.`,
      data: { client, recurring_schedule: schedule },
    };
  }

  const resumed = await resumeRecurringSchedule(tenantId, schedule.id);
  return {
    status: 'resolved',
    replyText: `Listo, se reactivó la recurrencia de ${client.first_name}.`,
    data: { client, recurring_schedule: resumed },
  };
}

async function buildDeactivateRecurringReply(tenantId, clientName, clientId = null) {
  if (!clientName && !clientId) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {
        pending_action: buildPendingAction('deactivate_recurring', { client_name: clientName, client_id: clientId }),
      },
    };
  }

  const resolution = await resolveClientReference(tenantId, { clientId, clientName });
  if (resolution.kind === 'none') {
    return { status: 'resolved', replyText: `No encontré clientes para "${clientName}".`, data: { total: 0, matches: [] } };
  }
  if (resolution.kind === 'multiple') {
    return buildClientClarificationReply(
      clientName,
      resolution.matches,
      buildPendingAction('deactivate_recurring', { client_name: clientName, client_id: clientId })
    );
  }
  if (resolution.kind === 'missing') {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: { pending_action: buildPendingAction('deactivate_recurring', { client_name: clientName, client_id: clientId }) },
    };
  }

  const client = resolution.client;
  const schedule = await findLatestRecurringScheduleForClient(tenantId, client.id);
  if (!schedule || schedule.ended_at) {
    return {
      status: 'resolved',
      replyText: `${client.first_name} no tiene una recurrencia activa o pausada para desactivar.`,
      data: { client, recurring_schedule: schedule },
    };
  }

  const ended = await endRecurringSchedule(tenantId, schedule.id);
  return {
    status: 'resolved',
    replyText: `Listo, se desactivó la recurrencia de ${client.first_name}.`,
    data: { client, recurring_schedule: ended },
  };
}

async function buildUpdateAvailabilityReply(tenantId, entities) {
  const weekdayName = entities.weekday_name;
  if (!weekdayName || !WEEKDAY_LABELS[weekdayName]) {
    return {
      status: 'clarification',
      replyText: 'Dime qué día quieres cambiar. Ejemplo: jueves.',
      data: {},
    };
  }

  const hasAvailabilityDirective = [
    entities.morning_mode,
    entities.afternoon_mode,
    entities.morning_start,
    entities.morning_end,
    entities.afternoon_start,
    entities.afternoon_end,
  ].some((value) => value != null && value !== '');

  if (!hasAvailabilityDirective) {
    return {
      status: 'clarification',
      replyText: 'Entendí el día, pero no un cambio concreto de disponibilidad. Dime algo como "jueves de 8 a 12" o "jueves en la tarde nada".',
      data: { weekday_name: weekdayName },
    };
  }

  const [rows] = await pool.query(
    `SELECT available_hours, available_days
     FROM config
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );
  const cfg = rows[0];
  const availableHours = parseJsonField(cfg?.available_hours, {});
  const availableDays = parseJsonField(cfg?.available_days, []);
  const currentDaySlots = Array.isArray(availableHours[weekdayName]) ? availableHours[weekdayName] : [];
  const currentMorning = currentDaySlots.filter((slot) => timeToMinutes(slot) < 13 * 60);
  const currentAfternoon = currentDaySlots.filter((slot) => timeToMinutes(slot) >= 16 * 60);

  let newMorning = currentMorning;
  let newAfternoon = currentAfternoon;

  if (entities.morning_mode === 'off') newMorning = [];
  if (entities.morning_mode === 'range') {
    newMorning = buildHourlySlots(entities.morning_start, entities.morning_end);
  }

  if (entities.afternoon_mode === 'off') newAfternoon = [];
  if (entities.afternoon_mode === 'range') {
    newAfternoon = buildHourlySlots(entities.afternoon_start, entities.afternoon_end);
  }

  if (
    entities.morning_mode == null &&
    entities.afternoon_mode == null &&
    entities.morning_start &&
    entities.morning_end
  ) {
    newMorning = buildHourlySlots(entities.morning_start, entities.morning_end);
  }

  const mergedSlots = [...newMorning, ...newAfternoon]
    .filter(Boolean)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

  availableHours[weekdayName] = mergedSlots;
  const nextAvailableDays = new Set(availableDays);
  if (mergedSlots.length > 0) nextAvailableDays.add(weekdayName);
  else nextAvailableDays.delete(weekdayName);
  const orderedAvailableDays = WEEKDAY_ORDER.filter((day) => nextAvailableDays.has(day));

  await pool.query(
    `UPDATE config
     SET available_hours = ?, available_days = ?
     WHERE tenant_id = ?`,
    [JSON.stringify(availableHours), JSON.stringify(orderedAvailableDays), tenantId]
  );

  if (!mergedSlots.length) {
    return {
      status: 'resolved',
      replyText: `Disponibilidad actualizada para ${WEEKDAY_LABELS[weekdayName]}: sin horarios.`,
      data: { weekday_name: weekdayName, slots: [] },
    };
  }

  const summaryParts = [];
  if (newMorning.length > 0) summaryParts.push(`mañana ${describeSlots(newMorning)}`);
  else if (entities.morning_mode === 'off') summaryParts.push('mañana sin horarios');

  if (newAfternoon.length > 0) summaryParts.push(`tarde ${describeSlots(newAfternoon)}`);
  else if (entities.afternoon_mode === 'off') summaryParts.push('tarde sin horarios');

  return {
    status: 'resolved',
    replyText:
      summaryParts.length > 0
        ? `Disponibilidad actualizada para ${WEEKDAY_LABELS[weekdayName]}: ${summaryParts.join(', ')}.`
        : `Disponibilidad actualizada para ${WEEKDAY_LABELS[weekdayName]}: ${mergedSlots.join(', ')}.`,
    data: { weekday_name: weekdayName, slots: mergedSlots },
  };
}

async function executeVoiceCommand({ tenantId, parsedCommand }) {
  const { intent, entities = {} } = parsedCommand || {};

  if (intent === 'agenda_query') {
    return buildAgendaReply(tenantId, entities);
  }
  if (intent === 'pending_payments') {
    return buildPendingPaymentsReply(tenantId);
  }
  if (intent === 'pending_amount') {
    return buildPendingAmountReply(tenantId);
  }
  if (intent === 'reminder_toggle') {
    return buildReminderToggleReply(tenantId, entities.reminder_enabled);
  }
  if (intent === 'send_reminders') {
    return buildSendRemindersReply(tenantId, entities.reminder_date);
  }
  if (intent === 'sessions_to_goal') {
    return buildSessionsToGoalReply(tenantId, entities.goal_amount);
  }
  if (intent === 'client_lookup') {
    return buildClientLookupReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'client_upcoming_appointments') {
    return buildClientUpcomingAppointmentsReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'reminder_check') {
    return buildReminderCheckReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'confirmation_check') {
    return buildConfirmationCheckReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'rescheduled_list') {
    return buildRescheduledListReply(tenantId);
  }
  if (intent === 'new_clients_count') {
    return buildNewClientsCountReply(tenantId, entities.month, entities.year);
  }
  if (intent === 'unconfirmed_tomorrow') {
    return buildUnconfirmedTomorrowReply(tenantId);
  }
  if (intent === 'confirmed_today') {
    return buildConfirmedTodayReply(tenantId);
  }
  if (intent === 'appointments_this_week') {
    return buildAppointmentsThisWeekReply(tenantId);
  }
  if (intent === 'create_appointment') {
    return buildCreateAppointmentReply(tenantId, entities.client_name, entities.date_key, entities.time_hhmm, entities.client_id);
  }
  if (intent === 'activate_recurring') {
    return buildActivateRecurringReply(tenantId, entities.client_name, entities.weekday_name, entities.time_hhmm, entities.client_id);
  }
  if (intent === 'deactivate_recurring') {
    return buildDeactivateRecurringReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'pause_recurring') {
    return buildPauseRecurringReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'resume_recurring') {
    return buildResumeRecurringReply(tenantId, entities.client_name, entities.client_id);
  }
  if (intent === 'update_availability') {
    return buildUpdateAvailabilityReply(tenantId, entities);
  }

  return {
    status: 'clarification',
    replyText: 'Todavía no puedo hacer eso. Por ahora consulta agenda, pendientes, metas, clientes, confirmaciones, recordatorios, reagendados, nuevos por mes, crea citas para clientes existentes, activa o pausa recurrencias y ajusta recordatorios y disponibilidad.',
    data: {
      supported_intents: [
        'agenda_query',
        'pending_payments',
        'pending_amount',
        'reminder_toggle',
        'send_reminders',
        'sessions_to_goal',
        'client_lookup',
        'client_upcoming_appointments',
        'reminder_check',
        'confirmation_check',
        'rescheduled_list',
        'new_clients_count',
        'unconfirmed_tomorrow',
        'confirmed_today',
        'appointments_this_week',
        'create_appointment',
        'activate_recurring',
        'deactivate_recurring',
        'pause_recurring',
        'resume_recurring',
        'update_availability',
      ],
    },
  };
}

module.exports = {
  executeVoiceCommand,
};
