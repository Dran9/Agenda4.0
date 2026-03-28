import { useState, useEffect, useCallback } from 'react';
import { Globe, ChevronDown, Search } from 'lucide-react';
import Calendar from '../Calendar';
import { TIMEZONE_GROUPS, convertLaPazTimeToTz, getCurrentTimeInTz } from '../../utils/timezones';

export default function CalendarScreen({ state, dispatch, config, slots, slotsLoading, fetchSlots, prefetchDays, daysWithSlots, timezone, onTimezoneChange }) {
  const { selectedDate, isReschedule } = state;
  const [showTzDropdown, setShowTzDropdown] = useState(false);
  const [tzSearch, setTzSearch] = useState('');

  // Close dropdown on outside click
  useEffect(() => {
    if (!showTzDropdown) return;
    function close(e) {
      if (!e.target.closest('.tz-dropdown-container')) setShowTzDropdown(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showTzDropdown]);

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
      if (dow >= 1 && dow <= 5 && date >= today && date <= maxDate) {
        const str = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        dates.push(str);
      }
    }
    if (dates.length > 0) prefetchDays(dates);
  }, [config, prefetchDays]);

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

  function handleSelectTz(tz) {
    onTimezoneChange(tz);
    setShowTzDropdown(false);
    setTzSearch('');
  }

  const filteredGroups = tzSearch.trim()
    ? TIMEZONE_GROUPS.map(g => ({
        ...g,
        zones: g.zones.filter(z => z.label.toLowerCase().includes(tzSearch.toLowerCase())),
      })).filter(g => g.zones.length > 0)
    : TIMEZONE_GROUPS;

  const morningSlots = slots.filter(s => s.block === 'morning');
  const afternoonSlots = slots.filter(s => s.block === 'afternoon');
  const isNotBolivia = timezone?.tz !== 'America/La_Paz';

  return (
    <div>
      <div className="text-xs font-mono text-gray-400 mb-2">Step {isReschedule ? '1 (reschedule)' : '1'}</div>
      {isReschedule && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Selecciona un nuevo horario para reagendar tu cita
        </div>
      )}

      {/* Timezone selector */}
      <div className="flex justify-center mb-4 tz-dropdown-container relative">
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setShowTzDropdown(!showTzDropdown); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Globe size={14} />
          <span>{timezone?.flag} {timezone?.label} ({getCurrentTimeInTz(timezone?.tz || 'America/La_Paz')})</span>
          <ChevronDown size={12} />
        </button>

        {showTzDropdown && (
          <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={tzSearch}
                  onChange={e => setTzSearch(e.target.value)}
                  placeholder="Buscar zona horaria..."
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-300"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              {filteredGroups.map(group => (
                <div key={group.label}>
                  <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 sticky top-0">
                    {group.label}
                  </div>
                  {group.zones.map(z => (
                    <button
                      key={z.tz}
                      type="button"
                      onClick={() => handleSelectTz(z)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${
                        timezone?.tz === z.tz ? 'bg-gray-100 font-medium' : ''
                      }`}
                    >
                      <span>{z.flag} {z.label}</span>
                      <span className="text-xs text-gray-400">{getCurrentTimeInTz(z.tz)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
              {isNotBolivia && (
                <div className="text-xs text-gray-400 text-center mb-3">
                  Horarios en tu zona ({timezone?.label})
                </div>
              )}
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
                        {isNotBolivia
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
                        {isNotBolivia
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
