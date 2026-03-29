import { useState, useEffect, useCallback } from 'react';
import { Globe, ChevronDown, Search } from 'lucide-react';
import Calendar from '../Calendar';
import { TIMEZONE_GROUPS, convertLaPazTimeToTz, getCurrentTimeInTz } from '../../utils/timezones';

export default function CalendarScreen({ state, dispatch, config, slots, slotsLoading, fetchSlots, prefetchDays, daysWithSlots, timezone, onTimezoneChange }) {
  const { selectedDate, isReschedule } = state;
  const [showTzDropdown, setShowTzDropdown] = useState(false);
  const [tzSearch, setTzSearch] = useState('');

  useEffect(() => {
    if (!showTzDropdown) return;
    function close(e) { if (!e.target.closest('.tz-dropdown-container')) setShowTzDropdown(false); }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showTzDropdown]);

  const handleMonthChange = useCallback((year, month) => {
    if (!config) return;
    const dates = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + (config.window_days || 10));
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dow = date.getDay();
      if (dow >= 1 && dow <= 5 && date >= today && date <= maxDate) {
        dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    if (dates.length > 0) prefetchDays(dates);
  }, [config, prefetchDays]);

  useEffect(() => { if (selectedDate) fetchSlots(selectedDate); }, [selectedDate]);

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
    <div style={{ width: '100%' }}>
      {isReschedule && (
        <div className="notice-box" style={{ marginBottom: 16, background: 'var(--crema)' }}>
          <span style={{ fontSize: 14, color: '#92400e' }}>Selecciona un nuevo horario para reagendar tu cita</span>
        </div>
      )}

      {/* Timezone selector */}
      <div className="tz-dropdown-container" style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setShowTzDropdown(!showTzDropdown); }}
          className="timezone-selector"
        >
          <Globe size={14} style={{ opacity: 0.5 }} />
          <span>{timezone?.flag} {timezone?.label}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--negro)', fontSize: 13 }}>
            {getCurrentTimeInTz(timezone?.tz || 'America/La_Paz')}
          </span>
          <ChevronDown size={12} style={{ color: 'var(--gris-medio)' }} />
        </button>

        {showTzDropdown && (
          <div className="timezone-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50 }}>
            <div style={{ padding: 8, borderBottom: '1px solid var(--platino)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gris-medio)' }} />
                <input
                  type="text" value={tzSearch} onChange={e => setTzSearch(e.target.value)}
                  placeholder="Buscar zona horaria..."
                  className="timezone-search"
                  style={{ paddingLeft: 32 }}
                  autoFocus
                />
              </div>
            </div>
            <div className="timezone-list" style={{ maxHeight: 300 }}>
              {filteredGroups.map(group => (
                <div key={group.label}>
                  <div className="timezone-group-label">{group.label}</div>
                  {group.zones.map(z => (
                    <button
                      key={z.tz} type="button" onClick={() => handleSelectTz(z)}
                      className={`timezone-item${timezone?.tz === z.tz ? ' active' : ''}`}
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', justifyContent: 'space-between' }}
                    >
                      <span>{z.flag} {z.label}</span>
                      <span style={{ fontSize: 12, color: 'var(--gris-medio)' }}>{getCurrentTimeInTz(z.tz)}</span>
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
        <div style={{ marginTop: 24, width: '100%' }}>
          {slotsLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--gris-medio)', padding: '16px 0', fontSize: 14 }}>Cargando horarios...</div>
          ) : slots.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--gris-medio)', padding: '16px 0', fontSize: 14 }}>No hay horarios disponibles este día</div>
          ) : (
            <>
              {isNotBolivia && (
                <div style={{ fontSize: 12, color: 'var(--gris-medio)', textAlign: 'center', marginBottom: 12 }}>
                  Horarios en tu zona ({timezone?.label})
                </div>
              )}
              {morningSlots.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="field-label" style={{ fontSize: 12, marginBottom: 8 }}>Mañana</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {morningSlots.map(slot => (
                      <button
                        type="button" key={slot.time} onClick={() => handleSelectSlot(slot)}
                        className="slot-btn"
                      >
                        {isNotBolivia ? convertLaPazTimeToTz(slot.time, selectedDate, timezone.tz) : slot.time}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {afternoonSlots.length > 0 && (
                <div>
                  <div className="field-label" style={{ fontSize: 12, marginBottom: 8 }}>Tarde</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {afternoonSlots.map(slot => (
                      <button
                        type="button" key={slot.time} onClick={() => handleSelectSlot(slot)}
                        className="slot-btn"
                      >
                        {isNotBolivia ? convertLaPazTimeToTz(slot.time, selectedDate, timezone.tz) : slot.time}
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
