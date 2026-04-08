// Date formatting helpers for Bolivia timezone

export function getBoliviaDateKey(dateInput = new Date()) {
  const date = new Date(dateInput);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function formatWeekdayShort(dayOfWeek) {
  const labels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return labels[Number(dayOfWeek)] || '—';
}

export function formatDateBolivia(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-BO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/La_Paz',
  });
}

export function formatTimeBolivia(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/La_Paz',
  });
}

export function formatDateTimeBolivia(dateStr) {
  return `${formatDateBolivia(dateStr)} a las ${formatTimeBolivia(dateStr)}`;
}

export function formatRelativeDay(dateStr) {
  const todayKey = getBoliviaDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = getBoliviaDateKey(tomorrow);
  const targetKey = getBoliviaDateKey(new Date(dateStr));

  if (targetKey === todayKey) return 'Hoy';
  if (targetKey === tomorrowKey) return 'Mañana';
  return new Date(dateStr).toLocaleDateString('es-BO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'America/La_Paz',
  });
}

export function formatRelativeTime(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffHrs < 24) return `hace ${diffHrs}h`;
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString('es-BO', { day: 'numeric', month: 'short', timeZone: 'America/La_Paz' });
}
