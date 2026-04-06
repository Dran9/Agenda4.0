const { pool } = require('../../db');
const { completeJson } = require('./groq');
const { normalizeText, parseJsonField } = require('./context');

const SUPPORTED_INTENTS = [
  'agenda_query',
  'pending_payments',
  'pending_amount',
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
  'reminder_toggle',
  'send_reminders',
  'update_availability',
  'unknown',
];

function getTodayContext() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function extractJsonObject(text) {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No se pudo extraer JSON del planner: ${text}`);
  }
  return JSON.parse(String(text).slice(start, end + 1));
}

function sanitizeEntities(entities = {}) {
  return {
    client_id: entities.client_id != null && entities.client_id !== ''
      ? Number(entities.client_id)
      : null,
    client_name: entities.client_name ? String(entities.client_name).trim() : null,
    date_key: entities.date_key ? String(entities.date_key).trim() : null,
    agenda_scope: entities.agenda_scope ? normalizeText(entities.agenda_scope) : null,
    time_hhmm: entities.time_hhmm ? String(entities.time_hhmm).trim() : null,
    goal_amount: entities.goal_amount != null && entities.goal_amount !== ''
      ? Number(entities.goal_amount)
      : null,
    month: entities.month != null && entities.month !== ''
      ? Number(entities.month)
      : null,
    year: entities.year != null && entities.year !== ''
      ? Number(entities.year)
      : null,
    reminder_enabled: entities.reminder_enabled ?? null,
    reminder_date: entities.reminder_date ? String(entities.reminder_date).trim() : null,
    weekday_name: entities.weekday_name ? normalizeText(entities.weekday_name) : null,
    morning_mode: entities.morning_mode ? normalizeText(entities.morning_mode) : null,
    morning_start: entities.morning_start ? String(entities.morning_start).trim() : null,
    morning_end: entities.morning_end ? String(entities.morning_end).trim() : null,
    afternoon_mode: entities.afternoon_mode ? normalizeText(entities.afternoon_mode) : null,
    afternoon_start: entities.afternoon_start ? String(entities.afternoon_start).trim() : null,
    afternoon_end: entities.afternoon_end ? String(entities.afternoon_end).trim() : null,
  };
}

async function toolSearchClients(tenantId, args = {}) {
  const query = String(args.query || '').trim();
  if (!query) return { error: 'missing_query' };

  const pattern = `%${query.replace(/\s+/g, '%')}%`;
  const [rows] = await pool.query(
    `SELECT c.id, c.first_name, c.last_name, c.city, c.phone, c.fee,
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
     LIMIT 5`,
    [tenantId, pattern, query]
  );

  return {
    total: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      full_name: `${row.first_name} ${row.last_name}`.trim(),
      city: row.city || null,
      phone_suffix: row.phone ? String(row.phone).slice(-4) : null,
      fee: row.fee != null ? Number(row.fee) : null,
      next_appointment: row.next_appointment || null,
    })),
  };
}

async function toolGetClientUpcomingAppointments(tenantId, args = {}) {
  const clientId = Number(args.client_id || 0);
  if (!clientId) return { error: 'missing_client_id' };

  const [[client]] = await pool.query(
    `SELECT id, first_name, last_name, city, phone, fee
     FROM clients
     WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, clientId]
  );
  if (!client) return { error: 'client_not_found' };

  const [rows] = await pool.query(
    `SELECT id, date_time, status
     FROM appointments
     WHERE tenant_id = ?
       AND client_id = ?
       AND status IN ('Agendada','Confirmada','Reagendada')
       AND date_time > NOW()
     ORDER BY date_time ASC
     LIMIT 5`,
    [tenantId, clientId]
  );

  return {
    client: {
      id: client.id,
      full_name: `${client.first_name} ${client.last_name}`.trim(),
      city: client.city || null,
      phone_suffix: client.phone ? String(client.phone).slice(-4) : null,
      fee: client.fee != null ? Number(client.fee) : null,
    },
    total: rows.length,
    items: rows,
  };
}

async function toolGetDayAgenda(tenantId, args = {}) {
  const dateKey = String(args.date_key || '').trim();
  if (!dateKey) return { error: 'missing_date_key' };

  const [rows] = await pool.query(
    `SELECT a.id, a.date_time, a.status, c.first_name, c.last_name
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = ?
       AND a.date_time >= ?
       AND a.date_time < DATE_ADD(?, INTERVAL 1 DAY)
       AND a.status IN ('Agendada','Confirmada','Reagendada','Completada','No-show')
     ORDER BY a.date_time ASC
     LIMIT 10`,
    [tenantId, `${dateKey} 00:00:00`, `${dateKey} 00:00:00`]
  );

  return {
    date_key: dateKey,
    total: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      date_time: row.date_time,
      status: row.status,
      client_name: `${row.first_name} ${row.last_name}`.trim(),
    })),
  };
}

