const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMercantilQrEmail } = require('../server/services/bankEmail');

const sampleEmail = `
Notificaciones
Estimado(a) MAC LEAN ESTRADA OSCAR DANIEL,

Banco Mercantil Santa Cruz S.A. le informa que se ha realizado la siguiente transacción:

Crédito Transferencia QR, por concepto de BMQRINDAGACIONC, a su cuenta 1006628555 de la cuenta 30151182874355 de OSCAR DANIEL MAC LEAN ESTRADA del BANCO DE CREDITO DE BOLIVIA S.A., por un monto de Bs 200.00.

La transacción fue realizada el 19/05/2026 a las 06:12:01 pm.
`;

test('parseMercantilQrEmail: extracts QR bank notification fields', () => {
  const result = parseMercantilQrEmail(sampleEmail);

  assert.equal(result.concept, 'BMQRINDAGACIONC');
  assert.equal(result.destinationAccount, '1006628555');
  assert.equal(result.originAccount, '30151182874355');
  assert.equal(result.payerName, 'OSCAR DANIEL MAC LEAN ESTRADA');
  assert.equal(result.originBank, 'BANCO DE CREDITO DE BOLIVIA S.A.');
  assert.equal(result.amount, 200);
  assert.equal(result.currency, 'BOB');
  assert.equal(result.transactionDateText, '19/05/2026');
  assert.equal(result.transactionTimeText, '06:12:01');
  assert.equal(result.transactionAt.toISOString(), '2026-05-19T22:12:01.000Z');
});

test('parseMercantilQrEmail: returns null for unrelated email body', () => {
  assert.equal(parseMercantilQrEmail('hola mundo'), null);
});
