import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  CircleAlert,
  Clock3,
  Target,
  Wallet,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { formatTimeBolivia, getBoliviaDateKey } from '../../utils/dates';
import { Toast, useToast } from '../../hooks/useToast';
import useAdminEvents from '../../hooks/useAdminEvents';
import { useUiTheme } from '../../hooks/useUiTheme';
import './Preview.css';

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

function getBoliviaDateParts(dateInput = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(dateInput));

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value || 0),
    month: Number(parts.find((part) => part.type === 'month')?.value || 0),
    day: Number(parts.find((part) => part.type === 'day')?.value || 0),
  };
}

function formatLongDate(dateInput = new Date()) {
  const formatter = new Intl.DateTimeFormat('es-BO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/La_Paz',
  });
  const text = formatter.format(new Date(dateInput));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatMonthLabel(dateInput = new Date()) {
  const formatter = new Intl.DateTimeFormat('es-BO', {
    month: 'long',
    timeZone: 'America/La_Paz',
  });
  const text = formatter.format(new Date(dateInput));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getAppointmentStatus(appt) {
  return appt.type === 'virtual' ? 'Recurrente' : appt.status || 'Agendada';
}

function getAppointmentEnd(appt, durationMinutes) {
  return new Date(new Date(appt.date_time).getTime() + durationMinutes * 60000);
}

function getNextAppointment(appointments, durationMinutes, now) {
  return appointments.find((appt) => {
    const status = getAppointmentStatus(appt);
    if (['Cancelada', 'No-show'].includes(status)) return false;
    return getAppointmentEnd(appt, durationMinutes) >= now;
  }) || null;
}

function getPendingItems(appointments) {
  const priorityMap = { mismatch: 0, payment: 1, confirmation: 2 };

  return appointments
    .map((appt) => {
      const status = getAppointmentStatus(appt);
      const patientName = `${appt.first_name || ''} ${appt.last_name || ''}`.trim();
      const time = formatTimeBolivia(appt.date_time);

      if (appt.payment_status === 'Mismatch') {
        return {
          key: `${buildAgendaKey(appt)}-mismatch`,
          priority: priorityMap.mismatch,
          label: 'Revisar comprobante',
          detail: `${patientName} · ${time}`,
          tone: 'rose',
        };
      }

      if (status === 'Completada' && appt.payment_status !== 'Confirmado') {
        return {
          key: `${buildAgendaKey(appt)}-payment`,
          priority: priorityMap.payment,
          label: 'Cobro por cerrar',
          detail: `${patientName} · ${time}`,
          tone: 'amber',
        };
      }

      if (appt.type === 'virtual' || ['Agendada', 'Reagendada'].includes(status)) {
        return {
          key: `${buildAgendaKey(appt)}-confirmation`,
          priority: priorityMap.confirmation,
          label: 'Aún sin confirmar',
          detail: `${patientName} · ${time}`,
          tone: 'sky',
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 6);
}

function computeFutureGaps(appointments, durationMinutes, now) {
  const activeAppointments = appointments
    .filter((appt) => !['Cancelada', 'No-show'].includes(getAppointmentStatus(appt)))
    .sort((a, b) => new Date(a.date_time) - new Date(b.date_time));

  const futureAppointments = activeAppointments.filter((appt) => getAppointmentEnd(appt, durationMinutes) >= now);
  if (futureAppointments.length === 0) return [];

  const windows = [];
  const firstStart = new Date(futureAppointments[0].date_time);
  const leadMinutes = Math.round((firstStart - now) / 60000);

  if (leadMinutes >= 30) {
    windows.push({
      key: 'lead-gap',
      start: now,
      end: firstStart,
      minutes: leadMinutes,
    });
  }

  for (let index = 0; index < futureAppointments.length - 1; index += 1) {
    const currentEnd = getAppointmentEnd(futureAppointments[index], durationMinutes);
    const nextStart = new Date(futureAppointments[index + 1].date_time);
    const gapMinutes = Math.round((nextStart - currentEnd) / 60000);

    if (gapMinutes >= 30) {
      windows.push({
        key: `gap-${index}`,
        start: currentEnd,
        end: nextStart,
        minutes: gapMinutes,
      });
    }
  }

  return windows.slice(0, 3);
}

function getTimelineToneClasses(status, isDark, isNext) {
  if (isNext) {
    return isDark
      ? 'border-l-amber-300 bg-amber-400/8'
      : 'border-l-[#b3643d] bg-[#f8efe5]';
  }

  if (status === 'Completada') {
    return isDark
      ? 'border-l-emerald-400/70 bg-emerald-500/6'
      : 'border-l-emerald-500 bg-emerald-50';
  }

  if (status === 'Cancelada' || status === 'No-show') {
    return isDark
      ? 'border-l-slate-600 bg-slate-800/40'
      : 'border-l-slate-300 bg-slate-100/70';
  }

  return isDark
    ? 'border-l-white/12 bg-white/[0.03]'
    : 'border-l-slate-200 bg-white';
}

function statusPillClasses(status, isDark) {
  const dark = {
    Recurrente: 'bg-sky-500/14 text-sky-100',
    Confirmada: 'bg-emerald-500/14 text-emerald-100',
    Completada: 'bg-white text-slate-950',
    Agendada: 'bg-amber-400/14 text-amber-50',
    Reagendada: 'bg-amber-400/14 text-amber-50',
    'No-show': 'bg-rose-500/14 text-rose-100',
    Cancelada: 'bg-slate-700 text-slate-200',
  };
  const light = {
    Recurrente: 'bg-sky-100 text-sky-700',
    Confirmada: 'bg-emerald-100 text-emerald-700',
    Completada: 'bg-slate-900 text-white',
    Agendada: 'bg-amber-100 text-amber-700',
    Reagendada: 'bg-amber-100 text-amber-700',
    'No-show': 'bg-rose-100 text-rose-700',
    Cancelada: 'bg-slate-200 text-slate-600',
  };

  const palette = isDark ? dark : light;
  return palette[status] || palette.Agendada;
}

function paymentPillClasses(status, isDark) {
  const dark = {
    Confirmado: 'bg-emerald-500/14 text-emerald-100',
    Pendiente: 'bg-amber-400/14 text-amber-50',
    Mismatch: 'bg-rose-500/14 text-rose-100',
    Rechazado: 'bg-rose-500/14 text-rose-100',
    default: 'bg-white/8 text-slate-300',
  };
  const light = {
    Confirmado: 'bg-emerald-100 text-emerald-700',
    Pendiente: 'bg-amber-100 text-amber-700',
    Mismatch: 'bg-rose-100 text-rose-700',
    Rechazado: 'bg-rose-100 text-rose-700',
    default: 'bg-slate-100 text-slate-500',
  };

  const palette = isDark ? dark : light;
  return palette[status] || palette.default;
}

function issueToneClasses(tone, isDark) {
  const dark = {
    rose: 'border-rose-500/20 bg-rose-500/8 text-rose-100',
    amber: 'border-amber-400/20 bg-amber-400/8 text-amber-50',
    sky: 'border-sky-500/20 bg-sky-500/8 text-sky-100',
  };
  const light = {
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
  };

  const palette = isDark ? dark : light;
  return palette[tone] || palette.sky;
}

function ProgressBar({ progress, isDark }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full ${isDark ? 'bg-white/8' : 'bg-slate-200'}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          progress >= 100
            ? 'bg-emerald-500'
            : progress >= 60
              ? 'bg-sky-500'
              : 'bg-amber-500'
        }`}
        style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
      />
    </div>
  );
}

function AgendaRow({ appt, isDark, isNext, durationMinutes }) {
  const status = getAppointmentStatus(appt);
  const timelineTone = getTimelineToneClasses(status, isDark, isNext);
  const note = appt.notes || appt.payment_notes || '';
  const shellText = isDark ? 'text-white' : 'text-slate-950';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const faintText = isDark ? 'text-slate-500' : 'text-slate-400';
  const endTime = formatTimeBolivia(getAppointmentEnd(appt, durationMinutes));

  return (
    <article className={`border-l-4 px-4 py-4 sm:px-5 ${timelineTone}`}>
      <div className="grid gap-4 md:grid-cols-[92px_minmax(0,1fr)_minmax(0,200px)] md:items-start">
        <div>
          <div className={`text-2xl font-semibold tracking-tight ${shellText}`}>{formatTimeBolivia(appt.date_time)}</div>
          <div className={`mt-1 text-xs uppercase tracking-[0.18em] ${faintText}`}>
            hasta {endTime}
          </div>
          {isNext ? (
            <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
              isDark ? 'bg-amber-400/14 text-amber-100' : 'bg-[#f3e4d5] text-[#8c4f2b]'
            }`}>
              Sigue
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className={`text-lg font-semibold tracking-tight ${shellText}`}>
            {`${appt.first_name || ''} ${appt.last_name || ''}`.trim() || 'Paciente sin nombre'}
          </div>
          <div className={`mt-1 flex flex-wrap items-center gap-2 text-sm ${mutedText}`}>
            <span>{appt.client_phone || 'Sin teléfono'}</span>
            {appt.session_number ? <span>Sesión {appt.session_number}</span> : null}
            {appt.type === 'virtual' ? <span>Recurrente</span> : null}
          </div>
          <div className={`mt-3 text-sm leading-6 ${note ? mutedText : faintText}`}>
            {note || 'Sin contexto añadido para esta cita.'}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2 md:justify-end">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClasses(status, isDark)}`}>
            {status}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${paymentPillClasses(appt.payment_status, isDark)}`}>
            {appt.payment_status || (status === 'Completada' ? 'Sin cobro' : 'Sin pago')}
          </span>
          {appt.payment_amount ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-100 text-slate-600'
            }`}>
              {formatMoney(appt.payment_amount)}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Section({ title, description, isDark, children, className = '' }) {
  return (
    <section className={`preview-enter overflow-hidden rounded-[28px] border ${className} ${
      isDark
        ? 'border-white/10 bg-[rgba(7,12,17,0.86)]'
        : 'border-slate-200/80 bg-[rgba(255,255,255,0.92)]'
    }`}>
      <div className={`px-6 py-5 ${isDark ? 'border-b border-white/10' : 'border-b border-slate-200/80'}`}>
        <h2 className={`text-lg font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-950'}`}>{title}</h2>
        {description ? (
          <p className={`mt-1 text-sm leading-6 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const [todayAppts, setTodayAppts] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [appointmentDuration, setAppointmentDuration] = useState(60);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();
  const { isDark } = useUiTheme();

  const loadDashboard = useCallback(async () => {
    setLoading(true);

    try {
      const today = getBoliviaDateKey();
      const { year, month } = getBoliviaDateParts();

      const [appts, recurring, paymentSummary, config] = await Promise.all([
        api.get('/appointments/today'),
        api.get(`/recurring/upcoming?from=${today}&to=${today}`).catch(() => []),
        api.get(`/payments/summary?year=${year}&month=${month}`).catch(() => null),
        api.get('/config').catch(() => null),
      ]);

      setTodayAppts(mergeTodayAgenda(appts || [], recurring || []));
      setMonthlySummary(paymentSummary || null);
      setAppointmentDuration(Number(config?.appointment_duration) || 60);
    } catch (err) {
      showToast(`Error cargando Hoy: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useAdminEvents(['appointment:change', 'recurring:change', 'payment:change'], loadDashboard);

  const now = new Date();
  const nowParts = getBoliviaDateParts(now);
  const nextAppointment = getNextAppointment(todayAppts, appointmentDuration, now);
  const nextAppointmentKey = nextAppointment ? buildAgendaKey(nextAppointment) : null;
  const pendingItems = getPendingItems(todayAppts);
  const futureGaps = computeFutureGaps(todayAppts, appointmentDuration, now);

  const totalToday = todayAppts.length;
  const confirmedToday = todayAppts.filter((appt) => getAppointmentStatus(appt) === 'Confirmada').length;
  const completedToday = todayAppts.filter((appt) => getAppointmentStatus(appt) === 'Completada').length;
  const unconfirmedToday = todayAppts.filter((appt) => {
    const status = getAppointmentStatus(appt);
    return appt.type === 'virtual' || ['Agendada', 'Reagendada'].includes(status);
  }).length;
  const unresolvedPaymentsToday = todayAppts.filter((appt) => {
    const status = getAppointmentStatus(appt);
    return status === 'Completada' && appt.payment_status !== 'Confirmado';
  });
  const unresolvedPaymentsAmount = unresolvedPaymentsToday.reduce((sum, appt) => sum + Number(appt.payment_amount || 0), 0);

  const currentMonth = monthlySummary?.current || {};
  const goalAmount = monthlySummary?.monthly_goal ? Number(monthlySummary.monthly_goal) : null;
  const confirmedMonth = Number(currentMonth.income_confirmed || 0);
  const pendingMonth = Number(currentMonth.income_pending || 0);
  const paidSessionsMonth = Number(currentMonth.paid_sessions || 0);
  const totalSessionsMonth = Number(currentMonth.total_sessions || 0);
  const averageFee = paidSessionsMonth > 0 ? confirmedMonth / paidSessionsMonth : 250;
  const goalProgress = goalAmount ? Math.min((confirmedMonth / goalAmount) * 100, 100) : 0;
  const goalRemaining = goalAmount ? Math.max(goalAmount - confirmedMonth, 0) : 0;
  const sessionsNeeded = goalAmount ? Math.ceil(goalRemaining / Math.max(averageFee, 1)) : 0;
  const daysInMonth = new Date(nowParts.year, nowParts.month, 0).getDate();
  const expectedByToday = goalAmount ? (goalAmount * nowParts.day) / daysInMonth : 0;
  const paceGap = goalAmount ? confirmedMonth - expectedByToday : 0;
  const projectedMonth = confirmedMonth + pendingMonth;

  const shellText = isDark ? 'text-slate-100' : 'text-slate-900';
  const subtleText = isDark ? 'text-slate-400' : 'text-slate-500';
  const faintText = isDark ? 'text-slate-500' : 'text-slate-400';
  const dividerClass = isDark ? 'border-white/10' : 'border-slate-200/80';
  const pageSurface = isDark ? 'bg-[#071018]' : 'bg-[#f6f3ed]';

  const summaryItems = [
    {
      label: 'Citas de hoy',
      value: String(totalToday),
      detail: completedToday > 0 ? `${completedToday} ya cerradas` : 'Aún sin cierres',
      icon: CalendarDays,
    },
    {
      label: 'Sigue',
      value: nextAppointment ? formatTimeBolivia(nextAppointment.date_time) : 'Sin más citas',
      detail: nextAppointment ? `${nextAppointment.first_name} ${nextAppointment.last_name || ''}`.trim() : 'El día ya no tiene sesiones futuras',
      icon: Clock3,
    },
    {
      label: 'Sin confirmar',
      value: String(unconfirmedToday),
      detail: confirmedToday > 0 ? `${confirmedToday} confirmadas` : 'Sin confirmadas todavía',
      icon: CircleAlert,
    },
    {
      label: 'Cobro por cerrar',
      value: unresolvedPaymentsAmount > 0 ? formatMoney(unresolvedPaymentsAmount) : String(unresolvedPaymentsToday.length),
      detail: unresolvedPaymentsToday.length > 0 ? `${unresolvedPaymentsToday.length} cita(s) completadas sin cierre` : 'Nada pendiente por cobrar hoy',
      icon: Wallet,
    },
  ];

  return (
    <AdminLayout title="Hoy">
      <Toast toast={toast} />

      <div className={`preview-admin-shell relative -mx-4 -mt-4 min-h-full px-4 pb-6 pt-4 lg:-mx-6 lg:-mt-6 lg:px-6 lg:pb-8 lg:pt-6 ${pageSurface} ${shellText}`}>
        <div className="preview-enter" style={{ animationDelay: '40ms' }}>
          <div className={`rounded-[32px] border px-6 py-6 ${isDark ? 'border-white/10 bg-[#0b141d]' : 'border-slate-200/80 bg-white/90'}`}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className={`text-xs font-semibold uppercase tracking-[0.24em] ${faintText}`}>Operación diaria</div>
                <h1 className={`mt-2 text-[clamp(2rem,3vw,3.25rem)] font-semibold tracking-[-0.05em] ${isDark ? 'text-white' : 'text-slate-950'}`}>
                  Hoy
                </h1>
                <p className={`mt-3 max-w-2xl text-sm leading-7 ${subtleText}`}>
                  {formatLongDate()} · agenda, pendientes del día y ritmo real de la meta mensual.
                </p>
              </div>

              <div className={`rounded-2xl px-4 py-3 ${isDark ? 'bg-white/6 text-slate-200' : 'bg-[#f6f1ea] text-slate-600'}`}>
                <div className="text-[11px] uppercase tracking-[0.18em]">Meta de {formatMonthLabel()}</div>
                <div className={`mt-1 text-2xl font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-950'}`}>
                  {goalAmount ? `${Math.round(goalProgress)}%` : 'Sin meta'}
                </div>
                <div className={`mt-1 text-sm ${subtleText}`}>
                  {goalAmount ? `${formatMoney(confirmedMonth)} confirmados` : 'Defínela en Finanzas para ver ritmo'}
                </div>
              </div>
            </div>

            <div className={`mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2 xl:grid-cols-4 ${dividerClass}`}>
              {summaryItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="min-w-0">
                    <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] ${faintText}`}>
                      <Icon size={14} />
                      {item.label}
                    </div>
                    <div className={`mt-2 text-2xl font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-950'}`}>
                      {item.value}
                    </div>
                    <div className={`mt-1 text-sm leading-6 ${subtleText}`}>{item.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_340px]">
          <div className="space-y-6">
            <Section
              title="Línea del día"
              description="Una vista densa de cada cita con estado, cobro y contexto. Sin comandos duplicados."
              isDark={isDark}
              className="preview-enter"
            >
              <div className={isDark ? 'divide-y divide-white/10' : 'divide-y divide-slate-200/80'}>
                {loading ? (
                  <div className={`px-6 py-12 text-sm ${subtleText}`}>Cargando agenda de hoy…</div>
                ) : todayAppts.length === 0 ? (
                  <div className={`px-6 py-12 text-sm ${subtleText}`}>No hay citas cargadas para hoy.</div>
                ) : (
                  todayAppts.map((appt) => (
                    <AgendaRow
                      key={buildAgendaKey(appt)}
                      appt={appt}
                      isDark={isDark}
                      isNext={buildAgendaKey(appt) === nextAppointmentKey}
                      durationMinutes={appointmentDuration}
                    />
                  ))
                )}
              </div>
            </Section>
          </div>

          <div className="space-y-6">
            <Section
              title="Próxima cita"
              description="Lo siguiente en tu jornada, con el mínimo contexto útil."
              isDark={isDark}
              className="preview-enter"
            >
              <div className="px-6 py-6">
                {nextAppointment ? (
                  <div>
                    <div className={`text-4xl font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-950'}`}>
                      {formatTimeBolivia(nextAppointment.date_time)}
                    </div>
                    <div className={`mt-2 text-lg font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                      {`${nextAppointment.first_name || ''} ${nextAppointment.last_name || ''}`.trim()}
                    </div>
                    <div className={`mt-2 text-sm ${subtleText}`}>{nextAppointment.client_phone || 'Sin teléfono'}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClasses(getAppointmentStatus(nextAppointment), isDark)}`}>
                        {getAppointmentStatus(nextAppointment)}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${paymentPillClasses(nextAppointment.payment_status, isDark)}`}>
                        {nextAppointment.payment_status || 'Sin pago'}
                      </span>
                    </div>
                    <div className={`mt-4 text-sm leading-6 ${nextAppointment.notes || nextAppointment.payment_notes ? subtleText : faintText}`}>
                      {nextAppointment.notes || nextAppointment.payment_notes || 'Sin nota visible para la próxima cita.'}
                    </div>
                  </div>
                ) : (
                  <div className={`text-sm leading-6 ${subtleText}`}>
                    No quedan sesiones futuras hoy. Si entran cambios, esta columna se actualiza sola.
                  </div>
                )}
              </div>
            </Section>

            <Section
              title="Pendientes de hoy"
              description="Lo que todavía exige revisión humana antes de dar el día por cerrado."
              isDark={isDark}
              className="preview-enter"
            >
              <div className="space-y-3 px-6 py-6">
                {pendingItems.length === 0 ? (
                  <div className={`rounded-[22px] border border-dashed px-4 py-5 text-sm ${isDark ? 'border-white/12 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
                    Nada urgente por revisar ahora mismo.
                  </div>
                ) : (
                  pendingItems.map((item) => (
                    <div key={item.key} className={`rounded-[22px] border px-4 py-4 ${issueToneClasses(item.tone, isDark)}`}>
                      <div className="text-sm font-semibold">{item.label}</div>
                      <div className="mt-1 text-sm opacity-90">{item.detail}</div>
                    </div>
                  ))
                )}
              </div>
            </Section>

            <Section
              title={`Meta de ${formatMonthLabel()}`}
              description="Lo confirmado, lo que falta y si el ritmo del mes alcanza."
              isDark={isDark}
              className="preview-enter"
            >
              <div className="space-y-5 px-6 py-6">
                {goalAmount ? (
                  <>
                    <div>
                      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] ${faintText}`}>
                        <Target size={14} />
                        Progreso
                      </div>
                      <div className={`mt-2 flex items-end justify-between gap-4 ${isDark ? 'text-white' : 'text-slate-950'}`}>
                        <div className="text-3xl font-semibold tracking-tight">{Math.round(goalProgress)}%</div>
                        <div className={`text-sm ${subtleText}`}>{formatMoney(confirmedMonth)} de {formatMoney(goalAmount)}</div>
                      </div>
                      <div className="mt-3">
                        <ProgressBar progress={goalProgress} isDark={isDark} />
                      </div>
                    </div>

                    <div className={`grid gap-4 sm:grid-cols-2 ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                      <div>
                        <div className={`text-xs uppercase tracking-[0.18em] ${faintText}`}>Falta</div>
                        <div className="mt-1 text-lg font-semibold">{formatMoney(goalRemaining)}</div>
                        <div className={`mt-1 text-sm ${subtleText}`}>
                          Aproximadamente {sessionsNeeded} sesiones más.
                        </div>
                      </div>

                      <div>
                        <div className={`text-xs uppercase tracking-[0.18em] ${faintText}`}>Ritmo</div>
                        <div className="mt-1 text-lg font-semibold">
                          {paceGap >= 0 ? 'Por encima' : 'Por debajo'}
                        </div>
                        <div className={`mt-1 text-sm ${subtleText}`}>
                          {formatMoney(Math.abs(paceGap))} respecto al ritmo esperado de hoy.
                        </div>
                      </div>
                    </div>

                    <div className={`rounded-[22px] px-4 py-4 ${isDark ? 'bg-white/5 text-slate-200' : 'bg-[#f6f1ea] text-slate-700'}`}>
                      <div className="text-sm font-semibold">Si entra todo lo pendiente del mes</div>
                      <div className="mt-1 text-sm leading-6">
                        Proyectas {formatMoney(projectedMonth)}. Quedan {daysInMonth - nowParts.day} días para cerrar {formatMonthLabel().toLowerCase()}.
                      </div>
                    </div>
                  </>
                ) : (
                  <div className={`text-sm leading-6 ${subtleText}`}>
                    Aún no hay meta definida. La pantalla puede mostrar progreso y ritmo apenas la fijes en Finanzas.
                  </div>
                )}

                <div className={`border-t pt-4 ${dividerClass}`}>
                  <div className={`text-xs uppercase tracking-[0.18em] ${faintText}`}>Mes actual</div>
                  <div className={`mt-2 grid gap-3 sm:grid-cols-2 ${subtleText}`}>
                    <div>
                      <div className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-slate-950'}`}>{formatMoney(pendingMonth)}</div>
                      <div className="text-sm">Pendiente de cobro en el mes</div>
                    </div>
                    <div>
                      <div className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-slate-950'}`}>{paidSessionsMonth} / {totalSessionsMonth}</div>
                      <div className="text-sm">Sesiones cobradas sobre sesiones del mes</div>
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <Section
              title="Huecos libres"
              description="Ventanas de hoy que todavía te dejan aire o movimiento."
              isDark={isDark}
              className="preview-enter"
            >
              <div className="space-y-3 px-6 py-6">
                {futureGaps.length === 0 ? (
                  <div className={`text-sm leading-6 ${subtleText}`}>
                    No aparecen huecos amplios entre las citas futuras de hoy.
                  </div>
                ) : (
                  futureGaps.map((gap) => (
                    <div key={gap.key} className={`rounded-[22px] px-4 py-4 ${isDark ? 'bg-white/5 text-slate-200' : 'bg-[#f6f1ea] text-slate-700'}`}>
                      <div className="text-sm font-semibold">
                        {formatTimeBolivia(gap.start)} → {formatTimeBolivia(gap.end)}
                      </div>
                      <div className={`mt-1 text-sm ${subtleText}`}>
                        {gap.minutes} minutos libres entre sesiones.
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
