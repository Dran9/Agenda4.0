import { useState, useEffect } from 'react';
import { Trash2, Search, BellRing, RotateCcw } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast';
import { formatDateBolivia, formatTimeBolivia } from '../../utils/dates';

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

export default function Appointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();
  const [filters, setFilters] = useState({ status: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    fetchAppointments();
  }, [page, filters]);

  async function fetchAppointments() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (filters.status) params.set('status', filters.status);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.search) params.set('search', filters.search);

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
    if (!confirm('Eliminar esta cita permanentemente?')) return;
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
    try {
      const appointmentDate = getBoliviaDateKey(appt.date_time);
      if (!appointmentDate) {
        showToast('No se pudo determinar la fecha de esta cita', 'error');
        return;
      }
      const params = new URLSearchParams({
        date: appointmentDate,
        appointment_id: String(appt.id),
      });
      if (force) params.set('force', '1');
      const result = await api.get(`/admin/test-reminder?${params.toString()}`);
      if (result.targetFound === false) {
        showToast('No se encontró la cita en los eventos elegibles para recordatorio', 'error');
        return;
      }
      if (result.sent > 0) {
        showToast(force ? 'Recordatorio reenviado a esta cita' : 'Recordatorio enviado a esta cita');
        return;
      }
      if (result.failed > 0) {
        showToast(`Error al ${force ? 'reenviar' : 'enviar'} recordatorio: ${result.errors?.[0]?.message || 'falló el envío a WhatsApp'}`, 'error');
        return;
      }
      if (result.skipped > 0) {
        showToast('Esta cita ya tenía recordatorio enviado. Usa reenviar si quieres repetirlo.');
        return;
      }
      showToast('No correspondía enviar recordatorio para esta cita');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Eliminar ${selected.size} cita(s) permanentemente?`)) return;
    try {
      for (const id of selected) {
        await api.delete(`/appointments/${id}`);
      }
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
        <input type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <input type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />

        {selected.size > 0 && (
          <button
            type="button"
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
          >
            <Trash2 size={16} />
            Eliminar ({selected.size})
          </button>
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
                  <th className="text-left p-3 font-medium min-w-[110px]">Registro</th>
                  <th className="text-left p-3 font-medium min-w-[150px]">Status</th>
                  <th className="text-left p-3 font-medium min-w-[340px]">Pago</th>
                  <th className="text-left p-3 font-medium min-w-[220px]">Reminder</th>
                  <th className="text-left p-3 font-medium min-w-[260px]">Calendar ID</th>
                  <th className="text-left p-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {appointments.map(appt => (
                  <tr key={appt.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(appt.id)}
                        onChange={() => toggleSelect(appt.id)}
                        className="w-4 h-4 accent-black rounded"
                      />
                    </td>
                    <td className="p-3 capitalize whitespace-nowrap">{formatDateBolivia(appt.date_time)}</td>
                    <td className="p-3 font-medium whitespace-nowrap">{formatTimeBolivia(appt.date_time)}</td>
                    <td className="p-3 whitespace-nowrap">{appt.first_name} {appt.last_name}</td>
                    <td className="p-3 whitespace-nowrap">
                      <a href={`https://wa.me/${appt.client_phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {appt.client_phone}
                      </a>
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
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleReminderSend(appt, false)}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            title="Enviar solo a esta cita si aún no salió"
                          >
                            <BellRing size={12} />
                            Enviar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReminderSend(appt, true)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                            title="Reenviar solo a esta cita"
                          >
                            <RotateCcw size={12} />
                            Reenviar
                          </button>
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
                      <button
                        type="button"
                        onClick={() => handleDelete(appt.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
                {appointments.length === 0 && (
                  <tr><td colSpan={11} className="p-8 text-center text-gray-400">Sin citas</td></tr>
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
    </AdminLayout>
  );
}
