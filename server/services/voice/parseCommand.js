const { completeJson } = require('./groq');
const { buildRecentVoiceSummary, resolveExplicitFollowUp } = require('./context');
const { planVoiceCommand, sanitizeEntities } = require('./planner');

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

function findWeekdayName(text) {
  const normalized = normalizeText(text);
  const weekdays = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  return weekdays.find((name) => normalized.includes(name)) || null;
}

function toDateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function resolveRelativeDate(text) {
  const normalized = normalizeText(text);
  const todayKey = getTodayContext();

  if (/\bpasado manana\b/.test(normalized)) {
    return addDays(todayKey, 2);
  }
  if (/\bmanana\b/.test(normalized)) {
    return addDays(todayKey, 1);
  }
  if (/\bhoy\b/.test(normalized)) {
    return todayKey;
  }

  const weekdayName = findWeekdayName(normalized);
  if (!weekdayName) return null;

  const weekdayMap = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  const [year, month, day] = todayKey.split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const currentWeekday = today.getUTCDay();
  const targetWeekday = weekdayMap[weekdayName];
  let diff = (targetWeekday - currentWeekday + 7) % 7;

  const hasExplicitThis = /\beste\b/.test(normalized);
  const hasExplicitNext = /\bproximo\b|\bsiguiente\b/.test(normalized);

  if (hasExplicitNext && diff === 0) diff = 7;
  if (!hasExplicitThis && !hasExplicitNext && diff === 0) diff = 7;

  const target = new Date(today);
  target.setUTCDate(target.getUTCDate() + diff);
  return toDateKey(target);
}

function extractNaturalTime(text) {
  const normalized = normalizeText(text);
  const explicit = normalized.match(
    /(?:a\s+las?|para\s+las?|a\s+la|para\s+la)\s+(\d{1,2}(?::\d{2})?(?:\s+y\s+media)?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?(?:\s+de\s+la\s+(?:manana|tarde|noche))?)/
  );
  if (explicit) return parseTimeValue(explicit[1]);

  const naked = normalized.match(/\b(\d{1,2}:\d{2}|\d{1,2})\b/);
  if (naked) return parseTimeValue(naked[1]);
  return null;
}

