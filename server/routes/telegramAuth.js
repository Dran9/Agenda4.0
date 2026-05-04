const { Router } = require('express');
const crypto = require('crypto');
const { generateToken } = require('../middleware/auth');
const { sendServerError } = require('../utils/httpErrors');

const router = Router();

// Validate Telegram WebApp initData
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  // Sort keys alphabetically and build data_check_string
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Secret key = HMAC_SHA256(token, "WebAppData")
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Validate hash = HMAC_SHA256(secret_key, data_check_string)
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) return null;

  // Parse user object
  const userJson = params.get('user');
  if (!userJson) return null;

  try {
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

// POST /api/auth/telegram
router.post('/telegram', async (req, res) => {
  try {
    const { initData } = req.body;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return res.status(500).json({ error: 'Bot token not configured' });
    }

    if (!initData) {
      return res.status(400).json({ error: 'initData requerido' });
    }

    const user = validateTelegramInitData(initData, botToken);
    if (!user) {
      return res.status(401).json({ error: 'initData inválido' });
    }

    // For now, any valid Telegram user gets admin access to tenant 1
    // In production, you might want to check against an admin whitelist
    const token = generateToken(1, user.id);

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        photoUrl: user.photo_url,
      },
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'Error en autenticación de Telegram',
      logLabel: 'telegram auth',
    });
  }
});

module.exports = router;
