function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function hasPhoneDigits(value, { min = 8, max = 20 } = {}) {
  const phone = normalizePhone(value);
  return phone.length >= min && phone.length <= max;
}

function normalizedPhoneSql(columnName) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${columnName}, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')`;
}

module.exports = {
  normalizePhone,
  hasPhoneDigits,
  normalizedPhoneSql,
};
