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

function normalizeCurrency(value) {
  const normalized = String(value || 'USD').trim().toUpperCase();
  return normalized === 'BOB' ? 'BOB' : 'USD';
}

function parseForeignPricingProfiles(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((profile) => {
      const key = String(profile?.key || '').trim().toLowerCase();
      const amount = Number(profile?.amount);
      const url = String(profile?.url || '').trim();
      if (!key || !Number.isFinite(amount) || amount <= 0 || !url) return null;
      return {
        key,
        name: String(profile?.name || profile?.label || key).trim().slice(0, 80),
        amount: Math.round(amount * 100) / 100,
        currency: normalizeCurrency(profile?.currency),
        url,
      };
    })
    .filter(Boolean);
}

function getAutomaticLocalFee({ city, country, config = {} }) {
  if (!isBoliviaCountry(country)) return null;
  return getCapitalCities(config).has(normalizeText(city))
    ? getCapitalFee(config)
    : getDefaultFee(config);
}

function resolveForeignPricingProfile({ client = null, config = {} }) {
  const profiles = parseForeignPricingProfiles(config?.foreign_pricing_profiles);
  const key = String(client?.foreign_pricing_key || '').trim().toLowerCase();
  if (key) {
    return profiles.find((profile) => profile.key === key) || null;
  }

  const currency = normalizeCurrency(client?.fee_currency || 'BOB');
  const amount = Number(client?.fee);
  if (currency === 'BOB' || !Number.isFinite(amount) || amount <= 0) return null;

  return profiles.find((profile) => (
    profile.currency === currency && Math.abs(Number(profile.amount) - amount) < 0.01
  )) || null;
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
  parseForeignPricingProfiles,
  resolveForeignPricingProfile,
  getSpecialFee,
  isBoliviaCountry,
  resolveQrKey,
};
