import { useState, useEffect } from 'react';
import { Copy, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast.jsx';
import MetaHealthPanel from './MetaHealthPanel';

const DAYS = [
  { key: 'lunes', label: 'Lunes', short: 'Lun' },
  { key: 'martes', label: 'Martes', short: 'Mar' },
  { key: 'miercoles', label: 'Miércoles', short: 'Mie' },
  { key: 'jueves', label: 'Jueves', short: 'Jue' },
  { key: 'viernes', label: 'Viernes', short: 'Vie' },
  { key: 'sabado', label: 'Sábado', short: 'Sab' },
  { key: 'domingo', label: 'Domingo', short: 'Dom' },
];

const ALL_CITIES = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Beni',
  'Sucre', 'Oruro', 'Potosí', 'Tarija', 'Cobija', 'El Alto',
];

const DEFAULT_RETENTION_RULES = {
  Semanal: { risk_days: 10, lost_days: 21 },
  Quincenal: { risk_days: 21, lost_days: 35 },
  Mensual: { risk_days: 45, lost_days: 75 },
  Irregular: { risk_days: 30, lost_days: 60 },
};

function sanitizeForeignPricingProfiles(rawProfiles) {
  let parsed = rawProfiles;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const usedKeys = new Set();
  const rows = [];

  for (const row of parsed) {
    const normalizedKey = String(row?.key || row?.name || row?.label || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 40);
    const key = normalizedKey || `usd-${rows.length + 1}`;
    if (usedKeys.has(key)) continue;

    const amount = Number(row?.amount);
    const url = String(row?.url || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !url) continue;

    usedKeys.add(key);
    const stripeFeePercent = Math.max(0, Number(row?.stripe_fee_percent ?? row?.stripeFeePercent ?? 0) || 0);
    const meruFeePercent = Math.max(0, Number(row?.meru_fee_percent ?? row?.meruFeePercent ?? 0) || 0);
    const stripeFeeFixed = Math.max(0, Number(row?.stripe_fee_fixed ?? row?.stripeFeeFixed ?? 0) || 0);

    rows.push({
      key,
      name: String(row?.name || key).trim().slice(0, 80) || key,
      amount: Math.round(amount * 100) / 100,
      currency: String(row?.currency || 'USD').trim().toUpperCase() === 'BOB' ? 'BOB' : 'USD',
      stripe_fee_percent: Math.round(stripeFeePercent * 100) / 100,
      meru_fee_percent: Math.round(meruFeePercent * 100) / 100,
      stripe_fee_fixed: Math.round(stripeFeeFixed * 100) / 100,
      url,
    });
    if (rows.length >= 6) break;
  }

  return rows;
}

function generateTimeOptions() {
  const opts = [];
  for (let h = 6; h <= 22; h++) {
    opts.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 22) opts.push(`${String(h).padStart(2, '0')}:30`);
  }
  return opts;
}
const TIME_OPTIONS = generateTimeOptions();

const SETTINGS_SECTIONS = [
  {
    key: 'availability',
    label: 'Calendario',
    title: 'Disponibilidad semanal',
    description: 'Define días, bloques y reglas del calendario público sin mezclarlo con cobros o automatizaciones.',
  },
  {
    key: 'pricing',
    label: 'Aranceles',
    title: 'Aranceles y QR',
    description: 'Administra precios, ciudades, links firmados y los QR que ve el cliente cuando va a pagar.',
  },
  {
    key: 'reminders',
    label: 'Automatizaciones',
    title: 'Recordatorios WhatsApp',
    description: 'Configura recordatorios de cita, pagos pendientes y el estado runtime de los procesos internos.',
  },
  {
    key: 'operations',
    label: 'Operación',
    title: 'Parámetros generales',
    description: 'Ajusta duración, ventana de agendamiento, buffer y límites operativos de la sesión.',
  },
  {
    key: 'retention',
    label: 'Retención',
    title: 'Retención y churn',
    description: 'Mantén en un solo lugar los umbrales que alimentan estados como al día, en riesgo o perdido.',
  },
  {
    key: 'meta-health',
    label: 'Meta health',
    title: 'Meta health',
    description: 'Panel webhook-first para vigilar cuenta Meta, número, templates, endpoint, watchdog y continuidad operativa.',
  },
];

const AUTOMATED_MESSAGES = [
  {
    title: 'Recordatorio de cita',
    channel: 'WhatsApp template',
    trigger: 'Día anterior a la cita, a la hora configurada en la zona horaria del cliente.',
    source: 'recordatorionovum26',
    preview: 'Template con nombre, fecha, hora y botones: Confirmo, Reagendar, Daniel.',
  },
  {
    title: 'Respuesta al confirmar cita',
    channel: 'WhatsApp texto',
    trigger: 'Cuando el cliente pulsa el botón de confirmar del recordatorio.',
    source: 'CONFIRM_NOW',
    preview: '👏 Perfecto [nombre], te esperamos para darle un giro a tu vida...',
  },
  {
    title: 'QR de pago automático',
    channel: 'WhatsApp imagen',
    trigger: '60 segundos después de confirmar, sólo si la cita corresponde a Bolivia.',
    source: 'payment_qr_*',
    preview: 'QR de pago - Bs [monto]. Por favor sube en este mismo chat el comprobante de tu pago.',
  },
  {
    title: 'Link de reagendamiento',
    channel: 'WhatsApp texto',
    trigger: 'Cuando el cliente pulsa el botón de reagendar del recordatorio.',
    source: 'REAGEN_NOW',
    preview: '[Nombre], vamos a reprogramar tu cita. Haz clic en el enlace...',
  },
  {
    title: 'Confirmación de reagendamiento',
    channel: 'WhatsApp texto',
    trigger: 'Cuando el cliente completa un reagendamiento desde el link público.',
    source: 'public reschedule',
    preview: '✅ Perfecto [nombre], tu sesión está reprogramada para el [día] a las [hora].',
  },
  {
    title: 'Recordatorio de pago pendiente',
    channel: 'WhatsApp template',
    trigger: 'Antes de una sesión próxima con pago pendiente, según las horas configuradas.',
    source: 'recordatorio_pago',
    preview: 'Template de pago pendiente. El nombre del template se puede configurar abajo.',
  },
  {
    title: 'Comprobante validado',
    channel: 'WhatsApp texto',
    trigger: 'Cuando OCR valida automáticamente el comprobante enviado por el cliente.',
    source: 'OCR pago ok',
    preview: '✅ Pago recibido correctamente, ¡Gracias!',
  },
  {
    title: 'Comprobante con problema',
    channel: 'WhatsApp texto',
    trigger: 'Cuando OCR detecta monto, fecha o destinatario que no coincide.',
    source: 'OCR mismatch',
    preview: 'No pude validarlo automáticamente por este motivo... Por favor, revisa el comprobante.',
  },
  {
    title: 'Doble reagendamiento en recurrencia',
    channel: 'WhatsApp botones',
    trigger: 'Cuando un cliente recurrente reprograma 2 veces consecutivas la misma recurrencia.',
    source: 'recurring_reschedule_prompt',
    preview: 'Pregunta si los cambios son puntuales o si quiere revisar su día/hora fija.',
  },
  {
    title: 'Mantener recurrencia',
    channel: 'WhatsApp texto',
    trigger: 'Cuando el cliente responde Mantengo horario en la pregunta de recurrencia.',
    source: 'KEEP_RECURRING',
    preview: 'Perfecto, entonces mantenemos.',
  },
  {
    title: 'Cambiar recurrencia',
    channel: 'WhatsApp + Telegram',
    trigger: 'Cuando el cliente responde Voy a cambiar en la pregunta de recurrencia.',
    source: 'CHANGE_RECURRING',
    preview: 'Perfecto, te paso con Daniel. Además se corta la recurrencia y llega alerta interna.',
  },
  {
    title: 'Contacto con Daniel',
    channel: 'WhatsApp texto',
    trigger: 'Cuando el cliente pulsa el botón para hablar con Daniel y existe respuesta configurada.',
    source: 'DANIEL_NOW',
    preview: 'Usa el texto guardado en auto_reply_contact.',
  },
];

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function formatRuntimeDate(value) {
  if (!value) return 'Sin programar';
  try {
    return new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/La_Paz',
    }).format(new Date(value)) + ' BOT';
  } catch {
    return value;
  }
}

