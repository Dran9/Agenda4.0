const { pool } = require('../../db');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseJsonField(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function describeClientCandidate(client) {
  const suffix = client.phone ? String(client.phone).slice(-4) : '';
  const details = [
    client.city || null,
    suffix ? `...${suffix}` : null,
    client.fee != null ? `Bs ${client.fee}` : null,
  ].filter(Boolean);
  return `${client.first_name} ${client.last_name}${details.length ? ` (${details.join(', ')})` : ''}`;
}

function pickCandidateByOrdinal(text, candidates) {
  if (!candidates.length) return null;
  const normalized = normalizeText(text);
  if (/\b(primero|primera|1|uno|una)\b/.test(normalized)) return candidates[0] || null;
  if (/\b(segundo|segunda|2|dos|otro|otra)\b/.test(normalized)) return candidates[1] || null;
  if (/\b(tercero|tercera|3|tres)\b/.test(normalized)) return candidates[2] || null;
  if (/\b(cuarto|cuarta|4|cuatro)\b/.test(normalized)) return candidates[3] || null;
  return null;
}

function pickCandidateByDescriptor(text, candidates) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  let best = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const scoreParts = [
      candidate.first_name,
      candidate.last_name,
      candidate.city,
      candidate.phone ? String(candidate.phone).slice(-4) : null,
    ].filter(Boolean);

    let score = 0;
    for (const part of scoreParts) {
      const normalizedPart = normalizeText(part);
      if (normalized.includes(normalizedPart)) {
        score += normalizedPart.length >= 4 ? 4 : 2;
      }
    }

    const fullName = normalizeText(`${candidate.first_name} ${candidate.last_name}`);
    if (fullName && normalized.includes(fullName)) {
      score += 6;
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function resolveExplicitClientSelection(text, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const normalized = normalizeText(text);

  if (candidates.length === 1 && /\b(si|sí|ese|esa|dale|correcto|exacto|ese mismo|esa misma)\b/.test(normalized)) {
    return candidates[0];
  }

  return pickCandidateByOrdinal(normalized, candidates) || pickCandidateByDescriptor(normalized, candidates);
}

function buildTurnSummary(turn) {
  const pieces = [];
  const input = turn.transcript || turn.raw_text || '';
  if (input) pieces.push(`usuario="${input.replace(/\s+/g, ' ').slice(0, 140)}"`);
  if (turn.parsed_intent) pieces.push(`intent=${turn.parsed_intent}`);
  if (turn.status) pieces.push(`status=${turn.status}`);
  if (turn.response_text) pieces.push(`respuesta="${String(turn.response_text).replace(/\s+/g, ' ').slice(0, 180)}"`);

  const pendingAction = turn.result_data?.pending_action;
  if (pendingAction?.intent) {
    pieces.push(`pending_intent=${pendingAction.intent}`);
    if (pendingAction.entities && Object.keys(pendingAction.entities).length > 0) {
      pieces.push(`pending_entities=${JSON.stringify(pendingAction.entities)}`);
    }
  }

  const matches = Array.isArray(turn.result_data?.matches) ? turn.result_data.matches : [];
  if (matches.length > 0) {
    pieces.push(
      `opciones=${matches
        .slice(0, 4)
        .map((candidate, index) => `${index + 1}:${describeClientCandidate(candidate)} [id=${candidate.id}]`)
        .join(' | ')}`
    );
  }

  return pieces.join(' ; ');
}

async function getRecentVoiceContext({ tenantId, source, limit = 6 }) {
  if (!tenantId) return [];

  const params = [tenantId];
  let sourceClause = '';
  if (source) {
    sourceClause = 'AND source = ?';
    params.push(source);
  }
  params.push(limit);

  const [rows] = await pool.query(
    `SELECT id, source, input_type, raw_text, transcript, parsed_intent, parsed_entities, response_text, status, error_message, result_data, created_at
     FROM voice_commands_log
     WHERE tenant_id = ? ${sourceClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    params
  );

  return rows.map((row) => ({
    ...row,
    parsed_entities: parseJsonField(row.parsed_entities, {}),
    result_data: parseJsonField(row.result_data, {}),
  }));
}

function buildRecentVoiceSummary(turns) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return 'Sin contexto reciente.';
  }

  return turns
    .slice(0, 4)
    .reverse()
    .map((turn, index) => `Turno ${index + 1}: ${buildTurnSummary(turn)}`)
    .join('\n');
}

function resolveExplicitFollowUp({ text, recentTurns }) {
  if (!text || !Array.isArray(recentTurns) || recentTurns.length === 0) return null;

  const latestClarification = recentTurns.find((turn) => turn.status === 'clarification' && turn.result_data?.pending_action);
  if (!latestClarification) return null;

  const pendingAction = latestClarification.result_data.pending_action;
  const candidates = Array.isArray(latestClarification.result_data.matches)
    ? latestClarification.result_data.matches
    : [];
  const selectedClient = resolveExplicitClientSelection(text, candidates);

  if (!selectedClient) return null;

  return {
    intent: pendingAction.intent || latestClarification.parsed_intent || 'unknown',
    confidence: 0.99,
    reply_hint: 'Seguimiento resuelto usando el contexto reciente.',
    entities: {
      ...(pendingAction.entities || {}),
      client_id: selectedClient.id,
      client_name: `${selectedClient.first_name} ${selectedClient.last_name}`.trim(),
    },
    raw: {
      source: 'recent_context_follow_up',
      clarification_turn_id: latestClarification.id,
      selected_client_id: selectedClient.id,
    },
  };
}

module.exports = {
  buildRecentVoiceSummary,
  getRecentVoiceContext,
  normalizeText,
  parseJsonField,
  resolveExplicitFollowUp,
};
