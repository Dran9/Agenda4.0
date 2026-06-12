const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isWhatsappReceiptOcrEnabled, readBooleanEnv } = require('../server/services/receiptOcrConfig');

test('readBooleanEnv: parses explicit boolean values', () => {
  assert.equal(readBooleanEnv('1'), true);
  assert.equal(readBooleanEnv('true'), true);
  assert.equal(readBooleanEnv('on'), true);
  assert.equal(readBooleanEnv('0'), false);
  assert.equal(readBooleanEnv('false'), false);
  assert.equal(readBooleanEnv('off'), false);
  assert.equal(readBooleanEnv('unexpected'), null);
});

test('isWhatsappReceiptOcrEnabled: defaults to enabled even when Gmail bank email is enabled', () => {
  assert.equal(isWhatsappReceiptOcrEnabled({ GMAIL_QR_EMAIL_ENABLED: '1' }), true);
});

test('isWhatsappReceiptOcrEnabled: explicit WhatsApp OCR flag is authoritative', () => {
  assert.equal(isWhatsappReceiptOcrEnabled({ WHATSAPP_RECEIPT_OCR_ENABLED: '0', GMAIL_QR_EMAIL_ENABLED: '0' }), false);
  assert.equal(isWhatsappReceiptOcrEnabled({ WHATSAPP_RECEIPT_OCR_ENABLED: '1', GMAIL_QR_EMAIL_ENABLED: '1' }), true);
});
