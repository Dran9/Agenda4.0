const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyMetaSignature } = require('../server/utils/webhookSignature');

const SECRET = 'test-app-secret-shhh';

function signBody(body, secret = SECRET) {
  const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, signature: `sha256=${hex}` };
}

test('verifyMetaSignature: accepts valid signature', () => {
  const { rawBody, signature } = signBody('{"hello":"world"}');
  const result = verifyMetaSignature({ signatureHeader: signature, rawBody, secret: SECRET });
  assert.equal(result.ok, true);
});

test('verifyMetaSignature: rejects tampered body', () => {
  const { signature } = signBody('{"hello":"world"}');
  const tampered = Buffer.from('{"hello":"WORLD"}', 'utf8');
  const result = verifyMetaSignature({ signatureHeader: signature, rawBody: tampered, secret: SECRET });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('verifyMetaSignature: rejects wrong secret', () => {
  const { rawBody, signature } = signBody('{"hello":"world"}');
  const result = verifyMetaSignature({ signatureHeader: signature, rawBody, secret: 'other-secret' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('verifyMetaSignature: rejects missing header', () => {
  const result = verifyMetaSignature({ signatureHeader: null, rawBody: Buffer.from('{}'), secret: SECRET });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('verifyMetaSignature: rejects header without sha256= prefix', () => {
  const result = verifyMetaSignature({ signatureHeader: 'abc123', rawBody: Buffer.from('{}'), secret: SECRET });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('verifyMetaSignature: rejects non-buffer rawBody', () => {
  const result = verifyMetaSignature({
    signatureHeader: 'sha256=abc',
    rawBody: '{"not":"buffer"}',
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('verifyMetaSignature: 500 when secret missing', () => {
  const result = verifyMetaSignature({
    signatureHeader: 'sha256=abc',
    rawBody: Buffer.from('{}'),
    secret: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('verifyMetaSignature: protects against length-mismatch timing attacks', () => {
  // A signature shorter than expected shouldn't throw — just return ok:false
  const { rawBody } = signBody('{"hello":"world"}');
  const result = verifyMetaSignature({
    signatureHeader: 'sha256=deadbeef',
    rawBody,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});
