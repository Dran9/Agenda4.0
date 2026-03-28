import { ChevronLeft } from 'lucide-react';
import { formatDateTimeBolivia } from '../../utils/dates';

export default function RescheduleConfirm({ state, dispatch, onConfirmReschedule }) {
  const { existingAppointment, selectedDate, selectedSlot, clientName, loading, error } = state;

  return (
    <div style={{ width: '100%' }}>
      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_BACK' })}
        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, color: 'var(--gris-medio)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, padding: 0 }}
      >
        <ChevronLeft size={16} />
        Volver al calendario
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Confirmar reagendamiento</h2>
      <p style={{ fontSize: 14, color: 'var(--gris-medio)', marginBottom: 20 }}>{clientName}, confirma el cambio de horario.</p>

      <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--terracota)', marginBottom: 4 }}>Se cancela</div>
        <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--terracota)', textTransform: 'capitalize', textDecoration: 'line-through' }}>
          {existingAppointment?.date_time ? formatDateTimeBolivia(existingAppointment.date_time) : ''}
        </div>
      </div>

      <div style={{ padding: 16, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5, color: '#15803D', marginBottom: 4 }}>Nueva cita</div>
        <div style={{ fontWeight: 600, fontSize: 16, color: '#15803D', textTransform: 'capitalize' }}>
          {formatDateTimeBolivia(`${selectedDate}T${selectedSlot?.time}:00-04:00`)}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, fontSize: 14, color: 'var(--terracota)' }}>
          {error}
        </div>
      )}

      <button
        type="button" onClick={onConfirmReschedule} disabled={loading}
        className="btn-primary" style={{ marginTop: 8 }}
      >
        {loading ? 'Reagendando...' : 'Confirmar reagendamiento'}
      </button>
    </div>
  );
}
