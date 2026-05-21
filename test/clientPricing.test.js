const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseForeignPricingProfiles,
  resolveForeignPricingProfile,
} = require('../server/services/clientPricing');

const config = {
  foreign_pricing_profiles: JSON.stringify([
    {
      key: 'usd-1',
      name: 'USD 22',
      amount: 22,
      currency: 'USD',
      url: 'https://buy.stripe.com/test_usd_1',
    },
    {
      key: 'usd-2',
      name: 'USD 45',
      amount: 45,
      currency: 'USD',
      url: 'https://buy.stripe.com/test_usd_2',
    },
  ]),
};

test('parseForeignPricingProfiles: keeps configured Stripe payment links', () => {
  const profiles = parseForeignPricingProfiles(config.foreign_pricing_profiles);

  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].key, 'usd-1');
  assert.equal(profiles[0].amount, 22);
  assert.equal(profiles[0].currency, 'USD');
  assert.equal(profiles[0].url, 'https://buy.stripe.com/test_usd_1');
});

test('resolveForeignPricingProfile: resolves by explicit client foreign_pricing_key', () => {
  const profile = resolveForeignPricingProfile({
    client: {
      fee: 22,
      fee_currency: 'USD',
      foreign_pricing_key: 'usd-1',
    },
    config,
  });

  assert.equal(profile.key, 'usd-1');
  assert.equal(profile.url, 'https://buy.stripe.com/test_usd_1');
});

test('resolveForeignPricingProfile: falls back to USD amount when key is missing', () => {
  const profile = resolveForeignPricingProfile({
    client: {
      fee: 45,
      fee_currency: 'USD',
      foreign_pricing_key: null,
    },
    config,
  });

  assert.equal(profile.key, 'usd-2');
});

test('resolveForeignPricingProfile: ignores local BOB clients without foreign key', () => {
  const profile = resolveForeignPricingProfile({
    client: {
      fee: 250,
      fee_currency: 'BOB',
    },
    config,
  });

  assert.equal(profile, null);
});
