const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBolivianReceipt } = require('../server/services/ocr');

function buildBnbReceipt(destName) {
  return [
    'BNB',
    'Comprobante Electronico',
    'Pago QR - Tarjeta de Credito',
    'Referencia: 250',
    'Fecha de la transaccion: 03/05/2026',
    'Hora de la transaccion: 21:34:05',
    'Nombre del originante: MONICA PATRICIA ORELLANA CHAVARRIA',
    'Se debito de su tarjeta de credito: 4772********6131',
    `Nombre del destinatario: ${destName}`,
    'Banco destino: BANCO DE CREDITO',
    'Se acredito a la cuenta: 301********355',
    'La suma de Bs.: 250',
    'Bancarizacion: 3P59057897',
  ].join('\n');
}

test('parseBolivianReceipt: accepts BNB masked destination account with trusted legal name', () => {
  const result = parseBolivianReceipt(buildBnbReceipt('Mac Lean Estrada Oscar Daniel'));

  assert.equal(result.amount, 250);
  assert.equal(result.reference, '3P59057897');
  assert.equal(result.destAccount, '301********355');
  assert.equal(result.destAccountVerified, true);
  assert.equal(result.destNameVerified, true);
  assert.equal(result.destVerified, true);
  assert.equal(result.destVerificationLevel, 'masked_account_with_name');
});

test('parseBolivianReceipt: rejects masked destination account when recipient name is not trusted', () => {
  const result = parseBolivianReceipt(buildBnbReceipt('Cliente Equivocado'));

  assert.equal(result.destAccount, '301********355');
  assert.equal(result.destAccountVerified, false);
  assert.equal(result.destNameVerified, false);
  assert.equal(result.destVerified, false);
  assert.equal(result.destVerificationLevel, 'masked_account_untrusted_name');
});

test('parseBolivianReceipt: treats Oscar as valid only with stronger identity signals', () => {
  const validResult = parseBolivianReceipt(buildBnbReceipt('Mac Lean Oscar'));
  const invalidResult = parseBolivianReceipt(buildBnbReceipt('Oscar Rodriguez'));

  assert.equal(validResult.destNameVerified, true);
  assert.equal(validResult.destVerified, true);
  assert.equal(invalidResult.destNameVerified, false);
  assert.equal(invalidResult.destVerified, false);
});
