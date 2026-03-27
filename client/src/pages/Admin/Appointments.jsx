import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { formatDateBolivia, formatTimeBolivia } from '../../utils/dates';

export default function Appointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

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
      console.error(err);
    }
  }

  return (
    <AdminLayout title="Citas">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar cliente..."
          value={filters.search}
          onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-48"
        />
        <select
          value={filters.status}
          onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">Todos los status</option>
          <option value="Confirmada">Confirmada</option>
          <option value="Completada">Completada</option>
          <option value="Cancelada">Cancelada</option>
          <option value="No-show">No-show</option>
          <option value="Reagendada">Reagendada</option>
        </select>
        <input type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        <input type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(1); }} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium">Hora</th>
                  <th className="text-left p-3 font-medium">Cliente</th>
                  <th className="text-left p-3 font-medium">Teléfono</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map(appt => (
                  <tr key={appt.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="p-3 text-sm capitalize">{formatDateBolivia(appt.date_time)}</td>
                    <td className="p-3 text-sm font-medium">{formatTimeBolivia(appt.date_time)}</td>
                    <td className="p-3 text-sm">{appt.first_name} {appt.last_name}</td>
                    <td className="p-3 text-sm">{appt.client_phone}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        appt.status === 'Confirmada' ? 'bg-green-100 text-green-700' :
                        appt.status === 'Completada' ? 'bg-blue-100 text-blue-700' :
                        appt.status === 'No-show' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {appt.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <select
                        value=""
                        onChange={e => { if (e.target.value) handleStatusChange(appt.id, e.target.value); }}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                      >
                        <option value="">Cambiar...</option>
                        <option value="Completada">Completada</option>
                        <option value="No-show">No-show</option>
                        <option value="Cancelada">Cancelada</option>
                        <option value="Confirmada">Confirmada</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > 50 && (
              <div className="p-3 flex justify-between items-center text-sm text-gray-500">
                <span>{total} citas total</span>
                <div className="flex gap-2">
                  <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-30">Anterior</button>
                  <button type="button" onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded">Siguiente</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
