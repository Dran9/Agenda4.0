import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  History,
  Eye,
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

const SEVERITY_CLASSES = {
  info: 'bg-slate-100 text-slate-600',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
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
  const [timeline, setTimeline] = useState([]);
  const [timelineMeta, setTimelineMeta] = useState({ page: 1, limit: 50, total: 0 });
  const [filters, setFilters] = useState({
    severity: '',
    field: '',
    phone: '',
    date_from: '',
    date_to: '',
  });
  const [detailById, setDetailById] = useState({});
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [showFullHistory, setShowFullHistory] = useState(false);

  const [configDraft, setConfigDraft] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const { toast, show: showToast } = useToast();

  const timelineLimit = showFullHistory ? 100 : 50;

  async function loadPanel() {
    const data = await api.get(`/meta-health?timeline_limit=${timelineLimit}`);
    setPanel(data);
    setConfigDraft(data.config || null);
  }

  async function loadEvents({ page = 1 } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(timelineLimit),
    });

    if (filters.severity) params.set('severity', filters.severity);
    if (filters.field) params.set('field', filters.field);
    if (filters.phone) params.set('phone', filters.phone);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);

    const data = await api.get(`/meta-health/events?${params.toString()}`);
    setTimeline(data.items || []);
    setTimelineMeta({ page: data.page || 1, limit: data.limit || timelineLimit, total: data.total || 0 });
  }

  async function bootstrap() {
    setLoading(true);
    try {
      await Promise.all([loadPanel(), loadEvents({ page: 1 })]);
    } catch (err) {
      showToast(`No se pudo cargar Meta health: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFullHistory]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.post('/meta-health/refresh', { run_watchdog: true });
      await Promise.all([loadPanel(), loadEvents({ page: 1 })]);
      showToast('Meta health refrescado');
    } catch (err) {
      showToast(`No se pudo refrescar: ${err.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function applyFilters() {
    try {
      await loadEvents({ page: 1 });
    } catch (err) {
      showToast(`No se pudieron aplicar filtros: ${err.message}`, 'error');
    }
  }

  async function loadEventDetail(eventId) {
    if (detailById[eventId]) {
      setDetailById((prev) => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
      return;
    }

    setLoadingDetailId(eventId);
    try {
      const detail = await api.get(`/meta-health/events/${eventId}`);
      setDetailById((prev) => ({ ...prev, [eventId]: detail }));
    } catch (err) {
      showToast(`No se pudo cargar detalle: ${err.message}`, 'error');
    } finally {
      setLoadingDetailId(null);
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

  const maxPages = useMemo(() => {
    if (!timelineMeta.total || !timelineMeta.limit) return 1;
    return Math.max(1, Math.ceil(timelineMeta.total / timelineMeta.limit));
  }, [timelineMeta]);

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
  const supportedFields = panel?.supported_fields || [];
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
            <button
              type="button"
              onClick={() => setShowFullHistory((prev) => !prev)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#4E769B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#618BBF]"
            >
              <History size={15} />
              {showFullHistory ? 'Ver últimos 50' : 'Abrir historial completo'}
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-slate-700">
          <History size={16} />
          <h4 className="text-sm font-semibold uppercase tracking-[0.12em]">Timeline / historial</h4>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <select
            value={filters.severity}
            onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Severidad: todas</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Crítico</option>
          </select>

          <select
            value={filters.field}
            onChange={(e) => setFilters((prev) => ({ ...prev, field: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Field: todos</option>
            {supportedFields.map((field) => (
              <option key={field} value={field}>{field}</option>
            ))}
          </select>

          <input
            type="text"
            value={filters.phone}
            onChange={(e) => setFilters((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="phone_number_id"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => setFilters((prev) => ({ ...prev, date_from: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilters((prev) => ({ ...prev, date_to: e.target.value }))}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
            >
              Aplicar
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha/hora</th>
                <th className="px-3 py-2">Severidad</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Resumen</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                    No hay eventos para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                timeline.map((event) => {
                  const detail = detailById[event.id];
                  return (
                    <Fragment key={event.id}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 text-xs text-slate-600">{formatDateTime(event.received_at)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${SEVERITY_CLASSES[event.severity] || SEVERITY_CLASSES.info}`}>
                            {event.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{event.event_type}</td>
                        <td className="px-3 py-2 text-slate-600">{event.field}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[420px]">{event.summary || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{event.status || event.quality || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => loadEventDetail(event.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            {loadingDetailId === event.id ? <LoaderCircle size={13} className="animate-spin" /> : <Eye size={13} />}
                            {detail ? 'Ocultar' : 'Ver detalle'}
                          </button>
                        </td>
                      </tr>

                      {detail ? (
                        <tr className="border-t border-slate-100 bg-slate-50/70">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-2">Evento normalizado</div>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-700">
                                  {JSON.stringify(detail.event?.normalized_payload || {}, null, 2)}
                                </pre>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-2">Raw payload</div>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-700">
                                  {JSON.stringify(detail.raw_payload || {}, null, 2)}
                                </pre>
                              </div>
                            </div>

                            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-2">Alertas correlacionadas</div>
                              {detail.alerts?.length ? (
                                <div className="space-y-1 text-xs text-slate-600">
                                  {detail.alerts.map((alert) => (
                                    <div key={alert.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                                      Canal: <span className="font-medium">{alert.channel}</span> · Estado:{' '}
                                      <span className="font-medium">{alert.status}</span> · Fecha: {formatDateTime(alert.created_at)}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-slate-500">No hay alertas emitidas para este evento.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{timelineMeta.total} eventos</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={timelineMeta.page <= 1}
              onClick={() => loadEvents({ page: Math.max(1, timelineMeta.page - 1) })}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>Página {timelineMeta.page} de {maxPages}</span>
            <button
              type="button"
              disabled={timelineMeta.page >= maxPages}
              onClick={() => loadEvents({ page: Math.min(maxPages, timelineMeta.page + 1) })}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
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
              hint="Canal único de alertas (según alcance actual)"
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
    </div>
  );
}
