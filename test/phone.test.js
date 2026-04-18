const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, hasPhoneDigits } = require('../server/utils/phone');

test('normalizePhone: keeps only digits', () => {
  assert.equal(normalizePhone('+591 720-34151'), '59172034151');
  assert.equal(normalizePhone('(591) 7.20.34.151'), '59172034151');
  assert.equal(normalizePhone('   59172034151   '), '59172034151');
});

test('normalizePhone: handles null/undefined/empty safely', () => {
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('abc'), '');
});

test('normalizePhone: accepts numbers', () => {
  assert.equal(normalizePhone(59172034151), '59172034151');
});

test('hasPhoneDigits: enforces min/max digit length', () => {
  assert.equal(hasPhoneDigits('59172034151'), true);
  assert.equal(hasPhoneDigits('1234567'), false); // 7 digits, below default min 8
  assert.equal(hasPhoneDigits('12345678'), true); // exactly 8 digits
  assert.equal(hasPhoneDigits('1'.repeat(21)), false); // 21 digits, above default max 20
});

test('hasPhoneDigits: respects custom bounds', () => {
  assert.equal(hasPhoneDigits('123', { min: 3, max: 3 }), true);
  assert.equal(hasPhoneDigits('1234', { min: 3, max: 3 }), false);
});
