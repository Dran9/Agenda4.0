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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <Repeat size={13} />
              Recurrencia
            </div>
            <h3 className="mt-3 text-lg font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">{clientName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {sourceLabel ? (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Base automática: {sourceTone} del {sourceLabel}.
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No encontré una base automática para esta recurrencia. Ajusta día, hora y fecha manualmente.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Día</span>
            <select
              value={form.day_of_week}
              onChange={(e) => setField('day_of_week', e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
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
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Hora</span>
              <input
                type="time"
                value={form.time}
                onChange={(e) => setField('time', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Desde</span>
              <input
                type="date"
                value={form.started_at}
                onChange={(e) => setField('started_at', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
                required
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : schedule && !schedule.ended_at ? 'Guardar recurrencia' : 'Activar recurrencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
