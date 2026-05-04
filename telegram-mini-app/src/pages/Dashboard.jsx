import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short', timeZone: 'America/La_Paz' });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' });
}

export default function Dashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const res = await api.get(`/appointments?from=${today}&limit=50&sort_by=date&sort_dir=asc`);
      setAppointments(res.appointments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-[#4E769B] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          type="button"
          onClick={loadAppointments}
          className="mt-2 text-[#4E769B] text-sm font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const todayAppts = appointments.filter(a => a.date_time?.startsWith(today));
  const upcomingAppts = appointments.filter(a => !a.date_time?.startsWith(today));

  return (
    <div className="space-y-4">
      {/* Today */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 mb-2">Hoy</h2>
        {todayAppts.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Sin citas hoy</p>
        ) : (
          <div className="space-y-2">
            {todayAppts.map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 mb-2">Próximas</h2>
        {upcomingAppts.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Sin citas próximas</p>
        ) : (
          <div className="space-y-2">
            {upcomingAppts.slice(0, 10).map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppointmentCard({ appt }) {
  const statusColors = {
    'Agendada': 'bg-blue-100 text-blue-700',
    'Confirmada': 'bg-green-100 text-green-700',
    'Reagendada': 'bg-amber-100 text-amber-700',
    'Completada': 'bg-gray-100 text-gray-600',
    'Cancelada': 'bg-red-100 text-red-700',
    'No-show': 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">
            {appt.first_name} {appt.last_name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDate(appt.date_time)} · {formatTime(appt.date_time)}
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ml-2 ${statusColors[appt.status] || 'bg-gray-100 text-gray-600'}`}>
          {appt.status}
        </span>
      </div>
      {appt.payment_status && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-400">Pago:</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            appt.payment_status === 'Confirmado' ? 'bg-green-50 text-green-600' :
            appt.payment_status === 'Pendiente' ? 'bg-amber-50 text-amber-600' :
            'bg-gray-50 text-gray-500'
          }`}>
            {appt.payment_status}
          </span>
        </div>
      )}
    </div>
  );
}
