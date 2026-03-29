import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast';
import { formatTimeBolivia } from '../../utils/dates';

export default function Dashboard() {
  const [todayAppts, setTodayAppts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    Promise.all([
      api.get('/appointments/today'),
      api.get('/analytics').catch(() => null),
    ]).then(([appts, analytics]) => {
      setTodayAppts(appts);
      if (analytics) setStats(analytics.totals);
    }).catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  async function handlePaymentToggle(appt) {
    if (!appt.payment_id) return;
    const newStatus = appt.payment_status === 'Confirmado' ? 'Pendiente' : 'Confirmado';
    try {
      await api.put(`/payments/${appt.payment_id}/status`, { status: newStatus });
      setTodayAppts(prev => prev.map(a => a.id === appt.id ? { ...a, payment_status: newStatus } : a));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleStatusChange(id, status) {
    try {
      await api.put(`/appointments/${id}/status`, { status });
      setTodayAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleTriggerReminder(date, force = false) {
    try {
      const url = `/admin/test-reminder?date=${date}&force=1`;
      const result = await api.get(url);
      if (result.sent > 0) {
        showToast(`${result.sent} recordatorio(s) enviado(s)`);
      } else {
        showToast('No hay citas para enviar recordatorio');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  return (
    <AdminLayout title="Dashboard">
      <Toast toast={toast} />
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 font-medium">Sesiones esta semana</div>
          <div className="text-2xl font-bold mt-1">{stats?.sessions_this_week ?? '--'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 font-medium">Clientes activos</div>
          <div className="text-2xl font-bold mt-1">{stats?.total_clients ?? '--'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 font-medium">Tasa asistencia</div>
          <div className="text-2xl font-bold mt-1">
            {stats && stats.total_completed > 0
              ? `${Math.round((stats.total_completed / (stats.total_completed + (stats.total_noshow || 0))) * 100)}%`
              : '--'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 font-medium">Ingresos del mes</div>
          <div className="text-2xl font-bold mt-1">
            {stats?.income_this_month != null ? `Bs ${Number(stats.income_this_month).toLocaleString()}` : '--'}
          </div>
        </div>
      </div>

      {/* Today's appointments */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold">Citas de hoy</h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => handleTriggerReminder('today')} className="text-xs px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">
              Recordatorio hoy
            </button>
            <button type="button" onClick={() => handleTriggerReminder('tomorrow')} className="text-xs px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">
              Recordatorio mañana
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : todayAppts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No hay sesiones programadas para hoy</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left p-3 font-medium">Hora</th>
                <th className="text-left p-3 font-medium">Cliente</th>
                <th className="text-left p-3 font-medium">Teléfono</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Pago</th>
                <th className="text-left p-3 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {todayAppts.map(appt => (
                <tr key={appt.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium">
                    {formatTimeBolivia(appt.date_time)}
                  </td>
                  <td className="p-3 text-sm">{appt.first_name} {appt.last_name}</td>
                  <td className="p-3 text-sm">
                    <a href={`https://wa.me/${appt.client_phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {appt.client_phone}
                    </a>
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      appt.status === 'Agendada' ? 'bg-blue-100 text-blue-700' :
                      appt.status === 'Confirmada' ? 'bg-green-100 text-green-700' :
                      appt.status === 'Completada' ? 'bg-emerald-100 text-emerald-700' :
                      appt.status === 'No-show' ? 'bg-red-100 text-red-700' :
                      appt.status === 'Cancelada' ? 'bg-gray-100 text-gray-600' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {appt.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {appt.payment_id ? (
                      <button
                        type="button"
                        onClick={() => handlePaymentToggle(appt)}
                        className={`text-xs px-2 py-1 rounded-full font-medium border cursor-pointer transition-colors ${
                          appt.payment_status === 'Confirmado' ? 'bg-green-100 text-green-700 border-green-200' :
                          'bg-red-100 text-red-700 border-red-200'
                        }`}
                        title={`Click para cambiar a ${appt.payment_status === 'Confirmado' ? 'Pendiente' : 'Confirmado'}`}
                      >
                        {appt.payment_status === 'Confirmado' ? 'Pagado' : 'Pendiente'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
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
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