async function toolGetWeekdayAvailability(tenantId, args = {}) {
  const weekdayName = normalizeText(args.weekday_name || '');
  if (!weekdayName) return { error: 'missing_weekday_name' };

  const [[cfg]] = await pool.query(
    `SELECT available_hours, available_days
     FROM config
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );

  const hours = parseJsonField(cfg?.available_hours, {});
  const days = parseJsonField(cfg?.available_days, []);
  return {
    weekday_name: weekdayName,
    enabled: Array.isArray(days) ? days.includes(weekdayName) : false,
    slots: Array.isArray(hours?.[weekdayName]) ? hours[weekdayName] : [],
  };
}

async function runPlanningTool(tenantId, toolName, toolArgs) {
  if (toolName === 'search_clients') return toolSearchClients(tenantId, toolArgs);
  if (toolName === 'get_client_upcoming_appointments') return toolGetClientUpcomingAppointments(tenantId, toolArgs);
  if (toolName === 'get_day_agenda') return toolGetDayAgenda(tenantId, toolArgs);
  if (toolName === 'get_weekday_availability') return toolGetWeekdayAvailability(tenantId, toolArgs);
  return { error: 'unknown_tool' };
}

function buildPlannerSystemPrompt(recentSummary) {
  return (
    `Eres un planner de comandos administrativos para una agenda terapéutica. ` +
    `Fecha actual en Bolivia: ${getTodayContext()}. ` +
    `Debes devolver solo JSON válido. ` +
    `Tienes este contexto reciente:\n${recentSummary}\n` +
    `Intents permitidos: ${SUPPORTED_INTENTS.join(', ')}. ` +
    `Entities posibles: client_id (number o null), client_name (string o null), date_key (YYYY-MM-DD o null), agenda_scope (day|this_week|next_week|null), time_hhmm (HH:MM o null), goal_amount (number o null), month (1-12 o null), year (YYYY o null), reminder_enabled (boolean o null), reminder_date (today|tomorrow|null), weekday_name (lunes|martes|miercoles|jueves|viernes|sabado|domingo|null), morning_mode (keep|off|range|null), morning_start (HH:MM|null), morning_end (HH:MM|null), afternoon_mode (keep|off|range|null), afternoon_start (HH:MM|null), afternoon_end (HH:MM|null). ` +
    `Si puedes resolver el comando final directamente, responde en modo final. ` +
    `Si te falta grounding, puedes pedir una sola tool por turno en modo tool. ` +
    `Tools disponibles: ` +
    `search_clients(query), get_client_upcoming_appointments(client_id), get_day_agenda(date_key), get_weekday_availability(weekday_name). ` +
    `Usa client_id cuando puedas resolver un cliente exacto. ` +
    `Aprovecha el contexto reciente para seguir conversaciones como "el de Santa Cruz", "el otro", "sí", "a las 8", "mañana" o "en la tarde nada". ` +
    `Para agenda, usa agenda_scope=this_week o next_week cuando el usuario pregunte por esta semana o la próxima semana. ` +
    `Si el usuario pide algo fuera del alcance actual o destructivo, usa unknown. ` +
    `Shape exacto: ` +
    `{"mode":"final","intent":"unknown","confidence":0,"entities":{"client_id":null,"client_name":null,"date_key":null,"agenda_scope":null,"time_hhmm":null,"goal_amount":null,"month":null,"year":null,"reminder_enabled":null,"reminder_date":null,"weekday_name":null,"morning_mode":null,"morning_start":null,"morning_end":null,"afternoon_mode":null,"afternoon_start":null,"afternoon_end":null},"reply_hint":"","tool_name":null,"tool_args":null,"reason":""} ` +
    `o ` +
    `{"mode":"tool","intent":"unknown","confidence":0,"entities":{"client_id":null,"client_name":null,"date_key":null,"agenda_scope":null,"time_hhmm":null,"goal_amount":null,"month":null,"year":null,"reminder_enabled":null,"reminder_date":null,"weekday_name":null,"morning_mode":null,"morning_start":null,"morning_end":null,"afternoon_mode":null,"afternoon_start":null,"afternoon_end":null},"reply_hint":"","tool_name":"search_clients","tool_args":{"query":"..."}, "reason":"..."}.`
  );
}

async function planVoiceCommand({ tenantId, text, recentSummary = 'Sin contexto reciente.' }) {
  const messages = [
    {
      role: 'system',
      content: buildPlannerSystemPrompt(recentSummary),
    },
    {
      role: 'user',
      content: text,
    },
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const content = await completeJson(messages, { temperature: 0.1 });
    const parsed = extractJsonObject(content);
    const mode = parsed.mode === 'tool' ? 'tool' : 'final';

    if (mode === 'final') {
      return {
        intent: typeof parsed.intent === 'string' && SUPPORTED_INTENTS.includes(parsed.intent)
          ? parsed.intent
          : 'unknown',
        confidence: Number(parsed.confidence || 0),
        reply_hint: typeof parsed.reply_hint === 'string' ? parsed.reply_hint : '',
        entities: sanitizeEntities(parsed.entities),
        raw: parsed,
      };
    }

    const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : '';
    const toolArgs = parsed.tool_args && typeof parsed.tool_args === 'object' ? parsed.tool_args : {};
    const toolResult = await runPlanningTool(tenantId, toolName, toolArgs);

    messages.push({
      role: 'assistant',
      content,
    });
    messages.push({
      role: 'user',
      content:
        `Resultado de la tool ${toolName}: ${JSON.stringify(toolResult)}. ` +
        `Ahora devuelve el comando final en modo final, salvo que todavía te falte una sola tool más imprescindible.`,
    });
  }

  return {
    intent: 'unknown',
    confidence: 0,
    reply_hint: 'No pude planificar el comando con suficiente claridad.',
    entities: sanitizeEntities({}),
    raw: { source: 'planner_fallback' },
  };
}

module.exports = {
  planVoiceCommand,
  sanitizeEntities,
};
