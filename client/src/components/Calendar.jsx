import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];
const DAY_LABELS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const DAY_MAP = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes', 6: 'sabado' };

export default function Calendar({ onSelectDate, selectedDate, availableDays = [], windowDays = 10, daysWithSlots, onMonthChange }) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + windowDays);
    return d;
  }, [today, windowDays]);

  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  useEffect(() => {
    if (onMonthChange) onMonthChange(viewYear, viewMonth);
  }, [viewYear, viewMonth]);

  function getDateStr(day) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function isToday(day) {
    if (!day) return false;
    return viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
  }

  function isEnabled(day) {
    if (!day) return false;
    const date = new Date(viewYear, viewMonth, day);
    date.setHours(0, 0, 0, 0);
    if (date < today) return false;
    if (date > maxDate) return false;
    const dayName = DAY_MAP[date.getDay()];
    return availableDays.includes(dayName);
  }

  function hasSlots(day) {
    if (!day || !daysWithSlots) return false;
    return daysWithSlots.has(getDateStr(day));
  }

  function isSelected(day) {
    if (!day || !selectedDate) return false;
    return selectedDate === getDateStr(day);
  }

  function handleClick(day) {
    if (!isEnabled(day)) return;
    onSelectDate(getDateStr(day));
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const canGoPrev = viewYear > today.getFullYear() || viewMonth > today.getMonth();
  const canGoNext = new Date(viewYear, viewMonth + 1, 1) <= maxDate;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={prevMonth} disabled={!canGoPrev} className="cal-nav-btn p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
          <ChevronLeft size={16} />
        </button>
        <span className="font-semibold text-lg">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button type="button" onClick={nextMonth} disabled={!canGoNext} className="cal-nav-btn p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-center text-xs font-medium uppercase text-gray-400 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const enabled = isEnabled(day);
          const selected = isSelected(day);
          const todayCell = isToday(day);
          const withSlots = hasSlots(day);

          return (
            <button
              type="button"
              key={i}
              onClick={() => handleClick(day)}
              disabled={!enabled}
              className={`
                h-11 rounded-lg text-base transition-all flex items-center justify-center
                ${selected ? 'bg-gray-900 text-white font-bold' : ''}
                ${!selected && enabled && withSlots ? 'font-bold text-gray-900 hover:bg-gray-100' : ''}
                ${!selected && enabled && !withSlots ? 'font-medium text-gray-400 hover:bg-gray-50' : ''}
                ${!enabled ? 'text-gray-200 cursor-not-allowed' : 'cursor-pointer'}
                ${todayCell && !selected ? 'ring-1 ring-gray-300' : ''}
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
