const LA_PAZ_TIME_ZONE = 'America/La_Paz';

function getLaPazDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_PAZ_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function getLaPazDateKey(date) {
  const { year, month, day } = getLaPazDateParts(date);
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function getLaPazMinutes(date) {
  const { hour, minute } = getLaPazDateParts(date);
  if (hour == null || minute == null) return null;
  return parseInt(hour, 10) * 60 + parseInt(minute, 10);
}

function getBusyRangeForEventOnDate(event, targetDateKey) {
  if (!event?.start || !event?.end || !targetDateKey) return null;

  if (event.start.date && !event.start.dateTime) {
    const startDateKey = String(event.start.date);
    const endDateKey = String(event.end.date || event.start.date);
    if (startDateKey <= targetDateKey && targetDateKey < endDateKey) {
      return { start: 0, end: 1440 };
    }
    return null;
  }

  if (!event.start.dateTime || !event.end.dateTime) return null;

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const startDateKey = getLaPazDateKey(start);
  const endDateKey = getLaPazDateKey(end);
  if (!startDateKey || !endDateKey) return null;
  if (targetDateKey < startDateKey || targetDateKey > endDateKey) return null;

  return {
    start: startDateKey === targetDateKey ? (getLaPazMinutes(start) ?? 0) : 0,
    end: endDateKey === targetDateKey ? (getLaPazMinutes(end) ?? 1440) : 1440,
  };
}

function getBusyRangesForDate(events, targetDateKey) {
  return (events || [])
    .map((event) => getBusyRangeForEventOnDate(event, targetDateKey))
    .filter((range) => range && range.end > range.start);
}

module.exports = {
  LA_PAZ_TIME_ZONE,
  getLaPazDateKey,
  getLaPazMinutes,
  getBusyRangeForEventOnDate,
  getBusyRangesForDate,
};
