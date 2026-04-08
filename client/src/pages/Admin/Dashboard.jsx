import { useEffect, useState, useCallback } from 'react';
import {
  BellRing,
  CheckCheck,
  FileWarning,
  MessageSquareMore,
  Repeat,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { formatRelativeTime, formatTimeBolivia, getBoliviaDateKey } from '../../utils/dates';
import { Toast, useToast } from '../../hooks/useToast';
import useAdminEvents from '../../hooks/useAdminEvents';
import { useUiTheme } from '../../hooks/useUiTheme';
import './Preview.css';

const AUTOMATIONS = [
  '24h antes: recordatorio si no hubo confirmación.',
  '12h después: reintentar cobro si la cita sigue pendiente.',
  '21 días sin agenda: reactivación por WhatsApp.',
];

function toneClasses(tone, isDark) {
  const dark = {
    blue: 'border-sky-500/30 bg-sky-500/12 text-sky-100',
    rose: 'border-rose-500/30 bg-rose-500/12 text-rose-100',
    amber: 'border-amber-400/30 bg-amber-400/12 text-amber-50',
    sky: 'border-cyan-400/30 bg-cyan-400/12 text-cyan-50',
  };
  const light = {
    blue: 'border-blue-200 bg-blue-100 text-blue-700',
    rose: 'border-rose-200 bg-rose-100 text-rose-700',
    amber: 'border-amber-200 bg-amber-100 text-amber-700',
    sky: 'border-sky-200 bg-sky-100 text-sky-700',
  };

  const palette = isDark ? dark : light;
  return palette[tone] || palette.sky;
}

function appointmentStatusClasses(state, isDark) {
  const dark = {
    Recurrente: 'bg-sky-500/14 text-sky-100',
    Confirmada: 'bg-emerald-500/14 text-emerald-100',
    Completada: 'bg-white text-slate-950',
    Agendada: 'bg-amber-400/14 text-amber-50',
    'No-show': 'bg-rose-500/14 text-rose-100',
    Cancelada: 'bg-slate-700 text-slate-200',
  };
  const light = {
    Recurrente: 'bg-blue-100 text-blue-700',
    Confirmada: 'bg-emerald-100 text-emerald-700',
    Completada: 'bg-slate-900 text-white',
    Agendada: 'bg-amber-100 text-amber-700',
    'No-show': 'bg-rose-100 text-rose-700',
    Cancelada: 'bg-slate-200 text-slate-600',
  };

  const palette = isDark ? dark : light;
  return palette[state] || palette.Agendada;
}

function paymentClasses(state, isDark) {
  const dark = {
    Confirmado: 'text-emerald-200 hover:text-emerald-100',
    Mismatch: 'text-rose-200 hover:text-rose-100',
    Rechazado: 'text-rose-300 hover:text-rose-200',
    default: 'text-slate-300 hover:text-white',
  };
  const light = {
    Confirmado: 'text-emerald-700 hover:text-emerald-800',
    Mismatch: 'text-rose-700 hover:text-rose-800',
    Rechazado: 'text-rose-600 hover:text-rose-700',
    default: 'text-slate-500 hover:text-slate-700',
  };

  const palette = isDark ? dark : light;
  return palette[state] || palette.default;
}

function actionButtonClasses(intent, isDark) {
  if (intent === 'danger') {
    return isDark
      ? 'border-rose-500/30 bg-rose-500/12 text-rose-100 hover:bg-rose-500/20'
      : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
  }

  if (intent === 'success') {
    return isDark
      ? 'border-emerald-500/30 bg-emerald-500/14 text-emerald-100 hover:bg-emerald-500/22'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
  }

  return isDark
    ? 'border-white/12 bg-white/6 text-slate-100 hover:bg-white/10'
    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
}

function formatMoney(amount) {
  return `Bs ${Number(amount || 0).toLocaleString('es-BO')}`;
}

function buildAgendaKey(item) {
  if (item.type === 'virtual') return `virtual-${item.schedule_id}-${item.date_time}`;
  return `appointment-${item.id}`;
}

function mergeTodayAgenda(appointments = [], recurring = []) {
  const merged = new Map();

  for (const appt of appointments) {
    merged.set(buildAgendaKey(appt), appt);
  }

  for (const item of recurring) {
    if (item.type === 'materialized' && item.id) {
      const key = `appointment-${item.id}`;
      if (merged.has(key)) continue;
      merged.set(key, item);
      continue;
    }
    merged.set(buildAgendaKey(item), item);
  }

  return [...merged.values()].sort((a, b) => new Date(a.date_time) - new Date(b.date_time));
}

function getDashboardActions(appt) {
  const currentStatus = appt.type === 'virtual' ? 'Agendada' : appt.status;

  if (['Completada', 'Cancelada', 'No-show'].includes(currentStatus)) {
    return [];
  }

  if (currentStatus === 'Confirmada') {
    return [
      { status: 'Completada', label: 'Completar', intent: 'success' },
      { status: 'No-show', label: 'No-show', intent: 'neutral' },
      { status: 'Cancelada', label: 'Cancelar', intent: 'danger' },
    ];
  }

  return [
    { status: 'Confirmada', label: 'Confirmar', intent: 'success' },
    { status: 'No-show', label: 'No-show', intent: 'neutral' },
    { status: 'Cancelada', label: 'Cancelar', intent: 'danger' },
  ];
}

function PreviewPanel({ eyebrow, title, description, children, className = '', delay = 0, isDark = false }) {
  const shellClass = isDark
    ? 'rounded-[28px] border border-white/10 bg-[rgba(8,14,20,0.82)] shadow-[0_30px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl'
    : 'rounded-[28px] border border-white/70 bg-white/82 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl';

  return (
    <section className={`preview-enter ${shellClass} ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <div className={`px-6 py-5 ${isDark ? 'border-b border-white/10' : 'border-b border-slate-200/70'}`}>
        <div className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
          {eyebrow}
        </div>
        <div>
          <h3 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h3>
          {description ? (
            <p className={`mt-1 text-sm leading-6 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function AgendaCard({ appt, index, isDark, onTogglePayment, onStatusChange }) {
  const actions = getDashboardActions(appt);
  const cardClass = isDark
    ? appt.type === 'virtual'
      ? 'border-sky-500/18 bg-sky-500/8'
      : 'border-white/10 bg-[#101923]'
    : appt.type === 'virtual'
      ? 'border-blue-200/60 bg-blue-50/70'
      : 'border-slate-200/80 bg-[#fcfbf8]';

  const numberClass = isDark
    ? 'bg-white/10 text-white'
    : 'bg-[#1f2937] text-white';

  const labelClass = isDark ? 'text-slate-500' : 'text-slate-400';
  const nameClass = isDark ? 'text-white' : 'text-slate-900';
  const metaClass = isDark ? 'text-slate-300' : 'text-slate-500';
  const emptyClass = isDark ? 'text-slate-500' : 'text-slate-400';

  return (
    <div className={`rounded-[24px] border px-4 py-4 ${cardClass}`}>
      <div className="grid gap-4 xl:grid-cols-[90px_minmax(0,1fr)_minmax(0,270px)]">
        <div className="flex items-center gap-3 xl:flex-col xl:items-start">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-semibold ${numberClass}`}>
            {index + 1}
          </div>
          <div className="space-y-1">
            <div className={`text-lg font-semibold tracking-tight ${nameClass}`}>{formatTimeBolivia(appt.date_time)}</div>
            <div className={`text-[11px] uppercase tracking-[0.18em] ${labelClass}`}>
              {appt.type === 'virtual'
                ? 'recurrente'
                : appt.session_number ? `sesión ${appt.session_number}` : 'agenda'}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`min-w-0 text-lg font-semibold tracking-tight ${nameClass}`}>
              {appt.first_name} {appt.last_name}
            </div>
            {appt.type === 'virtual' ? <Repeat size={15} className={isDark ? 'text-sky-300' : 'text-blue-600'} /> : null}
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${appointmentStatusClasses(appt.type === 'virtual' ? 'Recurrente' : appt.status, isDark)}`}>
              {appt.type === 'virtual' ? 'Recurrente' : appt.status}
            </span>
          </div>

          <div className={`flex flex-wrap gap-x-4 gap-y-2 text-sm ${metaClass}`}>
            <span>{appt.client_phone || 'Sin teléfono'}</span>
            {appt.payment_amount ? <span>{formatMoney(appt.payment_amount)}</span> : null}
            {appt.type === 'virtual' && appt.time ? <span>{appt.time}</span> : null}
          </div>
        </div>

        <div className="space-y-3 xl:text-right">
          <button
            type="button"
            onClick={() => onTogglePayment(appt)}
            disabled={!appt.payment_id}
            className={`text-sm font-semibold transition ${paymentClasses(appt.payment_status, isDark)} ${appt.payment_id ? '' : 'cursor-not-allowed opacity-40'}`}
          >
            {appt.payment_status || 'Sin pago'}
          </button>

          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-2 xl:justify-end">
              {actions.map((action) => (
                <button
                  key={action.status}
                  type="button"
                  onClick={() => onStatusChange(appt, action.status)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionButtonClasses(action.intent, isDark)}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : (
            <div className={`text-xs font-medium ${emptyClass}`}>Sin acciones rápidas</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [todayAppts, setTodayAppts] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [stats, setStats] = useState(null);
  const [payments, setPayments] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();
  const { isDark } = useUiTheme();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const today = getBoliviaDateKey();
      const [appts, recurring, analytics, paymentsData, convoData, clientsData] = await Promise.all([
        api.get('/appointments/today'),
        api.get(`/recurring/upcoming?from=${today}&to=${today}`).catch(() => []),
        api.get('/analytics').catch(() => null),
        api.get('/payments?limit=12').catch(() => ({ payments: [] })),
        api.get('/webhook/conversations?limit=6').catch(() => ({ conversations: [] })),
        api.get('/clients').catch(() => []),
      ]);
      setTodayAppts(mergeTodayAgenda(appts || [], recurring || []));
      setAnalyticsData(analytics || null);
      setStats(analytics?.totals || null);
      setPayments(paymentsData?.payments || []);
      setConversations(convoData?.conversations || []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
    } catch (err) {
      showToast(`Error cargando dashboard: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useAdminEvents(
    ['appointment:change', 'recurring:change', 'payment:change', 'client:change'],
    loadDashboard,
  );

  async function handlePaymentToggle(appt) {
    if (!appt.payment_id) return;
    const newStatus = appt.payment_status === 'Confirmado' ? 'Pendiente' : 'Confirmado';
    try {
      await api.put(`/payments/${appt.payment_id}/status`, { status: newStatus });
      setTodayAppts((prev) => prev.map((item) => (
        item.id === appt.id ? { ...item, payment_status: newStatus } : item
      )));
      showToast(`Pago marcado como ${newStatus.toLowerCase()}`);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  async function handleStatusChange(appt, status) {
    try {
      let appointmentId = appt.id;

      if (appt.type === 'virtual') {
        const materialized = await api.post(`/recurring/${appt.schedule_id}/materialize`, {
          date: getBoliviaDateKey(appt.date_time),
        });
        appointmentId = materialized?.appointment?.id;
      }

      if (!appointmentId) {
        throw new Error('No se pudo materializar la sesión recurrente');
      }

      await api.put(`/appointments/${appointmentId}/status`, { status });

      await loadDashboard();
      showToast(appt.type === 'virtual'
        ? `Sesión recurrente materializada y actualizada a ${status}`
        : `Cita actualizada a ${status}`);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  async function handleTriggerReminder(date) {
    try {
      const result = await api.get(`/admin/test-reminder?date=${date}`);
      if (result.sent > 0) showToast(`${result.sent} recordatorio(s) aceptado(s) por WhatsApp; ${result.skipped || 0} omitido(s) por dedupe`);
      else showToast(result.skipped > 0 ? 'No hubo pendientes nuevos; lo demás ya estaba enviado' : 'No hubo mensajes para enviar');
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  const mismatches = payments.filter((payment) => payment.status === 'Mismatch');
  const pendingPayments = payments.filter((payment) => payment.status === 'Pendiente');
  const atRiskClients = clients
    .filter((client) => ['En riesgo', 'Perdido'].includes(client.retention_status))
    .sort((a, b) => (b.days_since_last_session || 0) - (a.days_since_last_session || 0))
    .slice(0, 4);
  const clientsWithNext = clients.filter((client) => client.retention_status === 'Con cita').length;
  const healthyClients = clients.filter((client) => client.retention_status === 'Al día').length;
  const lostClients = clients.filter((client) => client.retention_status === 'Perdido').length;
  const riskClients = clients.filter((client) => client.retention_status === 'En riesgo').length;
  const inboxThreads = conversations.slice(0, 3);
  const projectedIncome = (Number(stats?.income_this_month) || 0) + pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const todayConfirmedRevenue = todayAppts
    .filter((appt) => appt.payment_status === 'Confirmado')
    .reduce((sum, appt) => sum + Number(appt.payment_amount || 0), 0);
  const needsConfirmation = todayAppts.filter((appt) => appt.type === 'virtual' || !['Confirmada', 'Completada'].includes(appt.status)).length;
  const weekSessions = Number(stats?.sessions_this_week || 0);
  const recurringClients = Number(analyticsData?.recurring?.active || 0);

  const attentionQueue = [
    mismatches[0] && {
      title: 'Pago con mismatch',
      detail: `${mismatches[0].first_name} ${mismatches[0].last_name || ''} • ${formatMoney(mismatches[0].amount)} pendiente de revisión`,
      tone: 'rose',
    },
    pendingPayments[0] && {
      title: 'Cobro pendiente',
      detail: `${pendingPayments[0].first_name} ${pendingPayments[0].last_name || ''} • cita ${pendingPayments[0].date_time ? formatTimeBolivia(pendingPayments[0].date_time) : 'sin hora'}`,
      tone: 'amber',
    },
    atRiskClients[0] && {
      title: 'Paciente en riesgo',
      detail: `${atRiskClients[0].first_name} ${atRiskClients[0].last_name} • ${atRiskClients[0].retention_status} • ${atRiskClients[0].days_since_last_session || 0} días`,
      tone: 'sky',
    },
  ].filter(Boolean);

  const priorityStrip = [
    { label: 'Sin confirmar', value: String(needsConfirmation), tone: 'amber' },
    { label: 'Recurrentes', value: String(recurringClients), tone: 'blue' },
    { label: 'Mismatch', value: String(mismatches.length), tone: 'rose' },
    { label: 'En riesgo', value: String(riskClients), tone: 'sky' },
  ];

  const shellText = isDark ? 'text-slate-100' : 'text-slate-900';
  const dividerClass = isDark ? 'border-white/10' : 'border-black/5';
  const badgeClass = isDark ? 'bg-white/6 text-slate-300' : 'bg-white/80 text-slate-500';
  const bodyTextClass = isDark ? 'text-slate-300' : 'text-slate-500';
  const subtleTextClass = isDark ? 'text-slate-500' : 'text-slate-400';
  const quietSurfaceClass = isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200/80 bg-[#fcfbf8]';
  const dashedSurfaceClass = isDark ? 'border-white/12 text-slate-500' : 'border-slate-200 text-slate-400';
  const threadCardClass = isDark
    ? 'border-white/10 bg-[#101923] hover:border-white/16 hover:bg-[#12202c] hover:shadow-[0_18px_36px_rgba(0,0,0,0.22)]'
    : 'border-slate-200/80 bg-[#fcfbf8] hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.06)]';
  const threadAvatarClass = isDark ? 'bg-[#d8704a] text-white' : 'bg-[#d8704a] text-white';

  return (
    <AdminLayout title="Hoy">
      <Toast toast={toast} />

      <div className={`preview-admin-shell relative -mx-4 -mt-4 px-4 pb-6 pt-4 lg:-mx-6 lg:-mt-6 lg:px-6 lg:pb-8 lg:pt-6 ${shellText}`}>
        <div className="preview-halo preview-halo-a" />
        <div className="preview-halo preview-halo-b" />

        <div className={`preview-enter border-b pb-6 ${dividerClass}`} style={{ animationDelay: '60ms' }}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className={`text-xs font-semibold uppercase tracking-[0.26em] ${subtleTextClass}`}>Operación</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className={`text-[clamp(2rem,3vw,3.25rem)] font-semibold tracking-[-0.04em] ${isDark ? 'text-white' : 'text-slate-950'}`}>Hoy</h1>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${badgeClass}`}>
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.15)]" />
                  {loading ? 'Sincronizando' : 'Operación activa'}
                </span>
              </div>
              <p className={`mt-3 max-w-2xl text-sm leading-7 ${bodyTextClass}`}>
                Agenda, cobros, pacientes e inbox del día en una sola superficie operativa.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleTriggerReminder('today')}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  isDark
                    ? 'border-white/12 bg-white/6 text-slate-100 hover:bg-white/10'
                    : 'border-white/70 bg-white/80 text-slate-700 hover:bg-white'
                }`}
              >
                Pendientes hoy
              </button>
              <button
                type="button"
                onClick={() => handleTriggerReminder('tomorrow')}
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                  isDark
                    ? 'bg-white text-slate-950 hover:bg-slate-100'
                    : 'bg-[#1f2937] text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] hover:bg-slate-800'
                }`}
              >
                Pendientes mañana
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {priorityStrip.map((item, index) => (
              <div
                key={item.label}
                className={`preview-enter rounded-2xl border px-4 py-3 ${toneClasses(item.tone, isDark)}`}
                style={{ animationDelay: `${120 + index * 70}ms` }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]">{item.label}</div>
                <div className="mt-1 text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_390px]">
          <div className="space-y-6">
            <PreviewPanel
              eyebrow="Agenda"
              title="Agenda del día"
              description="Citas de hoy con cobro, contexto y acciones rápidas."
              delay={140}
              isDark={isDark}
            >
              <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-3">
                  {loading ? (
                    <div className={`rounded-[24px] border px-4 py-10 text-center text-sm ${quietSurfaceClass}`}>
                      Cargando agenda...
                    </div>
                  ) : todayAppts.length === 0 ? (
                    <div className={`rounded-[24px] border px-4 py-10 text-center text-sm ${quietSurfaceClass}`}>
                      No hay citas hoy.
                    </div>
                  ) : (
                    todayAppts.map((appt, index) => (
                      <AgendaCard
                        key={buildAgendaKey(appt)}
                        appt={appt}
                        index={index}
                        isDark={isDark}
                        onTogglePayment={handlePaymentToggle}
                        onStatusChange={handleStatusChange}
                      />
                    ))
                  )}
                </div>

                <div className={`border-t pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 ${isDark ? 'border-white/10' : 'border-slate-200/80'}`}>
                  <div className={`mb-4 flex items-center gap-2 text-sm font-medium ${isDark ? 'text-slate-100' : 'text-slate-700'}`}>
                    <BellRing size={16} />
                    Atención inmediata
                  </div>
                  <div className="space-y-3">
                    {attentionQueue.length === 0 ? (
                      <div className={`rounded-[22px] border border-dashed px-4 py-5 text-sm ${dashedSurfaceClass}`}>
                        Sin alertas críticas por ahora.
                      </div>
                    ) : (
                      attentionQueue.map((item) => (
                        <div key={item.title} className={`rounded-[22px] border px-4 py-4 ${toneClasses(item.tone, isDark)}`}>
                          <div className="text-sm font-semibold">{item.title}</div>
                          <div className="mt-1 text-sm leading-6 opacity-90">{item.detail}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </PreviewPanel>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <PreviewPanel
                eyebrow="Pacientes"
                title="Radar de cartera"
                description="Segmentos útiles para seguimiento y reactivación."
                className="overflow-hidden"
                delay={210}
                isDark={isDark}
              >
                <div className={`divide-y px-6 ${isDark ? 'divide-white/10' : 'divide-slate-200/70'}`}>
                  {[
                    { label: 'Con cita', value: clientsWithNext, sub: 'ya tienen próxima sesión reservada' },
                    { label: 'Al día', value: healthyClients, sub: 'aún están dentro de su ventana normal' },
                    { label: 'En riesgo', value: riskClients, sub: 'se están saliendo de su cadencia' },
                    { label: 'Perdidos', value: lostClients, sub: 'sin retorno dentro del umbral' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <div className={`text-sm font-medium ${isDark ? 'text-slate-100' : 'text-slate-700'}`}>{item.label}</div>
                        <div className={`text-sm ${subtleTextClass}`}>{item.sub}</div>
                      </div>
                      <div className={`text-3xl font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-950'}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </PreviewPanel>

              <PreviewPanel
                eyebrow="Rutinas"
                title="Automatizaciones visibles"
                description="Recordatorios y seguimiento que hoy ya están corriendo."
                delay={260}
                isDark={isDark}
              >
                <div className="space-y-3 px-6 py-6">
                  {AUTOMATIONS.map((item) => (
                    <div
                      key={item}
                      className={`flex items-start gap-3 rounded-[20px] px-4 py-4 ${
                        isDark ? 'bg-white/5 text-slate-200' : 'bg-[#f7f3ee] text-slate-600'
                      }`}
                    >
                      <CheckCheck size={18} className={`mt-0.5 ${isDark ? 'text-amber-300' : 'text-[#b3643d]'}`} />
                      <div className="text-sm leading-6">{item}</div>
                    </div>
                  ))}
                </div>
              </PreviewPanel>
            </div>
          </div>

          <div className="space-y-6">
            <PreviewPanel
              eyebrow="Inbox"
              title="Conversaciones recientes"
              description="Mensajes vivos para seguimiento, cobro y coordinación."
              delay={180}
              isDark={isDark}
            >
              <div className="space-y-3 px-6 py-6">
                {inboxThreads.length === 0 ? (
                  <div className={`rounded-[22px] border border-dashed px-4 py-5 text-sm ${dashedSurfaceClass}`}>
                    Aún no hay hilos recientes.
                  </div>
                ) : (
                  inboxThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className={`rounded-[24px] border px-4 py-4 transition-all duration-200 ${threadCardClass}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-sm font-semibold ${threadAvatarClass}`}>
                          {(thread.first_name || thread.client_phone || '?').charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                              {thread.first_name ? `${thread.first_name} ${thread.last_name || ''}`.trim() : thread.client_phone}
                            </div>
                            <div className={`text-xs uppercase tracking-[0.18em] ${subtleTextClass}`}>{formatRelativeTime(thread.created_at)}</div>
                          </div>
                          <div className={`mt-1 line-clamp-2 text-sm leading-6 ${bodyTextClass}`}>{thread.content || 'Sin contenido'}</div>
                        </div>
                        <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                          isDark ? 'bg-white/10 text-white' : 'bg-slate-900 text-white'
                        }`}>
                          {thread.direction === 'inbound' ? 'Inbox' : 'Salida'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </PreviewPanel>

            <PreviewPanel
              eyebrow="Cobros"
              title="Pulso comercial"
              description="Lo confirmado, lo proyectado y lo que necesita revisión."
              delay={230}
              isDark={isDark}
            >
              <div className="grid gap-4 px-6 py-6">
                <div className={`rounded-[24px] p-5 ${isDark ? 'bg-white/6 text-white' : 'bg-[#1f2937] text-white'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-xs uppercase tracking-[0.18em] ${isDark ? 'text-white/45' : 'text-white/50'}`}>Ingreso proyectado</div>
                      <div className="mt-2 text-4xl font-semibold tracking-tight">{formatMoney(projectedIncome)}</div>
                    </div>
                    <TrendingUp size={24} className="text-emerald-300" />
                  </div>
                  <div className={`mt-4 h-2 overflow-hidden rounded-full ${isDark ? 'bg-white/8' : 'bg-white/10'}`}>
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300"
                      style={{ width: `${Math.min(100, projectedIncome > 0 ? Math.round(((Number(stats?.income_this_month) || 0) / projectedIncome) * 100) : 0)}%` }}
                    />
                  </div>
                  <div className={`mt-3 text-sm ${isDark ? 'text-white/55' : 'text-white/60'}`}>
                    {formatMoney(stats?.income_this_month || 0)} ya confirmado este mes
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className={`rounded-[22px] p-4 ${isDark ? 'bg-white/5' : 'bg-[#f6f1ea]'}`}>
                    <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-slate-200' : 'text-slate-500'}`}>
                      <FileWarning size={16} className="text-rose-500" />
                      En revisión
                    </div>
                    <div className={`mt-3 text-3xl font-semibold ${isDark ? 'text-white' : 'text-slate-950'}`}>
                      {formatMoney(mismatches.reduce((sum, item) => sum + Number(item.amount || 0), 0))}
                    </div>
                    <div className={`mt-1 text-sm ${subtleTextClass}`}>{mismatches.length} pago(s) con duda</div>
                  </div>

                  <div className={`rounded-[22px] p-4 ${isDark ? 'bg-white/5' : 'bg-[#f6f1ea]'}`}>
                    <div className={`flex items-center gap-2 text-sm font-medium ${isDark ? 'text-slate-200' : 'text-slate-500'}`}>
                      <ShieldCheck size={16} className="text-emerald-500" />
                      Cobrado hoy
                    </div>
                    <div className={`mt-3 text-3xl font-semibold ${isDark ? 'text-white' : 'text-slate-950'}`}>{formatMoney(todayConfirmedRevenue)}</div>
                    <div className={`mt-1 text-sm ${subtleTextClass}`}>{weekSessions} sesiones esta semana</div>
                  </div>
                </div>
              </div>
            </PreviewPanel>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
