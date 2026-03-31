const DEFAULT_RETENTION_RULES = {
  Semanal: { risk_days: 10, lost_days: 21 },
  Quincenal: { risk_days: 21, lost_days: 35 },
  Mensual: { risk_days: 45, lost_days: 75 },
  Irregular: { risk_days: 30, lost_days: 60 },
};

function normalizeRetentionRules(rawRules) {
  let parsed = rawRules;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }

  const normalized = {};
  for (const [frequency, defaults] of Object.entries(DEFAULT_RETENTION_RULES)) {
    const source = parsed?.[frequency] || {};
    const riskDays = Math.max(1, parseInt(source.risk_days, 10) || defaults.risk_days);
    const lostDays = Math.max(riskDays + 1, parseInt(source.lost_days, 10) || defaults.lost_days);
    normalized[frequency] = {
      risk_days: riskDays,
      lost_days: lostDays,
    };
  }
  return normalized;
}

function daysSince(dateTime) {
  if (!dateTime) return null;
  const date = new Date(dateTime);
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateRetentionStatus({ frequency, completedSessions, lastSession, nextAppointment, rules }) {
  const normalizedRules = normalizeRetentionRules(rules);
  const thresholds = normalizedRules[frequency] || normalizedRules.Semanal;
  const daysSinceLastSession = daysSince(lastSession);

  if (!completedSessions) {
    return {
      status: 'Nuevo',
      days_since_last_session: null,
      thresholds,
    };
  }

  if (nextAppointment && new Date(nextAppointment) > new Date()) {
    return {
      status: 'Con cita',
      days_since_last_session: daysSinceLastSession,
      thresholds,
    };
  }

  if (daysSinceLastSession === null) {
    return {
      status: 'Nuevo',
      days_since_last_session: null,
      thresholds,
    };
  }

  if (daysSinceLastSession >= thresholds.lost_days) {
    return {
      status: 'Perdido',
      days_since_last_session: daysSinceLastSession,
      thresholds,
    };
  }

  if (daysSinceLastSession >= thresholds.risk_days) {
    return {
      status: 'En riesgo',
      days_since_last_session: daysSinceLastSession,
      thresholds,
    };
  }

  return {
    status: 'Al día',
    days_since_last_session: daysSinceLastSession,
    thresholds,
  };
}

module.exports = {
  DEFAULT_RETENTION_RULES,
  normalizeRetentionRules,
  calculateRetentionStatus,
  daysSince,
};
