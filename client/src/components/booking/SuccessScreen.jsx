import { formatDateBolivia, formatTimeBolivia } from '../../utils/dates';

export default function SuccessScreen({ state }) {
  const { bookingResult, clientName, isReschedule } = state;
  const dateTime = bookingResult?.appointment?.date_time;

  return (
    <div style={{ textAlign: 'center', paddingTop: 32, width: '100%' }}>
      <div style={{ width: 64, height: 64, background: '#DCFCE7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }} className="animate-checkmark">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
        {isReschedule ? 'Cita reagendada' : 'Cita confirmada'}
      </h2>

      {clientName && (
        <p style={{ color: 'var(--gris-medio)', marginBottom: 20, fontSize: 15 }}>
          {isReschedule ? `${clientName}, tu cita ha sido reagendada` : `${clientName}, tu cita ha sido agendada`}
        </p>
      )}

      {dateTime && (
        <div className="card" style={{ display: 'inline-block', textAlign: 'left', padding: '20px 24px' }}>
          <div className="detail-row" style={{ borderTop: 'none', paddingTop: 0 }}>
            <div className="detail-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--azul-acero)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div>
              <div className="detail-label">Fecha</div>
              <div className="detail-value" style={{ textTransform: 'capitalize' }}>{formatDateBolivia(dateTime + '-04:00')}</div>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--azul-acero)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <div className="detail-label">Hora</div>
              <div className="detail-value">{formatTimeBolivia(dateTime + '-04:00')}</div>
            </div>
          </div>
          {bookingResult?.appointment?.session_number && (
            <div className="detail-row">
              <div className="detail-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--azul-acero)" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <div className="detail-label">Sesión</div>
                <div className="detail-value">#{bookingResult.appointment.session_number}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
