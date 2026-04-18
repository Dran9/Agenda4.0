const crypto = require('crypto');
const { pool } = require('../db');
const { broadcast } = require('./adminEvents');

const SUPPORTED_WEBHOOK_FIELDS = [
  'account_update',
  'account_alerts',
  'business_capability_update',
  'business_status_update',
  'phone_number_quality_update',
  'message_template_status_update',
  'message_template_quality_update',
  'messages',
  'smb_message_echoes',
  'security',
  'flows',
];

const SEVERITY_WEIGHT = {
  info: 1,
  warning: 2,
  critical: 3,
};

const STATUS_COLORS = {
  info: 'green',
  warning: 'yellow',
  critical: 'red',
};

const DEFAULT_ALERT_CHANNELS = {
  telegram: {
    enabled: false,
    bot_token: '',
    chat_id: '',
  },
};

const DEFAULT_META_HEALTH_CONFIG = {
  monitoring_enabled: true,
  watchdog_interval_minutes: 60,
  silence_warning_minutes: 180,
  silence_critical_minutes: 480,
  stale_after_minutes: 360,
  alert_cooldown_minutes: 30,
  alert_info_enabled: false,
  alert_warning_enabled: true,
  alert_critical_enabled: true,
  coexistence_enabled: true,
  smb_message_echoes_enabled: false,
  flows_enabled: false,
  monitored_phone_number_id: process.env.WA_PHONE_ID || '',
  monitored_waba_id: process.env.WABA_ID || '',
  alert_channels: DEFAULT_ALERT_CHANNELS,
};

const CRITICAL_TERMS = [
  'restricted',
  'restriction',
  'disconnect',
  'disconnected',
  'offboard',
  'offboarding',
  'partner_removed',
  'partner removed',
  'suspend',
  'suspended',
  'disabled',
  'banned',
  'compromise',
  'incident',
  'security_breach',
  'fatal',
];

const WARNING_TERMS = [
  'degrad',
  'paused',
  'pause',
  'rejected',
  'warn',
  'warning',
  'limited',
  'medium',
  'low',
  'unknown',
  'stale',
  'pending',
];

const RECOVERY_TERMS = [
  'connected',
  'active',
  'approved',
  'restored',
  'healthy',
  'good',
  'high',
  'ok',
  'resolved',
  'normal',
];

function parseJsonSafe(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function toInt(value, fallback, min = null, max = null) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  let out = parsed;
  if (min !== null && out < min) out = min;
  if (max !== null && out > max) out = max;
  return out;
}

function trimString(value, maxLen = 255) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  if (!out) return null;
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function compactText(value, maxLen = 420) {
  if (value === null || value === undefined) return null;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str) return null;
  const normalized = str.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}…` : normalized;
}

function lowerContains(haystack, terms) {
  const source = String(haystack || '').toLowerCase();
  return terms.some((term) => source.includes(term));
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    if (value > 1e12) {
      const msDate = new Date(value);
      return Number.isNaN(msDate.getTime()) ? null : msDate;
    }
    const secDate = new Date(value * 1000);
    return Number.isNaN(secDate.getTime()) ? null : secDate;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{10,13}$/.test(trimmed)) {
      return parseTimestamp(Number(trimmed));
    }

    const fromString = new Date(trimmed);
    if (!Number.isNaN(fromString.getTime())) return fromString;
  }

  return null;
}

function normalizeStatus(status) {
  if (!status) return null;
  return String(status).trim().toLowerCase().replace(/\s+/g, '_');
}

function slugify(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return normalized || 'unknown';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pickFirst(source, paths) {
  if (!source || typeof source !== 'object') return null;
  for (const path of paths) {
    const segments = path.split('.');
    let current = source;
    let ok = true;
    for (const segment of segments) {
      if (current && Object.prototype.hasOwnProperty.call(current, segment)) {
        current = current[segment];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && current !== undefined && current !== null && current !== '') return current;
  }
  return null;
}

function normalizeAlertChannels(rawChannels) {
  const parsed = parseJsonSafe(rawChannels, {});

  return {
    telegram: {
      enabled: toBool(parsed?.telegram?.enabled, DEFAULT_ALERT_CHANNELS.telegram.enabled),
      bot_token: trimString(parsed?.telegram?.bot_token || '', 500) || '',
      chat_id: trimString(parsed?.telegram?.chat_id || '', 255) || '',
    },
  };
}

async function ensureMetaHealthConfig(tenantId) {
  await pool.query(
    `INSERT INTO meta_health_config (
      tenant_id,
      monitoring_enabled,
      watchdog_interval_minutes,
      silence_warning_minutes,
      silence_critical_minutes,
      stale_after_minutes,
      alert_cooldown_minutes,
      alert_info_enabled,
      alert_warning_enabled,
      alert_critical_enabled,
      coexistence_enabled,
      smb_message_echoes_enabled,
      flows_enabled,
      monitored_phone_number_id,
      monitored_waba_id,
      alert_channels
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [
      tenantId,
      DEFAULT_META_HEALTH_CONFIG.monitoring_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.watchdog_interval_minutes,
      DEFAULT_META_HEALTH_CONFIG.silence_warning_minutes,
      DEFAULT_META_HEALTH_CONFIG.silence_critical_minutes,
      DEFAULT_META_HEALTH_CONFIG.stale_after_minutes,
      DEFAULT_META_HEALTH_CONFIG.alert_cooldown_minutes,
      DEFAULT_META_HEALTH_CONFIG.alert_info_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.alert_warning_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.alert_critical_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.coexistence_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.smb_message_echoes_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.flows_enabled ? 1 : 0,
      DEFAULT_META_HEALTH_CONFIG.monitored_phone_number_id || null,
      DEFAULT_META_HEALTH_CONFIG.monitored_waba_id || null,
      JSON.stringify(DEFAULT_META_HEALTH_CONFIG.alert_channels),
    ]
  );
}

function normalizeConfigRow(row) {
  if (!row) {
    return {
      ...DEFAULT_META_HEALTH_CONFIG,
      alert_channels: DEFAULT_ALERT_CHANNELS,
    };
  }

  return {
    monitoring_enabled: toBool(row.monitoring_enabled, DEFAULT_META_HEALTH_CONFIG.monitoring_enabled),
    watchdog_interval_minutes: toInt(
      row.watchdog_interval_minutes,
      DEFAULT_META_HEALTH_CONFIG.watchdog_interval_minutes,
      60,
      1440
    ),
    silence_warning_minutes: toInt(
      row.silence_warning_minutes,
      DEFAULT_META_HEALTH_CONFIG.silence_warning_minutes,
      15,
      10080
    ),
    silence_critical_minutes: toInt(
      row.silence_critical_minutes,
      DEFAULT_META_HEALTH_CONFIG.silence_critical_minutes,
      30,
      20160
    ),
    stale_after_minutes: toInt(
      row.stale_after_minutes,
      DEFAULT_META_HEALTH_CONFIG.stale_after_minutes,
      30,
      20160
    ),
    alert_cooldown_minutes: toInt(
      row.alert_cooldown_minutes,
      DEFAULT_META_HEALTH_CONFIG.alert_cooldown_minutes,
      1,
      1440
    ),
    alert_info_enabled: toBool(row.alert_info_enabled, DEFAULT_META_HEALTH_CONFIG.alert_info_enabled),
    alert_warning_enabled: toBool(row.alert_warning_enabled, DEFAULT_META_HEALTH_CONFIG.alert_warning_enabled),
    alert_critical_enabled: toBool(row.alert_critical_enabled, DEFAULT_META_HEALTH_CONFIG.alert_critical_enabled),
    coexistence_enabled: toBool(row.coexistence_enabled, DEFAULT_META_HEALTH_CONFIG.coexistence_enabled),
    smb_message_echoes_enabled: toBool(
      row.smb_message_echoes_enabled,
      DEFAULT_META_HEALTH_CONFIG.smb_message_echoes_enabled
    ),
    flows_enabled: toBool(row.flows_enabled, DEFAULT_META_HEALTH_CONFIG.flows_enabled),
    monitored_phone_number_id: trimString(
      row.monitored_phone_number_id,
      120
    ) || DEFAULT_META_HEALTH_CONFIG.monitored_phone_number_id,
    monitored_waba_id: trimString(row.monitored_waba_id, 120) || DEFAULT_META_HEALTH_CONFIG.monitored_waba_id,
    alert_channels: normalizeAlertChannels(row.alert_channels),
  };
}

async function getMetaHealthConfig(tenantId) {
  await ensureMetaHealthConfig(tenantId);
  const [rows] = await pool.query('SELECT * FROM meta_health_config WHERE tenant_id = ? LIMIT 1', [tenantId]);
  return normalizeConfigRow(rows[0]);
}

function sanitizeConfigPayload(payload = {}, existingConfig = DEFAULT_META_HEALTH_CONFIG) {
  const existingChannels = existingConfig.alert_channels || DEFAULT_ALERT_CHANNELS;
  const inputChannels = payload.alert_channels || {};

  const mergedChannels = {
    telegram: {
      ...existingChannels.telegram,
      ...(inputChannels.telegram || {}),
    },
  };

  return {
    monitoring_enabled: toBool(payload.monitoring_enabled, existingConfig.monitoring_enabled),
    watchdog_interval_minutes: toInt(
      payload.watchdog_interval_minutes,
      existingConfig.watchdog_interval_minutes,
      60,
      1440
    ),
    silence_warning_minutes: toInt(
      payload.silence_warning_minutes,
      existingConfig.silence_warning_minutes,
      15,
      10080
    ),
    silence_critical_minutes: toInt(
      payload.silence_critical_minutes,
      existingConfig.silence_critical_minutes,
      30,
      20160
    ),
    stale_after_minutes: toInt(payload.stale_after_minutes, existingConfig.stale_after_minutes, 30, 20160),
    alert_cooldown_minutes: toInt(
      payload.alert_cooldown_minutes,
      existingConfig.alert_cooldown_minutes,
      1,
      1440
    ),
    alert_info_enabled: toBool(payload.alert_info_enabled, existingConfig.alert_info_enabled),
    alert_warning_enabled: toBool(payload.alert_warning_enabled, existingConfig.alert_warning_enabled),
    alert_critical_enabled: toBool(payload.alert_critical_enabled, existingConfig.alert_critical_enabled),
    coexistence_enabled: toBool(payload.coexistence_enabled, existingConfig.coexistence_enabled),
    smb_message_echoes_enabled: toBool(
      payload.smb_message_echoes_enabled,
      existingConfig.smb_message_echoes_enabled
    ),
    flows_enabled: toBool(payload.flows_enabled, existingConfig.flows_enabled),
    monitored_phone_number_id: trimString(payload.monitored_phone_number_id, 120) || '',
    monitored_waba_id: trimString(payload.monitored_waba_id, 120) || '',
    alert_channels: normalizeAlertChannels(mergedChannels),
  };
}

