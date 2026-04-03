import {
  Activity,
  ArrowRight,
  BellRing,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Command,
  FileWarning,
  LayoutGrid,
  MessageSquareMore,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingUp,
  Users,
  Waypoints,
} from 'lucide-react';
import './Preview.css';

const NAV_ITEMS = [
  { label: 'Hoy', icon: Command, active: true },
  { label: 'Agenda', icon: CalendarClock },
  { label: 'Clientes', icon: Users },
  { label: 'Inbox', icon: MessageSquareMore },
  { label: 'Cobros', icon: CircleDollarSign },
  { label: 'Insights', icon: TrendingUp },
  { label: 'Automatizaciones', icon: Waypoints },
  { label: 'Ajustes', icon: Settings2 },
];

const PRIORITY_STRIP = [
  { label: 'Sin confirmar', value: '3', tone: 'amber' },
  { label: 'Mismatch', value: '2', tone: 'rose' },
  { label: 'Seguimiento', value: '4', tone: 'sky' },
];

const TIMELINE = [
  {
    time: '08:30',
    patient: 'María Fernanda V.',
    type: 'Recurrente',
    state: 'Confirmada',
    payment: 'Pagado',
    note: 'llega online, dejó nota previa anoche',
  },
  {
    time: '10:00',
    patient: 'José Manuel A.',
    type: 'Nuevo ingreso',
    state: 'Espera confirmación',
    payment: 'Pendiente',
    note: 'primer contacto, vino por referencia',
  },
  {
    time: '12:30',
    patient: 'Camila Rojas',
    type: 'Reactivación',
    state: 'Reagendar',
    payment: 'Mismatch',
    note: 'mandó comprobante con monto distinto',
  },
  {
    time: '16:00',
    patient: 'Marcelo Iturri',
    type: 'Seguimiento',
    state: 'Confirmada',
    payment: 'Pendiente',
    note: 'requiere recordatorio de pago antes de las 15:00',
  },
];

const ACTION_QUEUE = [
  {
    title: 'Pago con mismatch',
    detail: 'Camila Rojas • OCR leyó Bs 180 y la sesión es Bs 250',
    tone: 'rose',
  },
  {
    title: 'Paciente en riesgo',
    detail: 'José Manuel no confirmó y abrió el mensaje hace 2 h',
    tone: 'amber',
  },
  {
    title: 'Reactivación automática',
    detail: 'Luciana cumple 28 días sin reserva. Lista para enviar plantilla.',
    tone: 'sky',
  },
];

const FUNNEL = [
  { label: 'Nuevos', value: '14', sub: '+3 esta semana' },
  { label: 'Activos', value: '62', sub: '87% asistencia' },
  { label: 'En riesgo', value: '9', sub: 'requieren seguimiento' },
  { label: 'Recuperados', value: '5', sub: 'reactivados este mes' },
];

const INBOX_THREADS = [
  {
    name: 'Paola Suárez',
    meta: 'hace 8 min',
    message: 'Te envié el comprobante, ¿me confirmas si está bien?',
    tag: 'Cobro',
  },
  {
    name: 'Rodrigo M.',
    meta: 'hace 21 min',
    message: '¿Hay espacio mañana después de las 18:00?',
    tag: 'Reagendar',
  },
  {
    name: 'Luciana V.',
    meta: 'ayer',
    message: 'Gracias, ya me sirve ese horario.',
    tag: 'Cerrado',
  },
];

const AUTOMATIONS = [
  '24h antes: reintentar confirmación si no hubo click',
  '12h después: pedir comprobante si la cita sigue pendiente',
  '21 días sin agenda: reactivar por WhatsApp',
];

function toneClasses(tone) {
  if (tone === 'rose') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (tone === 'amber') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-sky-100 text-sky-700 border-sky-200';
}

function statusClasses(state) {
  if (state === 'Confirmada') return 'bg-emerald-100 text-emerald-700';
  if (state === 'Espera confirmación') return 'bg-amber-100 text-amber-700';
  if (state === 'Reagendar') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
}

function paymentClasses(state) {
  if (state === 'Pagado') return 'text-emerald-700';
  if (state === 'Mismatch') return 'text-rose-700';
  return 'text-slate-500';
}