function formatSchedulerLabel(runtimeKey, runtime) {
  if (runtime?.label) return runtime.label;
  const labels = {
    appointmentReminder: 'Recordatorios de cita',
    paymentReminder: 'Recordatorios de pago',
    autoComplete: 'Auto completar sesiones',
    recurringSync: 'Sync de recurrencia',
  };
  return labels[runtimeKey] || runtimeKey;
}

function formatRuntimeResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.sent != null || result.skipped != null || result.failed != null) {
    return `${result.sent ?? 0} enviados, ${result.skipped ?? 0} omitidos, ${result.failed ?? 0} fallidos`;
  }
  if (result.completed != null) {
    return `${result.completed} completadas`;
  }
  if (result.created != null || result.already_exists != null || result.no_client_match != null) {
    return `${result.created ?? 0} creados, ${result.already_exists ?? 0} ya existentes, ${result.no_client_match ?? 0} sin match`;
  }
  return JSON.stringify(result);
}

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
    normalized[frequency] = { risk_days: riskDays, lost_days: lostDays };
  }
  return normalized;
}

function normalizeConfigPayload(data) {
  const hours = typeof data.available_hours === 'string'
    ? JSON.parse(data.available_hours) : (data.available_hours || {});
  const days = typeof data.available_days === 'string'
    ? JSON.parse(data.available_days) : (data.available_days || []);
  const capitalCities = (data.capital_cities || '').split(',').map(c => c.trim()).filter(Boolean);
  const foreignPricingProfiles = sanitizeForeignPricingProfiles(data.foreign_pricing_profiles);
  return {
    ...data,
    payment_reminder_template: data.payment_reminder_template || '',
    retention_risk_template: data.retention_risk_template || '',
    retention_lost_template: data.retention_lost_template || '',
    whatsapp_template_language: data.whatsapp_template_language || 'es',
    stripe_webhook_url: data.stripe_webhook_url || '',
    stripe_webhook_secret: data.stripe_webhook_secret || '',
    _availableHours: hours,
    _availableDays: days,
    _capitalCities: capitalCities,
    _retentionRules: normalizeRetentionRules(data.retention_rules),
    _foreignPricingProfiles: foreignPricingProfiles,
  };
}

// Convert individual hours array → time range blocks
function hoursToBlocks(hours) {
  if (!hours || hours.length === 0) return [];
  const sorted = [...hours].sort();
  const blocks = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prevMin = timeToMinutes(prev);
    const currMin = timeToMinutes(sorted[i]);
    if (currMin - prevMin > 60) {
      blocks.push({ start, end: minutesToTime(prevMin + 60) });
      start = sorted[i];
    }
    prev = sorted[i];
  }
  blocks.push({ start, end: minutesToTime(timeToMinutes(prev) + 60) });
  return blocks;
}

// Convert time range blocks → individual hours array
function blocksToHours(blocks, duration = 60) {
  const hours = [];
  for (const block of blocks) {
    const startMin = timeToMinutes(block.start);
    const endMin = timeToMinutes(block.end);
    for (let m = startMin; m < endMin; m += duration) {
      hours.push(minutesToTime(m));
    }
  }
  return hours;
}