async function updateMetaHealthConfig(tenantId, payload = {}) {
  const existing = await getMetaHealthConfig(tenantId);
  const nextConfig = sanitizeConfigPayload(payload, existing);

  await pool.query(
    `UPDATE meta_health_config
      SET monitoring_enabled = ?,
          watchdog_interval_minutes = ?,
          silence_warning_minutes = ?,
          silence_critical_minutes = ?,
          stale_after_minutes = ?,
          alert_cooldown_minutes = ?,
          alert_info_enabled = ?,
          alert_warning_enabled = ?,
          alert_critical_enabled = ?,
          coexistence_enabled = ?,
          smb_message_echoes_enabled = ?,
          flows_enabled = ?,
          monitored_phone_number_id = ?,
          monitored_waba_id = ?,
          alert_channels = ?
      WHERE tenant_id = ?`,
    [
      nextConfig.monitoring_enabled ? 1 : 0,
      nextConfig.watchdog_interval_minutes,
      nextConfig.silence_warning_minutes,
      nextConfig.silence_critical_minutes,
      nextConfig.stale_after_minutes,
      nextConfig.alert_cooldown_minutes,
      nextConfig.alert_info_enabled ? 1 : 0,
      nextConfig.alert_warning_enabled ? 1 : 0,
      nextConfig.alert_critical_enabled ? 1 : 0,
      nextConfig.coexistence_enabled ? 1 : 0,
      nextConfig.smb_message_echoes_enabled ? 1 : 0,
      nextConfig.flows_enabled ? 1 : 0,
      nextConfig.monitored_phone_number_id || null,
      nextConfig.monitored_waba_id || null,
      JSON.stringify(nextConfig.alert_channels),
      tenantId,
    ]
  );

  return nextConfig;
}

function parseSeverityFromText(text, fallback = 'info') {
  if (!text) return fallback;
  const stringified = String(text).toLowerCase();
  if (lowerContains(stringified, CRITICAL_TERMS)) return 'critical';
  if (lowerContains(stringified, WARNING_TERMS)) return 'warning';
  if (lowerContains(stringified, RECOVERY_TERMS)) return 'info';
  return fallback;
}

function maxSeverity(...levels) {
  let winner = 'info';
  for (const level of levels) {
    if (!level) continue;
    if ((SEVERITY_WEIGHT[level] || 0) > (SEVERITY_WEIGHT[winner] || 0)) {
      winner = level;
    }
  }
  return winner;
}

function normalizeSeverityForField({ field, status, quality, reason, fallback = 'info' }) {
  const normalizedStatus = normalizeStatus(status);
  const normalizedQuality = normalizeStatus(quality);
  const composed = [field, normalizedStatus, normalizedQuality, reason].filter(Boolean).join(' ');

  if (field === 'security') {
    if (normalizedStatus && ['resolved', 'cleared', 'ok', 'normal'].includes(normalizedStatus)) return 'info';
    return 'critical';
  }

  if (field === 'account_alerts') {
    if (normalizedStatus && ['critical', 'high', 'severe'].includes(normalizedStatus)) return 'critical';
    if (normalizedStatus && ['warning', 'medium', 'moderate'].includes(normalizedStatus)) return 'warning';
  }

  if (field === 'phone_number_quality_update' || field === 'message_template_quality_update') {
    if (normalizedQuality && ['high', 'green', 'good'].includes(normalizedQuality)) return 'info';
    if (normalizedQuality && ['medium', 'yellow', 'unknown'].includes(normalizedQuality)) return 'warning';
    if (normalizedQuality && ['low', 'red', 'poor'].includes(normalizedQuality)) return 'warning';
  }

  if (field === 'message_template_status_update') {
    if (normalizedStatus && ['approved', 'active', 'enabled', 'restored'].includes(normalizedStatus)) return 'info';
    if (normalizedStatus && ['paused', 'rejected', 'disabled', 'pending', 'in_review'].includes(normalizedStatus)) return 'warning';
  }

  if (field === 'messages' || field === 'smb_message_echoes') {
    if (normalizedStatus === 'failed') return 'warning';
    if (normalizedStatus === 'undelivered') return 'warning';
    return 'info';
  }

  if (field === 'flows') {
    if (normalizedStatus && ['error', 'failed'].includes(normalizedStatus)) return 'warning';
    return parseSeverityFromText(composed, fallback);
  }

  if (field === 'business_status_update' || field === 'account_update') {
    if (normalizedStatus && ['restricted', 'disconnected', 'offboarded', 'offboarding', 'partner_removed', 'disabled', 'suspended'].includes(normalizedStatus)) {
      return 'critical';
    }
    if (normalizedStatus && ['degraded', 'warning', 'limited'].includes(normalizedStatus)) {
      return 'warning';
    }
  }

  return parseSeverityFromText(composed, fallback);
}

function buildRecommendedAction({ field, severity, status, quality, reason, coexistenceEnabled }) {
  if (severity === 'critical') {
    if (field === 'security') return 'Revisar seguridad de Meta Business, rotar tokens y validar permisos de app/webhook.';
    if (field === 'account_alerts' || field === 'account_update' || field === 'business_status_update') {
      return 'Abrir Meta Business Manager y verificar restricciones, offboarding o partner removed inmediatamente.';
    }
    if (field === 'watchdog') return 'Verificar endpoint webhook, logs del servidor y salud de DB/cola antes de continuar operación.';
    return 'Escalar de inmediato: validar estado de cuenta/número en Meta y revisar logs del webhook.';
  }

  if (severity === 'warning') {
    if (field === 'phone_number_quality_update') {
      return 'Revisar calidad del número y ajustar estrategia de envío para evitar restricciones.';
    }
    if (field === 'message_template_status_update' || field === 'message_template_quality_update') {
      return 'Revisar templates degradados, pausados o rechazados en Meta y ajustar contenido/frecuencia.';
    }
    if (field === 'watchdog') {
      return 'Validar silencios anómalos del webhook y confirmar que el pipeline interno siga procesando eventos.';
    }
    if (field === 'business_capability_update') {
      return 'Verificar cambios de capability en Meta y confirmar impacto sobre envíos y automatizaciones.';
    }
    if (field === 'messages' && coexistenceEnabled) {
      return 'En coexistence, confirmar smb_message_echoes y revisar si los mensajes manuales se reflejan según lo esperado.';
    }
    return 'Revisar este cambio en Meta Health para evitar que evolucione a incidente crítico.';
  }

  if (field === 'smb_message_echoes' && coexistenceEnabled) {
    return 'Evento operativo de coexistence detectado. Solo accionar si observas desalineación con mensajes manuales.';
  }

  return 'Monitoreo operativo sin acción inmediata.';
}

function baseContextFromChange({ field, value, entry, receivedAt }) {
  const metadata = value?.metadata || {};
  const wabaId =
    trimString(metadata?.business_account_id, 120) ||
    trimString(value?.waba_id, 120) ||
    trimString(entry?.id, 120) ||
    trimString(process.env.WABA_ID, 120) ||
    null;
  const phoneNumberId =
    trimString(metadata?.phone_number_id, 120) ||
    trimString(value?.phone_number_id, 120) ||
    trimString(value?.phone_number?.id, 120) ||
    trimString(process.env.WA_PHONE_ID, 120) ||
    null;

  return {
    field,
    wabaId,
    phoneNumberId,
    receivedAt,
    occurredAt: parseTimestamp(pickFirst(value, ['timestamp', 'event_time', 'occurred_at'])) || parseTimestamp(entry?.time) || receivedAt,
  };
}

function buildNormalizedEvent({
  source = 'meta_webhook',
  field,
  eventType,
  severity,
  occurredAt,
  receivedAt,
  wabaId,
  phoneNumberId,
  templateName,
  templateLanguage,
  status,
  quality,
  reason,
  summary,
  recommendedAction,
  rawRef,
}) {
  const normalizedOccurredAt = occurredAt || receivedAt || new Date();
  const normalizedReceivedAt = receivedAt || new Date();
  const normalizedStatus = normalizeStatus(status);
  const normalizedQuality = normalizeStatus(quality);

  const canonical = {
    source,
    field,
    event_type: eventType,
    severity,
    occurred_at: normalizedOccurredAt.toISOString(),
    received_at: normalizedReceivedAt.toISOString(),
    waba_id: wabaId || null,
    phone_number_id: phoneNumberId || null,
    template_name: templateName || null,
    template_language: templateLanguage || null,
    status: normalizedStatus || null,
    quality: normalizedQuality || null,
    reason: reason || null,
    summary: summary || null,
    recommended_action: recommendedAction || null,
    raw_ref: rawRef || null,
  };

  const dedupeCore = {
    field: canonical.field,
    event_type: canonical.event_type,
    occurred_at: canonical.occurred_at,
    status: canonical.status,
    quality: canonical.quality,
    reason: canonical.reason,
    waba_id: canonical.waba_id,
    phone_number_id: canonical.phone_number_id,
    template_name: canonical.template_name,
    template_language: canonical.template_language,
    raw_ref_key: rawRef?.id || rawRef?.message_id || rawRef?.event_id || null,
  };

  return {
    source: canonical.source,
    field: canonical.field,
    eventType: canonical.event_type,
    severity: canonical.severity,
    occurredAt: normalizedOccurredAt,
    receivedAt: normalizedReceivedAt,
    wabaId: canonical.waba_id,
    phoneNumberId: canonical.phone_number_id,
    templateName: canonical.template_name,
    templateLanguage: canonical.template_language,
    status: canonical.status,
    quality: canonical.quality,
    reason: canonical.reason,
    summary: canonical.summary,
    recommendedAction: canonical.recommended_action,
    normalizedPayload: canonical,
    rawRef,
    dedupeKey: crypto.createHash('sha1').update(JSON.stringify(dedupeCore)).digest('hex'),
  };
}

