const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAttendanceConfirmationReply,
  resolveAttendancePaymentInstruction,
} = require('../server/services/confirmationReply');

test('confirmation reply: paid appointment does not promise a new payment instruction', () => {
  const instruction = resolveAttendancePaymentInstruction({
    appointment: {
      payment_status: 'Confirmado',
      client_phone: '59170000000',
      fee: 250,
      fee_currency: 'BOB',
      client_country: 'Bolivia',
    },
  });

  const reply = buildAttendanceConfirmationReply('Laura ', instruction);

  assert.equal(instruction.kind, 'paid');
  assert.match(reply, /Tu pago ya está registrado/);
  assert.doesNotMatch(reply, /QR|enlace para pago adelantado/);
  assert.doesNotMatch(reply, /Laura ,/);
});

test('confirmation reply: Bolivia unpaid appointment promises QR only', () => {
  const instruction = resolveAttendancePaymentInstruction({
    appointment: {
      payment_status: 'Pendiente',
      client_phone: '59170000000',
      fee: 250,
      fee_currency: 'BOB',
      client_country: 'Bolivia',
    },
  });

  const reply = buildAttendanceConfirmationReply('Luciana', instruction);

  assert.equal(instruction.kind, 'qr');
  assert.match(reply, /te mandamos el \*QR\*/);
  assert.doesNotMatch(reply, /QR\* o _enlace_/);
});

test('confirmation reply: foreign configured appointment promises payment link only', () => {
  const instruction = resolveAttendancePaymentInstruction({
    appointment: {
      payment_status: 'Pendiente',
      client_phone: '34600000000',
      fee: 22,
      fee_currency: 'USD',
      foreign_pricing_key: 'usd-1',
      client_country: 'España',
    },
    config: {
      foreign_pricing_profiles: JSON.stringify([
        { key: 'usd-1', amount: 22, currency: 'USD', url: 'https://pay.example/usd-1' },
      ]),
    },
  });

  const reply = buildAttendanceConfirmationReply('Octavia', instruction);

  assert.equal(instruction.kind, 'stripe');
  assert.match(reply, /te mandamos el enlace/);
  assert.doesNotMatch(reply, /QR/);
});

test('confirmation reply: foreign appointment without profile does not promise an unavailable link', () => {
  const instruction = resolveAttendancePaymentInstruction({
    appointment: {
      payment_status: 'Pendiente',
      client_phone: '34600000000',
      fee: 22,
      fee_currency: 'USD',
      foreign_pricing_key: 'missing',
      client_country: 'España',
    },
    config: {
      foreign_pricing_profiles: '[]',
    },
  });

  const reply = buildAttendanceConfirmationReply('Octavia', instruction);

  assert.equal(instruction.kind, 'missing_stripe');
  assert.match(reply, /Daniel revisará contigo/);
  assert.doesNotMatch(reply, /te mandamos el enlace/);
  assert.doesNotMatch(reply, /QR/);
});
