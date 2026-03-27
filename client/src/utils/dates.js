// Date formatting helpers for Bolivia timezone

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