function normalizeAccountAlerts(field, value, base, config) {
  const alerts =
    asArray(value?.alerts).length > 0
      ? asArray(value?.alerts)
      : asArray(value?.account_alerts).length > 0
        ? asArray(value?.account_alerts)
        : asArray(value?.data?.alerts).length > 0
          ? asArray(value?.data?.alerts)
          : [value];

  return alerts.map((alert, idx) => {
    const status = pickFirst(alert, ['severity', 'level', 'status', 'alert_severity']);
    const reason = compactText(pickFirst(alert, ['message', 'description', 'reason', 'code']));
    const eventCode = pickFirst(alert, ['code', 'type', 'name']) || `alert_${idx + 1}`;
    const summary = compactText(
      pickFirst(alert, ['title', 'message', 'description']) ||
        `Alerta de cuenta Meta recibida (${eventCode})`
    );
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'warning',
    });

    return buildNormalizedEvent({
      field,
      eventType: `account_alert_${slugify(eventCode)}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(alert, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(alert, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: base.phoneNumberId,
      status,
      reason,
      summary,
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(alert, ['id', 'alert_id']) || null,
        payload: alert,
      },
    });
  });
}

function normalizeAccountUpdate(field, value, base, config) {
  const updates = asArray(value?.updates).length > 0 ? asArray(value?.updates) : [value];

  return updates.map((item, idx) => {
    const status = pickFirst(item, ['status', 'business_status', 'state', 'event']);
    const reason = compactText(pickFirst(item, ['reason', 'description', 'code', 'error']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'warning',
    });

    const summary = compactText(
      pickFirst(item, ['summary', 'message', 'description']) ||
        `Actualización de cuenta/WABA (${status || 'sin estado'})`
    );

    return buildNormalizedEvent({
      field,
      eventType: `account_update_${slugify(status || `event_${idx + 1}`)}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(item, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(item, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(item, ['phone_number_id']), 120) || base.phoneNumberId,
      status,
      reason,
      summary,
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(item, ['id', 'event_id']) || null,
        payload: item,
      },
    });
  });
}

