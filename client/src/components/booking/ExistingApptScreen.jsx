import { formatDateTimeBolivia } from '../../utils/dates';

export default function ExistingApptScreen({ state, dispatch, onReschedule }) {
  const { clientName, existingAppointment, selectedDate, selectedSlot, loading, error } = state;

  return (
    <div style={{ width: '100%' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Ya tienes una cita, {clientName}</h2>
      <p style={{ fontSize: 14, color: 'var(--gris-medio)', marginBottom: 20 }}>Puedes reagendar o conservar tu cita actual.</p>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-label" style={{ fontSize: 11, marginBottom: 4 }}>Tu cita actual</div>
        <div style={{ fontWeight: 600, fontSize: 16, textTransform: 'capitalize' }}>
          {existingAppointment?.date_time ? formatDateTimeBolivia(existingAppointment.date_time) : 'Sin fecha'}
        </div>
      </div>

      {selectedSlot && (
        <div style={{ padding: 16, background: 'var(--cian-light)', border: '1px solid var(--turquesa)', borderRadius: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--petroleo)', marginBottom: 4 }}>Nuevo horario</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--petroleo)', textTransform: 'capitalize' }}>
            {formatDateTimeBolivia(`${selectedDate}T${selectedSlot.time}:00-04:00`)}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12, padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, fontSize: 14, color: 'var(--terracota)' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={onReschedule} disabled={loading} className="btn-primary">
          {loading ? 'Reagendando...' : 'Reagendar'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'RESET' })} disabled={loading} className="btn-secondary">
          Conservar mi cita actual
        </button>
      </div>
    </div>
  );
}
