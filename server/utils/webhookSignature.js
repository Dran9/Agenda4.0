const crypto = require('crypto');

function getWebhookAppSecret() {
  return process.env.WA_APP_SECRET || process.env.META_APP_SECRET || process.env.APP_SECRET || '';
}

// Verifies Meta's x-hub-signature-256 header against the raw request body.
// Returns { ok: true } on match, or { ok: false, status, error } on failure.
// Pure: no req/res access beyond the two inputs so it's trivial to unit test.
function verifyMetaSignature({ signatureHeader, rawBody, secret }) {
  if (!secret) {
    return { ok: false, status: 500, error: 'Webhook app secret no configurado' };
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, status: 401, error: 'Firma faltante o inválida' };
  }
  if (!Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 400, error: 'Payload sin firma verificable' };
  }

  const expected = Buffer.from(
    `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    'utf8'
  );
  const received = Buffer.from(signatureHeader, 'utf8');

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, status: 401, error: 'Firma inválida' };
  }
  return { ok: true };
}

// Express-aware wrapper — keeps the behavior identical to the inline helper
// that lives in routes/webhook.js. Routes can migrate to this helper incrementally.
function verifyWebhookSignatureFromReq(req) {
  return verifyMetaSignature({
    signatureHeader: req.get('x-hub-signature-256'),
    rawBody: req.rawBody,
    secret: getWebhookAppSecret(),
  });
}

module.exports = {
  getWebhookAppSecret,
  verifyMetaSignature,
  verifyWebhookSignatureFromReq,
};
