import { useEffect, useMemo, useState } from 'react';
import { Repeat, X } from 'lucide-react';
import { useUiTheme } from '../hooks/useUiTheme';
import { formatDateTimeBolivia, formatTimeBolivia, getBoliviaDateKey } from '../utils/dates';

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getDayOfWeekFromDateTime(dateTime) {
  if (!dateTime) return '';
  const weekday = normalizeText(
    new Intl.DateTimeFormat('es-BO', {
      timeZone: 'America/La_Paz',
      weekday: 'long',
    }).format(new Date(dateTime))
  );
  const map = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  return map[weekday] ?? '';
}

function buildInitialForm(schedule, sourceAppointment) {
  return {
    day_of_week: schedule?.day_of_week ?? getDayOfWeekFromDateTime(sourceAppointment?.date_time),
    time: schedule?.time ?? (sourceAppointment?.date_time ? formatTimeBolivia(sourceAppointment.date_time) : ''),
    started_at: schedule?.started_at || (sourceAppointment?.date_time ? getBoliviaDateKey(sourceAppointment.date_time) : getBoliviaDateKey()),
  };
}

export default function RecurringQuickModal({
  open,
  clientName,
  schedule = null,
  sourceAppointment = null,
  saving = false,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState(() => buildInitialForm(schedule, sourceAppointment));
  const { isDark } = useUiTheme();

  useEffect(() => {
    if (!open) return;
    setForm(buildInitialForm(schedule, sourceAppointment));
  }, [open, schedule, sourceAppointment]);

  const title = schedule && !schedule.ended_at ? 'Editar recurrencia' : 'Poner en recurrencia';
  const sourceLabel = useMemo(() => {
    if (!sourceAppointment?.date_time) return null;
    return formatDateTimeBolivia(sourceAppointment.date_time);
  }, [sourceAppointment]);
  const sourceTone = sourceAppointment?.status === 'Completada'
    ? 'última sesión completada'
    : 'cita próxima';

  const themeClasses = isDark
    ? {
        backdrop: 'fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,12,0.72)] px-4 backdrop-blur-sm',
        panel: 'w-full max-w-md rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,23,31,0.98),rgba(10,14,20,0.98))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.55)]',
        badge: 'inline-flex items-center gap-2 rounded-full border border-[#d6b16b]/30 bg-[#d6b16b]/12 px-3 py-1 text-xs font-semibold text-[#f3cf8c]',
        title: 'mt-3 text-lg font-semibold text-white',
        subtitle: 'mt-1 text-sm text-slate-400',
        close: 'text-slate-500 transition hover:text-white',
        info: 'mt-4 rounded-xl border border-[#4a7fa4]/40 bg-[#10212f] px-4 py-3 text-sm text-[#b5d8ef]',
        warning: 'mt-4 rounded-xl border border-[#d6b16b]/30 bg-[#2b2414] px-4 py-3 text-sm text-[#f1d698]',
        label: 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400',
        control: 'w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-none transition focus:border-[#7fb5d6] focus:bg-white/10',
        secondary: 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white',
        primary: 'rounded-xl bg-[linear-gradient(135deg,#d4a857,#82642d)] px-4 py-2 text-sm font-medium text-[#071017] transition hover:brightness-105 disabled:opacity-60',
      }
    : {
        backdrop: 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px]',
        panel: 'w-full max-w-md rounded-2xl border border-white/80 bg-white/95 p-6 shadow-xl',
        badge: 'inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700',
        title: 'mt-3 text-lg font-semibold text-gray-900',
        subtitle: 'mt-1 text-sm text-gray-600',
        close: 'text-gray-400 transition hover:text-gray-700',
        info: 'mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800',
        warning: 'mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800',
        label: 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-gray-500',
        control: 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-300',
        secondary: 'rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50',
        primary: 'rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60',
      };

  if (!open) return null;

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      day_of_week: Number(form.day_of_week),
      time: form.time,
      started_at: form.started_at,
      source_appointment_id: sourceAppointment?.id || null,
    });
  }

  return (
    <div className={themeClasses.backdrop} onClick={onClose}>
      <div className={themeClasses.panel} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={themeClasses.badge}>
              <Repeat size={13} />
              Recurrencia
            </div>
            <h3 className={themeClasses.title}>{title}</h3>
            <p className={themeClasses.subtitle}>{clientName}</p>
          </div>
          <button type="button" onClick={onClose} className={themeClasses.close}>
            <X size={20} />
          </button>
        </div>

        {sourceLabel ? (
          <div className={themeClasses.info}>
            Base automática: {sourceTone} del {sourceLabel}.
          </div>
        ) : (
          <div className={themeClasses.warning}>
            No encontré una base automática para esta recurrencia. Ajusta día, hora y fecha manualmente.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className={themeClasses.label}>Día</span>
            <select
              value={form.day_of_week}
              onChange={(e) => setField('day_of_week', e.target.value)}
              className={themeClasses.control}
              required
            >
              <option value="">Selecciona un día</option>
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={themeClasses.label}>Hora</span>
              <input
                type="time"
                value={form.time}
                onChange={(e) => setField('time', e.target.value)}
                className={themeClasses.control}
                required
              />
            </label>
            <label className="block">
              <span className={themeClasses.label}>Desde</span>
              <input
                type="date"
                value={form.started_at}
                onChange={(e) => setField('started_at', e.target.value)}
                className={themeClasses.control}
                required
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={themeClasses.secondary}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className={themeClasses.primary}
            >
              {saving ? 'Guardando...' : schedule && !schedule.ended_at ? 'Guardar recurrencia' : 'Activar recurrencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
