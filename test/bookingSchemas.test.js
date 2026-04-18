const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  publicBookingSchema,
  adminBookingSchema,
  publicRescheduleSchema,
  adminRescheduleSchema,
  clientSchema,
} = require('../server/middleware/validate');

// publicBookingSchema ─────────────────────────────────────────────

test('publicBookingSchema: accepts valid minimal payload', () => {
  const result = publicBookingSchema.safeParse({
    phone: '+591 720-34151',
    date_time: '2026-05-01T10:00',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.phone, '59172034151'); // phone normalized
});

test('publicBookingSchema: accepts onboarding block', () => {
  const result = publicBookingSchema.safeParse({
    phone: '59172034151',
    date_time: '2026-05-01T10:00',
    onboarding: { first_name: 'Daniel', last_name: 'MacLean' },
  });
  assert.equal(result.success, true);
});

test('publicBookingSchema: rejects short phone', () => {
  const result = publicBookingSchema.safeParse({
    phone: '1234',
    date_time: '2026-05-01T10:00',
  });
  assert.equal(result.success, false);
});

test('publicBookingSchema: rejects bad date_time format', () => {
  const r1 = publicBookingSchema.safeParse({ phone: '59172034151', date_time: '2026/05/01 10:00' });
  const r2 = publicBookingSchema.safeParse({ phone: '59172034151', date_time: '2026-05-01' });
  const r3 = publicBookingSchema.safeParse({ phone: '59172034151', date_time: '2026-05-01T10:00:00' });
  assert.equal(r1.success, false);
  assert.equal(r2.success, false);
  assert.equal(r3.success, false); // schema requires HH:MM, not HH:MM:SS
});

test('publicBookingSchema: rejects invalid fee_mode', () => {
  const result = publicBookingSchema.safeParse({
    phone: '59172034151',
    date_time: '2026-05-01T10:00',
    fee_mode: 'vip',
  });
  assert.equal(result.success, false);
});

test('publicBookingSchema: accepts fee_mode=pe with code', () => {
  const result = publicBookingSchema.safeParse({
    phone: '59172034151',
    date_time: '2026-05-01T10:00',
    fee_mode: 'pe',
    code: 'abc123',
  });
  assert.equal(result.success, true);
});

// adminBookingSchema ──────────────────────────────────────────────

test('adminBookingSchema: requires client_id as positive int', () => {
  const valid = adminBookingSchema.safeParse({ client_id: 42, date_time: '2026-05-01T10:00' });
  const invalid1 = adminBookingSchema.safeParse({ client_id: 0, date_time: '2026-05-01T10:00' });
  const invalid2 = adminBookingSchema.safeParse({ client_id: -5, date_time: '2026-05-01T10:00' });
  const invalid3 = adminBookingSchema.safeParse({ client_id: 'abc', date_time: '2026-05-01T10:00' });
  assert.equal(valid.success, true);
  assert.equal(invalid1.success, false);
  assert.equal(invalid2.success, false);
  assert.equal(invalid3.success, false);
});

// publicRescheduleSchema ──────────────────────────────────────────

test('publicRescheduleSchema: requires reschedule_token', () => {
  const withoutToken = publicRescheduleSchema.safeParse({
    phone: '59172034151',
    old_appointment_id: 10,
    date_time: '2026-05-01T10:00',
  });
  assert.equal(withoutToken.success, false);

  const valid = publicRescheduleSchema.safeParse({
    phone: '59172034151',
    old_appointment_id: 10,
    date_time: '2026-05-01T10:00',
    reschedule_token: 'tok',
  });
  assert.equal(valid.success, true);
});

// adminRescheduleSchema ──────────────────────────────────────────

test('adminRescheduleSchema: requires client_id and old_appointment_id', () => {
  const valid = adminRescheduleSchema.safeParse({
    client_id: 1,
    old_appointment_id: 2,
    date_time: '2026-05-01T10:00',
  });
  const missing = adminRescheduleSchema.safeParse({
    client_id: 1,
    date_time: '2026-05-01T10:00',
  });
  assert.equal(valid.success, true);
  assert.equal(missing.success, false);
});

// clientSchema ────────────────────────────────────────────────────

test('clientSchema: enforces enums on modality / frequency / payment_method', () => {
  const invalid = clientSchema.safeParse({
    phone: '59172034151',
    first_name: 'A',
    last_name: 'B',
    modality: 'Hibrido', // not in enum
  });
  assert.equal(invalid.success, false);

  const valid = clientSchema.safeParse({
    phone: '59172034151',
    first_name: 'A',
    last_name: 'B',
    modality: 'Presencial',
    frequency: 'Semanal',
    payment_method: 'QR',
  });
  assert.equal(valid.success, true);
});

test('clientSchema: clamps rating to 0-5', () => {
  assert.equal(clientSchema.safeParse({
    phone: '59172034151',
    first_name: 'A',
    last_name: 'B',
    rating: 6,
  }).success, false);

  assert.equal(clientSchema.safeParse({
    phone: '59172034151',
    first_name: 'A',
    last_name: 'B',
    rating: -1,
  }).success, false);

  assert.equal(clientSchema.safeParse({
    phone: '59172034151',
    first_name: 'A',
    last_name: 'B',
    rating: 4,
  }).success, true);
});
