const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEmailDelayWarning,
  collectHistoryMessageIds,
  filterCandidatePaymentsForBankEmail,
  formatMysqlDateTime,
  isRecipientNameValid,
  parseMercantilQrEmail,
  parsePubSubNotification,
} = require('../server/services/bankEmail');

const sampleEmail = `
Notificaciones
Estimado(a) MAC LEAN ESTRADA OSCAR DANIEL,

Banco Mercantil Santa Cruz S.A. le informa que se ha realizado la siguiente transacción:

Crédito Transferencia QR, por concepto de BMQRINDAGACIONC, a su cuenta 1006628555 de la cuenta 30151182874355 de OSCAR DANIEL MAC LEAN ESTRADA del BANCO DE CREDITO DE BOLIVIA S.A., por un monto de Bs 200.00.

La transacción fue realizada el 19/05/2026 a las 06:12:01 pm.
`;

test('parseMercantilQrEmail: extracts QR bank notification fields', () => {
  const result = parseMercantilQrEmail(sampleEmail);

  assert.equal(result.recipientName, 'MAC LEAN ESTRADA OSCAR DANIEL');
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

test('isRecipientNameValid: accepts the configured bank email recipient', () => {
  assert.equal(isRecipientNameValid('MAC LEAN ESTRADA OSCAR DANIEL'), true);
  assert.equal(isRecipientNameValid('OTRA PERSONA'), false);
});

test('formatMysqlDateTime: stores instants as Bolivia local DATETIME', () => {
  assert.equal(
    formatMysqlDateTime(new Date('2026-06-01T12:38:35.000Z')),
    '2026-06-01 08:38:35'
  );
});

test('buildEmailDelayWarning: warns but does not block late Gmail delivery', () => {
  const parsed = parseMercantilQrEmail(sampleEmail);
  const emailReceivedAt = new Date('2026-05-19T22:30:01.000Z');

  const warning = buildEmailDelayWarning(parsed, emailReceivedAt, 5);

  assert.match(warning, /18 min/);
  assert.match(warning, /matchea por QR/);
});

test('buildEmailDelayWarning: returns null inside acceptable delay window', () => {
  const parsed = parseMercantilQrEmail(sampleEmail);
  const emailReceivedAt = new Date('2026-05-19T22:15:01.000Z');

  assert.equal(buildEmailDelayWarning(parsed, emailReceivedAt, 5), null);
});

test('parsePubSubNotification: decodes Gmail history notification', () => {
  const data = Buffer.from(JSON.stringify({
    emailAddress: 'danielmacleann@gmail.com',
    historyId: '9876543210',
  })).toString('base64url');

  const result = parsePubSubNotification({
    subscription: 'projects/agenda40/subscriptions/gmail-qr-payments-push',
    message: {
      messageId: 'pubsub-1',
      publishTime: '2026-05-20T12:00:00Z',
      data,
    },
  });

  assert.equal(result.emailAddress, 'danielmacleann@gmail.com');
  assert.equal(result.historyId, '9876543210');
  assert.equal(result.messageId, 'pubsub-1');
});

test('collectHistoryMessageIds: collects unique message ids from Gmail history', () => {
  const result = collectHistoryMessageIds([
    {
      messagesAdded: [{ message: { id: 'a' } }],
      labelsAdded: [{ message: { id: 'b' } }],
      messages: [{ id: 'a' }, { id: 'c' }],
    },
  ]);

  assert.deepEqual(result.sort(), ['a', 'b', 'c']);
});

test('filterCandidatePaymentsForBankEmail: recent WhatsApp receipt wins over stale same-amount candidates', () => {
  const result = filterCandidatePaymentsForBankEmail([
    {
      id: 273,
      first_name: 'Camila',
      last_name: 'Arze',
      date_time: new Date('2026-06-01T21:00:00.000Z'),
      qr_sent_at: new Date('2026-05-31T23:19:50.000Z'),
      recent_receipt_at: new Date('2026-06-01T12:39:02.000Z'),
    },
    {
      id: 251,
      first_name: 'Margarita',
      last_name: 'Paz',
      date_time: new Date('2026-05-27T15:00:00.000Z'),
      qr_sent_at: new Date('2026-05-26T22:36:00.000Z'),
      recent_receipt_at: null,
    },
    {
      id: 257,
      first_name: 'Roger',
      last_name: 'Echalar',
      date_time: new Date('2026-05-27T12:00:00.000Z'),
      qr_sent_at: new Date('2026-05-26T22:32:21.000Z'),
      recent_receipt_at: null,
    },
    {
      id: 270,
      first_name: 'Roger',
      last_name: 'Echalar',
      date_time: new Date('2026-06-03T12:00:00.000Z'),
      qr_sent_at: null,
      recent_receipt_at: null,
    },
  ], {
    transactionAt: new Date('2026-06-01T12:38:35.000Z'),
    qrWindowHours: 12,
  });

  assert.deepEqual(result.map((row) => row.id), [273]);
});

test('filterCandidatePaymentsForBankEmail: drops unrelated old and far-future candidates', () => {
  const result = filterCandidatePaymentsForBankEmail([
    {
      id: 273,
      date_time: new Date('2026-06-01T21:00:00.000Z'),
      qr_sent_at: null,
      recent_receipt_at: null,
    },
    {
      id: 251,
      date_time: new Date('2026-05-27T15:00:00.000Z'),
      qr_sent_at: null,
      recent_receipt_at: null,
    },
    {
      id: 262,
      date_time: new Date('2026-06-08T15:00:00.000Z'),
      qr_sent_at: null,
      recent_receipt_at: null,
    },
  ], {
    transactionAt: new Date('2026-06-01T12:38:35.000Z'),
  });

  assert.deepEqual(result.map((row) => row.id), [273]);
});

test('filterCandidatePaymentsForBankEmail: recent receipt does not pull a far-future payment from the same client', () => {
  const result = filterCandidatePaymentsForBankEmail([
    {
      id: 290,
      date_time: new Date('2026-06-08T23:00:00.000Z'),
      qr_sent_at: new Date('2026-06-08T21:02:51.000Z'),
      recent_receipt_at: new Date('2026-06-08T21:04:55.000Z'),
    },
    {
      id: 281,
      date_time: new Date('2026-06-12T23:00:00.000Z'),
      qr_sent_at: null,
      recent_receipt_at: new Date('2026-06-08T21:04:55.000Z'),
    },
  ], {
    transactionAt: new Date('2026-06-08T21:04:16.000Z'),
  });

  assert.deepEqual(result.map((row) => row.id), [290]);
});