function extractClientNameForCreate(text) {
  const original = String(text || '').trim();
  let candidate = '';

  const afterPara = original.match(/(?:nueva\s+|crear?\s+|crea\s+|agendar?\s+|agenda(?:r)?\s+)?(?:una\s+)?(?:nueva\s+)?(?:cita|evento)(?:\s+para)?\s+(.+)$/i);
  if (afterPara?.[1]) {
    candidate = afterPara[1];
  } else {
    const simpler = original.match(/para\s+(.+)$/i);
    if (simpler?.[1]) candidate = simpler[1];
  }

  if (!candidate) return null;

  const cutPatterns = [
    /\s+para\s+el\s+/i,
    /\s+el\s+(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i,
    /\s+este\s+(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i,
    /\s+hoy\b/i,
    /\s+mañana\b/i,
    /\s+pasado\s+mañana\b/i,
    /\s+a\s+las?\s+/i,
    /\s+para\s+las?\s+/i,
    /\s+\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i,
    /\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i,
  ];

  let endIndex = candidate.length;
  for (const pattern of cutPatterns) {
    const match = candidate.match(pattern);
    if (match?.index != null) {
      endIndex = Math.min(endIndex, match.index);
    }
  }

  const trimmed = candidate.slice(0, endIndex).replace(/[,.]+$/, '').trim();
  return trimmed || null;
}

function detectCreateAppointmentIntent(text) {
  const normalized = normalizeText(text);
  const soundsLikeCreate =
    /\b(nueva cita|crear cita|crea cita|agendar cita|agenda cita|nuevo evento|crear evento|crea evento|nueva sesion|nueva sesión)\b/.test(normalized) ||
    /\b(cita|evento)\b.*\bpara\b/.test(normalized);
  if (!soundsLikeCreate) return null;

  const clientName = extractClientNameForCreate(text);
  const dateKey = resolveRelativeDate(text);
  const timeHhmm = extractNaturalTime(text);

  if (!clientName && !dateKey && !timeHhmm) return null;
  return {
    intent: 'create_appointment',
    entities: {
      client_name: clientName,
      date_key: dateKey,
      time_hhmm: timeHhmm,
    },
  };
}

function detectAgendaIntent(text) {
  const normalized = normalizeText(text);
  const asksAgenda =
    /\b(que|qué)\s+(citas?\s+)?(tengo|hay)\s+para\b/.test(normalized) ||
    /\b(citas?|agenda|turnos|sesiones)\b.*\b(hoy|manana|pasado manana|esta semana|proxima semana|siguiente semana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalized) ||
    /\bmu[eé]strame\b.*\b(citas?|agenda)\b/.test(normalized) ||
    /\bdime\b.*\b(citas?|agenda)\b/.test(normalized);

  if (!asksAgenda) return null;
  if (/\bcuant[oa]s?\b/.test(normalized)) return null;

  if (/\b(proxima|siguiente)\s+semana\b/.test(normalized)) {
    return {
      intent: 'agenda_query',
      entities: {
        agenda_scope: 'next_week',
      },
    };
  }

  if (/\besta\s+semana\b/.test(normalized)) {
    return {
      intent: 'agenda_query',
      entities: {
        agenda_scope: 'this_week',
      },
    };
  }

  const dateKey = resolveRelativeDate(text);
  if (!dateKey) return null;

  return {
    intent: 'agenda_query',
    entities: {
      date_key: dateKey,
      agenda_scope: 'day',
    },
  };
}

function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toDateKey(dt);
}

function parseTimeValue(rawValue, period = null) {
  const value = normalizeText(rawValue);
  const match = value.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  let hour = Number(match[1]);
  let minute = match[2] ? Number(match[2]) : 0;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  if (!match[2] && /\by media\b/.test(value)) {
    minute = 30;
  }

  const hasPm = /\bpm\b|\bp\.m\b|\bde la tarde\b|\bde la noche\b/.test(value);
  const hasAm = /\bam\b|\ba\.m\b|\bde la manana\b/.test(value);
  if ((period === 'afternoon' || hasPm) && hour < 12) {
    hour += 12;
  } else if (hasAm && hour === 12) {
    hour = 0;
  }

  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractTimeRange(text, period = null) {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /(?:de\s+)?(?:las\s+)?(\d{1,2}(?::\d{2})?(?:\s+y\s+media)?)\s*(?:a|hasta)\s*(?:las\s+)?(\d{1,2}(?::\d{2})?(?:\s+y\s+media)?)/
  );
  if (!match) return null;
  const start = parseTimeValue(match[1], period);
  const end = parseTimeValue(match[2], period);
  if (!start || !end) return null;
  return { start, end };
}

function extractAvailabilityRange(text, segmentName) {
  const normalized = normalizeText(text);
  const directAfterSegment = normalized.match(
    new RegExp(`${segmentName}[^\\d]{0,24}(?:de\\s+)?(?:las\\s+)?(\\d{1,2}(?::\\d{2})?(?:\\s+y\\s+media)?)\\s*(?:a|hasta)\\s*(?:las\\s+)?(\\d{1,2}(?::\\d{2})?(?:\\s+y\\s+media)?)`)
  );
  if (directAfterSegment) {
    return {
      start: parseTimeValue(directAfterSegment[1], segmentName === 'tarde' ? 'afternoon' : 'morning'),
      end: parseTimeValue(directAfterSegment[2], segmentName === 'tarde' ? 'afternoon' : 'morning'),
    };
  }

  const directBeforeSegment = normalized.match(
    new RegExp(`(?:de\\s+)?(?:las\\s+)?(\\d{1,2}(?::\\d{2})?(?:\\s+y\\s+media)?)\\s*(?:a|hasta)\\s*(?:las\\s+)?(\\d{1,2}(?::\\d{2})?(?:\\s+y\\s+media)?)\\s*(?:en\\s+la\\s+)?${segmentName}`)
  );
  if (directBeforeSegment) {
    return {
      start: parseTimeValue(directBeforeSegment[1], segmentName === 'tarde' ? 'afternoon' : 'morning'),
      end: parseTimeValue(directBeforeSegment[2], segmentName === 'tarde' ? 'afternoon' : 'morning'),
    };
  }

  return null;
}

function splitContinuousRange(start, end) {
  const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endMinutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes) || endMinutes < startMinutes) {
    return null;
  }

  const result = {
    morning_mode: 'off',
    morning_start: null,
    morning_end: null,
    afternoon_mode: 'off',
    afternoon_start: null,
    afternoon_end: null,
  };

  if (startMinutes < 13 * 60) {
    const morningEndMinutes = Math.min(endMinutes, 12 * 60);
    if (morningEndMinutes >= startMinutes) {
      result.morning_mode = 'range';
      result.morning_start = start;
      result.morning_end = `${String(Math.floor(morningEndMinutes / 60)).padStart(2, '0')}:${String(morningEndMinutes % 60).padStart(2, '0')}`;
    }
  }

  if (endMinutes >= 16 * 60) {
    const afternoonStartMinutes = Math.max(startMinutes, 16 * 60);
    if (endMinutes >= afternoonStartMinutes) {
      result.afternoon_mode = 'range';
      result.afternoon_start = `${String(Math.floor(afternoonStartMinutes / 60)).padStart(2, '0')}:${String(afternoonStartMinutes % 60).padStart(2, '0')}`;
      result.afternoon_end = end;
    }
  }

  return result;
}

