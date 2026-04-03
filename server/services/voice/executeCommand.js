const { pool } = require('../../db');
const { getTodayContext } = require('./parseCommand');

function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatDateTime(dateTime) {
  const parts = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(dateTime));
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  return `${day}/${month} ${hour}:${minute}`;
}

function shortList(items, max = 5) {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `y ${items.length - max} más`];
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
      replyText: `No hay citas para ${dayKey}.`,
      data: { date_key: dayKey, total: 0, items: [] },
    };
  }

  const lines = rows.map((row) =>
    `${formatDateTime(row.date_time)} ${row.first_name} ${row.last_name} (${row.status}${row.payment_status ? `, ${row.payment_status}` : ''})`
  );

  return {
    status: 'resolved',
    replyText: [`${rows.length} citas para ${dayKey}.`, ...shortList(lines)].join('\n'),
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
    replyText: [`Hay ${rows.length} pagos pendientes.`, ...shortList(lines)].join('\n'),
    data: { total: rows.length, items: rows },
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
        `${client.next_appointment ? `Próxima cita ${formatDateTime(client.next_appointment)}.` : 'Sin próxima cita.'}`,
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
    replyText: [`${client.first_name} ${client.last_name} tiene ${appointments.length} próximas citas.`, ...shortList(lines)].join('\n'),
    data: { client, total: appointments.length, items: appointments },
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
  if (intent === 'sessions_to_goal') {
    return buildSessionsToGoalReply(tenantId, entities.goal_amount);
  }
  if (intent === 'client_lookup') {
    return buildClientLookupReply(tenantId, entities.client_name);
  }
  if (intent === 'client_upcoming_appointments') {
    return buildClientUpcomingAppointmentsReply(tenantId, entities.client_name);
  }

  return {
    status: 'clarification',
    replyText: 'Todavía no puedo hacer eso. Por ahora consulta agenda, pagos pendientes, meta mensual o próximas citas.',
    data: { supported_intents: ['agenda_query', 'pending_payments', 'sessions_to_goal', 'client_lookup', 'client_upcoming_appointments'] },
  };
}

module.exports = {
  executeVoiceCommand,
};
