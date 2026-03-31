import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Command,
  FileWarning,
  MessageSquareMore,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Waypoints,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { formatRelativeTime, formatTimeBolivia } from '../../utils/dates';
import { Toast, useToast } from '../../hooks/useToast';
import './Preview.css';

const AUTOMATIONS = [
  '24h antes: recordatorio si no hubo confirmación.',
  '12h después: reintentar cobro si la cita sigue pendiente.',
  '21 días sin agenda: reactivación por WhatsApp.',
];

function toneClasses(tone) {
  if (tone === 'rose') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (tone === 'amber') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-sky-100 text-sky-700 border-sky-200';
}

function appointmentStatusClasses(state) {
  if (state === 'Confirmada') return 'bg-emerald-100 text-emerald-700';
  if (state === 'Completada') return 'bg-slate-900 text-white';
  if (state === 'Agendada') return 'bg-amber-100 text-amber-700';
  if (state === 'No-show') return 'bg-rose-100 text-rose-700';
  if (state === 'Cancelada') return 'bg-slate-200 text-slate-600';
  return 'bg-sky-100 text-sky-700';
}

function paymentClasses(state) {
  if (state === 'Confirmado') return 'text-emerald-700';
  if (state === 'Mismatch') return 'text-rose-700';
  if (state === 'Rechazado') return 'text-rose-600';
  return 'text-slate-500';
}

function formatMoney(amount) {
  return `Bs ${Number(amount || 0).toLocaleString('es-BO')}`;
}

function formatClientStatus(status) {
  if (!status) return 'Sin estado';
  return status;
}