function detectAvailabilityIntent(text) {
  const normalized = normalizeText(text);
  const weekdayName = findWeekdayName(normalized);
  if (!weekdayName) return null;

  const soundsLikeAvailability =
    /\b(disponibilidad|disponible|horario|trabaj|atiendo|solo|todo igual|en la manana|en la tarde|nada)\b/.test(normalized);
  if (!soundsLikeAvailability) return null;

  const entities = {
    weekday_name: weekdayName,
    morning_mode: null,
    morning_start: null,
    morning_end: null,
    afternoon_mode: null,
    afternoon_start: null,
    afternoon_end: null,
  };

  const mentionsMorning = /\bmanana\b/.test(normalized);
  const mentionsAfternoon = /\btarde\b/.test(normalized);
  const hasSolo = /\bsolo\b/.test(normalized);

  if (/manana[^.]*todo igual|todo igual[^.]*manana/.test(normalized)) {
    entities.morning_mode = 'keep';
  } else if (/manana[^.]*nada|nada[^.]*manana/.test(normalized)) {
    entities.morning_mode = 'off';
  }

  if (/tarde[^.]*todo igual|todo igual[^.]*tarde/.test(normalized)) {
    entities.afternoon_mode = 'keep';
  } else if (/tarde[^.]*nada|nada[^.]*tarde/.test(normalized)) {
    entities.afternoon_mode = 'off';
  }

  const morningRange = extractAvailabilityRange(normalized, 'manana');
  if (morningRange?.start && morningRange?.end) {
    entities.morning_mode = 'range';
    entities.morning_start = morningRange.start;
    entities.morning_end = morningRange.end;
  }

  const afternoonRange = extractAvailabilityRange(normalized, 'tarde');
  if (afternoonRange?.start && afternoonRange?.end) {
    entities.afternoon_mode = 'range';
    entities.afternoon_start = afternoonRange.start;
    entities.afternoon_end = afternoonRange.end;
  }

  if ((mentionsMorning || mentionsAfternoon) && hasSolo) {
    if (mentionsMorning && entities.afternoon_mode == null) entities.afternoon_mode = 'off';
    if (mentionsAfternoon && entities.morning_mode == null) entities.morning_mode = 'off';
  }

  if (
    !morningRange &&
    !afternoonRange &&
    !mentionsMorning &&
    !mentionsAfternoon
  ) {
    const globalRange = extractTimeRange(normalized);
    if (globalRange?.start && globalRange?.end) {
      const split = splitContinuousRange(globalRange.start, globalRange.end);
      if (split) {
        entities.morning_mode = split.morning_mode;
        entities.morning_start = split.morning_start;
        entities.morning_end = split.morning_end;
        entities.afternoon_mode = split.afternoon_mode;
        entities.afternoon_start = split.afternoon_start;
        entities.afternoon_end = split.afternoon_end;
      }
    }
  }

  const hasDirective =
    entities.morning_mode != null ||
    entities.afternoon_mode != null ||
    entities.morning_start != null ||
    entities.afternoon_start != null;

  if (!hasDirective) return null;
  return { intent: 'update_availability', entities };
}

