import { formatDateTimeBolivia } from '../../utils/dates';
import { api } from '../../utils/api';

export default function ExistingApptScreen({ state, dispatch, onReschedule }) {
  const { clientName, existingAppointment, selectedDate, selectedSlot, loading, error } = state;

  function handleKeep() {
    dispatch({ type: 'RESET' });
  }

  return (
    <div>
      <div className="text-xs font-mono text-gray-400 mb-2">Step 4</div>
      <h2 className="text-lg font-semibold mb-1">Ya tienes una cita, {clientName}</h2>
      <p className="text-sm text-gray-500 mb-4">Puedes reagendar o conservar tu cita actual.</p>

      <div className="space-y-3">
        <div className="p-4 bg-gray-50 rounded-xl">
          <div className="text-xs font-medium text-gray-400 uppercase mb-1">Tu cita actual</div>
          <div className="font-medium capitalize">
            {existingAppointment?.date_time
              ? formatDateTimeBolivia(existingAppointment.date_time)
              : 'Sin fecha'}
          </div>
        </div>

        {selectedSlot && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="text-xs font-medium text-blue-500 uppercase mb-1">Nuevo horario</div>
            <div className="font-medium text-blue-900">
              {formatDateTimeBolivia(`${selectedDate}T${selectedSlot.time}:00-04:00`)}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={onReschedule}
          disabled={loading}
          className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-40"
        >
          {loading ? 'Reagendando...' : 'Reagendar'}
        </button>
        <button
          type="button"
          onClick={handleKeep}
          disabled={loading}
          className="w-full py-3 bg-white text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50 transition-colors"
        >
          Conservar mi cita actual
        </button>
      </div>
    </div>
  );
}
