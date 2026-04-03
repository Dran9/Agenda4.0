const { completeJson } = require('./groq');

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
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No se pudo extraer JSON del parser: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function detectMonthYear(text) {
  const normalized = normalizeText(text);
  const months = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const monthName = Object.keys(months).find((name) => normalized.includes(name));
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (!monthName && !yearMatch) return { month: null, year: null };
  return {
    month: monthName ? months[monthName] : null,
    year: yearMatch ? Number(yearMatch[1]) : null,
  };
}

function detectDirectIntent(text) {
  const normalized = normalizeText(text);
  const monthYear = detectMonthYear(text);

  if (/\b(cuanto|cuanta)\b.*\bdinero pendiente\b|\bpendiente de cobro\b/.test(normalized)) {
    return { intent: 'pending_amount', entities: {} };
  }
  if (/\bquienes\b.*\bno han confirmado\b.*\bmanana\b|\bno confirmaron manana\b/.test(normalized)) {
    return { intent: 'unconfirmed_tomorrow', entities: {} };
  }
  if (/\bquienes\b.*\bconfirmaron hoy\b|\bquien confirmo hoy\b/.test(normalized)) {
    return { intent: 'confirmed_today', entities: {} };
  }
  if (/\bcuantas\b.*\bcitas\b.*\besta semana\b|\bcitas esta semana\b/.test(normalized)) {
    return { intent: 'appointments_this_week', entities: {} };
  }
  if (/\bquienes\b.*\breagend/.test(normalized)) {
    return { intent: 'rescheduled_list', entities: {} };
  }
  if (/\bnuevos\b.*\btuve\b/.test(normalized) || /\bclientes nuevos\b/.test(normalized)) {
    return { intent: 'new_clients_count', entities: monthYear };
  }
  const reminderMatch = normalized.match(/recordatorio a (.+)$/);
  if (/\bhas enviado recordatorio\b/.test(normalized) && reminderMatch?.[1]) {
    return { intent: 'reminder_check', entities: { client_name: reminderMatch[1].trim() } };
  }
  const confirmationMatch = normalized.match(/ha confirmado (.+)$/);
  if (confirmationMatch?.[1]) {
    return { intent: 'confirmation_check', entities: { client_name: confirmationMatch[1].trim() } };
  }

  return null;
}

async function parseVoiceCommand(inputText) {
  const text = String(inputText || '').trim();
  if (!text) {
    return {
      intent: 'unknown',
      confidence: 0,
      reply_hint: 'No llegó texto ni transcripción.',
      entities: {},
    };
  }

  const direct = detectDirectIntent(text);
  if (direct) {
    return {
      intent: direct.intent,
      confidence: 0.99,
      reply_hint: '',
      entities: {
        client_name: direct.entities?.client_name ? String(direct.entities.client_name).trim() : null,
        date_key: direct.entities?.date_key || null,
        time_hhmm: direct.entities?.time_hhmm || null,
        goal_amount: direct.entities?.goal_amount != null && direct.entities.goal_amount !== ''
          ? Number(direct.entities.goal_amount)
          : null,
        month: direct.entities?.month != null && direct.entities.month !== ''
          ? Number(direct.entities.month)
          : null,
        year: direct.entities?.year != null && direct.entities.year !== ''
          ? Number(direct.entities.year)
          : null,
      },
      raw: direct,
    };
  }

  const today = getTodayContext();
  const content = await completeJson([
    {
      role: 'system',
      content:
        `Eres un parser de comandos administrativos para una agenda terapéutica. ` +
        `Debes devolver solo JSON válido, sin markdown ni explicación. ` +
        `Fecha actual en Bolivia: ${today}. ` +
        `Intents permitidos: agenda_query, pending_payments, pending_amount, sessions_to_goal, client_lookup, client_upcoming_appointments, reminder_check, confirmation_check, rescheduled_list, new_clients_count, unconfirmed_tomorrow, confirmed_today, appointments_this_week, create_appointment, unknown. ` +
        `Entities posibles: client_name (string o null), date_key (YYYY-MM-DD o null), time_hhmm (HH:MM o null), goal_amount (number o null), month (1-12 o null), year (YYYY o null). ` +
        `Convierte fechas relativas como hoy, mañana, pasado mañana, este viernes, el viernes a YYYY-MM-DD. ` +
        `Convierte horas como 8, 8 de la mañana, 8 am, 8 y media, 14:30 a HH:MM en formato 24 horas. ` +
        `Si el usuario pregunta por marzo o abril, extrae month y year cuando sea posible. ` +
        `Si el usuario pide una acción no permitida o destructiva, usa unknown. ` +
        `Responde con este shape exacto: ` +
        `{"intent":"...","confidence":0.0,"entities":{"client_name":null,"date_key":null,"time_hhmm":null,"goal_amount":null,"month":null,"year":null},"reply_hint":"..."}`,
    },
    {
      role: 'user',
      content: text,
    },
  ]);

  const parsed = extractJsonObject(content);
  const entities = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};

  return {
    intent: typeof parsed.intent === 'string' ? parsed.intent : 'unknown',
    confidence: Number(parsed.confidence || 0),
    reply_hint: typeof parsed.reply_hint === 'string' ? parsed.reply_hint : '',
    entities: {
      client_name: entities.client_name ? String(entities.client_name).trim() : null,
      date_key: entities.date_key ? String(entities.date_key).trim() : null,
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
    },
    raw: parsed,
  };
}

module.exports = {
  getTodayContext,
  parseVoiceCommand,
};
