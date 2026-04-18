import { useState, useEffect, useCallback } from 'react';
import {
  Trash2,
  Search,
  BellRing,
  RotateCcw,
  ArrowUpDown,
  Repeat,
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import InlineConfirmButton from '../../components/InlineConfirmButton';
import RecurringQuickModal from '../../components/RecurringQuickModal';
import { api } from '../../utils/api';
import { getRecurringSyncIssue, pickDefaultRecurringSource } from '../../utils/recurring';
import { useToast, Toast } from '../../hooks/useToast';
import useAdminEvents from '../../hooks/useAdminEvents';
import { formatDateBolivia, formatTimeBolivia, formatWeekdayShort } from '../../utils/dates';

function formatReceiptAmount(amount) {
  if (amount == null) return '—';
  return `Bs ${Number(amount).toLocaleString('es-BO')}`;
}

function ReceiptLine({ label, value, tone = 'ok' }) {
  const labelClass = tone === 'problem'
    ? 'text-rose-600'
    : tone === 'muted'
      ? 'text-gray-400'
      : 'text-emerald-600';
  const valueClass = tone === 'problem'
    ? 'text-rose-700'
    : tone === 'muted'
      ? 'text-gray-400'
      : 'text-emerald-700';

  return (
    <div className={valueClass}>
      <span className={`font-medium ${labelClass}`}>{label}:</span> {value || '—'}
    </div>
  );
}

function ReceiptSummary({ appt }) {
  const hasOcrSummary = appt.ocr_extracted_amount != null || appt.ocr_extracted_dest_name || appt.ocr_extracted_date || appt.payment_notes;
  if (!hasOcrSummary) return null;
  const cardClass = appt.payment_status === 'Mismatch'
    ? 'border-rose-200 bg-rose-50'
    : 'border-emerald-200 bg-emerald-50';

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-5 ${cardClass}`}>
      {appt.payment_notes && <ReceiptLine label="Motivo" value={appt.payment_notes} tone="problem" />}
      <ReceiptLine label="Fecha de abono" value={appt.ocr_extracted_date} tone={appt.ocr_extracted_date ? 'ok' : 'muted'} />
      <ReceiptLine label="Destinatario" value={appt.ocr_extracted_dest_name} tone={appt.ocr_extracted_dest_name ? 'ok' : 'muted'} />
      <ReceiptLine label="Monto" value={formatReceiptAmount(appt.ocr_extracted_amount)} tone={appt.ocr_extracted_amount != null ? 'ok' : 'muted'} />
    </div>
  );
}

const PAYMENT_LABELS = {
  Confirmado: 'Pagado',
  Pendiente: 'Pendiente',
  Mismatch: 'Mismatch',
  Rechazado: 'Rechazado',
};

const PAYMENT_STYLES = {
  Confirmado: 'bg-green-100 text-green-700 border-green-200',
  Pendiente: 'bg-red-100 text-red-700 border-red-200',
  Mismatch: 'bg-orange-100 text-orange-700 border-orange-200',
  Rechazado: 'bg-gray-100 text-gray-500 border-gray-200',
};

const STATUS_STYLES = {
  Agendada: 'bg-blue-100 text-blue-700 border-blue-200',
  Confirmada: 'bg-green-100 text-green-700 border-green-200',
  Completada: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Cancelada: 'bg-gray-100 text-gray-600 border-gray-200',
  'No-show': 'bg-red-100 text-red-700 border-red-200',
  Reagendada: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};

const STATUSES = ['Agendada', 'Confirmada', 'Completada', 'Reagendada', 'Cancelada', 'No-show'];
const PAYMENT_STATUSES = ['Pendiente', 'Confirmado', 'Mismatch', 'Rechazado'];
const SORT_OPTIONS = [
  { value: 'date:asc', label: 'Fecha mas proxima' },
  { value: 'date:desc', label: 'Fecha mas reciente' },
  { value: 'name:asc', label: 'Nombre A-Z' },
  { value: 'name:desc', label: 'Nombre Z-A' },
  { value: 'created:desc', label: 'Registro reciente' },
  { value: 'created:asc', label: 'Registro antiguo' },
  { value: 'status:asc', label: 'Status A-Z' },
  { value: 'status:desc', label: 'Status Z-A' },
];

function formatRegistro(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-BO', {
    day: '2-digit', month: 'short',
    timeZone: 'America/La_Paz',
  });
}

function getBoliviaDateKey(dateStr) {
  if (!dateStr) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dateStr));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

function recurringPriority(schedule) {
  if (!schedule) return 99;
  if (!schedule.ended_at && !schedule.paused_at) return 0;
  if (schedule.paused_at && !schedule.ended_at) return 1;
  return 2;
}

function pickRecurringSchedule(current, candidate) {
  if (!current) return candidate;
  const currentPriority = recurringPriority(current);
  const candidatePriority = recurringPriority(candidate);
  if (candidatePriority !== currentPriority) {
    return candidatePriority < currentPriority ? candidate : current;
  }
  return new Date(candidate.updated_at || 0) > new Date(current.updated_at || 0) ? candidate : current;
}

function getRecurringFieldMeta(schedule) {
  if (!schedule || schedule.ended_at) {
    return {
      label: '—',
      detail: '',
      className: 'border-gray-200 bg-white text-gray-400',
    };
  }

  const detail = `${formatWeekdayShort(schedule.day_of_week)} ${schedule.time}${schedule.started_at ? ` · desde ${schedule.started_at}` : ''}`;
  if (schedule.paused_at) {
    return {
      label: 'Pausada',
      detail,
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  return {
    label: 'Recurrente',
    detail,
    className: 'border-blue-200 bg-blue-50 text-blue-700',
  };
}

function ReminderActionButton({
  icon: Icon,
  label,
  confirmLabel,
  successLabel,
  title,
  disabled = false,
  onConfirm,
}) {
  const [phase, setPhase] = useState('idle'); // idle | armed | loading | success | error

  useEffect(() => {
    if (phase !== 'armed') return undefined;
    const timer = window.setTimeout(() => setPhase('idle'), 5000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!['success', 'error'].includes(phase)) return undefined;
    const timer = window.setTimeout(() => setPhase('idle'), 1300);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (disabled) setPhase('idle');
  }, [disabled]);

  async function handleClick() {
    if (disabled || phase === 'loading' || phase === 'success') return;

    if (phase === 'idle' || phase === 'error') {
      setPhase('armed');
      return;
    }

    if (phase === 'armed') {
      setPhase('loading');
      try {
        const result = await onConfirm();
        setPhase(result === false ? 'error' : 'success');
      } catch (_) {
        setPhase('error');
      }
    }
  }

  const classByPhase = {
    idle: 'border-slate-300 bg-gradient-to-r from-slate-50 to-white text-slate-700 hover:border-[#4E769B] hover:text-[#335c7a] hover:shadow-[0_8px_20px_rgba(78,118,155,0.18)]',
    armed: 'border-red-300 bg-red-50 text-red-700 shadow-[0_10px_24px_rgba(239,68,68,0.18)]',
    loading: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    success: 'border-emerald-300 bg-emerald-100 text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.18)]',
    error: 'border-rose-300 bg-rose-50 text-rose-700',
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-w-[120px] items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${classByPhase[phase]}`}
    >
      {phase === 'armed' ? (
        <AlertTriangle size={13} />
      ) : phase === 'loading' ? (
        <LoaderCircle size={13} className="animate-spin" />
      ) : phase === 'success' ? (
        <CheckCircle2 size={13} />
      ) : (
        <Icon size={13} />
      )}
      {phase === 'armed'
        ? confirmLabel
        : phase === 'loading'
          ? 'Enviando...'
          : phase === 'success'
            ? successLabel
            : phase === 'error'
              ? 'Error'
              : label}
    </button>
  );
}

