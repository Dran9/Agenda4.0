const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectBestPendingPaymentForOcr } = require('../server/services/receiptPaymentMatcher');

test('selectBestPendingPaymentForOcr: prefers today payment with recent QR over old mismatch for same amount', () => {
  const result = selectBestPendingPaymentForOcr([
    {
      id: 213,
      amount: 250,
      fee: 250,
      status: 'Mismatch',
      appointment_id: 213,
      date_time: new Date('2026-05-06T16:00:00.000Z'),
      qr_sent_at: new Date('2026-05-05T22:42:17.000Z'),
    },
    {
      id: 283,
      amount: 250,
      fee: 250,
      status: 'Pendiente',
      appointment_id: 283,
      date_time: new Date('2026-06-10T15:00:00.000Z'),
      qr_sent_at: new Date('2026-06-10T00:53:56.000Z'),
    },
    {
      id: 251,
      amount: 250,
      fee: 250,
      status: 'Pendiente',
      appointment_id: 251,
      date_time: new Date('2026-05-27T15:00:00.000Z'),
      qr_sent_at: new Date('2026-05-26T22:36:00.000Z'),
    },
  ], {
    amount: 250,
    date: '10/06/2026',
  }, {
    now: new Date('2026-06-10T12:08:52.000Z'),
  });

  assert.equal(result.id, 283);
});

test('selectBestPendingPaymentForOcr: falls back to same receipt date when QR is absent', () => {
  const result = selectBestPendingPaymentForOcr([
    {
      id: 251,
      amount: 250,
      fee: 250,
      status: 'Pendiente',
      date_time: new Date('2026-05-27T15:00:00.000Z'),
      qr_sent_at: null,
    },
    {
      id: 283,
      amount: 250,
      fee: 250,
      status: 'Pendiente',
      date_time: new Date('2026-06-10T15:00:00.000Z'),
      qr_sent_at: null,
    },
  ], {
    amount: 250,
    date: '10/06/2026',
  }, {
    now: new Date('2026-06-10T12:08:52.000Z'),
  });

  assert.equal(result.id, 283);
});
