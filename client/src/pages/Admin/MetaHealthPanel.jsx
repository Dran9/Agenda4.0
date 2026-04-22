import { useEffect, useState } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  Save,
  LoaderCircle,
} from 'lucide-react';
import { api } from '../../utils/api';
import { Toast, useToast } from '../../hooks/useToast.jsx';

const HEALTH_LABELS = {
  green: 'Verde',
  yellow: 'Amarillo',
  red: 'Rojo',
  gray: 'Sin datos',
};

const HEALTH_CLASSES = {
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-700 border-amber-200',
  red: 'bg-red-100 text-red-700 border-red-200',
  gray: 'bg-slate-100 text-slate-500 border-slate-200',
};

const TEMPLATE_STATUS_CLASSES = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  missing: 'bg-amber-100 text-amber-700 border-amber-200',
};

const TEMPLATE_SOURCE_LABELS = {
  app_default: 'Default app',
  env_override: 'Env',
  tenant_config: 'Config tenant',
  not_configured: 'Sin configurar',
};

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/La_Paz',
  }).format(date) + ' BOT';
}

function formatGlobalStatus(status) {
  if (status === 'green') return 'Sano';
  if (status === 'yellow') return 'Con advertencias';
  if (status === 'red') return 'Crítico';
  return 'Sin señal';
}

