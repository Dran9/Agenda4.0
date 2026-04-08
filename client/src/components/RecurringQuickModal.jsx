import { useEffect, useMemo, useState } from 'react';
import { Repeat, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,12,0.72)] px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,23,31,0.98),rgba(10,14,20,0.98))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d6b16b]/30 bg-[#d6b16b]/12 px-3 py-1 text-xs font-semibold text-[#f3cf8c]">
              <Repeat size={13} />
              Recurrencia
            </div>
            <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{clientName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 transition hover:text-white">
            <X size={20} />
          </button>
        </div>

        {sourceLabel ? (
          <div className="mt-4 rounded-xl border border-[#4a7fa4]/40 bg-[#10212f] px-4 py-3 text-sm text-[#b5d8ef]">
            Base automática: {sourceTone} del {sourceLabel}.
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-[#d6b16b]/30 bg-[#2b2414] px-4 py-3 text-sm text-[#f1d698]">
            No encontré una base automática para esta recurrencia. Ajusta día, hora y fecha manualmente.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Día</span>
            <select
              value={form.day_of_week}
              onChange={(e) => setField('day_of_week', e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-none transition focus:border-[#7fb5d6] focus:bg-white/10"
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
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Hora</span>
              <input
                type="time"
                value={form.time}
                onChange={(e) => setField('time', e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-none transition focus:border-[#7fb5d6] focus:bg-white/10"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Desde</span>
              <input
                type="date"
                value={form.started_at}
                onChange={(e) => setField('started_at', e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-none transition focus:border-[#7fb5d6] focus:bg-white/10"
                required
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[linear-gradient(135deg,#d4a857,#82642d)] px-4 py-2 text-sm font-medium text-[#071017] transition hover:brightness-105 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : schedule && !schedule.ended_at ? 'Guardar recurrencia' : 'Activar recurrencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
