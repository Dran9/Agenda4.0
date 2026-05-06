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

// Vision OCR sometimes returns the BNB receipt with the labels and values
// split across multiple lines because the template uses a two-column layout.
// This is the layout that has been rejecting Daniel's real receipts.
function buildBnbReceiptColumnSplit(destNameLines) {
  return [
    'BNB',
    'Comprobante Electronico',
    'Transferencia interbancaria',
    'Referencia:',
    '250',
    'Fecha de la',
    'transaccion:',
    '05/05/2026',
    'Hora de la',
    'transaccion:',
    '19:49:55',
    'Nombre del',
    'originante:',
    'NAVA CLAUDIA M.',
    'Se debito de su',
    'caja de ahorro:',
    '350****856',
    'Nombre del',
    'destinatario:',
    ...destNameLines,
    'Banco destino:',
    'BANCO DE',
    'CREDITO',
    'Se acredito a la',
    'cuenta:',
    '301********355',
    'La suma de Bs.:',
    '250',
    'Bancarizacion:',
    '3P63451085',
  ].join('\n');
}

test('parseBolivianReceipt: BNB column-split layout with label and value wrapped', () => {
  const result = parseBolivianReceipt(buildBnbReceiptColumnSplit(['Mac Lean Estrada', 'Oscar Daniel']));

  assert.equal(result.amount, 250);
  assert.equal(result.destAccount, '301********355');
  assert.match(result.destName || '', /Mac Lean Estrada Oscar Daniel/i);
  assert.equal(result.destNameVerified, true);
  assert.equal(result.destVerified, true);
  assert.equal(result.destVerificationLevel, 'masked_account_with_name');
});

test('parseBolivianReceipt: BNB column-split layout with name in reverse order', () => {
  // Some receipts print "Apellido Nombre" while others print "Nombre Apellido".
  const result = parseBolivianReceipt(buildBnbReceiptColumnSplit(['Oscar Daniel', 'Mac Lean Estrada']));

  assert.equal(result.destNameVerified, true);
  assert.equal(result.destVerified, true);
});

test('parseBolivianReceipt: free-text identity fallback when destName cannot be extracted', () => {
  // Worst case: dest name field is missing entirely from the parsed text but
  // the user's name still appears somewhere on the receipt (e.g. in a header
  // or footer). The masked account match plus free-text identity must verify.
  const text = [
    'BNB',
    'Comprobante Electronico',
    'Pago a Mac Lean Estrada Oscar Daniel',
    'Referencia: 250',
    'Fecha de la transaccion: 05/05/2026',
    'Nombre del originante: NAVA CLAUDIA M.',
    'Banco destino: BANCO DE CREDITO',
    'Cuenta: 301********355',
    'La suma de Bs.: 250',
    'Bancarizacion: 3P63451085',
  ].join('\n');

  const result = parseBolivianReceipt(text);

  assert.equal(result.destAccount, '301********355');
  assert.equal(result.destNameVerified, true);
  assert.equal(result.destVerified, true);
  assert.equal(result.destVerificationLevel, 'masked_account_with_text_name');
});

test('parseBolivianReceipt: free-text fallback ignores given names that come from the originator', () => {
  // If the sender happens to be named "Daniel", that token must not satisfy
  // the destination identity check on its own — needs the surname signal too.
  const text = [
    'BNB',
    'Comprobante Electronico',
    'Referencia: 250',
    'Fecha de la transaccion: 05/05/2026',
    'Nombre del originante: DANIEL OSCAR PEREZ',
    'Banco destino: BANCO DE CREDITO',
    'Cuenta: 301********355',
    'La suma de Bs.: 250',
  ].join('\n');

  const result = parseBolivianReceipt(text);

  assert.equal(result.destNameVerified, false);
  assert.equal(result.destVerified, false);
});
