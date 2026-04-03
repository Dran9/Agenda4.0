const { pool } = require('../../db');
const { createBooking } = require('../booking');
const { getTodayContext } = require('./parseCommand');
const { checkAndSendReminders } = require('../reminder');
const { refreshConfigSchedulers } = require('../../cron/scheduler');

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
    timeZone: 'America/La_Paz',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return label;
}

function formatMonthYear(month, year) {
  const label = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
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

async function buildAgendaReply(tenantId, dateKey) {
  const dayKey = dateKey || getTodayContext();
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
      data: { date_key: dayKey, total: 0, items: [] },
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
    data: { date_key: dayKey, total: rows.length, items: rows },
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

async function buildClientLookupReply(tenantId, clientName) {
  if (!clientName) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {},
    };
  }

  const matches = await findClientsByName(tenantId, clientName);
  if (!matches.length) {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (matches.length === 1) {
    const client = matches[0];
    return {
      status: 'resolved',
      replyText:
        `${client.first_name} ${client.last_name}. ` +
        `${client.city || 'Sin ciudad'}. ` +
        `Arancel Bs ${client.fee}. ` +
        `${client.next_appointment ? `Próxima cita: ${formatDateTime(client.next_appointment)}.` : 'Sin próxima cita.'}`,
      data: { total: 1, matches },
    };
  }

  const lines = matches.map((client) =>
    `${client.first_name} ${client.last_name}${client.city ? `, ${client.city}` : ''}`
  );

  return {
    status: 'clarification',
    replyText: [`Encontré varios clientes para "${clientName}".`, ...shortList(lines)].join('\n'),
    data: { total: matches.length, matches },
  };
}

async function buildClientUpcomingAppointmentsReply(tenantId, clientName) {
  if (!clientName) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {},
    };
  }

  const matches = await findClientsByName(tenantId, clientName);
  if (!matches.length) {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (matches.length > 1) {
    const lines = matches.map((client) => `${client.first_name} ${client.last_name}`);
    return {
      status: 'clarification',
      replyText: [`Encontré varios clientes para "${clientName}".`, ...shortList(lines)].join('\n'),
      data: { total: matches.length, matches },
    };
  }

  const client = matches[0];
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

async function buildReminderCheckReply(tenantId, clientName) {
  if (!clientName) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {},
    };
  }

  const matches = await findClientsByName(tenantId, clientName);
  if (!matches.length) {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (matches.length > 1) {
    const lines = matches.map((client) => `${client.first_name} ${client.last_name}`);
    return {
      status: 'clarification',
      replyText: [`Encontré varios clientes para "${clientName}".`, ...shortList(lines)].join('\n'),
      data: { total: matches.length, matches },
    };
  }

  const client = matches[0];
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

async function buildConfirmationCheckReply(tenantId, clientName) {
  if (!clientName) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {},
    };
  }

  const matches = await findClientsByName(tenantId, clientName);
  if (!matches.length) {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (matches.length > 1) {
    const lines = matches.map((client) => `${client.first_name} ${client.last_name}`);
    return {
      status: 'clarification',
      replyText: [`Encontré varios clientes para "${clientName}".`, ...shortList(lines)].join('\n'),
      data: { total: matches.length, matches },
    };
  }

  const client = matches[0];
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

async function buildCreateAppointmentReply(tenantId, clientName, dateKey, timeHhmm) {
  if (!clientName) {
    return {
      status: 'clarification',
      replyText: 'Dime el nombre del cliente.',
      data: {},
    };
  }

  if (!dateKey || !timeHhmm) {
    return {
      status: 'clarification',
      replyText: 'Dime fecha y hora. Ejemplo: crear cita para Cecilia de Ugarte el 8 de abril a las 08:00.',
      data: {},
    };
  }

  const matches = await findClientsByName(tenantId, clientName);
  if (!matches.length) {
    return {
      status: 'resolved',
      replyText: `No encontré clientes para "${clientName}".`,
      data: { total: 0, matches: [] },
    };
  }

  if (matches.length > 1) {
    const lines = matches.map((client) => `${client.first_name} ${client.last_name}`);
    return {
      status: 'clarification',
      replyText: [`Encontré varios clientes para "${clientName}".`, ...shortList(lines)].join('\n'),
      data: { total: matches.length, matches },
    };
  }

  const client = matches[0];
  const dateTime = buildDateTimeKey(dateKey, timeHhmm);
  const result = await createBooking(client, dateTime, tenantId, {
    user_agent: 'voice-shortcut',
    device_type: 'shortcut',
  });

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

async function buildUpdateAvailabilityReply(tenantId, entities) {
  const weekdayName = entities.weekday_name;
  if (!weekdayName || !WEEKDAY_LABELS[weekdayName]) {
    return {
      status: 'clarification',
      replyText: 'Dime qué día quieres cambiar. Ejemplo: jueves.',
      data: {},
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
    return buildAgendaReply(tenantId, entities.date_key);
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
    return buildClientLookupReply(tenantId, entities.client_name);
  }
  if (intent === 'client_upcoming_appointments') {
    return buildClientUpcomingAppointmentsReply(tenantId, entities.client_name);
  }
  if (intent === 'reminder_check') {
    return buildReminderCheckReply(tenantId, entities.client_name);
  }
  if (intent === 'confirmation_check') {
    return buildConfirmationCheckReply(tenantId, entities.client_name);
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
    return buildCreateAppointmentReply(tenantId, entities.client_name, entities.date_key, entities.time_hhmm);
  }
  if (intent === 'update_availability') {
    return buildUpdateAvailabilityReply(tenantId, entities);
  }

  return {
    status: 'clarification',
    replyText: 'Todavía no puedo hacer eso. Por ahora consulta agenda, pendientes, metas, clientes, confirmaciones, recordatorios, reagendados, nuevos por mes, crea citas para clientes existentes o ajusta recordatorios y disponibilidad.',
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
        'update_availability',
      ],
    },
  };
}

module.exports = {
  executeVoiceCommand,
};