function detectDirectIntent(text) {
  const normalized = normalizeText(text);
  const monthYear = detectMonthYear(text);
  const availabilityIntent = detectAvailabilityIntent(text);
  const createAppointmentIntent = detectCreateAppointmentIntent(text);
  const agendaIntent = detectAgendaIntent(text);

  if (availabilityIntent) return availabilityIntent;
  if (createAppointmentIntent) return createAppointmentIntent;
  if (/\bdesactivar recordatorios\b|\bapagar recordatorios\b/.test(normalized)) {
    return { intent: 'reminder_toggle', entities: { reminder_enabled: false } };
  }
  if (/\bactivar recordatorios\b|\bencender recordatorios\b/.test(normalized)) {
    return { intent: 'reminder_toggle', entities: { reminder_enabled: true } };
  }
  if (/\b(manda?r|envia?r)\b.*\brecordatorios?\b.*\bhoy\b|\brecordatorios?\b.*\bpara hoy\b/.test(normalized)) {
    return { intent: 'send_reminders', entities: { reminder_date: 'today' } };
  }
  if (/\b(manda?r|envia?r)\b.*\brecordatorios?\b.*\bmanana\b|\brecordatorios?\b.*\bpara manana\b/.test(normalized)) {
    return { intent: 'send_reminders', entities: { reminder_date: 'tomorrow' } };
  }
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
  if (agendaIntent) return agendaIntent;
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

async function parseVoiceCommand(inputText, options = {}) {
  const tenantId = options.tenantId || null;
  const recentContext = Array.isArray(options.recentContext) ? options.recentContext : [];
  const text = String(inputText || '').trim();
  if (!text) {
    return {
      intent: 'unknown',
      confidence: 0,
      reply_hint: 'No llegó texto ni transcripción.',
      entities: {},
    };
  }

  const explicitFollowUp = resolveExplicitFollowUp({ text, recentTurns: recentContext });
  if (explicitFollowUp) {
    return {
      intent: explicitFollowUp.intent,
      confidence: Number(explicitFollowUp.confidence || 0),
      reply_hint: explicitFollowUp.reply_hint || '',
      entities: sanitizeEntities(explicitFollowUp.entities),
      raw: explicitFollowUp.raw || explicitFollowUp,
    };
  }

  const direct = detectDirectIntent(text);
  if (direct) {
    return {
      intent: direct.intent,
      confidence: 0.99,
      reply_hint: '',
      entities: sanitizeEntities(direct.entities),
      raw: direct,
    };
  }

  const recentSummary = buildRecentVoiceSummary(recentContext);
  if (tenantId) {
    try {
      const planned = await planVoiceCommand({ tenantId, text, recentSummary });
      return {
        intent: planned.intent,
        confidence: Number(planned.confidence || 0),
        reply_hint: planned.reply_hint || '',
        entities: sanitizeEntities(planned.entities),
        raw: planned.raw || planned,
      };
    } catch (_) {
      // Fall through to the simpler parser prompt below.
    }
  }

  const today = getTodayContext();
  const content = await completeJson([
    {
      role: 'system',
      content:
        `Eres un parser de comandos administrativos para una agenda terapéutica. ` +
        `Debes devolver solo JSON válido, sin markdown ni explicación. ` +
        `Fecha actual en Bolivia: ${today}. ` +
        `Contexto reciente: ${recentSummary}. ` +
        `Intents permitidos: agenda_query, pending_payments, pending_amount, sessions_to_goal, client_lookup, client_upcoming_appointments, reminder_check, confirmation_check, rescheduled_list, new_clients_count, unconfirmed_tomorrow, confirmed_today, appointments_this_week, create_appointment, reminder_toggle, send_reminders, update_availability, unknown. ` +
        `Entities posibles: client_id (number o null), client_name (string o null), date_key (YYYY-MM-DD o null), agenda_scope (day|this_week|next_week|null), time_hhmm (HH:MM o null), goal_amount (number o null), month (1-12 o null), year (YYYY o null), reminder_enabled (boolean o null), reminder_date (today|tomorrow|null), weekday_name (lunes|martes|miercoles|jueves|viernes|sabado|domingo|null), morning_mode (keep|off|range|null), morning_start (HH:MM|null), morning_end (HH:MM|null), afternoon_mode (keep|off|range|null), afternoon_start (HH:MM|null), afternoon_end (HH:MM|null). ` +
        `Convierte fechas relativas como hoy, mañana, pasado mañana, este viernes, el viernes a YYYY-MM-DD. ` +
        `Si el usuario pregunta por esta semana o la próxima semana, usa agenda_scope=this_week o next_week. ` +
        `Convierte horas como 8, 8 de la mañana, 8 am, 8 y media, 14:30 a HH:MM en formato 24 horas. ` +
        `Si el usuario pregunta por marzo o abril, extrae month y year cuando sea posible. ` +
        `Para disponibilidad, interpreta frases como "jueves solo de 8 a 12 en la mañana, en la tarde nada" usando weekday_name y morning/afternoon modes. ` +
        `Si el usuario dice "en la tarde todo igual", usa afternoon_mode=keep. ` +
        `Si el contexto reciente muestra una aclaración pendiente, puedes continuarla y completar entidades faltantes. ` +
        `Si el usuario pide una acción no permitida o destructiva, usa unknown. ` +
        `Responde con este shape exacto: ` +
        `{"intent":"...","confidence":0.0,"entities":{"client_id":null,"client_name":null,"date_key":null,"agenda_scope":null,"time_hhmm":null,"goal_amount":null,"month":null,"year":null,"reminder_enabled":null,"reminder_date":null,"weekday_name":null,"morning_mode":null,"morning_start":null,"morning_end":null,"afternoon_mode":null,"afternoon_start":null,"afternoon_end":null},"reply_hint":"..."}`,
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
    entities: sanitizeEntities(entities),
    raw: parsed,
  };
}

module.exports = {
  getTodayContext,
  parseVoiceCommand,
};
