import { ChevronLeft } from 'lucide-react';
import { formatDateTimeBolivia } from '../../utils/dates';

export default function RescheduleConfirm({ state, dispatch, onConfirmReschedule }) {
  const { existingAppointment, selectedDate, selectedSlot, clientName, loading, error } = state;

  return (
    <div>
      <div className="text-xs font-mono text-gray-400 mb-2">Step 4b</div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_BACK' })}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ChevronLeft size={16} />
        Volver al calendario
      </button>

      <h2 className="text-lg font-semibold mb-1">Confirmar reagendamiento</h2>
      <p className="text-sm text-gray-500 mb-4">{clientName}, confirma el cambio de horario.</p>

      <div className="space-y-3">
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
          <div className="text-xs font-medium text-red-400 uppercase mb-1">Se cancela</div>
          <div className="font-medium text-red-800 capitalize line-through">
            {existingAppointment?.date_time
              ? formatDateTimeBolivia(existingAppointment.date_time)
              : ''}
          </div>
        </div>

        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
          <div className="text-xs font-medium text-green-500 uppercase mb-1">Nueva cita</div>
          <div className="font-medium text-green-900 capitalize">
            {formatDateTimeBolivia(`${selectedDate}T${selectedSlot?.time}:00-04:00`)}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onConfirmReschedule}
        disabled={loading}
        className="w-full mt-6 py-3 bg-gray-900 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
      >
        {loading ? 'Reagendando...' : 'Confirmar reagendamiento'}
      </button>
    </div>
  );
}
