import { formatDateBolivia, formatTimeBolivia } from '../../utils/dates';

export default function SuccessScreen({ state }) {
  const { bookingResult, clientName, isReschedule } = state;
  const dateTime = bookingResult?.appointment?.date_time;

  // 5a = first-time client, 5b = returning client, 5c = reschedule
  const isNewClient = bookingResult?.appointment?.session_number === 1;
  const stepLabel = isReschedule ? '5c' : isNewClient ? '5a' : '5b';

  return (
    <div className="text-center py-8">
      <div className="text-xs font-mono text-gray-400 mb-2 text-left">Step {stepLabel}</div>
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 className="text-xl font-semibold mb-1">
        {isReschedule ? 'Cita reagendada' : 'Cita confirmada'}
      </h2>

      {clientName && (
        <p className="text-gray-600 mb-4">
          {isReschedule ? `${clientName}, tu cita ha sido reagendada` : `${clientName}, tu cita ha sido agendada`}
        </p>
      )}

      {dateTime && (
        <div className="bg-gray-50 rounded-xl p-4 inline-block text-left">
          <div className="text-sm text-gray-500">Fecha</div>
          <div className="font-medium capitalize">{formatDateBolivia(dateTime + '-04:00')}</div>
          <div className="text-sm text-gray-500 mt-2">Hora</div>
          <div className="font-medium">{formatTimeBolivia(dateTime + '-04:00')}</div>
          {bookingResult?.appointment?.session_number && (
            <>
              <div className="text-sm text-gray-500 mt-2">Sesión</div>
              <div className="font-medium">#{bookingResult.appointment.session_number}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