function formatTemplateSource(source) {
  return TEMPLATE_SOURCE_LABELS[source] || source || '—';
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div>
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {hint ? <div className="text-xs text-slate-500 mt-0.5">{hint}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 rounded-full transition-colors ${checked ? 'bg-[#4E769B]' : 'bg-slate-300'}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export default function MetaHealthPanel() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [panel, setPanel] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const { toast, show: showToast } = useToast();

  async function loadPanel() {
    const data = await api.get('/meta-health');
    setPanel(data);
    setConfigDraft(data.config || null);
  }

  async function bootstrap() {
    setLoading(true);
    try {
      await loadPanel();
    } catch (err) {
      showToast(`No se pudo cargar Meta health: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.post('/meta-health/refresh', { run_watchdog: true });
      await loadPanel();
      showToast('Meta health refrescado');
    } catch (err) {
      showToast(`No se pudo refrescar: ${err.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function saveConfig() {
    if (!configDraft) return;

    setSavingConfig(true);
    try {
      await api.put('/meta-health/config', configDraft);
      await loadPanel();
      showToast('Configuración de Meta health guardada');
    } catch (err) {
      showToast(`No se pudo guardar configuración: ${err.message}`, 'error');
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
        Cargando Meta health...
      </div>
    );
  }

  const summary = panel?.summary || {};
  const cards = panel?.cards || [];
  const recommendations = panel?.recommendations || [];
  const globalClass = HEALTH_CLASSES[summary.global_status] || HEALTH_CLASSES.gray;

  return (
    <div className="space-y-6">
      <Toast toast={toast} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${globalClass}`}>
                {formatGlobalStatus(summary.global_status)} ({HEALTH_LABELS[summary.global_status] || 'Sin datos'})
              </span>
              <span className="text-xs text-slate-500">Último refresco: {formatDateTime(summary.refreshed_at)}</span>
            </div>
            <h3 className="text-xl font-semibold text-slate-900">Resumen operativo Meta health</h3>
            <p className="text-sm text-slate-600 max-w-3xl">{summary.global_reason || 'Sin resumen disponible.'}</p>
            <div className="grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                Último webhook: <span className="font-medium text-slate-700">{formatDateTime(summary.last_webhook_received_at)}</span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                Último evento crítico: <span className="font-medium text-slate-700">{formatDateTime(summary.last_critical_event_at)}</span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                Último watchdog: <span className="font-medium text-slate-700">{formatDateTime(summary.last_watchdog_run_at)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {refreshing ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refrescar vista
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-slate-700">
          <ShieldCheck size={16} />
          <h4 className="text-sm font-semibold uppercase tracking-[0.12em]">Tarjetas de estado</h4>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const cardClass = HEALTH_CLASSES[card.status] || HEALTH_CLASSES.gray;
            return (
              <article key={card.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-sm font-semibold text-slate-900">{card.title}</h5>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase ${cardClass}`}>
                    {HEALTH_LABELS[card.status] || 'Sin datos'}
                  </span>
                </div>
                <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                  <div>
                    Estado actual: <span className="font-medium text-slate-800">{card.current_state || 'unknown'}</span>
                  </div>
                  <div>
                    Último cambio: <span className="font-medium text-slate-800">{card.last_change || '—'}</span>
                  </div>
                  <div>
                    Fecha/hora: <span className="font-medium text-slate-800">{formatDateTime(card.date_time)}</span>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-600">{card.explanation || 'Sin explicación disponible.'}</p>
                {card.action_recommended ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Acción recomendada: {card.action_recommended}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700 mb-3">
          <AlertTriangle size={16} />
          <h4 className="text-sm font-semibold uppercase tracking-[0.12em]">Qué revisar ahora</h4>
        </div>
        <div className="space-y-2">
          {recommendations.map((item, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {item}
            </div>
          ))}
        </div>
        {configDraft?.coexistence_enabled ? (
          <div className="mt-3 rounded-lg border border-[#CFE8E9] bg-[#eef7f7] px-3 py-2 text-xs text-[#365673]">
            Coexistence activo: este panel usa `smb_message_echoes` cuando está disponible y no depende de `message_echoes`.
          </div>
        ) : null}
      </section>

      {configDraft ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">Configuración Meta health</h4>
              <p className="text-xs text-slate-500 mt-1">Webhook-first, watchdog-second. Ajusta monitoreo, umbrales y alertado por Telegram.</p>
            </div>
            <button
              type="button"
              onClick={saveConfig}
              disabled={savingConfig}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4E769B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#618BBF] disabled:opacity-50"
            >
              {savingConfig ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
              Guardar configuración
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Toggle
              checked={!!configDraft.monitoring_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, monitoring_enabled: value }))}
              label="Monitoreo activo"
              hint="Activa/desactiva Meta health para este tenant"
            />
            <Toggle
              checked={!!configDraft.coexistence_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, coexistence_enabled: value }))}
              label="Tenant usa coexistence"
              hint="Bot y operador humano comparten número"
            />
            <Toggle
              checked={!!configDraft.smb_message_echoes_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, smb_message_echoes_enabled: value }))}
              label="smb_message_echoes habilitado"
              hint="Señal recomendada para coexistence"
            />
            <Toggle
              checked={!!configDraft.flows_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, flows_enabled: value }))}
              label="Soporte de Flows"
              hint="Actívalo solo si usas Flows"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="text-xs text-slate-600">
              Watchdog (min)
              <input
                type="number"
                min={60}
                max={1440}
                value={configDraft.watchdog_interval_minutes || 60}
                onChange={(e) => setConfigDraft((prev) => ({ ...prev, watchdog_interval_minutes: Number(e.target.value) || 60 }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Umbral silencio warning (min)
              <input
                type="number"
                min={15}
                max={10080}
                value={configDraft.silence_warning_minutes || 180}
                onChange={(e) => setConfigDraft((prev) => ({ ...prev, silence_warning_minutes: Number(e.target.value) || 180 }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Umbral silencio crítico (min)
              <input
                type="number"
                min={30}
                max={20160}
                value={configDraft.silence_critical_minutes || 480}
                onChange={(e) => setConfigDraft((prev) => ({ ...prev, silence_critical_minutes: Number(e.target.value) || 480 }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Cool-down alertas (min)
              <input
                type="number"
                min={1}
                max={1440}
                value={configDraft.alert_cooldown_minutes || 30}
                onChange={(e) => setConfigDraft((prev) => ({ ...prev, alert_cooldown_minutes: Number(e.target.value) || 30 }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-600">
              phone_number_id monitoreado
              <input
                type="text"
                value={configDraft.monitored_phone_number_id || ''}
                onChange={(e) => setConfigDraft((prev) => ({ ...prev, monitored_phone_number_id: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              waba_id monitoreado
              <input
                type="text"
                value={configDraft.monitored_waba_id || ''}
                onChange={(e) => setConfigDraft((prev) => ({ ...prev, monitored_waba_id: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Toggle
              checked={!!configDraft.alert_info_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, alert_info_enabled: value }))}
              label="Alertar severidad Info"
              hint="Generalmente OFF para evitar ruido"
            />
            <Toggle
              checked={!!configDraft.alert_warning_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, alert_warning_enabled: value }))}
              label="Alertar severidad Warning"
              hint="Agrupado por cool-down"
            />
            <Toggle
              checked={!!configDraft.alert_critical_enabled}
              onChange={(value) => setConfigDraft((prev) => ({ ...prev, alert_critical_enabled: value }))}
              label="Alertar severidad Crítico"
              hint="Disparo inmediato"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <h5 className="text-sm font-semibold text-slate-800">Alertas Telegram</h5>
            <Toggle
              checked={!!configDraft.alert_channels?.telegram?.enabled}
              onChange={(value) => setConfigDraft((prev) => ({
                ...prev,
                alert_channels: {
                  ...prev.alert_channels,
                  telegram: {
                    ...(prev.alert_channels?.telegram || {}),
                    enabled: value,
                  },
                },
              }))}
              label="Telegram activo"
              hint="Canal único de alertas y avisos operativos"
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs text-slate-600">
                Bot token
                <input
                  type="password"
                  value={configDraft.alert_channels?.telegram?.bot_token || ''}
                  onChange={(e) => setConfigDraft((prev) => ({
                    ...prev,
                    alert_channels: {
                      ...prev.alert_channels,
                      telegram: {
                        ...(prev.alert_channels?.telegram || {}),
                        bot_token: e.target.value,
                      },
                    },
                  }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Chat ID
                <input
                  type="text"
                  value={configDraft.alert_channels?.telegram?.chat_id || ''}
                  onChange={(e) => setConfigDraft((prev) => ({
                    ...prev,
                    alert_channels: {
                      ...prev.alert_channels,
                      telegram: {
                        ...(prev.alert_channels?.telegram || {}),
                        chat_id: e.target.value,
                      },
                    },
                  }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>
        </section>
      ) : null}

      {Array.isArray(panel?.templates_in_use) && panel.templates_in_use.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">Templates en uso</h4>
            <p className="text-xs text-slate-500 mt-1">Solo muestra templates que la app usa hoy de verdad por default, env o configuración del tenant.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {panel.templates_in_use.map((item) => (
              <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.trigger}</div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${TEMPLATE_STATUS_CLASSES[item.status] || TEMPLATE_STATUS_CLASSES.active}`}>
                    {item.status === 'missing' ? 'Falta' : 'Activo'}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div><span className="font-medium text-slate-700">Template:</span> {item.template_name || '—'}</div>
                  <div><span className="font-medium text-slate-700">Idioma:</span> {item.language || '—'}</div>
                  <div><span className="font-medium text-slate-700">Origen:</span> {formatTemplateSource(item.source)}</div>
                  {item.notes ? (
                    <div>
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-900">Uso:</span>{' '}
                      {item.notes}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
