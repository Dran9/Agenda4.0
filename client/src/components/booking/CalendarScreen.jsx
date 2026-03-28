import { useEffect, useCallback } from 'react';
import Calendar from '../Calendar';
import { convertLaPazTimeToTz } from '../../utils/timezones';

export default function CalendarScreen({ state, dispatch, config, slots, slotsLoading, fetchSlots, prefetchDays, daysWithSlots, timezone }) {
  const { selectedDate, isReschedule } = state;

  // Pre-fetch slots for visible weekdays when month changes
  const handleMonthChange = useCallback((year, month) => {
    if (!config) return;
    const dates = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + (config.window_days || 10));

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dow = date.getDay();
      // Only weekdays (Mon-Fri)
      if (dow >= 1 && dow <= 5 && date >= today && date <= maxDate) {
        const str = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        dates.push(str);
      }
    }
    if (dates.length > 0) prefetchDays(dates);
  }, [config, prefetchDays]);

  // Fetch slots when date is selected
  useEffect(() => {
    if (selectedDate) fetchSlots(selectedDate);
  }, [selectedDate]);

  function handleSelectDate(dateStr) {
    dispatch({ type: 'SELECT_DATE_ONLY', date: dateStr });
    fetchSlots(dateStr);
  }

  function handleSelectSlot(slot) {
    if (isReschedule) {
      dispatch({ type: 'SELECT_SLOT_RESCHEDULE', date: selectedDate, slot });
    } else {
      dispatch({ type: 'SELECT_SLOT', date: selectedDate, slot });
    }
  }

  const morningSlots = slots.filter(s => s.block === 'morning');
  const afternoonSlots = slots.filter(s => s.block === 'afternoon');

  return (
    <div>
      <div className="text-[10px] font-mono text-gray-300 mb-2">Step {isReschedule ? '1 (reschedule)' : '1'}</div>
      {isReschedule && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Selecciona un nuevo horario para reagendar tu cita
        </div>
      )}

      <Calendar
        onSelectDate={handleSelectDate}
        selectedDate={selectedDate}
        availableDays={config?.available_days || []}
        windowDays={config?.window_days || 10}
        daysWithSlots={daysWithSlots}
        onMonthChange={handleMonthChange}
      />

      {selectedDate && (
        <div className="mt-6">
          {slotsLoading ? (
            <div className="text-center text-gray-400 py-4">Cargando horarios...</div>
          ) : slots.length === 0 ? (
            <div className="text-center text-gray-400 py-4">No hay horarios disponibles este día</div>
          ) : (
            <>
              {morningSlots.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-medium text-gray-400 uppercase mb-2">Mañana</div>
                  <div className="grid grid-cols-3 gap-2">
                    {morningSlots.map(slot => (
                      <button
                        type="button"
                        key={slot.time}
                        onClick={() => handleSelectSlot(slot)}
                        className="py-2.5 px-3 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all"
                      >
                        {timezone?.tz !== 'America/La_Paz'
                          ? convertLaPazTimeToTz(slot.time, selectedDate, timezone.tz)
                          : slot.time}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {afternoonSlots.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase mb-2">Tarde</div>
                  <div className="grid grid-cols-3 gap-2">
                    {afternoonSlots.map(slot => (
                      <button
                        type="button"
                        key={slot.time}
                        onClick={() => handleSelectSlot(slot)}
                        className="py-2.5 px-3 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all"
                      >
                        {timezone?.tz !== 'America/La_Paz'
                          ? convertLaPazTimeToTz(slot.time, selectedDate, timezone.tz)
                          : slot.time}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