function normalizeBusinessCapability(field, value, base, config) {
  const items =
    asArray(value?.capabilities).length > 0
      ? asArray(value?.capabilities)
      : asArray(value?.business_capability_update).length > 0
        ? asArray(value?.business_capability_update)
        : [value];

  return items.map((item, idx) => {
    const capability = pickFirst(item, ['name', 'capability', 'type']) || `capability_${idx + 1}`;
    const status = pickFirst(item, ['status', 'state', 'value']);
    const reason = compactText(pickFirst(item, ['reason', 'description', 'message']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'warning',
    });

    return buildNormalizedEvent({
      field,
      eventType: `business_capability_${slugify(capability)}_${slugify(status || 'changed')}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(item, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(item, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: base.phoneNumberId,
      status,
      reason,
      summary: compactText(
        pickFirst(item, ['summary', 'message', 'description']) ||
          `Cambio de capacidad ${capability} (${status || 'sin estado'})`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(item, ['id', 'event_id']) || null,
        payload: item,
      },
    });
  });
}

function normalizeBusinessStatus(field, value, base, config) {
  const updates = asArray(value?.updates).length > 0 ? asArray(value?.updates) : [value];

  return updates.map((item, idx) => {
    const status = pickFirst(item, ['business_status', 'status', 'state']);
    const reason = compactText(pickFirst(item, ['reason', 'description', 'message', 'error']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'warning',
    });

    return buildNormalizedEvent({
      field,
      eventType: `business_status_${slugify(status || `update_${idx + 1}`)}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(item, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(item, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(item, ['phone_number_id']), 120) || base.phoneNumberId,
      status,
      reason,
      summary: compactText(
        pickFirst(item, ['summary', 'message', 'description']) ||
          `Estado de negocio actualizado (${status || 'sin estado'})`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(item, ['id', 'event_id']) || null,
        payload: item,
      },
    });
  });
}

function normalizePhoneQuality(field, value, base, config) {
  const items =
    asArray(value?.phone_number_quality_update).length > 0
      ? asArray(value?.phone_number_quality_update)
      : asArray(value?.updates).length > 0
        ? asArray(value?.updates)
        : [value];

  return items.map((item, idx) => {
    const quality = pickFirst(item, ['quality_rating', 'quality', 'current_quality']);
    const status = pickFirst(item, ['status', 'state']);
    const reason = compactText(pickFirst(item, ['reason', 'description', 'message']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality,
      reason,
      fallback: 'warning',
    });

    const phoneNumberId =
      trimString(pickFirst(item, ['phone_number_id', 'id', 'phone_number.id']), 120) || base.phoneNumberId;

    return buildNormalizedEvent({
      field,
      eventType: `phone_quality_${slugify(quality || status || `update_${idx + 1}`)}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(item, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(item, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId,
      status,
      quality,
      reason,
      summary: compactText(
        pickFirst(item, ['summary', 'message', 'description']) ||
          `Actualización de calidad del número (${quality || status || 'sin detalle'})`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(item, ['id', 'event_id']) || null,
        payload: item,
      },
    });
  });
}

function normalizeTemplateStatus(field, value, base, config) {
  const templates =
    asArray(value?.message_template_status_update).length > 0
      ? asArray(value?.message_template_status_update)
      : asArray(value?.templates).length > 0
        ? asArray(value?.templates)
        : [value];

  return templates.map((template, idx) => {
    const status = pickFirst(template, ['status', 'state', 'event']);
    const templateName = trimString(pickFirst(template, ['name', 'template_name']), 120);
    const templateLanguage = trimString(pickFirst(template, ['language', 'template_language']), 30);
    const reason = compactText(pickFirst(template, ['reason', 'rejection_reason', 'message', 'description']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'warning',
    });

    return buildNormalizedEvent({
      field,
      eventType: `template_status_${slugify(templateName || `template_${idx + 1}`)}_${slugify(status || 'updated')}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(template, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(template, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(template, ['phone_number_id']), 120) || base.phoneNumberId,
      templateName,
      templateLanguage,
      status,
      reason,
      summary: compactText(
        pickFirst(template, ['summary', 'message', 'description']) ||
          `Template ${templateName || `#${idx + 1}`} cambió a ${status || 'sin estado'}`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(template, ['id', 'event_id']) || null,
        payload: template,
      },
    });
  });
}

function normalizeTemplateQuality(field, value, base, config) {
  const templates =
    asArray(value?.message_template_quality_update).length > 0
      ? asArray(value?.message_template_quality_update)
      : asArray(value?.templates).length > 0
        ? asArray(value?.templates)
        : [value];

  return templates.map((template, idx) => {
    const quality = pickFirst(template, ['quality_rating', 'quality', 'current_quality']);
    const status = pickFirst(template, ['status', 'state']);
    const templateName = trimString(pickFirst(template, ['name', 'template_name']), 120);
    const templateLanguage = trimString(pickFirst(template, ['language', 'template_language']), 30);
    const reason = compactText(pickFirst(template, ['reason', 'message', 'description']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality,
      reason,
      fallback: 'warning',
    });

    return buildNormalizedEvent({
      field,
      eventType: `template_quality_${slugify(templateName || `template_${idx + 1}`)}_${slugify(quality || status || 'updated')}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(template, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(template, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(template, ['phone_number_id']), 120) || base.phoneNumberId,
      templateName,
      templateLanguage,
      status,
      quality,
      reason,
      summary: compactText(
        pickFirst(template, ['summary', 'message', 'description']) ||
          `Calidad de template ${templateName || `#${idx + 1}`} = ${quality || status || 'sin detalle'}`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(template, ['id', 'event_id']) || null,
        payload: template,
      },
    });
  });
}

function normalizeMessages(field, value, base, config) {
  const events = [];

  for (const statusItem of asArray(value?.statuses)) {
    const status = pickFirst(statusItem, ['status']);
    const errors = asArray(statusItem?.errors)
      .map((err) => compactText(pickFirst(err, ['title', 'message', 'code']) || err))
      .filter(Boolean);
    const reason = errors.length > 0 ? errors.join(' | ') : compactText(pickFirst(statusItem, ['description', 'reason']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: status === 'failed' ? 'warning' : 'info',
    });

    events.push(
      buildNormalizedEvent({
        field,
        eventType: `message_status_${slugify(status || 'unknown')}`,
        severity,
        occurredAt: parseTimestamp(pickFirst(statusItem, ['timestamp'])) || base.occurredAt,
        receivedAt: base.receivedAt,
        wabaId: trimString(pickFirst(statusItem, ['waba_id']), 120) || base.wabaId,
        phoneNumberId: trimString(pickFirst(statusItem, ['phone_number_id']), 120) || base.phoneNumberId,
        status,
        reason,
        summary: compactText(
          `Estado de mensaje ${status || 'desconocido'}${reason ? `: ${reason}` : ''}`
        ),
        recommendedAction: buildRecommendedAction({
          field,
          severity,
          status,
          quality: null,
          reason,
          coexistenceEnabled: config.coexistence_enabled,
        }),
        rawRef: {
          id: pickFirst(statusItem, ['id']) || null,
          payload: statusItem,
        },
      })
    );
  }

  for (const messageItem of asArray(value?.messages)) {
    const type = pickFirst(messageItem, ['type']) || 'unknown';
    const summary = compactText(
      `Mensaje ${type} recibido (${pickFirst(messageItem, ['id']) || 'sin id'})`
    );
    events.push(
      buildNormalizedEvent({
        field,
        eventType: `message_${slugify(type)}`,
        severity: 'info',
        occurredAt: parseTimestamp(pickFirst(messageItem, ['timestamp'])) || base.occurredAt,
        receivedAt: base.receivedAt,
        wabaId: base.wabaId,
        phoneNumberId: base.phoneNumberId,
        status: 'received',
        summary,
        recommendedAction: buildRecommendedAction({
          field,
          severity: 'info',
          status: 'received',
          quality: null,
          reason: null,
          coexistenceEnabled: config.coexistence_enabled,
        }),
        rawRef: {
          id: pickFirst(messageItem, ['id']) || null,
          payload: messageItem,
        },
      })
    );
  }

  if (events.length === 0) {
    const reason = compactText(pickFirst(value, ['description', 'message']));
    const severity = normalizeSeverityForField({
      field,
      status: pickFirst(value, ['status']),
      quality: null,
      reason,
      fallback: 'info',
    });

    events.push(
      buildNormalizedEvent({
        field,
        eventType: `messages_${slugify(pickFirst(value, ['status']) || 'update')}`,
        severity,
        occurredAt: base.occurredAt,
        receivedAt: base.receivedAt,
        wabaId: base.wabaId,
        phoneNumberId: base.phoneNumberId,
        status: pickFirst(value, ['status']) || null,
        reason,
        summary: compactText('Evento operativo de mensajes recibido.'),
        recommendedAction: buildRecommendedAction({
          field,
          severity,
          status: pickFirst(value, ['status']),
          quality: null,
          reason,
          coexistenceEnabled: config.coexistence_enabled,
        }),
        rawRef: {
          id: null,
          payload: value,
        },
      })
    );
  }

  return events;
}

function normalizeSmbEchoes(field, value, base, config) {
  const echoes =
    asArray(value?.smb_message_echoes).length > 0
      ? asArray(value?.smb_message_echoes)
      : asArray(value?.messages).length > 0
        ? asArray(value?.messages)
        : [value];

  return echoes.map((echo, idx) => {
    const status = pickFirst(echo, ['status']) || 'echo_received';
    const reason = compactText(pickFirst(echo, ['message', 'description', 'reason']));
    const summary = compactText(
      pickFirst(echo, ['summary', 'message']) ||
        `Eco SMB detectado (${pickFirst(echo, ['id']) || `evento_${idx + 1}`})`
    );

    return buildNormalizedEvent({
      field,
      eventType: `smb_echo_${slugify(status)}`,
      severity: 'info',
      occurredAt: parseTimestamp(pickFirst(echo, ['timestamp', 'time'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(echo, ['waba_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(echo, ['phone_number_id']), 120) || base.phoneNumberId,
      status,
      reason,
      summary,
      recommendedAction: buildRecommendedAction({
        field,
        severity: 'info',
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(echo, ['id']) || null,
        payload: echo,
      },
    });
  });
}

function normalizeSecurity(field, value, base, config) {
  const incidents =
    asArray(value?.incidents).length > 0
      ? asArray(value?.incidents)
      : asArray(value?.security).length > 0
        ? asArray(value?.security)
        : [value];

  return incidents.map((incident, idx) => {
    const status = pickFirst(incident, ['status', 'state', 'severity']) || 'incident';
    const reason = compactText(pickFirst(incident, ['reason', 'description', 'message', 'code']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'critical',
    });

    return buildNormalizedEvent({
      field,
      eventType: `security_${slugify(pickFirst(incident, ['type', 'code']) || status || `incident_${idx + 1}`)}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(incident, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(incident, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(incident, ['phone_number_id']), 120) || base.phoneNumberId,
      status,
      reason,
      summary: compactText(
        pickFirst(incident, ['summary', 'message', 'description']) ||
          `Evento de seguridad detectado (${status || 'sin detalle'})`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(incident, ['id', 'event_id']) || null,
        payload: incident,
      },
    });
  });
}

function normalizeFlows(field, value, base, config) {
  const items =
    asArray(value?.flows).length > 0
      ? asArray(value?.flows)
      : asArray(value?.flow_events).length > 0
        ? asArray(value?.flow_events)
        : [value];

  return items.map((flow, idx) => {
    const status = pickFirst(flow, ['status', 'state', 'event']);
    const reason = compactText(pickFirst(flow, ['reason', 'description', 'message', 'error']));
    const severity = normalizeSeverityForField({
      field,
      status,
      quality: null,
      reason,
      fallback: 'info',
    });

    return buildNormalizedEvent({
      field,
      eventType: `flows_${slugify(pickFirst(flow, ['flow_name', 'name', 'type']) || status || `event_${idx + 1}`)}`,
      severity,
      occurredAt: parseTimestamp(pickFirst(flow, ['timestamp', 'time', 'occurred_at'])) || base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: trimString(pickFirst(flow, ['waba_id', 'business_id']), 120) || base.wabaId,
      phoneNumberId: trimString(pickFirst(flow, ['phone_number_id']), 120) || base.phoneNumberId,
      status,
      reason,
      summary: compactText(
        pickFirst(flow, ['summary', 'message', 'description']) ||
          `Evento de Flows (${status || 'sin detalle'})`
      ),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: pickFirst(flow, ['id', 'event_id']) || null,
        payload: flow,
      },
    });
  });
}

function normalizeGenericField(field, value, base, config) {
  const status = pickFirst(value, ['status', 'state', 'event']) || 'updated';
  const quality = pickFirst(value, ['quality', 'quality_rating']);
  const reason = compactText(pickFirst(value, ['reason', 'message', 'description']));
  const severity = normalizeSeverityForField({ field, status, quality, reason, fallback: 'info' });

  return [
    buildNormalizedEvent({
      field,
      eventType: `${slugify(field)}_${slugify(status || 'event')}`,
      severity,
      occurredAt: base.occurredAt,
      receivedAt: base.receivedAt,
      wabaId: base.wabaId,
      phoneNumberId: base.phoneNumberId,
      status,
      quality,
      reason,
      summary: compactText(`Evento ${field} recibido${reason ? `: ${reason}` : ''}`),
      recommendedAction: buildRecommendedAction({
        field,
        severity,
        status,
        quality,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      rawRef: {
        id: null,
        payload: value,
      },
    }),
  ];
}

function normalizeWebhookChange({ field, value, entry, receivedAt, config }) {
  const base = baseContextFromChange({ field, value, entry, receivedAt });

  switch (field) {
    case 'account_alerts':
      return normalizeAccountAlerts(field, value, base, config);
    case 'account_update':
      return normalizeAccountUpdate(field, value, base, config);
    case 'business_capability_update':
      return normalizeBusinessCapability(field, value, base, config);
    case 'business_status_update':
      return normalizeBusinessStatus(field, value, base, config);
    case 'phone_number_quality_update':
      return normalizePhoneQuality(field, value, base, config);
    case 'message_template_status_update':
      return normalizeTemplateStatus(field, value, base, config);
    case 'message_template_quality_update':
      return normalizeTemplateQuality(field, value, base, config);
    case 'messages':
      return normalizeMessages(field, value, base, config);
    case 'smb_message_echoes':
      return normalizeSmbEchoes(field, value, base, config);
    case 'security':
      return normalizeSecurity(field, value, base, config);
    case 'flows':
      return normalizeFlows(field, value, base, config);
    default:
      return normalizeGenericField(field || 'unknown', value || {}, base, config);
  }
}

async function storeRawWebhook({ tenantId, requestId, payload, rawBody, signatureValid, source, fieldHint }) {
  const payloadRaw = rawBody || JSON.stringify(payload || {});
  const payloadHash = crypto.createHash('sha256').update(payloadRaw).digest('hex');

  const [result] = await pool.query(
    `INSERT INTO meta_health_webhook_raw (
      tenant_id,
      request_id,
      source,
      signature_valid,
      field_hint,
      payload_hash,
      payload,
      received_at,
      processed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
    [
      tenantId,
      requestId,
      source || 'meta_webhook',
      signatureValid ? 1 : 0,
      fieldHint || null,
      payloadHash,
      JSON.stringify(payload || {}),
    ]
  );

  return {
    id: result.insertId,
    payloadHash,
  };
}

async function markRawWebhookProcessed(rawWebhookId, errorMessage = null) {
  await pool.query(
    `UPDATE meta_health_webhook_raw
       SET processed = 1,
           processing_error = ?,
           processed_at = NOW()
     WHERE id = ?`,
    [errorMessage || null, rawWebhookId]
  );
}

async function upsertNormalizedEvent(tenantId, rawWebhookId, event) {
  const [result] = await pool.query(
    `INSERT INTO meta_health_events (
      tenant_id,
      raw_webhook_id,
      source,
      field_name,
      event_type,
      severity,
      occurred_at,
      received_at,
      waba_id,
      phone_number_id,
      template_name,
      template_language,
      status,
      quality,
      reason,
      summary,
      recommended_action,
      normalized_payload,
      dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      id = LAST_INSERT_ID(id),
      received_at = GREATEST(received_at, VALUES(received_at)),
      updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      rawWebhookId || null,
      event.source,
      event.field,
      event.eventType,
      event.severity,
      event.occurredAt,
      event.receivedAt,
      event.wabaId,
      event.phoneNumberId,
      event.templateName,
      event.templateLanguage,
      event.status,
      event.quality,
      event.reason,
      event.summary,
      event.recommendedAction,
      JSON.stringify(event.normalizedPayload || {}),
      event.dedupeKey,
    ]
  );

  const inserted = result.affectedRows === 1;
  const eventId = result.insertId;

  await pool.query(
    `INSERT INTO meta_health_last_seen (
      tenant_id,
      event_key,
      last_received_at,
      last_occurred_at,
      last_event_id
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_received_at = GREATEST(last_received_at, VALUES(last_received_at)),
      last_occurred_at = GREATEST(last_occurred_at, VALUES(last_occurred_at)),
      last_event_id = VALUES(last_event_id)`,
    [tenantId, `field:${event.field}`, event.receivedAt, event.occurredAt, eventId]
  );

  await pool.query(
    `INSERT INTO meta_health_last_seen (
      tenant_id,
      event_key,
      last_received_at,
      last_occurred_at,
      last_event_id
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_received_at = GREATEST(last_received_at, VALUES(last_received_at)),
      last_occurred_at = GREATEST(last_occurred_at, VALUES(last_occurred_at)),
      last_event_id = VALUES(last_event_id)`,
    [tenantId, `event:${event.eventType}`, event.receivedAt, event.occurredAt, eventId]
  );

  return {
    inserted,
    eventId,
    event: {
      id: eventId,
      ...event,
      rawWebhookId,
    },
  };
}

function buildAlertMessage(event) {
  const severityLabel =
    event.severity === 'critical' ? 'CRITICO' : event.severity === 'warning' ? 'WARNING' : 'INFO';
  const lines = [
    `Meta Health ${severityLabel}`,
    `Tipo: ${event.eventType}`,
    `Field: ${event.field}`,
    `Resumen: ${event.summary || 'Sin resumen'}`,
  ];

  if (event.status) lines.push(`Status: ${event.status}`);
  if (event.quality) lines.push(`Quality: ${event.quality}`);
  if (event.reason) lines.push(`Reason: ${event.reason}`);
  if (event.phoneNumberId) lines.push(`phone_number_id: ${event.phoneNumberId}`);
  if (event.wabaId) lines.push(`waba_id: ${event.wabaId}`);
  if (event.recommendedAction) lines.push(`Accion sugerida: ${event.recommendedAction}`);

  return lines.join('\n');
}

async function sendTelegramAlert(channelConfig, payload) {
  const botToken = channelConfig?.bot_token;
  const chatId = channelConfig?.chat_id;
  if (!botToken || !chatId) {
    throw new Error('Telegram sin bot_token/chat_id');
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: payload.text,
      disable_web_page_preview: true,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram ${response.status}: ${compactText(body, 280)}`);
  }

  return {
    statusCode: response.status,
    body,
  };
}

async function maybeSendAlertsForEvent(tenantId, event, config) {
  const severityEnabled =
    (event.severity === 'critical' && config.alert_critical_enabled) ||
    (event.severity === 'warning' && config.alert_warning_enabled) ||
    (event.severity === 'info' && config.alert_info_enabled);

  if (!config.monitoring_enabled || !severityEnabled) {
    return;
  }

  const channels = [['telegram', config.alert_channels.telegram]].filter(([, channelCfg]) =>
    toBool(channelCfg?.enabled, false)
  );

  if (channels.length === 0) {
    return;
  }

  const cooldownMinutes = toInt(config.alert_cooldown_minutes, 30, 1, 1440);
  const message = buildAlertMessage(event);

  for (const [channel, channelCfg] of channels) {
    const dedupeScope = `${event.field}|${event.eventType}|${event.status || ''}|${event.quality || ''}|${event.reason || ''}`;
    const dedupeKey = crypto.createHash('sha1').update(`${channel}|${event.severity}|${dedupeScope}`).digest('hex');

    const [recent] = await pool.query(
      `SELECT id
         FROM meta_health_alerts
        WHERE tenant_id = ?
          AND channel = ?
          AND dedupe_key = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          AND status IN ('sent', 'queued')
        LIMIT 1`,
      [tenantId, channel, dedupeKey, cooldownMinutes]
    );

    if (recent.length > 0) {
      await pool.query(
        `INSERT INTO meta_health_alerts (
          tenant_id,
          event_id,
          alert_type,
          severity,
          channel,
          dedupe_key,
          status,
          payload
        ) VALUES (?, ?, ?, ?, ?, ?, 'skipped', ?)`,
        [
          tenantId,
          event.id,
          event.eventType,
          event.severity,
          channel,
          dedupeKey,
          JSON.stringify({ reason: 'cooldown', message }),
        ]
      );
      continue;
    }

    const payload = {
      subject: `[Meta health][${event.severity.toUpperCase()}] ${event.eventType}`,
      text: message,
      body: {
        source: 'meta_health',
        severity: event.severity,
        event_type: event.eventType,
        field: event.field,
        summary: event.summary,
        recommended_action: event.recommendedAction,
        status: event.status,
        quality: event.quality,
        reason: event.reason,
        occurred_at: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
        received_at: event.receivedAt instanceof Date ? event.receivedAt.toISOString() : event.receivedAt,
        phone_number_id: event.phoneNumberId,
        waba_id: event.wabaId,
      },
    };

    try {
      const dispatchResult = await sendTelegramAlert(channelCfg, payload);
      await pool.query(
        `INSERT INTO meta_health_alerts (
          tenant_id,
          event_id,
          alert_type,
          severity,
          channel,
          dedupe_key,
          status,
          payload,
          response_status,
          response_body,
          sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, NOW())`,
        [
          tenantId,
          event.id,
          event.eventType,
          event.severity,
          channel,
          dedupeKey,
          JSON.stringify(payload.body),
          dispatchResult.statusCode || null,
          compactText(dispatchResult.body, 2000),
        ]
      );
    } catch (err) {
      await pool.query(
        `INSERT INTO meta_health_alerts (
          tenant_id,
          event_id,
          alert_type,
          severity,
          channel,
          dedupe_key,
          status,
          payload,
          response_status,
          response_body
        ) VALUES (?, ?, ?, ?, ?, ?, 'error', ?, NULL, ?)`,
        [
          tenantId,
          event.id,
          event.eventType,
          event.severity,
          channel,
          dedupeKey,
          JSON.stringify(payload.body),
          compactText(err.message, 2000),
        ]
      );
    }
  }
}

function eventToCardStatus(event) {
  if (!event) return 'gray';
  return STATUS_COLORS[event.severity] || 'gray';
}

function colorLabel(color) {
  if (color === 'green') return 'OK';
  if (color === 'yellow') return 'Warning';
  if (color === 'red') return 'Crítico';
  return 'Sin datos';
}

function minutesSince(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

function buildCardFromEvent({ key, title, event, fallbackExplanation, fallbackAction }) {
  const status = eventToCardStatus(event);
  return {
    key,
    title,
    status,
    state_label: colorLabel(status),
    current_state: event?.status || event?.quality || (status === 'gray' ? 'unknown' : 'ok'),
    last_change: event?.eventType || null,
    date_time: event?.receivedAt ? new Date(event.receivedAt).toISOString() : null,
    explanation: event?.summary || fallbackExplanation,
    action_recommended:
      status === 'green' || status === 'gray'
        ? null
        : event?.recommendedAction || fallbackAction || 'Revisar detalle técnico del evento.',
  };
}

function chooseLatestByFields(events, fields) {
  return events.find((event) => fields.includes(event.field));
}

function buildRecommendations({ cards, config, lastWebhookMinutes, watchdogStatus }) {
  const recommendations = [];

  const phoneQualityCard = cards.find((card) => card.key === 'number_quality');
  if (phoneQualityCard && ['yellow', 'red'].includes(phoneQualityCard.status)) {
    recommendations.push('Revisar calidad del número y reducir señales que impacten reputación.');
  }

  const templatesCard = cards.find((card) => card.key === 'templates');
  if (templatesCard && ['yellow', 'red'].includes(templatesCard.status)) {
    recommendations.push('Revisar templates degradados, pausados o rechazados y reenviar para aprobación si aplica.');
  }

  const webhookCard = cards.find((card) => card.key === 'webhook_endpoint');
  if (webhookCard && ['yellow', 'red'].includes(webhookCard.status)) {
    recommendations.push('Verificar endpoint webhook y pipeline interno: firma, respuesta 200 y procesamiento async.');
  }

  const accountCard = cards.find((card) => card.key === 'meta_account');
  if (accountCard && accountCard.status === 'red') {
    recommendations.push('Revisar restricciones de cuenta/WABA, offboarding o partner removed en Meta Business Manager.');
  }

  if (toBool(config.coexistence_enabled, false)) {
    recommendations.push('Coexistence activo: validar anomalías sin asumir que mensajes manuales replican exactamente el patrón del bot.');
  }

  if (lastWebhookMinutes !== null && lastWebhookMinutes > config.silence_warning_minutes) {
    recommendations.push('Existe silencio prolongado de eventos Meta: confirmar si es baja actividad real o falla de recepción.');
  }

  if (watchdogStatus === 'critical') {
    recommendations.push('Watchdog crítico: validar DB/cola/canales de alerta antes de operar normalmente.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Sin acciones urgentes. Mantener monitoreo y revisar historial ante cualquier anomalía.');
  }

  return recommendations;
}

function getGlobalStatus({ cards, lastWebhookMinutes, config, latestCriticalEvent, watchdogStatus }) {
  const hasRedCard = cards.some((card) => card.status === 'red');
  const hasYellowCard = cards.some((card) => card.status === 'yellow');
  const criticalRecentMinutes = latestCriticalEvent ? minutesSince(latestCriticalEvent.receivedAt) : null;

  if (hasRedCard || watchdogStatus === 'critical' || (criticalRecentMinutes !== null && criticalRecentMinutes <= 1440)) {
    return 'red';
  }

  if (
    hasYellowCard ||
    watchdogStatus === 'warning' ||
    (lastWebhookMinutes !== null && lastWebhookMinutes > config.silence_warning_minutes)
  ) {
    return 'yellow';
  }

  return 'green';
}

function mapEventRow(row) {
  return {
    id: row.id,
    raw_webhook_id: row.raw_webhook_id,
    source: row.source,
    field: row.field_name,
    event_type: row.event_type,
    severity: row.severity,
    occurred_at: row.occurred_at,
    received_at: row.received_at,
    waba_id: row.waba_id,
    phone_number_id: row.phone_number_id,
    template_name: row.template_name,
    template_language: row.template_language,
    status: row.status,
    quality: row.quality,
    reason: row.reason,
    summary: row.summary,
    recommended_action: row.recommended_action,
    dedupe_key: row.dedupe_key,
    normalized_payload: parseJsonSafe(row.normalized_payload, null),
  };
}

async function rebuildMetaHealthState(tenantId, { trigger = 'internal', persistHistory = true } = {}) {
  const config = await getMetaHealthConfig(tenantId);

  const [eventRowsResult, watchdogRows, stateRows] = await Promise.all([
    pool.query(
      `SELECT *
         FROM meta_health_events
        WHERE tenant_id = ?
        ORDER BY received_at DESC
        LIMIT 500`,
      [tenantId]
    ),
    pool.query(
      `SELECT *
         FROM meta_health_watchdog_runs
        WHERE tenant_id = ?
        ORDER BY checked_at DESC
        LIMIT 1`,
      [tenantId]
    ),
    pool.query(
      `SELECT *
         FROM meta_health_state
        WHERE tenant_id = ?
        LIMIT 1`,
      [tenantId]
    ),
  ]);

  const eventRows = eventRowsResult[0] || [];
  const events = eventRows.map((row) => ({
    id: row.id,
    rawWebhookId: row.raw_webhook_id,
    source: row.source,
    field: row.field_name,
    eventType: row.event_type,
    severity: row.severity,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    templateName: row.template_name,
    templateLanguage: row.template_language,
    status: row.status,
    quality: row.quality,
    reason: row.reason,
    summary: row.summary,
    recommendedAction: row.recommended_action,
  }));

  const latestEvent = events[0] || null;
  const latestCriticalEvent = events.find((event) => event.severity === 'critical') || null;
  const latestWebhookEvent = events.find((event) => event.source === 'meta_webhook') || null;

  const lastWebhookMinutes = minutesSince(latestWebhookEvent?.receivedAt);

  const latestAccountEvent = chooseLatestByFields(events, [
    'account_update',
    'account_alerts',
    'business_status_update',
    'business_capability_update',
  ]);
  const latestPhoneEvent = chooseLatestByFields(events, ['messages', 'business_status_update']);
  const latestQualityEvent = chooseLatestByFields(events, ['phone_number_quality_update']);
  const latestTemplateEvent = chooseLatestByFields(events, [
    'message_template_status_update',
    'message_template_quality_update',
  ]);
  const latestSecurityEvent = chooseLatestByFields(events, ['security']);
  const latestFlowsEvent = chooseLatestByFields(events, ['flows']);

  const latestWatchdog = watchdogRows[0]?.[0] || null;
  const watchdogStatus = latestWatchdog?.status || stateRows[0]?.watchdog_status || 'unknown';

  const endpointStatus =
    lastWebhookMinutes === null
      ? 'yellow'
      : lastWebhookMinutes > config.silence_critical_minutes
        ? 'red'
        : lastWebhookMinutes > config.silence_warning_minutes
          ? 'yellow'
          : 'green';

  const endpointCard = {
    key: 'webhook_endpoint',
    title: 'Webhook endpoint',
    status: endpointStatus,
    state_label: colorLabel(endpointStatus),
    current_state:
      endpointStatus === 'red' ? 'sin senales recientes' : endpointStatus === 'yellow' ? 'senal dudosa' : 'activo',
    last_change: latestWebhookEvent?.eventType || null,
    date_time: latestWebhookEvent?.receivedAt ? new Date(latestWebhookEvent.receivedAt).toISOString() : null,
    explanation:
      endpointStatus === 'green'
        ? 'Endpoint recibiendo webhooks recientes y procesando con normalidad.'
        : endpointStatus === 'yellow'
          ? 'Tiempo elevado sin webhooks recientes. Puede ser baja actividad o señal de degradación.'
          : 'Silencio anómalo de webhooks. Posible caída de endpoint o pipeline roto.',
    action_recommended:
      endpointStatus === 'green'
        ? null
        : 'Revisar endpoint, firma, logs de entrada y cola/procesamiento interno.',
  };

  const cards = [
    endpointCard,
    buildCardFromEvent({
      key: 'meta_account',
      title: 'Cuenta Meta / WABA',
      event: latestAccountEvent,
      fallbackExplanation: 'Sin eventos recientes de cuenta/WABA.',
      fallbackAction: 'Validar estado de la cuenta en Meta Business Manager.',
    }),
    buildCardFromEvent({
      key: 'whatsapp_number',
      title: 'Numero de WhatsApp',
      event: latestPhoneEvent,
      fallbackExplanation: 'Sin eventos recientes del número.',
      fallbackAction: 'Confirmar conectividad del número y permisos de envío.',
    }),
    buildCardFromEvent({
      key: 'number_quality',
      title: 'Calidad del numero',
      event: latestQualityEvent,
      fallbackExplanation: 'Sin actualizaciones recientes de calidad.',
      fallbackAction: 'Revisar phone_number_quality_update en Meta.',
    }),
    buildCardFromEvent({
      key: 'templates',
      title: 'Templates',
      event: latestTemplateEvent,
      fallbackExplanation: 'Sin cambios recientes de templates.',
      fallbackAction: 'Verificar aprobaciones, pausas o rechazos de templates.',
    }),
    buildCardFromEvent({
      key: 'security',
      title: 'Seguridad',
      event: latestSecurityEvent,
      fallbackExplanation: 'Sin incidentes de seguridad recientes.',
      fallbackAction: 'Revisar eventos de security y control de accesos.',
    }),
  ];

  if (config.flows_enabled) {
    cards.push(
      buildCardFromEvent({
        key: 'flows',
        title: 'Flows',
        event: latestFlowsEvent,
        fallbackExplanation: 'Flows habilitado sin eventos recientes.',
        fallbackAction: 'Revisar estado de Flows en Meta si aplica.',
      })
    );
  }

  cards.push(
    buildCardFromEvent({
      key: 'last_critical_event',
      title: 'Ultimo evento critico',
      event: latestCriticalEvent,
      fallbackExplanation: 'No se registraron eventos críticos recientes.',
      fallbackAction: 'Sin acción urgente.',
    }),
    buildCardFromEvent({
      key: 'last_event_received',
      title: 'Ultimo evento recibido',
      event: latestEvent,
      fallbackExplanation: 'Aún no hay eventos recibidos.',
      fallbackAction: 'Confirmar suscripción webhook y envío de eventos.',
    })
  );

  const recommendations = buildRecommendations({
    cards,
    config,
    lastWebhookMinutes,
    watchdogStatus,
  });

  const globalStatus = getGlobalStatus({
    cards,
    lastWebhookMinutes,
    config,
    latestCriticalEvent,
    watchdogStatus,
  });

  const reasonSource =
    cards.find((card) => card.status === 'red') ||
    cards.find((card) => card.status === 'yellow') ||
    cards.find((card) => card.status === 'green');

  const globalReason =
    globalStatus === 'green'
      ? 'Meta operativo: endpoint saludable y sin alertas críticas recientes.'
      : reasonSource?.explanation || 'Hay señales que requieren revisión en Meta health.';

  const summary = {
    global_status: globalStatus,
    global_reason: globalReason,
    refreshed_at: new Date().toISOString(),
    last_webhook_received_at: latestWebhookEvent?.receivedAt || null,
    last_critical_event_at: latestCriticalEvent?.receivedAt || null,
    last_event_received_at: latestEvent?.receivedAt || null,
    last_watchdog_run_at: latestWatchdog?.checked_at || null,
    watchdog_status: watchdogStatus,
    pipeline_status: latestWatchdog?.status || 'unknown',
    trigger,
  };

  await pool.query(
    `INSERT INTO meta_health_state (
      tenant_id,
      global_status,
      global_reason,
      last_internal_refresh_at,
      last_webhook_received_at,
      last_critical_event_at,
      last_event_received_at,
      last_watchdog_run_at,
      watchdog_status,
      pipeline_status,
      cards,
      diagnostics,
      metrics,
      updated_at
    ) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      global_status = VALUES(global_status),
      global_reason = VALUES(global_reason),
      last_internal_refresh_at = NOW(),
      last_webhook_received_at = VALUES(last_webhook_received_at),
      last_critical_event_at = VALUES(last_critical_event_at),
      last_event_received_at = VALUES(last_event_received_at),
      last_watchdog_run_at = VALUES(last_watchdog_run_at),
      watchdog_status = VALUES(watchdog_status),
      pipeline_status = VALUES(pipeline_status),
      cards = VALUES(cards),
      diagnostics = VALUES(diagnostics),
      metrics = VALUES(metrics),
      updated_at = NOW()`,
    [
      tenantId,
      summary.global_status,
      summary.global_reason,
      summary.last_webhook_received_at,
      summary.last_critical_event_at,
      summary.last_event_received_at,
      summary.last_watchdog_run_at,
      summary.watchdog_status,
      summary.pipeline_status,
      JSON.stringify(cards),
      JSON.stringify(recommendations),
      JSON.stringify({
        total_events_considered: events.length,
        last_webhook_minutes: lastWebhookMinutes,
      }),
    ]
  );

  if (persistHistory) {
    await pool.query(
      `INSERT INTO meta_health_history (
        tenant_id,
        global_status,
        global_reason,
        snapshot,
        created_at
      ) VALUES (?, ?, ?, ?, NOW())`,
      [
        tenantId,
        summary.global_status,
        summary.global_reason,
        JSON.stringify({
          summary,
          cards,
          recommendations,
        }),
      ]
    );
  }

  broadcast(
    'meta-health:update',
    {
      tenant_id: tenantId,
      global_status: summary.global_status,
      global_reason: summary.global_reason,
      refreshed_at: summary.refreshed_at,
    },
    tenantId
  );

  return {
    summary,
    cards,
    recommendations,
  };
}

async function ingestMetaWebhookPayload({
  tenantId,
  body,
  rawBody,
  signatureValid = true,
  source = 'meta_webhook',
}) {
  if (!tenantId) {
    throw new Error('tenantId requerido para ingestMetaWebhookPayload');
  }

  const config = await getMetaHealthConfig(tenantId);
  const receivedAt = new Date();
  const requestId = crypto.randomUUID();
  const firstField = body?.entry?.[0]?.changes?.[0]?.field || null;

  const rawWebhook = await storeRawWebhook({
    tenantId,
    requestId,
    payload: body,
    rawBody,
    signatureValid,
    source,
    fieldHint: firstField,
  });

  let parseError = null;
  const normalizedEvents = [];

  try {
    for (const entry of asArray(body?.entry)) {
      for (const change of asArray(entry?.changes)) {
        const field = change?.field || 'unknown';
        const value = change?.value || {};

        const events = normalizeWebhookChange({
          field,
          value,
          entry,
          receivedAt,
          config,
        });

        normalizedEvents.push(...events);
      }
    }

    if (normalizedEvents.length === 0) {
      normalizedEvents.push(
        buildNormalizedEvent({
          field: 'unknown',
          eventType: 'unknown_event',
          severity: 'warning',
          occurredAt: receivedAt,
          receivedAt,
          wabaId: trimString(process.env.WABA_ID, 120) || null,
          phoneNumberId: trimString(process.env.WA_PHONE_ID, 120) || null,
          summary: 'Payload webhook recibido sin cambios parseables.',
          recommendedAction:
            'Revisar payload raw para mapear nuevos formatos y evitar pérdida de señal operativa.',
          rawRef: {
            id: null,
            payload: body,
          },
        })
      );
    }
  } catch (err) {
    parseError = err;
    normalizedEvents.push(
      buildNormalizedEvent({
        field: 'unknown',
        eventType: 'parser_error',
        severity: 'warning',
        occurredAt: receivedAt,
        receivedAt,
        wabaId: trimString(process.env.WABA_ID, 120) || null,
        phoneNumberId: trimString(process.env.WA_PHONE_ID, 120) || null,
        reason: compactText(err.message),
        summary: 'Error parseando payload webhook. Se almacenó raw para diagnóstico.',
        recommendedAction:
          'Abrir raw payload y ajustar normalización para soportar el formato recibido sin romper el endpoint.',
        rawRef: {
          id: null,
          payload: body,
        },
      })
    );
  }

  const insertedEvents = [];
  let duplicateCount = 0;

  for (const normalizedEvent of normalizedEvents) {
    const upsert = await upsertNormalizedEvent(tenantId, rawWebhook.id, normalizedEvent);
    if (upsert.inserted) {
      insertedEvents.push(upsert.event);
    } else {
      duplicateCount += 1;
    }
  }

  await markRawWebhookProcessed(rawWebhook.id, parseError ? compactText(parseError.message, 1000) : null);

  if (insertedEvents.length > 0) {
    for (const event of insertedEvents) {
      if (event.severity === 'critical' || event.severity === 'warning' || event.severity === 'info') {
        await maybeSendAlertsForEvent(tenantId, event, config);
      }
    }
  }

  await rebuildMetaHealthState(tenantId, { trigger: 'webhook' });

  return {
    raw_webhook_id: rawWebhook.id,
    payload_hash: rawWebhook.payloadHash,
    total_events: normalizedEvents.length,
    inserted_events: insertedEvents.length,
    duplicates: duplicateCount,
    parse_error: parseError ? parseError.message : null,
  };
}

async function getMetaHealthPanel(tenantId, { timelineLimit = 50 } = {}) {
  const config = await getMetaHealthConfig(tenantId);

  const [stateRows, eventsRows] = await Promise.all([
    pool.query('SELECT * FROM meta_health_state WHERE tenant_id = ? LIMIT 1', [tenantId]),
    pool.query(
      `SELECT *
         FROM meta_health_events
        WHERE tenant_id = ?
        ORDER BY received_at DESC
        LIMIT ?`,
      [tenantId, toInt(timelineLimit, 50, 1, 100)]
    ),
  ]);

  let stateRow = stateRows[0]?.[0] || null;
  if (!stateRow) {
    await rebuildMetaHealthState(tenantId, { trigger: 'bootstrap' });
    const [newStateRows] = await pool.query('SELECT * FROM meta_health_state WHERE tenant_id = ? LIMIT 1', [tenantId]);
    stateRow = newStateRows[0] || null;
  }

  const summary = stateRow
    ? {
        global_status: stateRow.global_status,
        global_reason: stateRow.global_reason,
        refreshed_at: stateRow.last_internal_refresh_at,
        last_webhook_received_at: stateRow.last_webhook_received_at,
        last_critical_event_at: stateRow.last_critical_event_at,
        last_event_received_at: stateRow.last_event_received_at,
        last_watchdog_run_at: stateRow.last_watchdog_run_at,
        watchdog_status: stateRow.watchdog_status,
        pipeline_status: stateRow.pipeline_status,
      }
    : {
        global_status: 'yellow',
        global_reason: 'Sin estado agregado aún.',
        refreshed_at: null,
        last_webhook_received_at: null,
        last_critical_event_at: null,
        last_event_received_at: null,
        last_watchdog_run_at: null,
        watchdog_status: 'unknown',
        pipeline_status: 'unknown',
      };

  return {
    summary,
    cards: parseJsonSafe(stateRow?.cards, []),
    recommendations: parseJsonSafe(stateRow?.diagnostics, []),
    config,
    timeline: (eventsRows[0] || []).map((row) => ({
      id: row.id,
      received_at: row.received_at,
      occurred_at: row.occurred_at,
      severity: row.severity,
      field: row.field_name,
      event_type: row.event_type,
      status: row.status,
      quality: row.quality,
      summary: row.summary,
      recommended_action: row.recommended_action,
      waba_id: row.waba_id,
      phone_number_id: row.phone_number_id,
      template_name: row.template_name,
      raw_webhook_id: row.raw_webhook_id,
    })),
    supported_fields: SUPPORTED_WEBHOOK_FIELDS,
  };
}

async function listMetaHealthEvents(tenantId, {
  page = 1,
  limit = 50,
  severity,
  field,
  phone,
  dateFrom,
  dateTo,
} = {}) {
  const normalizedPage = toInt(page, 1, 1, 100000);
  const normalizedLimit = toInt(limit, 50, 1, 100);
  const offset = (normalizedPage - 1) * normalizedLimit;

  let where = 'tenant_id = ?';
  const params = [tenantId];

  if (severity) {
    where += ' AND severity = ?';
    params.push(severity);
  }

  if (field) {
    where += ' AND field_name = ?';
    params.push(field);
  }

  if (phone) {
    where += ' AND phone_number_id LIKE ?';
    params.push(`%${String(phone).trim()}%`);
  }

  if (dateFrom) {
    where += ' AND received_at >= ?';
    params.push(new Date(dateFrom));
  }

  if (dateTo) {
    where += ' AND received_at <= ?';
    params.push(new Date(dateTo));
  }

  const [rows] = await pool.query(
    `SELECT *
       FROM meta_health_events
      WHERE ${where}
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?`,
    [...params, normalizedLimit, offset]
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM meta_health_events
      WHERE ${where}`,
    params
  );

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    total: countRows[0]?.total || 0,
    items: rows.map(mapEventRow),
  };
}

async function getMetaHealthEventDetail(tenantId, eventId) {
  const [rows] = await pool.query(
    `SELECT e.*, r.payload AS raw_payload, r.received_at AS raw_received_at
       FROM meta_health_events e
       LEFT JOIN meta_health_webhook_raw r ON r.id = e.raw_webhook_id
      WHERE e.tenant_id = ?
        AND e.id = ?
      LIMIT 1`,
    [tenantId, eventId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];

  const [alerts] = await pool.query(
    `SELECT *
       FROM meta_health_alerts
      WHERE tenant_id = ?
        AND event_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [tenantId, eventId]
  );

  return {
    event: mapEventRow(row),
    raw_payload: parseJsonSafe(row.raw_payload, null),
    raw_received_at: row.raw_received_at,
    alerts: alerts.map((alertRow) => ({
      id: alertRow.id,
      channel: alertRow.channel,
      severity: alertRow.severity,
      status: alertRow.status,
      alert_type: alertRow.alert_type,
      created_at: alertRow.created_at,
      sent_at: alertRow.sent_at,
      response_status: alertRow.response_status,
      response_body: alertRow.response_body,
      payload: parseJsonSafe(alertRow.payload, null),
    })),
  };
}

async function listMetaHealthHistory(tenantId, { limit = 50 } = {}) {
  const normalizedLimit = toInt(limit, 50, 1, 200);
  const [rows] = await pool.query(
    `SELECT *
       FROM meta_health_history
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [tenantId, normalizedLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    global_status: row.global_status,
    global_reason: row.global_reason,
    created_at: row.created_at,
    snapshot: parseJsonSafe(row.snapshot, null),
  }));
}

async function listMetaHealthAlerts(tenantId, { limit = 100 } = {}) {
  const normalizedLimit = toInt(limit, 100, 1, 200);
  const [rows] = await pool.query(
    `SELECT a.*, e.field_name, e.event_type, e.summary
       FROM meta_health_alerts a
       LEFT JOIN meta_health_events e ON e.id = a.event_id
      WHERE a.tenant_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?`,
    [tenantId, normalizedLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    severity: row.severity,
    status: row.status,
    alert_type: row.alert_type,
    created_at: row.created_at,
    sent_at: row.sent_at,
    response_status: row.response_status,
    response_body: row.response_body,
    event_id: row.event_id,
    event_field: row.field_name,
    event_type: row.event_type,
    event_summary: row.summary,
    payload: parseJsonSafe(row.payload, null),
  }));
}

async function createWatchdogSignalEvent(tenantId, severity, reason, details, config) {
  const now = new Date();
  const cooldownBucketMinutes = Math.max(1, toInt(config.alert_cooldown_minutes, 30, 1, 1440));
  const bucket = Math.floor(Date.now() / (cooldownBucketMinutes * 60 * 1000));

  const syntheticEvent = {
    source: 'watchdog',
    field: 'watchdog',
    eventType: severity === 'critical' ? 'watchdog_failure' : 'watchdog_warning',
    severity,
    occurredAt: now,
    receivedAt: now,
    wabaId: trimString(config.monitored_waba_id, 120) || trimString(process.env.WABA_ID, 120) || null,
    phoneNumberId:
      trimString(config.monitored_phone_number_id, 120) || trimString(process.env.WA_PHONE_ID, 120) || null,
    status: severity,
    quality: null,
    reason: compactText(reason),
    summary:
      severity === 'critical'
        ? `Watchdog detectó falla crítica: ${compactText(reason, 180)}`
        : `Watchdog detectó advertencia operativa: ${compactText(reason, 180)}`,
    recommendedAction: buildRecommendedAction({
      field: 'watchdog',
      severity,
      status: severity,
      quality: null,
      reason,
      coexistenceEnabled: config.coexistence_enabled,
    }),
    normalizedPayload: {
      source: 'watchdog',
      field: 'watchdog',
      event_type: severity === 'critical' ? 'watchdog_failure' : 'watchdog_warning',
      severity,
      occurred_at: now.toISOString(),
      received_at: now.toISOString(),
      waba_id: trimString(config.monitored_waba_id, 120) || null,
      phone_number_id: trimString(config.monitored_phone_number_id, 120) || null,
      status: severity,
      quality: null,
      reason,
      summary:
        severity === 'critical'
          ? `Watchdog detectó falla crítica: ${compactText(reason, 180)}`
          : `Watchdog detectó advertencia operativa: ${compactText(reason, 180)}`,
      recommended_action: buildRecommendedAction({
        field: 'watchdog',
        severity,
        status: severity,
        quality: null,
        reason,
        coexistenceEnabled: config.coexistence_enabled,
      }),
      raw_ref: details || null,
    },
    rawRef: {
      id: null,
      payload: details || null,
    },
  };

  syntheticEvent.dedupeKey = crypto
    .createHash('sha1')
    .update(`${tenantId}|watchdog|${syntheticEvent.eventType}|${reason}|${bucket}`)
    .digest('hex');

  const upsert = await upsertNormalizedEvent(tenantId, null, syntheticEvent);

  if (upsert.inserted) {
    await maybeSendAlertsForEvent(tenantId, upsert.event, config);
  }

  return upsert;
}

async function runMetaHealthWatchdogForTenant(tenantId, { force = false } = {}) {
  const config = await getMetaHealthConfig(tenantId);

  if (!config.monitoring_enabled) {
    return {
      tenant_id: tenantId,
      status: 'skipped',
      reason: 'monitoring_disabled',
    };
  }

  const [stateRows] = await pool.query('SELECT last_watchdog_run_at FROM meta_health_state WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const lastRunAt = stateRows[0]?.last_watchdog_run_at || null;

  if (!force && lastRunAt) {
    const elapsed = minutesSince(lastRunAt);
    if (elapsed !== null && elapsed < config.watchdog_interval_minutes) {
      return {
        tenant_id: tenantId,
        status: 'skipped',
        reason: 'not_due',
        next_due_in_minutes: config.watchdog_interval_minutes - elapsed,
      };
    }
  }

  const checks = [];
  const start = Date.now();

  try {
    await pool.query('SELECT 1');
    checks.push({
      check_name: 'database',
      status: 'ok',
      message: 'DB accesible',
      details: null,
    });
  } catch (err) {
    checks.push({
      check_name: 'database',
      status: 'critical',
      message: `DB inaccesible: ${compactText(err.message, 300)}`,
      details: { error: err.message },
    });
  }

  const [silenceRows] = await pool.query(
    `SELECT
       MAX(received_at) AS last_webhook_at,
       SUM(CASE WHEN received_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS events_24h
     FROM meta_health_events
     WHERE tenant_id = ?
       AND source = 'meta_webhook'`,
    [tenantId]
  );

  const lastWebhookAt = silenceRows[0]?.last_webhook_at || null;
  const events24h = Number(silenceRows[0]?.events_24h || 0);
  const silenceMinutes = minutesSince(lastWebhookAt);

  if (silenceMinutes === null) {
    checks.push({
      check_name: 'webhook_silence',
      status: 'ok',
      message: 'Sin webhooks iniciales aún; se activa monitoreo de silencio tras el primer evento.',
      details: { events_24h: events24h, baseline_established: false },
    });
  } else if (silenceMinutes > config.silence_critical_minutes) {
    checks.push({
      check_name: 'webhook_silence',
      status: 'critical',
      message: `Silencio webhook de ${silenceMinutes} min (> ${config.silence_critical_minutes} min).`,
      details: { last_webhook_at: lastWebhookAt, events_24h: events24h },
    });
  } else if (silenceMinutes > config.silence_warning_minutes) {
    checks.push({
      check_name: 'webhook_silence',
      status: 'warning',
      message: `Silencio webhook de ${silenceMinutes} min (> ${config.silence_warning_minutes} min).`,
      details: {
        last_webhook_at: lastWebhookAt,
        events_24h: events24h,
        low_activity_hint: events24h <= 2,
      },
    });
  } else {
    checks.push({
      check_name: 'webhook_silence',
      status: 'ok',
      message: `Último webhook hace ${silenceMinutes} min.`,
      details: { last_webhook_at: lastWebhookAt, events_24h: events24h },
    });
  }

  const [backlogRows] = await pool.query(
    `SELECT COUNT(*) AS pending
       FROM meta_health_webhook_raw
      WHERE tenant_id = ?
        AND processed = 0
        AND received_at <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
    [tenantId]
  );

  const pendingBacklog = Number(backlogRows[0]?.pending || 0);

  if (pendingBacklog >= 20) {
    checks.push({
      check_name: 'pipeline_backlog',
      status: 'critical',
      message: `Backlog crítico en pipeline (${pendingBacklog} payloads pendientes).`,
      details: { pending: pendingBacklog },
    });
  } else if (pendingBacklog > 0) {
    checks.push({
      check_name: 'pipeline_backlog',
      status: 'warning',
      message: `Backlog pendiente en pipeline (${pendingBacklog}).`,
      details: { pending: pendingBacklog },
    });
  } else {
    checks.push({
      check_name: 'pipeline_backlog',
      status: 'ok',
      message: 'Sin backlog en pipeline.',
      details: { pending: 0 },
    });
  }

  const enabledChannels = [config.alert_channels.telegram?.enabled].filter(Boolean).length;

  if (enabledChannels === 0) {
    checks.push({
      check_name: 'alert_channels',
      status: 'warning',
      message: 'No hay canales de alerta activos en Meta health.',
      details: null,
    });
  } else {
    checks.push({
      check_name: 'alert_channels',
      status: 'ok',
      message: `${enabledChannels} canal(es) de alerta activo(s).`,
      details: null,
    });
  }

  let overall = 'ok';
  for (const check of checks) {
    if (check.status === 'critical') {
      overall = 'critical';
      break;
    }
    if (check.status === 'warning') overall = 'warning';
  }

  const durationMs = Date.now() - start;
  const checkedAt = new Date();

  await pool.query(
    `INSERT INTO meta_health_watchdog_runs (
      tenant_id,
      status,
      checked_at,
      duration_ms,
      result_payload
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      tenantId,
      overall,
      checkedAt,
      durationMs,
      JSON.stringify({
        checks,
        silence_minutes: silenceMinutes,
        events_24h: events24h,
        pending_backlog: pendingBacklog,
      }),
    ]
  );

  for (const check of checks) {
    await pool.query(
      `INSERT INTO meta_health_pipeline_checks (
        tenant_id,
        check_name,
        status,
        details,
        checked_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [tenantId, check.check_name, check.status, JSON.stringify(check.details || { message: check.message }), checkedAt]
    );
  }

  if (overall === 'warning' || overall === 'critical') {
    const mainIssue = checks.find((check) => check.status === overall)?.message || 'Watchdog detectó condición anómala';
    await createWatchdogSignalEvent(
      tenantId,
      overall === 'critical' ? 'critical' : 'warning',
      mainIssue,
      { checks },
      config
    );
  }

  await rebuildMetaHealthState(tenantId, { trigger: 'watchdog' });

  return {
    tenant_id: tenantId,
    status: overall,
    checked_at: checkedAt.toISOString(),
    duration_ms: durationMs,
    checks,
  };
}

async function runMetaHealthWatchdogForDueTenants() {
  const [tenants] = await pool.query('SELECT id FROM tenants ORDER BY id');
  const results = [];

  for (const tenant of tenants) {
    const tenantId = tenant.id;
    try {
      await ensureMetaHealthConfig(tenantId);
      const result = await runMetaHealthWatchdogForTenant(tenantId, { force: false });
      results.push(result);
    } catch (err) {
      results.push({
        tenant_id: tenantId,
        status: 'critical',
        reason: 'watchdog_batch_error',
        error: compactText(err.message, 300),
      });
    }
  }

  const executed = results.filter((item) => item.status !== 'skipped');
  const critical = executed.filter((item) => item.status === 'critical').length;
  const warnings = executed.filter((item) => item.status === 'warning').length;

  return {
    checked_at: new Date().toISOString(),
    tenants_total: tenants.length,
    runs_executed: executed.length,
    critical,
    warnings,
    results,
  };
}

module.exports = {
  SUPPORTED_WEBHOOK_FIELDS,
  getMetaHealthConfig,
  updateMetaHealthConfig,
  ingestMetaWebhookPayload,
  getMetaHealthPanel,
  listMetaHealthEvents,
  getMetaHealthEventDetail,
  listMetaHealthHistory,
  listMetaHealthAlerts,
  rebuildMetaHealthState,
  runMetaHealthWatchdogForTenant,
  runMetaHealthWatchdogForDueTenants,
};
