import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];
const DAY_COLUMNS = [
  { key: 'lunes', label: 'Lun', jsDay: 1 },
  { key: 'martes', label: 'Mar', jsDay: 2 },
  { key: 'miercoles', label: 'Mié', jsDay: 3 },
  { key: 'jueves', label: 'Jue', jsDay: 4 },
  { key: 'viernes', label: 'Vie', jsDay: 5 },
  { key: 'sabado', label: 'Sáb', jsDay: 6 },
  { key: 'domingo', label: 'Dom', jsDay: 0 },
];
const DAY_MAP = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes', 6: 'sabado' };

export default function Calendar({ onSelectDate, selectedDate, availableDays = [], windowDays = 10, daysWithSlots, onMonthChange }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + windowDays);
    return d;
  }, [today, windowDays]);

  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  const visibleColumns = useMemo(() => {
    const filtered = DAY_COLUMNS.filter(day => (
      !['sabado', 'domingo'].includes(day.key) || availableDays.includes(day.key)
    ));
    return filtered.length > 0 ? filtered : DAY_COLUMNS;
  }, [availableDays]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstVisibleDate = useMemo(() => {
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = DAY_MAP[new Date(viewYear, viewMonth, d).getDay()];
      if (visibleColumns.some(column => column.key === dayKey)) return d;
    }
    return null;
  }, [daysInMonth, viewYear, viewMonth, visibleColumns]);

  const startOffset = useMemo(() => {
    if (!firstVisibleDate) return 0;
    const firstVisibleJsDay = new Date(viewYear, viewMonth, firstVisibleDate).getDay();
    const visibleIndex = visibleColumns.findIndex(column => column.jsDay === firstVisibleJsDay);
    return visibleIndex >= 0 ? visibleIndex : 0;
  }, [firstVisibleDate, viewYear, viewMonth, visibleColumns]);

  const cells = useMemo(() => {
    const nextCells = [];
    for (let i = 0; i < startOffset; i++) nextCells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = DAY_MAP[new Date(viewYear, viewMonth, d).getDay()];
      if (visibleColumns.some(column => column.key === dayKey)) nextCells.push(d);
    }
    while (nextCells.length % visibleColumns.length !== 0) nextCells.push(null);
    return nextCells;
  }, [startOffset, daysInMonth, viewYear, viewMonth, visibleColumns]);

  useEffect(() => { if (onMonthChange) onMonthChange(viewYear, viewMonth); }, [viewYear, viewMonth]);

  function getDateStr(day) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function isToday(day) {
    return day && viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
  }
  function isEnabled(day) {
    if (!day) return false;
    const date = new Date(viewYear, viewMonth, day); date.setHours(0,0,0,0);
    if (date < today || date > maxDate) return false;
    return availableDays.includes(DAY_MAP[date.getDay()]);
  }
  function hasSlots(day) { return day && daysWithSlots?.has(getDateStr(day)); }
  function isSelected(day) { return day && selectedDate === getDateStr(day); }
  function handleClick(day) { if (isEnabled(day)) onSelectDate(getDateStr(day)); }

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
    <div className="calendar-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button type="button" onClick={prevMonth} disabled={!canGoPrev} className="cal-nav-btn">
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontWeight: 600, fontSize: 20 }}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth} disabled={!canGoNext} className="cal-nav-btn">
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleColumns.length}, 1fr)`, gap: 2, marginBottom: 4 }}>
        {visibleColumns.map(d => (
          <div key={d.key} style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, textTransform: 'uppercase', color: '#A4A4A6', padding: '4px 0' }}>
            {d.label}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleColumns.length}, 1fr)`, gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const enabled = isEnabled(day);
          const selected = isSelected(day);
          const todayCell = isToday(day);
          const withSlots = hasSlots(day);

          let bg = 'transparent';
          let color = '#A4A4A6';
          let fw = 400;

          if (selected) { bg = 'var(--azul-acero)'; color = 'white'; fw = 700; }
          else if (enabled && withSlots) { color = '#000000'; fw = 900; }
          else if (enabled) { color = '#A4A4A6'; fw = 600; }
          else { color = '#A4A4A6'; fw = 600; }

          return (
            <button
              type="button" key={i} onClick={() => handleClick(day)} disabled={!enabled}
              style={{
                height: 44, borderRadius: 10, fontSize: 20, display: 'flex',
                alignItems: 'center', justifyContent: 'center', border: 'none',
                background: bg, cursor: enabled ? 'pointer' : 'not-allowed',
                transition: 'all 200ms', fontWeight: fw, color,
                boxShadow: todayCell && !selected ? 'inset 0 0 0 1.5px var(--arena)' : 'none',
              }}
              onMouseEnter={e => { if (enabled && !selected) e.target.style.background = 'var(--blanco-gris)'; }}
              onMouseLeave={e => { if (!selected) e.target.style.background = 'transparent'; }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
