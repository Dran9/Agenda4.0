function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isBoliviaCountry(country) {
  const normalized = normalizeText(country);
  return !normalized || normalized === 'bolivia' || normalized === 'bo';
}

function getCapitalCities(config = {}) {
  return new Set(
    String(config?.capital_cities || '')
      .split(',')
      .map((city) => normalizeText(city))
      .filter(Boolean)
  );
}

function getDefaultFee(config = {}) {
  return parseInt(config?.default_fee, 10) || 250;
}

function getCapitalFee(config = {}) {
  return parseInt(config?.capital_fee, 10) || 300;
}

function getSpecialFee(config = {}) {
  return parseInt(config?.special_fee, 10) || 150;
}

function getAutomaticLocalFee({ city, country, config = {} }) {
  if (!isBoliviaCountry(country)) return null;
  return getCapitalCities(config).has(normalizeText(city))
    ? getCapitalFee(config)
    : getDefaultFee(config);
}

function resolveQrKey({ client = null, fee = null, config = {} }) {
  if (Number(client?.special_fee_enabled) === 1) return 'qr_150';

  const normalizedFee = parseInt(fee ?? client?.fee, 10);
  if (normalizedFee === getCapitalFee(config)) return 'qr_300';
  if (normalizedFee === getSpecialFee(config)) return 'qr_150';
  if (normalizedFee === getDefaultFee(config)) return 'qr_250';
  return 'qr_generico';
}

module.exports = {
  getAutomaticLocalFee,
  getSpecialFee,
  isBoliviaCountry,
  resolveQrKey,
};
