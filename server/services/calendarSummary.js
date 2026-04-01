function stripCalendarMarkers(summary) {
  return String(summary || '').replace(/^(?:(?:💰|✅|\$)\s*)+/, '').trim();
}

function hasCalendarPaymentMarker(summary) {
  const prefix = String(summary || '').trim().match(/^(?:(?:💰|✅|\$)\s*)+/)?.[0] || '';
  return /💰|\$/.test(prefix);
}

function buildCalendarSummary(summary, { paid = false, confirmed = false } = {}) {
  const base = stripCalendarMarkers(summary);
  const prefixes = [];
  if (confirmed) prefixes.push('✅');
  if (paid) prefixes.push('💰');
  return `${prefixes.length ? `${prefixes.join(' ')} ` : ''}${base}`.trim();
}

module.exports = {
  stripCalendarMarkers,
  hasCalendarPaymentMarker,
  buildCalendarSummary,
};
