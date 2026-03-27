import { formatDateTimeBolivia } from '../../utils/dates';

export default function ExistingApptScreen({ state, dispatch }) {
  const { clientName, existingAppointment, selectedDate, selectedSlot } = state;

  function handleReschedule() {
    dispatch({
      type: 'START_RESCHEDULE',
      oldAppointmentId: existingAppointment.id,
    });
  }

  function handleKeep() {
    // Go back to calendar
    dispatch({ type: 'RESET' });
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Ya tienes una cita, {clientName}</h2>
      <p className="text-sm text-gray-500 mb-4">Puedes reagendar o conservar tu cita actual.</p>

      <div className="space-y-3">
        <div className="p-4 bg-gray-50 rounded-xl">
          <div className="text-xs font-medium text-gray-400 uppercase mb-1">Tu cita actual</div>
          <div className="font-medium capitalize">
            {existingAppointment?.date_time
              ? formatDateTimeBolivia(existingAppointment.date_time + '-04:00')
              : 'Sin fecha'}
          </div>
        </div>

        {selectedSlot && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="text-xs font-medium text-blue-500 uppercase mb-1">Horario que elegiste</div>
            <div className="font-medium text-blue-900">
              {selectedDate} a las {selectedSlot.time}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={handleReschedule}
          className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Reagendar
        </button>
        <button
          type="button"
          onClick={handleKeep}
          className="w-full py-3 bg-white text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50 transition-colors"
        >
          Conservar mi cita actual
        </button>
      </div>
    </div>
  );
}