function PreviewPanel({ eyebrow, title, description, children, className = '', delay = 0 }) {
  return (
    <section
      className={`preview-enter rounded-[28px] border border-white/70 bg-white/82 backdrop-blur-xl shadow-[0_30px_80px_rgba(15,23,42,0.08)] ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="border-b border-slate-200/70 px-6 py-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
        <div>
          <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const [todayAppts, setTodayAppts] = useState([]);
  const [stats, setStats] = useState(null);
  const [payments, setPayments] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [appts, analytics, paymentsData, convoData, clientsData] = await Promise.all([
        api.get('/appointments/today'),
        api.get('/analytics').catch(() => null),
        api.get('/payments?limit=12').catch(() => ({ payments: [] })),
        api.get('/webhook/conversations?limit=6').catch(() => ({ conversations: [] })),
        api.get('/clients').catch(() => []),
      ]);
      setTodayAppts(appts || []);
      setStats(analytics?.totals || null);
      setPayments(paymentsData?.payments || []);
      setConversations(convoData?.conversations || []);
      setClients(Array.isArray(clientsData) ? clientsData : []);
    } catch (err) {
      showToast(`Error cargando dashboard: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handlePaymentToggle(appt) {
    if (!appt.payment_id) return;
    const newStatus = appt.payment_status === 'Confirmado' ? 'Pendiente' : 'Confirmado';
    try {
      await api.put(`/payments/${appt.payment_id}/status`, { status: newStatus });
      setTodayAppts((prev) => prev.map((a) => (a.id === appt.id ? { ...a, payment_status: newStatus } : a)));
      showToast(`Pago marcado como ${newStatus.toLowerCase()}`);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  async function handleStatusChange(id, status) {
    try {
      await api.put(`/appointments/${id}/status`, { status });
      setTodayAppts((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
      showToast(`Cita actualizada a ${status}`);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  async function handleTriggerReminder(date) {
    try {
      const result = await api.get(`/admin/test-reminder?date=${date}`);
      if (result.sent > 0) showToast(`${result.sent} recordatorio(s) enviado(s); ${result.skipped || 0} omitido(s) por dedupe`);
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
  const needsConfirmation = todayAppts.filter((appt) => !['Confirmada', 'Completada'].includes(appt.status)).length;
  const weekSessions = Number(stats?.sessions_this_week || 0);

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
    { label: 'Mismatch', value: String(mismatches.length), tone: 'rose' },
    { label: 'En riesgo', value: String(riskClients), tone: 'sky' },
  ];

  return (
    <AdminLayout title="Hoy">
      <Toast toast={toast} />

      <div className="preview-admin-shell relative -mx-4 -mt-4 px-4 pb-6 pt-4 lg:-mx-6 lg:-mt-6 lg:px-6 lg:pb-8 lg:pt-6">
        <div className="preview-halo preview-halo-a" />
        <div className="preview-halo preview-halo-b" />

        <div className="preview-enter border-b border-black/5 pb-6" style={{ animationDelay: '60ms' }}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">Command Center</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-[clamp(2rem,3vw,3.35rem)] font-semibold tracking-[-0.04em] text-slate-950">Hoy</h1>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-sm text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.15)]" />
                  {loading ? 'Sincronizando' : 'Operación activa'}
                </span>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
                Agenda, cobros, pacientes e inbox en un solo tablero. Esto ya no es un resumen: es una superficie para decidir y operar.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleTriggerReminder('today')}
                className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white"
              >
                Pendientes hoy
              </button>
              <button
                type="button"
                onClick={() => handleTriggerReminder('tomorrow')}
                className="rounded-2xl bg-[#1f2937] px-4 py-3 text-sm font-medium text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
              >
                Pendientes mañana
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {priorityStrip.map((item, index) => (
              <div key={item.label} className={`preview-enter rounded-2xl border px-4 py-3 ${toneClasses(item.tone)}`} style={{ animationDelay: `${120 + index * 70}ms` }}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]">{item.label}</div>
                <div className="mt-1 text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_390px]">
          <div className="space-y-6">
            <PreviewPanel
              eyebrow="Workspace"
              title="Agenda viva del día"
              description="Citas de hoy con cobro, contexto y acciones rápidas en el mismo lugar."
              delay={140}
            >
              <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-3">
                  {loading ? (
                    <div className="rounded-[24px] border border-slate-200/80 bg-[#fcfbf8] px-4 py-10 text-center text-sm text-slate-400">
                      Cargando agenda...
                    </div>
                  ) : todayAppts.length === 0 ? (
                    <div className="rounded-[24px] border border-slate-200/80 bg-[#fcfbf8] px-4 py-10 text-center text-sm text-slate-400">
                      No hay citas hoy. Si quieres vender la demo mejor, corre el seeder de ejemplo.
                    </div>
                  ) : (
                    todayAppts.map((appt, index) => (
                      <div
                        key={appt.id}
                        className="group flex flex-col gap-4 rounded-[24px] border border-slate-200/80 bg-[#fcfbf8] px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_40px_rgba(15,23,42,0.07)] md:flex-row md:items-center"
                      >
                        <div className="flex items-center gap-4 md:w-[122px] md:flex-none">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1f2937] text-sm font-semibold text-white">
                            {index + 1}
                          </div>
                          <div>
                            <div className="text-lg font-semibold tracking-tight text-slate-900">{formatTimeBolivia(appt.date_time)}</div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                              {appt.session_number ? `sesión ${appt.session_number}` : 'agenda'}
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-base font-semibold text-slate-900">{appt.first_name} {appt.last_name}</div>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${appointmentStatusClasses(appt.status)}`}>{appt.status}</span>
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {appt.client_phone || 'Sin teléfono'} {appt.payment_amount ? `• ${formatMoney(appt.payment_amount)}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4 md:w-[196px] md:flex-none md:justify-end">
                          <button
                            type="button"
                            onClick={() => handlePaymentToggle(appt)}
                            disabled={!appt.payment_id}
                            className={`text-sm font-semibold ${paymentClasses(appt.payment_status)} ${appt.payment_id ? 'hover:underline' : 'cursor-not-allowed opacity-40'}`}
                          >
                            {appt.payment_status || 'Sin pago'}
                          </button>
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) handleStatusChange(appt.id, e.target.value);
                            }}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition hover:border-slate-300"
                          >
                            <option value="">Acción</option>
                            <option value="Confirmada">Confirmar</option>
                            <option value="Completada">Completar</option>
                            <option value="No-show">No-show</option>
                            <option value="Cancelada">Cancelar</option>
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="border-t border-slate-200/80 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-700">
                    <BellRing size={16} />
                    Atención inmediata
                  </div>
                  <div className="space-y-3">
                    {attentionQueue.length === 0 ? (
                      <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
                        Sin alertas críticas por ahora.
                      </div>
                    ) : (
                      attentionQueue.map((item) => (
                        <div key={item.title} className={`rounded-[22px] border px-4 py-4 ${toneClasses(item.tone)}`}>
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
                eyebrow="Patients"
                title="Radar de cartera"
                description="Segmentos útiles para seguimiento, reactivación y venta recurrente."
                className="overflow-hidden"
                delay={210}
              >
                <div className="divide-y divide-slate-200/70 px-6">
                  {[
                    { label: 'Con cita', value: clientsWithNext, sub: 'ya tienen próxima sesión reservada' },
                    { label: 'Al día', value: healthyClients, sub: 'aún están dentro de su ventana normal' },
                    { label: 'En riesgo', value: riskClients, sub: 'se están saliendo de su cadencia' },
                    { label: 'Perdidos', value: lostClients, sub: 'sin retorno dentro del umbral' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between py-4">
                      <div>
                        <div className="text-sm font-medium text-slate-700">{item.label}</div>
                        <div className="text-sm text-slate-400">{item.sub}</div>
                      </div>
                      <div className="text-3xl font-semibold tracking-tight text-slate-950">{item.value}</div>
                    </div>
                  ))}
                </div>
              </PreviewPanel>

              <PreviewPanel
                eyebrow="Automation"
                title="Rutinas visibles"
                description="El producto se vende mejor cuando las automatizaciones se pueden ver y entender."
                delay={260}
              >
                <div className="space-y-3 px-6 py-6">
                  {AUTOMATIONS.map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-[20px] bg-[#f7f3ee] px-4 py-4">
                      <CheckCheck size={18} className="mt-0.5 text-[#b3643d]" />
                      <div className="text-sm leading-6 text-slate-600">{item}</div>
                    </div>
                  ))}
                </div>
              </PreviewPanel>
            </div>
          </div>

          <div className="space-y-6">
            <PreviewPanel
              eyebrow="Inbox"
              title="Conversaciones que requieren respuesta"
              description="Mensajes vivos, no logs. Prioridad real para venta, cobro y seguimiento."
              delay={180}
            >
              <div className="space-y-3 px-6 py-6">
                {inboxThreads.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
                    Aún no hay hilos recientes.
                  </div>
                ) : (
                  inboxThreads.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      className="flex w-full items-start gap-4 rounded-[24px] border border-slate-200/80 bg-[#fcfbf8] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.06)]"
                    >
                      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-[#d8704a] text-sm font-semibold text-white">
                        {(thread.first_name || thread.client_phone || '?').charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {thread.first_name ? `${thread.first_name} ${thread.last_name || ''}`.trim() : thread.client_phone}
                          </div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{formatRelativeTime(thread.created_at)}</div>
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{thread.content || 'Sin contenido'}</div>
                      </div>
                      <div className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                        {thread.direction === 'inbound' ? 'Inbox' : 'Salida'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </PreviewPanel>

            <PreviewPanel
              eyebrow="Revenue"
              title="Pulso comercial"
              description="Lo que está entrando, lo que está trabado y dónde conviene actuar hoy."
              delay={230}
            >
              <div className="grid gap-4 px-6 py-6">
                <div className="rounded-[24px] bg-[#1f2937] p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-white/50">Ingreso proyectado</div>
                      <div className="mt-2 text-4xl font-semibold tracking-tight">{formatMoney(projectedIncome)}</div>
                    </div>
                    <TrendingUp size={24} className="text-emerald-300" />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300"
                      style={{ width: `${Math.min(100, projectedIncome > 0 ? Math.round(((Number(stats?.income_this_month) || 0) / projectedIncome) * 100) : 0)}%` }}
                    />
                  </div>
                  <div className="mt-3 text-sm text-white/60">
                    {formatMoney(stats?.income_this_month || 0)} ya confirmado este mes
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-[22px] bg-[#f6f1ea] p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                      <FileWarning size={16} className="text-rose-500" />
                      En revisión
                    </div>
                    <div className="mt-3 text-3xl font-semibold text-slate-950">{formatMoney(mismatches.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</div>
                    <div className="mt-1 text-sm text-slate-400">{mismatches.length} pago(s) con duda</div>
                  </div>
                  <div className="rounded-[22px] bg-[#f6f1ea] p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                      <ShieldCheck size={16} className="text-emerald-500" />
                      Cobrado hoy
                    </div>
                    <div className="mt-3 text-3xl font-semibold text-slate-950">{formatMoney(todayConfirmedRevenue)}</div>
                    <div className="mt-1 text-sm text-slate-400">{weekSessions} sesiones esta semana</div>
                  </div>
                </div>
              </div>
            </PreviewPanel>

            <PreviewPanel
              eyebrow="Direction"
              title="Por qué esta pantalla ya se puede vender"
              description="Hace visible operación, ingreso, seguimiento y conversación en una sola capa."
              delay={290}
            >
              <div className="space-y-4 px-6 py-6 text-sm leading-7 text-slate-500">
                <div className="flex items-start gap-3">
                  <Command size={18} className="mt-1 text-[#b3643d]" />
                  <div>El admin deja de ser un conjunto de módulos y pasa a ser un escritorio operativo.</div>
                </div>
                <div className="flex items-start gap-3">
                  <MessageSquareMore size={18} className="mt-1 text-[#b3643d]" />
                  <div>Inbox, cobro y agenda dejan de vivir separados y se conectan al día a día del consultorio.</div>
                </div>
                <div className="flex items-start gap-3">
                  <Waypoints size={18} className="mt-1 text-[#b3643d]" />
                  <div>Las automatizaciones dejan de ser “magia escondida” y se vuelven parte del producto.</div>
                </div>
                <div className="flex items-start gap-3">
                  <ArrowUpRight size={18} className="mt-1 text-[#b3643d]" />
                  <div>Con datos demo suficientes, esta pantalla ya sirve para una venta o demo comercial seria.</div>
                </div>
              </div>
            </PreviewPanel>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