export default function Appointments() {
  const [appointments, setAppointments] = useState([]);
  const [recurringSchedules, setRecurringSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();
  const [filters, setFilters] = useState({ status: '', from: '', to: '', search: '', sort: 'date:desc' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [savingRecurringClientId, setSavingRecurringClientId] = useState(null);
  const [recurringModal, setRecurringModal] = useState(null);
  const [loadingRecurringModal, setLoadingRecurringModal] = useState(false);
  const [sendingReminderAppointmentId, setSendingReminderAppointmentId] = useState(null);

  const refreshAll = useCallback(() => {
    fetchAppointments();
    loadRecurringSchedules();
  }, [page, filters]);

  useEffect(() => { fetchAppointments(); }, [page, filters]);
  useEffect(() => { loadRecurringSchedules(); }, []);

  // Real-time updates via SSE
  useAdminEvents(
    ['appointment:change', 'recurring:change', 'payment:change'],
    refreshAll,
  );

  async function fetchAppointments() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      const [sortBy, sortDir] = (filters.sort || 'date:desc').split(':');
      if (filters.status) params.set('status', filters.status);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.search) params.set('search', filters.search);
      params.set('sort_by', sortBy || 'date');
      params.set('sort_dir', sortDir || 'desc');

      const data = await api.get(`/appointments?${params}`);
      setAppointments(data.appointments);
      setTotal(data.total);
      setSelected(new Set());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecurringSchedules() {
    try {
      const data = await api.get('/recurring');
      setRecurringSchedules(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadDefaultRecurringSource(clientId, fallbackAppointment = null) {
    try {
      const detail = await api.get(`/clients/${clientId}`);
      const appointmentsHistory = Array.isArray(detail?.appointments) ? detail.appointments : [];
      return pickDefaultRecurringSource(appointmentsHistory, fallbackAppointment, { preferFallback: true });
    } catch (err) {
      console.error(err);
      return pickDefaultRecurringSource([], fallbackAppointment, { preferFallback: true });
    }
  }

  async function handleStatusChange(id, status) {
    try {
      await api.put(`/appointments/${id}/status`, { status });
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handlePaymentChange(appt, newStatus) {
    if (!appt.payment_id) return;
    try {
      await api.put(`/payments/${appt.payment_id}/status`, { status: newStatus });
      setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, payment_status: newStatus } : a));
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/appointments/${id}`);
      setAppointments(prev => prev.filter(a => a.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      setTotal(t => t - 1);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleReminderSend(appt, force = false) {
    setSendingReminderAppointmentId(appt.id);
    try {
      const appointmentDate = getBoliviaDateKey(appt.date_time);
      if (!appointmentDate) {
        showToast('No se pudo determinar la fecha de esta cita', 'error');
        return false;
      }
      const params = new URLSearchParams({
        date: appointmentDate,
        appointment_id: String(appt.id),
      });
      if (force) params.set('force', '1');
      const result = await api.get(`/admin/test-reminder?${params.toString()}`);
      if (result.targetFound === false) {
        showToast('No se encontró la cita en los eventos elegibles para recordatorio', 'error');
        return false;
      }
      if (result.sent > 0) {
        showToast(force ? 'Recordatorio aceptado por WhatsApp para reenvío' : 'Recordatorio aceptado por WhatsApp');
        return true;
      }
      if (result.failed > 0) {
        showToast(`Error al ${force ? 'reenviar' : 'enviar'} recordatorio: ${result.errors?.[0]?.message || 'falló el envío a WhatsApp'}`, 'error');
        return false;
      }
      if (result.skipped > 0) {
        showToast('Esta cita ya tenía recordatorio enviado. Usa reenviar si quieres repetirlo.');
        return true;
      }
      showToast('No correspondía enviar recordatorio para esta cita');
      return true;
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      return false;
    } finally {
      setSendingReminderAppointmentId(current => (current === appt.id ? null : current));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    try {
      await Promise.all([...selected].map((id) => api.delete(`/appointments/${id}`)));
      setAppointments(prev => prev.filter(a => !selected.has(a.id)));
      setTotal(t => t - selected.size);
      setSelected(new Set());
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  function toggleSelectAll() {
    if (selected.size === appointments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(appointments.map(a => a.id)));
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function handleRecurringQuickAction(appt, schedule, action) {
    if (!schedule?.id) return;

    setSavingRecurringClientId(appt.client_id);
    try {
      const result = await api.put(`/recurring/${schedule.id}/${action}`, {});
      await Promise.all([fetchAppointments(), loadRecurringSchedules()]);
      const syncIssue = action === 'resume' ? getRecurringSyncIssue(result, 'resume') : null;
      showToast(
        syncIssue || (
          action === 'pause'
            ? 'Recurrencia pausada'
            : action === 'resume'
              ? 'Recurrencia reactivada'
              : 'Recurrencia quitada'
        ),
        syncIssue ? 'error' : 'success'
      );
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurringClientId(null);
    }
  }

  async function openRecurringModal(appt, schedule) {
    setLoadingRecurringModal(true);
    try {
      const sourceAppointment = await loadDefaultRecurringSource(appt.client_id, appt);
      setRecurringModal({
        clientId: appt.client_id,
        clientName: `${appt.first_name} ${appt.last_name}`.trim(),
        schedule,
        sourceAppointment,
      });
    } finally {
      setLoadingRecurringModal(false);
    }
  }

  async function handleRecurringModalSubmit(payload) {
    if (!recurringModal) return;
    setSavingRecurringClientId(recurringModal.clientId);
    try {
      if (recurringModal.schedule && !recurringModal.schedule.ended_at) {
        const updated = await api.put(`/recurring/${recurringModal.schedule.id}`, {
          day_of_week: payload.day_of_week,
          time: payload.time,
          started_at: payload.started_at,
        });
        const syncIssue = getRecurringSyncIssue(updated, 'update');
        showToast(syncIssue || 'Recurrencia actualizada', syncIssue ? 'error' : 'success');
      } else {
        const created = await api.post('/recurring', {
          client_id: recurringModal.clientId,
          day_of_week: payload.day_of_week,
          time: payload.time,
          started_at: payload.started_at,
          source_appointment_id: payload.source_appointment_id,
        });
        const syncIssue = getRecurringSyncIssue(created, 'activate');
        showToast(syncIssue || 'Recurrencia activada', syncIssue ? 'error' : 'success');
      }

      setRecurringModal(null);
      await Promise.all([fetchAppointments(), loadRecurringSchedules()]);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSavingRecurringClientId(null);
    }
  }

  const recurringByClient = new Map();
  for (const schedule of recurringSchedules) {
    recurringByClient.set(
      schedule.client_id,
      pickRecurringSchedule(recurringByClient.get(schedule.client_id), schedule)
    );
  }

  return (
    <AdminLayout title="Citas">
      <Toast toast={toast} />
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar cliente..."
            value={filters.search}
            onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
            className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-48"
          />
        </div>
        <select
          value={filters.status}
          onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">Todos los status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">Desde</label>
          <input
            type="date"
            value={filters.from}
            onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">Hasta</label>
          <input
            type="date"
            value={filters.to}
            onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div className="relative">
          <ArrowUpDown size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select
            value={filters.sort}
            onChange={e => { setFilters(f => ({ ...f, sort: e.target.value })); setPage(1); }}
            className="pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm bg-white min-w-[190px]"
          >
            {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        {selected.size > 0 && (
          <InlineConfirmButton
            onConfirm={handleBulkDelete}
            confirmLabel="¿Confirmas?"
            cancelLabel="Cancelar"
            wrapperClassName="flex items-center gap-2"
            idleClassName="flex items-center gap-1.5 rounded-lg bg-[#B34E35] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#9f452f]"
            confirmClassName="inline-flex items-center gap-1.5 rounded-lg bg-[#FF2C2C] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#e32727]"
            cancelClassName="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Trash2 size={16} />
            Eliminar ({selected.size})
          </InlineConfirmButton>
        )}

        <span className="text-xs text-gray-400 ml-auto">{total} cita{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <>
            <table className="w-full min-w-[1900px] text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={appointments.length > 0 && selected.size === appointments.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 accent-black rounded"
                    />
                  </th>
                  <th className="text-left p-3 font-medium min-w-[150px]">Fecha agendada</th>
                  <th className="text-left p-3 font-medium min-w-[90px]">Hora</th>
                  <th className="text-left p-3 font-medium min-w-[220px]">Cliente</th>
                  <th className="text-left p-3 font-medium min-w-[170px]">Teléfono</th>
                  <th className="text-left p-3 font-medium min-w-[210px]">Recurrencia</th>
                  <th className="text-left p-3 font-medium min-w-[110px]">Registro</th>
                  <th className="text-left p-3 font-medium min-w-[150px]">Status</th>
                  <th className="text-left p-3 font-medium min-w-[340px]">Pago</th>
                  <th className="text-left p-3 font-medium min-w-[220px]">Reminder</th>
                  <th className="text-left p-3 font-medium min-w-[260px]">Calendar ID</th>
                  <th className="text-left p-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {appointments.map(appt => {
                  const recurringSchedule = recurringByClient.get(appt.client_id) || null;
                  const recurringMeta = getRecurringFieldMeta(recurringSchedule);
                  return (
                  <tr key={appt.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(appt.id)}
                        onChange={() => toggleSelect(appt.id)}
                        className="w-4 h-4 accent-black rounded"
                      />
                    </td>
                    <td className="p-3 capitalize whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {appt.source_schedule_id ? <Repeat size={14} className="text-blue-500" /> : null}
                        <span>{formatDateBolivia(appt.date_time)}</span>
                      </div>
                    </td>
                    <td className="p-3 font-medium whitespace-nowrap">{formatTimeBolivia(appt.date_time)}</td>
                    <td className="p-3 whitespace-nowrap">{appt.first_name} {appt.last_name}</td>
                    <td className="p-3 whitespace-nowrap">
                      <a href={`https://wa.me/${appt.client_phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {appt.client_phone}
                      </a>
                    </td>
                    <td className="p-3 align-top">
                      <div className="space-y-1">
                        <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${recurringMeta.className}`}>
                          {recurringMeta.label}
                        </div>
                        {recurringMeta.detail ? (
                          <div className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500">
                            <Repeat size={11} className="text-gray-400" />
                            <span>{recurringMeta.detail}</span>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openRecurringModal(appt, recurringSchedule)}
                          disabled={loadingRecurringModal || savingRecurringClientId === appt.client_id}
                          className="inline-flex rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {recurringSchedule && !recurringSchedule.ended_at ? 'Editar recurrencia' : 'Poner en recurrencia'}
                        </button>
                        {recurringSchedule && !recurringSchedule.ended_at ? (
                          <div className="flex flex-wrap gap-2">
                            {!recurringSchedule.paused_at ? (
                              <button
                                type="button"
                                onClick={() => handleRecurringQuickAction(appt, recurringSchedule, 'pause')}
                                disabled={savingRecurringClientId === appt.client_id}
                                className="rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                              >
                                Pausar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRecurringQuickAction(appt, recurringSchedule, 'resume')}
                                disabled={savingRecurringClientId === appt.client_id}
                                className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                              >
                                Reactivar
                              </button>
                            )}
                            <InlineConfirmButton
                              onConfirm={() => handleRecurringQuickAction(appt, recurringSchedule, 'end')}
                              confirmLabel="Confirmar"
                              cancelLabel="Cancelar"
                              compactCancel
                              wrapperClassName="flex items-center gap-2"
                              idleClassName="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                              confirmClassName="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                              cancelClassName="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                              disabled={savingRecurringClientId === appt.client_id}
                            >
                              Quitar
                            </InlineConfirmButton>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-gray-400 whitespace-nowrap">{formatRegistro(appt.created_at)}</td>
                    <td className="p-3 align-top">
                      <select
                        value={appt.status}
                        onChange={e => handleStatusChange(appt.id, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-full font-medium border appearance-none cursor-pointer ${STATUS_STYLES[appt.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-3 align-top">
                      {appt.payment_id ? (
                        <div className="max-w-[320px]">
                          <select
                            value={appt.payment_status || 'Pendiente'}
                            onChange={e => handlePaymentChange(appt, e.target.value)}
                            className={`text-xs px-2 py-1 rounded-full font-medium border appearance-none cursor-pointer ${PAYMENT_STYLES[appt.payment_status] || PAYMENT_STYLES.Pendiente}`}
                          >
                            {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{PAYMENT_LABELS[s]}</option>)}
                          </select>
                          <ReceiptSummary appt={appt} />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      {['Agendada', 'Confirmada', 'Reagendada'].includes(appt.status) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <ReminderActionButton
                            icon={BellRing}
                            label="Enviar"
                            confirmLabel="¿Enviar?"
                            successLabel="Enviado"
                            title="Enviar solo a esta cita si aún no salió"
                            disabled={sendingReminderAppointmentId === appt.id}
                            onConfirm={() => handleReminderSend(appt, false)}
                          />
                          <ReminderActionButton
                            icon={RotateCcw}
                            label="Reenviar"
                            confirmLabel="¿Reenviar?"
                            successLabel="Reenviado"
                            title="Reenviar solo a esta cita"
                            disabled={sendingReminderAppointmentId === appt.id}
                            onConfirm={() => handleReminderSend(appt, true)}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      {appt.gcal_event_id ? (
                        <div className="max-w-[240px] break-all font-mono text-[11px] text-gray-500">
                          {appt.gcal_event_id}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <InlineConfirmButton
                        onConfirm={() => handleDelete(appt.id)}
                        confirmLabel="¿Confirmas?"
                        cancelLabel="Cancelar"
                        compactCancel
                        wrapperClassName="flex items-center justify-end gap-1"
                        idleClassName="inline-flex items-center justify-center rounded-lg bg-[#B34E35] p-1.5 text-white transition hover:bg-[#9f452f]"
                        confirmClassName="inline-flex items-center gap-1 rounded-lg bg-[#FF2C2C] px-2 py-1 text-xs font-medium text-white transition hover:bg-[#e32727]"
                        cancelClassName="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                        idleTitle="Eliminar"
                      >
                        <Trash2 size={15} />
                      </InlineConfirmButton>
                    </td>
                  </tr>
                )})}
                {appointments.length === 0 && (
                  <tr><td colSpan={12} className="p-8 text-center text-gray-400">Sin citas</td></tr>
                )}
              </tbody>
            </table>
            {total > 50 && (
              <div className="p-3 flex justify-between items-center text-sm text-gray-500 border-t border-gray-100">
                <span>Página {page} de {Math.ceil(total / 50)}</span>
                <div className="flex gap-2">
                  <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-gray-50">Anterior</button>
                  <button type="button" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-30 hover:bg-gray-50">Siguiente</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <RecurringQuickModal
        open={!!recurringModal}
        clientName={recurringModal?.clientName || ''}
        schedule={recurringModal?.schedule || null}
        sourceAppointment={recurringModal?.sourceAppointment || null}
        saving={savingRecurringClientId === recurringModal?.clientId}
        onClose={() => setRecurringModal(null)}
        onSubmit={handleRecurringModalSubmit}
      />
    </AdminLayout>
  );
}
