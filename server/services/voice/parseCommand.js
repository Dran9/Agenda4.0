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

  const today = getTodayContext();
  const content = await completeJson([
    {
      role: 'system',
      content:
        `Eres un parser de comandos administrativos para una agenda terapéutica. ` +
        `Debes devolver solo JSON válido, sin markdown ni explicación. ` +
        `Fecha actual en Bolivia: ${today}. ` +
        `Intents permitidos: agenda_query, pending_payments, sessions_to_goal, client_lookup, client_upcoming_appointments, unknown. ` +
        `Entities posibles: client_name (string o null), date_key (YYYY-MM-DD o null), goal_amount (number o null). ` +
        `Convierte fechas relativas como hoy, mañana, pasado mañana, este viernes, el viernes a YYYY-MM-DD. ` +
        `Si el usuario pide una acción no permitida o destructiva, usa unknown. ` +
        `Responde con este shape exacto: ` +
        `{"intent":"...","confidence":0.0,"entities":{"client_name":null,"date_key":null,"goal_amount":null},"reply_hint":"..."}`,
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
      goal_amount: entities.goal_amount != null && entities.goal_amount !== ''
        ? Number(entities.goal_amount)
        : null,
    },
    raw: parsed,
  };
}

module.exports = {
  getTodayContext,
  parseVoiceCommand,
};
