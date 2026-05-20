const { Router } = require('express');
const { processBankEmailPubSubNotification } = require('../services/bankEmail');
const { sendServerError } = require('../utils/httpErrors');

const router = Router();

function getExpectedSecret() {
  return process.env.GMAIL_PUBSUB_PUSH_TOKEN || process.env.GMAIL_BANK_WEBHOOK_SECRET || '';
}

function getProvidedSecret(req) {
  return String(
    req.get('x-gmail-pubsub-token') ||
    req.query?.token ||
    ''
  ).trim();
}

router.post('/gmail-bank-email', async (req, res) => {
  try {
    const expected = getExpectedSecret();
    if (!expected) return res.status(500).json({ error: 'Webhook Gmail no configurado' });
    if (getProvidedSecret(req) !== expected) return res.status(401).json({ error: 'Token inválido' });

    const result = await processBankEmailPubSubNotification({ tenantId: 1, body: req.body });
    res.status(200).json(result);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo procesar la notificación Gmail',
      logLabel: 'gmail bank webhook',
    });
  }
});

module.exports = router;
