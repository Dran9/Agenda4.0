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
      <div className="flex justify-center py-12">
        <div 
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: '#E6E6E6', borderTopColor: '#4E769B' }}
        ></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-medium" style={{ color: '#B34E35' }}>{error}</p>
        <button
          type="button"
          onClick={loadAppointments}
          className="mt-3 text-sm font-semibold"
          style={{ color: '#4E769B' }}
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
    <div className="space-y-5">
      {/* Today */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: '#A4A4A6' }}>
          Hoy
        </h2>
        {todayAppts.length === 0 ? (
          <div 
            className="rounded-2xl p-8 text-center"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
          >
            <p className="text-sm" style={{ color: '#C5C2C0' }}>Sin citas hoy</p>
          </div>
        ) : (
          <div className="space-y-2">
            {todayAppts.map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: '#A4A4A6' }}>
          Próximas
        </h2>
        {upcomingAppts.length === 0 ? (
          <div 
            className="rounded-2xl p-8 text-center"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E6E6' }}
          >
            <p className="text-sm" style={{ color: '#C5C2C0' }}>Sin citas próximas</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingAppts.slice(0, 10).map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AppointmentCard({ appt }) {
  const statusConfig = {
    'Agendada': { bg: '#CFE8E9', text: '#085C6D', label: 'Agendada' },
    'Confirmada': { bg: '#D1FAE5', text: '#047857', label: 'Confirmada' },
    'Reagendada': { bg: '#FEF3C7', text: '#92400E', label: 'Reagendada' },
    'Completada': { bg: '#F3F4F6', text: '#6B7280', label: 'Completada' },
    'Cancelada': { bg: '#FEE2E2', text: '#991B1B', label: 'Cancelada' },
    'No-show': { bg: '#F1F5F9', text: '#64748B', label: 'No-show' },
  };

  const status = statusConfig[appt.status] || statusConfig['Agendada'];

  return (
    <div 
      className="rounded-2xl p-4"
      style={{ 
        backgroundColor: '#FFFFFF', 
        border: '1px solid #E6E6E6',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: '#3C3939' }}>
            {appt.first_name} {appt.last_name}
          </p>
          <p className="text-xs mt-1 font-medium" style={{ color: '#A4A4A6' }}>
            {formatDate(appt.date_time)} · {formatTime(appt.date_time)}
          </p>
        </div>
        <span 
          className="text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ backgroundColor: status.bg, color: status.text }}
        >
          {status.label}
        </span>
      </div>
      
      {appt.payment_status && (
        <div className="mt-3 flex items-center gap-2 pt-3" style={{ borderTop: '1px solid #F0EEF0' }}>
          <span className="text-[10px] font-medium" style={{ color: '#C5C2C0' }}>Pago:</span>
          <span 
            className="text-[10px] font-bold px-2 py-0.5 rounded-md"
            style={{
              backgroundColor: appt.payment_status === 'Confirmado' ? '#D1FAE5' : 
                            appt.payment_status === 'Pendiente' ? '#FEF3C7' : '#F3F4F6',
              color: appt.payment_status === 'Confirmado' ? '#047857' :
                     appt.payment_status === 'Pendiente' ? '#92400E' : '#6B7280'
            }}
          >
            {appt.payment_status}
          </span>
        </div>
      )}
    </div>
  );
}