function PreviewPanel({ eyebrow, title, description, children, className = '', delay = 0 }) {
  return (
    <section
      className={`preview-enter rounded-[28px] border border-white/70 bg-white/82 backdrop-blur-xl shadow-[0_30px_80px_rgba(15,23,42,0.08)] ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="border-b border-slate-200/70 px-6 py-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
            {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function AdminPreview() {
  return (
    <div className="preview-admin-shell min-h-screen overflow-hidden bg-[#f4efe7] text-slate-900">
      <div className="preview-halo preview-halo-a" />
      <div className="preview-halo preview-halo-b" />

      <div className="relative flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full border-b border-black/5 bg-[#f8f3ec]/92 px-5 py-6 backdrop-blur-xl lg:w-[290px] lg:border-b-0 lg:border-r lg:px-7">
          <div className="preview-enter flex items-center justify-between pb-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#b3643d]">Agenda Daniel MacLean</div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Desk Preview</div>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#b3643d] text-white shadow-[0_18px_40px_rgba(179,100,61,0.28)]">
              <Stethoscope size={22} />
            </div>
          </div>

          <div className="preview-enter relative mb-6" style={{ animationDelay: '80ms' }}>
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              readOnly
              value="Buscar paciente, mensaje o cobro"
              className="w-full rounded-2xl border border-white/80 bg-white/80 py-3 pl-11 pr-4 text-sm text-slate-500 outline-none"
            />
          </div>

          <nav className="preview-enter space-y-1.5" style={{ animationDelay: '140ms' }}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`group flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-all duration-200 ${
                    item.active
                      ? 'bg-[#1e2533] text-white shadow-[0_20px_45px_rgba(15,23,42,0.22)]'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={18} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </span>
                  <ChevronRight size={16} className={item.active ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-60'} />
                </button>
              );
            })}
          </nav>

          <div className="preview-enter mt-8 rounded-[26px] bg-[#1e2533] p-5 text-white shadow-[0_20px_45px_rgba(15,23,42,0.24)]" style={{ animationDelay: '220ms' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold">Modo operador</div>
                <div className="text-xs text-white/65">El admin ya no explica. Prioriza.</div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-white/60">Asistencia</div>
                <div className="mt-1 text-xl font-semibold">87%</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-white/60">Cobrado</div>
                <div className="mt-1 text-xl font-semibold">Bs 18.4k</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="preview-enter border-b border-black/5 px-5 py-5 lg:px-8" style={{ animationDelay: '90ms' }}>
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">Command Center</div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h1 className="text-[clamp(2rem,3vw,3.35rem)] font-semibold tracking-[-0.04em] text-slate-950">Hoy, martes 30</h1>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-sm text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.15)]" />
                    Operación estable
                  </span>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
                  Un escritorio de consulta hecho para decidir rápido: quién requiere atención, quién debe pagar y qué conversación no puede quedar dormida.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {PRIORITY_STRIP.map((item) => (
                  <div key={item.label} className={`rounded-2xl border px-4 py-3 ${toneClasses(item.tone)}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em]">{item.label}</div>
                    <div className="mt-1 text-2xl font-semibold">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </header>

          <main className="px-5 py-6 lg:px-8 lg:py-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_390px]">
              <div className="space-y-6">
                <PreviewPanel
                  eyebrow="Workspace"
                  title="Agenda viva del día"
                  description="No es una lista de citas. Es una línea de operación con decisiones, cobro y contexto en el mismo plano."
                  delay={120}
                >
                  <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="space-y-3">
                      {TIMELINE.map((item, index) => (
                        <div
                          key={item.time}
                          className="group flex flex-col gap-4 rounded-[24px] border border-slate-200/80 bg-[#fcfbf8] px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_40px_rgba(15,23,42,0.07)] md:flex-row md:items-center"
                        >
                          <div className="flex items-center gap-4 md:w-[122px] md:flex-none">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1f2937] text-sm font-semibold text-white">
                              {index + 1}
                            </div>
                            <div>
                              <div className="text-lg font-semibold tracking-tight text-slate-900">{item.time}</div>
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.type}</div>
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base font-semibold text-slate-900">{item.patient}</div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses(item.state)}`}>{item.state}</span>
                            </div>
                            <div className="mt-1 text-sm text-slate-500">{item.note}</div>
                          </div>

                          <div className="flex items-center justify-between gap-4 md:w-[158px] md:flex-none md:justify-end">
                            <div className="text-right">
                              <div className={`text-sm font-semibold ${paymentClasses(item.payment)}`}>{item.payment}</div>
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Pago</div>
                            </div>
                            <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
                              Abrir
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-200/80 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-700">
                        <BellRing size={16} />
                        Atención inmediata
                      </div>
                      <div className="space-y-3">
                        {ACTION_QUEUE.map((item) => (
                          <div key={item.title} className={`rounded-[22px] border px-4 py-4 ${toneClasses(item.tone)}`}>
                            <div className="text-sm font-semibold">{item.title}</div>
                            <div className="mt-1 text-sm leading-6 opacity-90">{item.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </PreviewPanel>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
                  <PreviewPanel
                    eyebrow="Patients"
                    title="Radar de cartera"
                    description="Segmentos de pacientes para vender seguimiento, no solo para listar nombres."
                    className="overflow-hidden"
                    delay={180}
                  >
                    <div className="divide-y divide-slate-200/70 px-6">
                      {FUNNEL.map((item) => (
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
                    description="La venta futura está en que el sistema haga seguimiento sin pedirle memoria al terapeuta."
                    delay={220}
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
                  title="Conversaciones que mueven caja"
                  description="No logs. Hilos priorizados por intención y tiempo."
                  delay={150}
                >
                  <div className="space-y-3 px-6 py-6">
                    {INBOX_THREADS.map((thread) => (
                      <button
                        key={thread.name}
                        type="button"
                        className="flex w-full items-start gap-4 rounded-[24px] border border-slate-200/80 bg-[#fcfbf8] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_36px_rgba(15,23,42,0.06)]"
                      >
                        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-[#d8704a] text-sm font-semibold text-white">
                          {thread.name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">{thread.name}</div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{thread.meta}</div>
                          </div>
                          <div className="mt-1 text-sm leading-6 text-slate-500">{thread.message}</div>
                        </div>
                        <div className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                          {thread.tag}
                        </div>
                      </button>
                    ))}
                  </div>
                </PreviewPanel>

                <PreviewPanel
                  eyebrow="Revenue"
                  title="Pulso comercial"
                  description="La app se ve vendible cuando hace visible cuánto está entrando, cuánto está trabado y dónde actuar."
                  delay={210}
                >
                  <div className="grid gap-4 px-6 py-6">
                    <div className="rounded-[24px] bg-[#1f2937] p-5 text-white">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-white/50">Ingresos proyectados</div>
                          <div className="mt-2 text-4xl font-semibold tracking-tight">Bs 24.500</div>
                        </div>
                        <TrendingUp size={24} className="text-emerald-300" />
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-[74%] rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300" />
                      </div>
                      <div className="mt-3 text-sm text-white/60">74% ya confirmado antes del cierre del mes</div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-[22px] bg-[#f6f1ea] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                          <FileWarning size={16} className="text-rose-500" />
                          En revisión
                        </div>
                        <div className="mt-3 text-3xl font-semibold text-slate-950">Bs 680</div>
                        <div className="mt-1 text-sm text-slate-400">2 comprobantes dudosos</div>
                      </div>
                      <div className="rounded-[22px] bg-[#f6f1ea] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                          <ShieldCheck size={16} className="text-emerald-500" />
                          Cobrado hoy
                        </div>
                        <div className="mt-3 text-3xl font-semibold text-slate-950">Bs 1.250</div>
                        <div className="mt-1 text-sm text-slate-400">4 pagos cerrados</div>
                      </div>
                    </div>
                  </div>
                </PreviewPanel>

                <PreviewPanel
                  eyebrow="Product Direction"
                  title="Lo que vendería esta versión"
                  description="Una sola pantalla ya deja ver agenda, cobro, pacientes e inbox como un mismo producto."
                  delay={260}
                >
                  <div className="space-y-4 px-6 py-6 text-sm leading-7 text-slate-500">
                    <div className="flex items-start gap-3">
                      <LayoutGrid size={18} className="mt-1 text-[#b3643d]" />
                      <div>Menos módulos sueltos, más centro operativo con decisiones rápidas.</div>
                    </div>
                    <div className="flex items-start gap-3">
                      <MessageSquareMore size={18} className="mt-1 text-[#b3643d]" />
                      <div>WhatsApp deja de ser log y pasa a ser inbox conectado al negocio.</div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Activity size={18} className="mt-1 text-[#b3643d]" />
                      <div>Los cobros se priorizan por fricción, no por fila de tabla.</div>
                    </div>
                    <button type="button" className="mt-2 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 font-medium text-white transition hover:bg-slate-800">
                      Continuar hacia diseño completo
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </PreviewPanel>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