export default function Config() {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast, show: showToast } = useToast();
  const [availability, setAvailability] = useState({});
  const [copyPopoverDay, setCopyPopoverDay] = useState(null);
  const [copyTo, setCopyTo] = useState({});
  const [specialFeePhone, setSpecialFeePhone] = useState('');
  const [specialFeeLinkData, setSpecialFeeLinkData] = useState(null);
  const [generatingSpecialFeeLink, setGeneratingSpecialFeeLink] = useState(false);
  const [qrPreviewVersion, setQrPreviewVersion] = useState(() => ({
    qr_300: Date.now(),
    qr_250: Date.now(),
    qr_150: Date.now(),
    qr_generico: Date.now(),
  }));
  const [qrAssetStatus, setQrAssetStatus] = useState({});

  useEffect(() => {
    api.get('/config')
      .then(data => {
        const normalized = normalizeConfigPayload(data);
        const hours = normalized._availableHours;
        const days = normalized._availableDays;

        const avail = {};
        for (const day of DAYS) {
          const dayHours = hours[day.key] || [];
          avail[day.key] = {
            enabled: days.includes(day.key),
            blocks: hoursToBlocks(dayHours),
          };
        }
        setAvailability(avail);
        setConfig(normalized);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!copyPopoverDay) return;
    function handleClickOutside(event) {
      if (!event.target.closest('[data-copy-popover-root]')) {
        setCopyPopoverDay(null);
        setCopyTo({});
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [copyPopoverDay]);

  function updateAvailability(dayKey, update) {
    setAvailability(prev => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...update },
    }));
  }

  function applyWeekdaysOnly() {
    setAvailability(prev => {
      const next = { ...prev };
      for (const day of DAYS) {
        if (day.key === 'sabado' || day.key === 'domingo') {
          next[day.key] = { ...next[day.key], enabled: false };
        }
      }
      return next;
    });
    showToast('Calendario público ajustado a lunes-viernes');
  }

  function toggleDay(dayKey, enabled) {
    const currentBlocks = availability[dayKey]?.blocks || [];
    if (enabled && currentBlocks.length === 0) {
      updateAvailability(dayKey, {
        enabled: true,
        blocks: [{ start: '08:00', end: '13:00' }, { start: '15:00', end: '20:00' }],
      });
      return;
    }
    updateAvailability(dayKey, { enabled });
  }

  function addBlock(dayKey) {
    const blocks = availability[dayKey]?.blocks || [];
    const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : '08:00';
    const startMin = timeToMinutes(lastEnd);
    const newStart = minutesToTime(Math.max(startMin, timeToMinutes('14:00')));
    const endMin = Math.min(timeToMinutes(newStart) + 240, timeToMinutes('22:00'));
    updateAvailability(dayKey, {
      blocks: [...blocks, { start: newStart, end: minutesToTime(endMin) }],
    });
  }

  function removeBlock(dayKey, idx) {
    const blocks = [...(availability[dayKey]?.blocks || [])];
    blocks.splice(idx, 1);
    updateAvailability(dayKey, { blocks });
  }

  function updateBlock(dayKey, idx, field, value) {
    const blocks = [...(availability[dayKey]?.blocks || [])];
    blocks[idx] = { ...blocks[idx], [field]: value };
    updateAvailability(dayKey, { blocks });
  }

  function clearDay(dayKey) {
    updateAvailability(dayKey, { enabled: false, blocks: [] });
    if (copyPopoverDay === dayKey) {
      setCopyPopoverDay(null);
      setCopyTo({});
    }
  }

  function openCopyPopover(dayKey) {
    setCopyPopoverDay(curr => curr === dayKey ? null : dayKey);
    setCopyTo({});
  }

  function toggleCopyTarget(dayKey, checked) {
    setCopyTo(prev => ({ ...prev, [dayKey]: checked }));
  }

  function toggleCopyAll(fromDayKey, checked) {
    const next = {};
    for (const day of DAYS) {
      if (day.key !== fromDayKey) next[day.key] = checked;
    }
    setCopyTo(next);
  }

  function handleCopy(fromDayKey) {
    const fromBlocks = availability[fromDayKey]?.blocks || [];
    const targets = Object.entries(copyTo).filter(([k, v]) => v && k !== fromDayKey).map(([k]) => k);
    if (targets.length === 0) return;

    const updated = { ...availability };
    for (const dayKey of targets) {
      updated[dayKey] = {
        ...updated[dayKey],
        blocks: JSON.parse(JSON.stringify(fromBlocks)),
        enabled: true,
      };
    }
    setAvailability(updated);
    setCopyTo({});
    setCopyPopoverDay(null);

    const names = targets.map(k => DAYS.find(d => d.key === k)?.short).join(', ');
    showToast(`Horario copiado a ${names}`);
  }

  function toggleCity(city) {
    setConfig(prev => {
      const cities = [...(prev._capitalCities || [])];
      const idx = cities.indexOf(city);
      if (idx >= 0) cities.splice(idx, 1);
      else cities.push(city);
      return { ...prev, _capitalCities: cities, capital_cities: cities.join(',') };
    });
  }

  function updateRetentionRule(frequency, field, value) {
    setConfig(prev => ({
      ...prev,
      _retentionRules: {
        ...prev._retentionRules,
        [frequency]: {
          ...prev._retentionRules[frequency],
          [field]: Math.max(1, parseInt(value, 10) || 1),
        },
      },
    }));
  }

  function buildDefaultStripeWebhookUrl() {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/api/stripe/webhook`;
  }

  function addForeignPricingProfile() {
    setConfig(prev => {
      const current = Array.isArray(prev?._foreignPricingProfiles) ? prev._foreignPricingProfiles : [];
      if (current.length >= 6) return prev;
      const nextIndex = current.length + 1;
      const baseKey = `usd-${nextIndex}`;
      return {
        ...prev,
        _foreignPricingProfiles: [
          ...current,
          {
            key: baseKey,
            name: `Monto ${nextIndex}`,
            amount: '',
            currency: 'USD',
            stripe_fee_percent: 0,
            meru_fee_percent: 0,
            stripe_fee_fixed: 0,
            url: '',
          },
        ],
      };
    });
  }

  function updateForeignPricingProfile(idx, field, value) {
    setConfig(prev => {
      const current = Array.isArray(prev?._foreignPricingProfiles) ? [...prev._foreignPricingProfiles] : [];
      if (!current[idx]) return prev;

      const next = { ...current[idx] };
      if (field === 'key') {
        next.key = String(value || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .slice(0, 40);
      } else if (field === 'amount') {
        const parsed = Number(value);
        next.amount = Number.isFinite(parsed) ? parsed : '';
      } else if (field === 'stripe_fee_percent' || field === 'meru_fee_percent' || field === 'stripe_fee_fixed') {
        const parsed = Number(value);
        next[field] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      } else if (field === 'currency') {
        next.currency = String(value || 'USD').toUpperCase() === 'BOB' ? 'BOB' : 'USD';
      } else if (field === 'name' || field === 'url') {
        next[field] = String(value || '');
      }

      current[idx] = next;
      return { ...prev, _foreignPricingProfiles: current };
    });
  }

  function removeForeignPricingProfile(idx) {
    setConfig(prev => {
      const current = Array.isArray(prev?._foreignPricingProfiles) ? [...prev._foreignPricingProfiles] : [];
      current.splice(idx, 1);
      return { ...prev, _foreignPricingProfiles: current };
    });
  }

  function updateSpecialFeePhone(value) {
    setSpecialFeePhone(value.replace(/\D/g, '').slice(0, 15));
    setSpecialFeeLinkData(null);
  }

  async function handleGenerateSpecialFeeLink() {
    if (!specialFeePhone) {
      showToast('Ingresa un teléfono para generar el link', 'error');
      return;
    }

    setGeneratingSpecialFeeLink(true);
    try {
      const data = await api.post('/config/special-fee-link', { phone: specialFeePhone });
      setSpecialFeePhone(data.phone || specialFeePhone);
      setSpecialFeeLinkData(data);
      showToast('Link firmado generado');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setGeneratingSpecialFeeLink(false);
    }
  }

  async function handleCopySpecialFeeLink() {
    if (!specialFeeLinkData?.url) return;
    try {
      await navigator.clipboard.writeText(specialFeeLinkData.url);
      showToast('Link copiado');
    } catch (err) {
      showToast('No se pudo copiar el link', 'error');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const available_hours = {};
      const available_days = [];
      const duration = config?.appointment_duration || 60;

      for (const day of DAYS) {
        const dayAvail = availability[day.key];
        if (dayAvail?.enabled) {
          available_days.push(day.key);
          available_hours[day.key] = blocksToHours(dayAvail.blocks || [], duration);
        }
      }

      await api.put('/config', {
        available_hours,
        available_days,
        window_days: config.window_days,
        buffer_hours: config.buffer_hours,
        appointment_duration: config.appointment_duration,
        min_age: config.min_age,
        max_age: config.max_age,
        capital_fee: config.capital_fee,
        default_fee: config.default_fee,
        special_fee: config.special_fee,
        foreign_pricing_profiles: sanitizeForeignPricingProfiles(config._foreignPricingProfiles),
        stripe_webhook_url: (config.stripe_webhook_url || buildDefaultStripeWebhookUrl() || '').trim(),
        stripe_webhook_secret: (config.stripe_webhook_secret || '').trim(),
        capital_cities: config._capitalCities?.join(',') || '',
        reminder_enabled: config.reminder_enabled ? 1 : 0,
        reminder_time: config.reminder_time || '18:40',
        payment_reminder_enabled: config.payment_reminder_enabled ? 1 : 0,
        payment_reminder_hours: config.payment_reminder_hours || 2,
        payment_reminder_template: config.payment_reminder_template || '',
        retention_risk_template: config.retention_risk_template || '',
        retention_lost_template: config.retention_lost_template || '',
        whatsapp_template_language: config.whatsapp_template_language || 'es',
        rate_limit_booking: config.rate_limit_booking,
        rate_limit_window: config.rate_limit_window,
        retention_rules: normalizeRetentionRules(config._retentionRules),
      });
      const updated = await api.get('/config');
      setConfig(normalizeConfigPayload(updated));
      showToast('Configuración guardada');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleQRUpload(key, file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.upload(`/config/qr/${key}`, formData);
      setQrPreviewVersion(prev => ({ ...prev, [key]: Date.now() }));
      setQrAssetStatus(prev => ({ ...prev, [key]: 'loading' }));
      showToast('QR subido');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleQRDelete(key) {
    try {
      await api.delete(`/config/qr/${key}`);
      setQrPreviewVersion(prev => ({ ...prev, [key]: Date.now() }));
      setQrAssetStatus(prev => ({ ...prev, [key]: 'loading' }));
      showToast('QR borrado');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  const enabledDaysCount = DAYS.filter(day => availability[day.key]?.enabled).length;
  const requestedSection = searchParams.get('section');
  const activeSection = SETTINGS_SECTIONS.some(section => section.key === requestedSection)
    ? requestedSection
    : SETTINGS_SECTIONS[0].key;
  const activeSectionMeta = SETTINGS_SECTIONS.find(section => section.key === activeSection) || SETTINGS_SECTIONS[0];
  const activeSectionIndex = SETTINGS_SECTIONS.findIndex(section => section.key === activeSection) + 1;
  const sectionItems = [
    { ...SETTINGS_SECTIONS[0], detail: `${enabledDaysCount} día${enabledDaysCount === 1 ? '' : 's'} activos` },
    {
      ...SETTINGS_SECTIONS[1],
      detail: `Base Bs ${config?.default_fee || 250} · especial Bs ${config?.special_fee || 150} · Stripe ${(config?._foreignPricingProfiles || []).length}/6`,
    },
    {
      ...SETTINGS_SECTIONS[2],
      detail: `${config?.reminder_enabled ? 'Citas ON' : 'Citas OFF'} · ${config?.payment_reminder_enabled ? 'Pagos ON' : 'Pagos OFF'}`,
    },
    { ...SETTINGS_SECTIONS[3], detail: `${config?.appointment_duration || 60} min por sesión` },
    {
      ...SETTINGS_SECTIONS[4],
      detail: `Semanal en riesgo desde ${config?._retentionRules?.Semanal?.risk_days || DEFAULT_RETENTION_RULES.Semanal.risk_days} días`,
    },
    {
      ...SETTINGS_SECTIONS[5],
      detail: 'Estado Meta, webhook y watchdog',
    },
  ];
  const sidebarSubItems = sectionItems.map(section => ({
    label: section.label,
    to: `/admin/config?section=${section.key}`,
    active: section.key === activeSection,
  }));

  function renderActiveSection() {
    switch (activeSection) {
      case 'availability':
        return (
          <div className="bg-white rounded-[28px] p-6 lg:p-8 shadow-[0_18px_40px_rgba(15,23,42,0.06)] border border-slate-200">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-slate-950 mb-1">Disponibilidad semanal</h3>
                <p className="text-sm text-slate-500">Configura tus bloques por día y copia horarios sin abrir paneles extra.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={applyWeekdaysOnly}
                  className="px-3.5 py-2 rounded-xl bg-[#D9E48B] text-slate-900 text-sm font-medium hover:bg-[#cdd97d] transition-colors"
                >
                  Solo lunes a viernes
                </button>
                <span className="text-xs text-slate-400">El calendario público seguirá exactamente estos días.</span>
              </div>
            </div>

            <div className="space-y-2.5">
              {DAYS.map(day => {
                const dayAvail = availability[day.key] || { enabled: false, blocks: [] };
                const blockCount = dayAvail.blocks?.length || 0;
                const allTargetsSelected = DAYS.filter(d => d.key !== day.key).every(d => copyTo[d.key]);

                return (
                  <div
                    key={day.key}
                    className={`rounded-[24px] border transition-all relative ${
                      copyPopoverDay === day.key ? 'z-40' : 'z-0'
                    } ${
                      dayAvail.enabled
                        ? 'border-[#CFE8E9] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.04)]'
                        : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    <div className="flex flex-col gap-2.5 p-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-center gap-3 min-w-[156px]">
                        <button
                          type="button"
                          onClick={() => toggleDay(day.key, !dayAvail.enabled)}
                          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                            dayAvail.enabled ? 'bg-[#618BBF]' : 'bg-slate-200'
                          }`}
                          aria-pressed={dayAvail.enabled}
                        >
                          <span
                            className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-[0_6px_18px_rgba(15,23,42,0.18)] transition-transform ${
                              dayAvail.enabled ? 'translate-x-7' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <div>
                          <div className="text-[19px] leading-none font-medium tracking-tight text-slate-800">{day.label}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {dayAvail.enabled ? `${blockCount} bloque${blockCount !== 1 ? 's' : ''}` : 'No disponible'}
                          </div>
                        </div>
                      </div>

                      <div className="flex-1">
                        {dayAvail.enabled ? (
                          <div className="space-y-2">
                            {dayAvail.blocks.map((block, idx) => (
                              <div key={idx} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                                <select
                                  value={block.start}
                                  onChange={e => updateBlock(day.key, idx, 'start', e.target.value)}
                                  className="min-w-[96px] rounded-[16px] border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-semibold tracking-tight text-slate-800 shadow-[0_6px_14px_rgba(15,23,42,0.05)] outline-none transition focus:border-[#618BBF] focus:ring-2 focus:ring-[#CFE8E9]"
                                >
                                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <span className="hidden sm:inline text-base text-slate-400 px-1">-</span>
                                <select
                                  value={block.end}
                                  onChange={e => updateBlock(day.key, idx, 'end', e.target.value)}
                                  className="min-w-[96px] rounded-[16px] border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-semibold tracking-tight text-slate-800 shadow-[0_6px_14px_rgba(15,23,42,0.05)] outline-none transition focus:border-[#618BBF] focus:ring-2 focus:ring-[#CFE8E9]"
                                >
                                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => removeBlock(day.key, idx)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-[14px] border border-slate-200 bg-white text-slate-400 transition hover:border-red-200 hover:text-red-500"
                                  title="Eliminar bloque"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-full min-h-[72px] items-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 text-sm text-slate-400">
                            Activa este día para definir tus horas disponibles.
                          </div>
                        )}
                      </div>

                      <div className="flex items-start gap-1.5" data-copy-popover-root>
                        <button
                          type="button"
                          onClick={() => dayAvail.enabled && addBlock(day.key)}
                          disabled={!dayAvail.enabled}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[14px] border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Agregar bloque"
                        >
                          <Plus size={15} />
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            data-copy-trigger
                            onClick={() => dayAvail.enabled && openCopyPopover(day.key)}
                            disabled={!dayAvail.enabled}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-[14px] border transition ${
                              copyPopoverDay === day.key
                                ? 'border-[#618BBF] bg-[#CFE8E9] text-slate-900 shadow-[0_10px_24px_rgba(97,139,191,0.24)]'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                            title="Copiar horarios"
                          >
                            <Copy size={14} />
                          </button>

                          {copyPopoverDay === day.key && dayAvail.enabled && (
                            <div
                              data-copy-popover
                              className="copy-schedule-popover absolute right-0 top-[calc(100%+12px)] z-50 w-[320px] rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.16)]"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 mb-2">Copiar horarios a</div>
                              <label className="flex items-center gap-3 py-2 text-base text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={allTargetsSelected}
                                  onChange={e => toggleCopyAll(day.key, e.target.checked)}
                                  className="h-5 w-5 rounded border-slate-300 accent-[#4E769B]"
                                />
                                Seleccionar todo
                              </label>
                              <div className="mt-2 space-y-2 border-t border-slate-100 pt-3">
                                <label className="flex items-center gap-3 py-2 text-base text-slate-400">
                                  <input type="checkbox" checked readOnly className="h-5 w-5 rounded border-slate-300 accent-[#4E769B]" />
                                  {day.label}
                                </label>
                                {DAYS.filter(d => d.key !== day.key).map(targetDay => (
                                  <label key={targetDay.key} className="flex items-center gap-3 py-2 text-base text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={copyTo[targetDay.key] || false}
                                      onChange={e => toggleCopyTarget(targetDay.key, e.target.checked)}
                                      className="h-5 w-5 rounded border-slate-300 accent-[#4E769B]"
                                    />
                                    {targetDay.label}
                                  </label>
                                ))}
                              </div>
                              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                                <button
                                  type="button"
                                  onClick={() => { setCopyPopoverDay(null); setCopyTo({}); }}
                                  className="px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-900"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(day.key)}
                                  disabled={!Object.values(copyTo).some(Boolean)}
                                  className="rounded-2xl bg-[#4E769B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#618BBF] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Aplicar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => clearDay(day.key)}
                          disabled={!dayAvail.enabled && blockCount === 0}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[14px] border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Borrar configuración del día"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'pricing':
        return (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-lg font-semibold mb-1">Aranceles</h3>
              <p className="text-sm text-gray-400 mb-5">Capital/provincia/especial en Bs y perfiles extranjeros con monto + URL Stripe asignables por cliente.</p>

              <div className="space-y-4">
                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-medium text-sm">Capital</div>
                      <div className="text-xs text-gray-400">Ciudades del eje troncal</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-gray-400">Bs</span>
                      <input
                        type="number"
                        value={config?.capital_fee || ''}
                        onChange={e => setConfig(c => ({ ...c, capital_fee: parseFloat(e.target.value) }))}
                        className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mb-2">Ciudades que aplican:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_CITIES.map(city => {
                      const selected = (config?._capitalCities || []).includes(city);
                      return (
                        <button
                          key={city}
                          type="button"
                          onClick={() => toggleCity(city)}
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[13px] transition-all ${
                            selected
                              ? 'bg-[#D9E48B] text-slate-900'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {city}
                          {selected && <span className="text-[11px] ml-0.5 opacity-70">x</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">Provincia</div>
                      <div className="text-xs text-gray-400">Resto de Bolivia (se asigna automáticamente)</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-gray-400">Bs</span>
                      <input
                        type="number"
                        value={config?.default_fee || ''}
                        onChange={e => setConfig(c => ({ ...c, default_fee: parseFloat(e.target.value) }))}
                        className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">Precio especial</div>
                      <div className="text-xs text-gray-400">Asignación manual por cliente</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-gray-400">Bs</span>
                      <input
                        type="number"
                        value={config?.special_fee || ''}
                        onChange={e => setConfig(c => ({ ...c, special_fee: parseFloat(e.target.value) }))}
                        className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                      />
                    </div>
                  </div>
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Teléfono del cliente</label>
                        <input
                          type="tel"
                          value={specialFeePhone}
                          onChange={e => updateSpecialFeePhone(e.target.value)}
                          placeholder="59172034151"
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                        />
                      </div>
                      <div className="lg:w-[180px]">
                        <label className="block text-xs text-gray-500 mb-1">Modo</label>
                        <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-700">
                          Precio especial
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleGenerateSpecialFeeLink}
                        disabled={!specialFeePhone || generatingSpecialFeeLink}
                        className="rounded-xl bg-[#4E769B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#618BBF] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {generatingSpecialFeeLink ? 'Generando...' : 'Generar link'}
                      </button>
                    </div>

                    <p className="mt-3 text-xs text-gray-500">
                      Firmado significa que el link queda amarrado a este teléfono y al modo <span className="font-medium">precio especial</span>. Si alguien edita la URL a mano, el server lo rechaza.
                    </p>

                    {specialFeeLinkData?.url ? (
                      <div className="mt-4 rounded-xl border border-[#D9E48B] bg-[#F8FBE8] p-4">
                        <div className="text-xs text-gray-500 mb-2">
                          Aplica <span className="font-medium">Bs {specialFeeLinkData.fee_amount ?? config?.special_fee ?? ''}</span> y vence en {specialFeeLinkData.expires_in}.
                        </div>
                        <div className="flex flex-col gap-2 lg:flex-row">
                          <input
                            type="text"
                            readOnly
                            value={specialFeeLinkData.url}
                            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-700"
                          />
                          <button
                            type="button"
                            onClick={handleCopySpecialFeeLink}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                          >
                            <Copy size={14} />
                            Copiar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="font-medium text-sm">Webhook Stripe</div>
                      <div className="text-xs text-gray-400">URL para registrar en Stripe y capturar pagos confirmados automáticamente.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfig(c => ({ ...c, stripe_webhook_url: buildDefaultStripeWebhookUrl() }))}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Usar URL actual
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <input
                      type="text"
                      value={config?.stripe_webhook_url || ''}
                      onChange={e => setConfig(c => ({ ...c, stripe_webhook_url: e.target.value }))}
                      placeholder={buildDefaultStripeWebhookUrl() || 'https://tu-dominio.com/api/stripe/webhook'}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const webhookUrl = (config?.stripe_webhook_url || buildDefaultStripeWebhookUrl() || '').trim();
                        if (!webhookUrl) return;
                        try {
                          await navigator.clipboard.writeText(webhookUrl);
                          showToast('Webhook Stripe copiado');
                        } catch {
                          showToast('No se pudo copiar el webhook', 'error');
                        }
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      <Copy size={14} />
                      Copiar
                    </button>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs text-gray-500 mb-1">Signing secret de Stripe</label>
                    <input
                      type="password"
                      value={config?.stripe_webhook_secret || ''}
                      onChange={e => setConfig(c => ({ ...c, stripe_webhook_secret: e.target.value }))}
                      placeholder="whsec_..."
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="font-medium text-sm">Montos a cobrar Extranjeros</div>
                      <div className="text-xs text-gray-400">Hasta 6 perfiles con monto + URL Stripe. El monto contable se calcula restando % Stripe, % Meru y cargo fijo Stripe.</div>
                    </div>
                    <button
                      type="button"
                      onClick={addForeignPricingProfile}
                      disabled={(config?._foreignPricingProfiles || []).length >= 6}
                      className="rounded-xl bg-[#4E769B] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#618BBF] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Agregar monto
                    </button>
                  </div>

                  {(config?._foreignPricingProfiles || []).length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      Aún no hay montos extranjeros configurados.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {(config?._foreignPricingProfiles || []).map((profile, idx) => (
                        <div key={`${profile.key || 'profile'}-${idx}`} className="rounded-xl border border-gray-200 bg-slate-50/50 p-3">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 2xl:grid-cols-12">
                            <div className="min-w-0 2xl:col-span-2">
                              <label className="mb-1 block text-xs text-gray-500">Tipo / clave</label>
                              <input
                                type="text"
                                value={profile.key || ''}
                                onChange={e => updateForeignPricingProfile(idx, 'key', e.target.value)}
                                placeholder="22us"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="min-w-0 2xl:col-span-2">
                              <label className="mb-1 block text-xs text-gray-500">Nombre</label>
                              <input
                                type="text"
                                value={profile.name || ''}
                                onChange={e => updateForeignPricingProfile(idx, 'name', e.target.value)}
                                placeholder="Monto 22 USD"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="min-w-0 sm:col-span-2 lg:col-span-2 2xl:col-span-3">
                              <label className="mb-1 block text-xs text-gray-500">Monto</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={profile.amount}
                                  onChange={e => updateForeignPricingProfile(idx, 'amount', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right"
                                />
                                <select
                                  value={profile.currency || 'USD'}
                                  onChange={e => updateForeignPricingProfile(idx, 'currency', e.target.value)}
                                  className="min-w-[88px] px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white"
                                >
                                  <option value="USD">USD</option>
                                  <option value="BOB">BOB</option>
                                </select>
                              </div>
                            </div>
                            <div className="min-w-0 2xl:col-span-1">
                              <label className="mb-1 block text-xs text-gray-500">% Stripe</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={profile.stripe_fee_percent ?? 0}
                                onChange={e => updateForeignPricingProfile(idx, 'stripe_fee_percent', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right"
                              />
                            </div>
                            <div className="min-w-0 2xl:col-span-1">
                              <label className="mb-1 block text-xs text-gray-500">% Meru</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={profile.meru_fee_percent ?? 0}
                                onChange={e => updateForeignPricingProfile(idx, 'meru_fee_percent', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right"
                              />
                            </div>
                            <div className="min-w-0 lg:col-span-2 2xl:col-span-2">
                              <label className="mb-1 block text-xs text-gray-500">Cargo fijo Stripe</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={profile.stripe_fee_fixed ?? 0}
                                onChange={e => updateForeignPricingProfile(idx, 'stripe_fee_fixed', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right"
                              />
                            </div>
                            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1 2xl:col-span-1">
                              <button
                                type="button"
                                onClick={() => removeForeignPricingProfile(idx)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-500 hover:bg-red-50"
                                title="Eliminar perfil"
                              >
                                <Trash2 size={14} />
                              </button>
                              {profile.url ? (
                                <a
                                  href={profile.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
                                  title="Abrir URL"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-3">
                            <label className="block text-xs text-gray-500 mb-1">URL Stripe</label>
                            <input
                              type="url"
                              value={profile.url || ''}
                              onChange={e => updateForeignPricingProfile(idx, 'url', e.target.value)}
                              placeholder="https://buy.stripe.com/..."
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="mt-2 text-[11px] text-gray-500">
                            Neto contable estimado: {profile.currency || 'USD'}{' '}
                            {(() => {
                              const amount = Number(profile.amount || 0);
                              const stripePct = Number(profile.stripe_fee_percent || 0);
                              const meruPct = Number(profile.meru_fee_percent || 0);
                              const stripeFixed = Number(profile.stripe_fee_fixed || 0);
                              const net = Math.max(0, amount - (amount * stripePct / 100) - (amount * meruPct / 100) - stripeFixed);
                              return net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-lg font-semibold mb-1">QR de pago</h3>
              <p className="text-sm text-gray-400 mb-5">Sube QR para cada categoría de arancel.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'qr_300', label: 'Capital' },
                  { key: 'qr_250', label: 'Provincia' },
                  { key: 'qr_150', label: 'Especial' },
                  { key: 'qr_generico', label: 'Genérico' },
                ].map(qr => (
                  <div key={qr.key} className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">{qr.label}</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => { if (e.target.files[0]) handleQRUpload(qr.key, e.target.files[0]); }}
                      className="text-xs"
                    />
                    <div className="mt-3 flex items-start gap-3">
                      <div className="flex h-24 w-24 items-center justify-center rounded border bg-white">
                        {qrAssetStatus[qr.key] === 'missing' ? (
                          <span className="px-2 text-center text-[11px] text-gray-400">Sin QR</span>
                        ) : null}
                        <img
                          key={`${qr.key}-${qrPreviewVersion[qr.key] || 0}`}
                          src={`/api/config/qr/${qr.key}?v=${qrPreviewVersion[qr.key] || 0}`}
                          alt={`QR ${qr.label}`}
                          className={`h-24 w-24 object-contain ${qrAssetStatus[qr.key] === 'missing' ? 'hidden' : ''}`}
                          onLoad={() => setQrAssetStatus(prev => ({ ...prev, [qr.key]: 'ready' }))}
                          onError={() => setQrAssetStatus(prev => ({ ...prev, [qr.key]: 'missing' }))}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleQRDelete(qr.key)}
                        className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Borrar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'reminders':
        return (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold mb-1">Recordatorios WhatsApp</h3>
            <p className="text-sm text-gray-400 mb-5">Automatizaciones internas de la app. No aparecen en Cron Jobs de Hostinger porque viven dentro del servidor Node.</p>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Recordatorio de cita</div>
                <div className="text-xs text-gray-400">Se envían diariamente a la hora configurada para las citas del día siguiente</div>
              </div>
              <button
                type="button"
                onClick={() => setConfig(c => ({ ...c, reminder_enabled: c.reminder_enabled ? 0 : 1 }))}
                className={`relative w-12 h-7 rounded-full transition-colors ${config?.reminder_enabled ? 'bg-[#4E769B]' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${config?.reminder_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {config?.reminder_enabled ? (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <label className="block text-xs text-gray-500 mb-1">Hora de envío (Bolivia)</label>
                <select
                  value={config?.reminder_time || '18:40'}
                  onChange={e => setConfig(c => ({ ...c, reminder_time: e.target.value }))}
                  className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  {Array.from({ length: 15 }, (_, i) => {
                    const h = i + 8;
                    return [
                      <option key={`${h}:00`} value={`${String(h).padStart(2, '0')}:00`}>{String(h).padStart(2, '0')}:00</option>,
                      <option key={`${h}:30`} value={`${String(h).padStart(2, '0')}:30`}>{String(h).padStart(2, '0')}:30</option>,
                    ];
                  }).flat().filter(o => {
                    const v = o.props.value;
                    const [hh] = v.split(':').map(Number);
                    return hh <= 22;
                  })}
                </select>
              </div>
            ) : null}

            <div className="mt-6 pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Recordatorio de pago pendiente</div>
                  <div className="text-xs text-gray-400">Busca sesiones próximas con pago pendiente y manda WhatsApp antes de la cita.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfig(c => ({ ...c, payment_reminder_enabled: c.payment_reminder_enabled ? 0 : 1 }))}
                  className={`relative w-12 h-7 rounded-full transition-colors ${config?.payment_reminder_enabled ? 'bg-[#4E769B]' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${config?.payment_reminder_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Enviar antes de la sesión</label>
                  <select
                    value={config?.payment_reminder_hours || 2}
                    onChange={e => setConfig(c => ({ ...c, payment_reminder_hours: parseInt(e.target.value, 10) }))}
                    disabled={!config?.payment_reminder_enabled}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value={1}>1 hora antes</option>
                    <option value={2}>2 horas antes</option>
                    <option value={3}>3 horas antes</option>
                    <option value={6}>6 horas antes</option>
                    <option value={12}>12 horas antes</option>
                  </select>
                </div>
                <div className="rounded-xl border border-[#CFE8E9] bg-[#eef7f7] px-4 py-3 text-sm text-[#365673]">
                  Requiere template aprobado en Meta. Lo eliges aquí en el panel; si lo dejas vacío, el servidor usa el fallback <code>WA_PAYMENT_REMINDER_TEMPLATE</code>, que ahora apunta a <code>recordatorio_pago</code>.
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Template de pago pendiente</label>
                  <input
                    type="text"
                    value={config?.payment_reminder_template || ''}
                    onChange={e => setConfig(c => ({ ...c, payment_reminder_template: e.target.value }))}
                    disabled={!config?.payment_reminder_enabled}
                    placeholder="recordatorio_pago"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Código de idioma Meta</label>
                  <input
                    type="text"
                    value={config?.whatsapp_template_language || 'es'}
                    onChange={e => setConfig(c => ({ ...c, whatsapp_template_language: e.target.value }))}
                    placeholder="es"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                  />
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">Reservado para futuras automatizaciones</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Template para clientes en riesgo</label>
                    <input
                      type="text"
                      value={config?.retention_risk_template || ''}
                      onChange={e => setConfig(c => ({ ...c, retention_risk_template: e.target.value }))}
                      placeholder="seguimiento_en_riesgo"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Template para clientes perdidos</label>
                    <input
                      type="text"
                      value={config?.retention_lost_template || ''}
                      onChange={e => setConfig(c => ({ ...c, retention_lost_template: e.target.value }))}
                      placeholder="seguimiento_perdido"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-400">
                  Estos nombres se guardan ya en configuración para que, cuando actives automatizaciones de retención, no queden hardcodeados.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Estado runtime</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    {Object.entries(config?._runtime?.schedulers || {}).map(([runtimeKey, runtime]) => {
                      const enabled = runtime?.enabled;
                      const statusLabel = enabled === false ? 'Pausado' : enabled === null || enabled === undefined ? 'Iniciando' : 'Activo';
                      const statusClass = enabled === false
                        ? 'bg-gray-200 text-gray-600'
                        : enabled === null || enabled === undefined
                          ? 'bg-[#CFE8E9] text-[#4E769B]'
                          : 'bg-[#D9E48B] text-slate-900';
                      return (
                        <div key={runtimeKey} className="rounded-xl border border-gray-200 p-4 bg-white">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="font-medium text-sm">{formatSchedulerLabel(runtimeKey, runtime)}</div>
                            <span className={`text-[11px] px-2 py-1 rounded-full ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">
                            Cada {runtime?.intervalMinutes || '—'} min
                          </div>
                          <div className="text-xs text-gray-500">Próxima corrida: {formatRuntimeDate(runtime?.nextRunAt)}</div>
                          <div className="text-xs text-gray-500 mt-1">Última corrida: {formatRuntimeDate(runtime?.lastRunAt)}</div>
                          {runtime?.lastResult ? (
                            <div className="text-xs text-gray-500 mt-2">
                              Último resultado: {formatRuntimeResult(runtime.lastResult)}
                            </div>
                          ) : null}
                          {runtime?.lastError ? (
                            <div className="text-xs text-red-500 mt-2 line-clamp-2">{runtime.lastError}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Inventario de mensajes</div>
                      <h4 className="text-base font-semibold text-slate-900">Mensajes automatizados activos en la app</h4>
                    </div>
                    <div className="text-xs text-gray-400">{AUTOMATED_MESSAGES.length} automatizaciones documentadas</div>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    Esta lista es descriptiva: sirve para saber qué puede enviar la app, qué lo dispara y qué texto aproximado recibe el cliente.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {AUTOMATED_MESSAGES.map((message) => (
                    <div key={message.title} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_180px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-sm text-slate-900">{message.title}</div>
                          <span className="rounded-full bg-[#CFE8E9] px-2 py-0.5 text-[11px] font-medium text-[#365673]">
                            {message.channel}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">{message.trigger}</div>
                        <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                          {message.preview}
                        </div>
                      </div>
                      <div className="flex items-start lg:justify-end">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-gray-500">
                          <div className="mb-0.5 uppercase tracking-wide text-gray-400">Origen</div>
                          <code className="text-slate-700">{message.source}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case 'operations':
        return (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-lg font-semibold mb-1">Parámetros generales</h3>
              <p className="text-sm text-gray-400 mb-5">Configuración de la sesión y ventana de agendamiento.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Duración de sesión</label>
                  <select
                    value={config?.appointment_duration || 60}
                    onChange={e => setConfig(c => ({ ...c, appointment_duration: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                  >
                    <option value={45}>45 min</option>
                    <option value={60}>60 min</option>
                    <option value={90}>90 min</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Ventana de agendamiento</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={config?.window_days || 10}
                      onChange={e => setConfig(c => ({ ...c, window_days: parseInt(e.target.value) || 10 }))}
                      className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                    <span className="text-sm text-gray-400">días</span>
                  </div>
                </div>
                <div className="md:col-span-2 flex flex-col gap-3 lg:flex-row">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Buffer mínimo</label>
                    <select
                      value={config?.buffer_hours || 3}
                      onChange={e => setConfig(c => ({ ...c, buffer_hours: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                    >
                      <option value={1}>1 hora</option>
                      <option value={2}>2 horas</option>
                      <option value={3}>3 horas</option>
                      <option value={6}>6 horas</option>
                      <option value={24}>24 horas</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Edad mínima</label>
                    <input
                      type="number"
                      value={config?.min_age || 12}
                      onChange={e => setConfig(c => ({ ...c, min_age: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Edad máxima</label>
                    <input
                      type="number"
                      value={config?.max_age || 100}
                      onChange={e => setConfig(c => ({ ...c, max_age: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-lg font-semibold mb-1">Límite público de intentos</h3>
              <p className="text-sm text-gray-400 mb-5">Controla cuántas verificaciones o reprogramaciones públicas puede intentar una misma IP antes del bloqueo temporal.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Intentos permitidos</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={config?.rate_limit_booking || 6}
                      onChange={e => setConfig(c => ({ ...c, rate_limit_booking: parseInt(e.target.value, 10) || 6 }))}
                      className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                    <span className="text-sm text-gray-400">por IP</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tiempo de bloqueo</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={config?.rate_limit_window || 15}
                      onChange={e => setConfig(c => ({ ...c, rate_limit_window: parseInt(e.target.value, 10) || 15 }))}
                      className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                    />
                    <span className="text-sm text-gray-400">minutos</span>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs text-gray-400">
                Esto afecta la verificación del teléfono antes de reservar y la reagenda pública. Si haces muchas pruebas desde la misma red, conviene subirlo temporalmente.
              </p>
            </div>
          </div>
        );

      case 'retention':
        return (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold mb-1">Retención y churn</h3>
            <p className="text-sm text-gray-400 mb-5">Estos rangos se usan cuando el cliente no tiene próxima cita agendada. Sirven para marcar quién está al día, en riesgo o perdido según su frecuencia.</p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 text-left font-medium">Frecuencia</th>
                    <th className="py-2 text-left font-medium">En riesgo desde</th>
                    <th className="py-2 text-left font-medium">Perdido desde</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(config?._retentionRules || DEFAULT_RETENTION_RULES).map(([frequency, rules]) => (
                    <tr key={frequency} className="border-b border-gray-50 last:border-b-0">
                      <td className="py-3 font-medium text-slate-700">{frequency}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={rules.risk_days}
                            onChange={e => updateRetentionRule(frequency, 'risk_days', e.target.value)}
                            className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                          />
                          <span className="text-gray-400">días</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={2}
                            value={rules.lost_days}
                            onChange={e => updateRetentionRule(frequency, 'lost_days', e.target.value)}
                            className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                          />
                          <span className="text-gray-400">días</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'meta-health':
        return <MetaHealthPanel />;

      default:
        return null;
    }
  }

  if (loading) {
    return <AdminLayout title="Configuración"><div className="text-gray-400">Cargando...</div></AdminLayout>;
  }

  return (
    <AdminLayout title="Configuración" sidebarSubItems={sidebarSubItems}>
      <Toast toast={toast} />
      <div className="max-w-6xl space-y-6 pb-28">
        <div className="space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Sección {activeSectionIndex} de {SETTINGS_SECTIONS.length}
            </div>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-slate-950">{activeSectionMeta.title}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{activeSectionMeta.description}</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
                {sectionItems.find(section => section.key === activeSection)?.detail}
              </div>
            </div>
          </div>

          {renderActiveSection()}
        </div>

        {activeSection !== 'meta-health' ? (
          <div className="fixed bottom-4 left-0 right-0 z-20 px-4 lg:left-64 lg:px-6">
            <div className="rounded-[24px] border border-slate-200 bg-white/95 px-4 py-4 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Guardar cambios</div>
                  <p className="text-sm text-slate-500">
                    Sección actual: {activeSectionMeta.label}. Los cambios no se guardan automáticamente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full rounded-xl bg-[#4E769B] px-6 py-3 text-white font-semibold transition-colors hover:bg-[#618BBF] disabled:opacity-40 lg:w-auto"
                >
                  {saving ? 'Guardando...' : 'Guardar configuración'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
