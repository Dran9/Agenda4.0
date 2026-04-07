const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { generateToken } = require('../middleware/auth');
const { isTrustedDevMode } = require('../utils/devmode');
const { sendServerError } = require('../utils/httpErrors');

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: isTrustedDevMode,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
});

function getVoiceBootstrapToken() {
  return process.env.VOICE_APP_BOOTSTRAP_TOKEN || process.env.VOICE_ADMIN_TOKEN || '';
}

function getVoiceTenantId() {
  return Number(process.env.VOICE_ADMIN_TENANT_ID || 1);
}

// POST /api/auth/login — simple password-based login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { password, slug } = req.body;
    if (!password) return res.status(400).json({ error: 'Password requerido' });

    // For now: single admin password from env
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Resolve tenant
    const tenantSlug = slug || 'daniel';
    const [tenants] = await pool.query('SELECT id, name, slug FROM tenants WHERE slug = ?', [tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'Tenant no encontrado' });

    const tenant = tenants[0];
    const token = generateToken(tenant.id, null);
    res.json({ token, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo iniciar sesión',
      logLabel: 'auth login',
    });
  }
});

// POST /api/auth/voice-login — bootstrap session for native /voice wrapper
router.post('/voice-login', loginLimiter, async (req, res) => {
  try {
    const expected = getVoiceBootstrapToken();
    const provided = String(
      req.get('x-voice-token') ||
      req.get('x-shortcut-token') ||
      req.body?.token ||
      ''
    ).trim();

    if (!expected) {
      return res.status(500).json({ error: 'VOICE bootstrap no configurado' });
    }

    if (!provided || provided !== expected) {
      return res.status(401).json({ error: 'Token de voz inválido' });
    }

    const tenantId = getVoiceTenantId();
    const [tenants] = await pool.query(
      'SELECT id, name, slug FROM tenants WHERE id = ? LIMIT 1',
      [tenantId]
    );

    if (tenants.length === 0) {
      return res.status(404).json({ error: 'Tenant de voz no encontrado' });
    }

    const tenant = tenants[0];
    const token = generateToken(tenant.id, null);

    res.json({
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo iniciar la sesión de voz',
      logLabel: 'auth voice-login',
    });
  }
});

module.exports = router;
