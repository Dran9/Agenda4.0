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

function getAdminBootstrapToken() {
  return process.env.ADMIN_APP_BOOTSTRAP_TOKEN || '';
}

function getDefaultAdminTenantSlug() {
  return process.env.ADMIN_APP_TENANT_SLUG || 'daniel';
}

// POST /api/auth/login — 6-digit PIN login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { pin, slug } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN requerido' });

    // Validate PIN format: exactly 6 digits
    if (!/^\d{6}$/.test(String(pin))) {
      return res.status(400).json({ error: 'El PIN debe tener exactamente 6 dígitos numéricos' });
    }

    // Check PIN against env
    const expectedPin = process.env.ADMIN_PIN || process.env.ADMIN_PASSWORD;
    if (String(pin) !== String(expectedPin)) {
      return res.status(401).json({ error: 'PIN incorrecto' });
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

// POST /api/auth/admin-login — bootstrap session for native /admin wrapper
router.post('/admin-login', loginLimiter, async (req, res) => {
  try {
    const expected = getAdminBootstrapToken();
    const provided = String(
      req.get('x-admin-token') ||
      req.body?.token ||
      ''
    ).trim();

    if (!expected) {
      return res.status(500).json({ error: 'ADMIN bootstrap no configurado' });
    }

    if (!provided || provided !== expected) {
      return res.status(401).json({ error: 'Token de admin inválido' });
    }

    const tenantSlug = String(req.body?.slug || getDefaultAdminTenantSlug()).trim();
    const [tenants] = await pool.query(
      'SELECT id, name, slug FROM tenants WHERE slug = ? LIMIT 1',
      [tenantSlug]
    );

    if (tenants.length === 0) {
      return res.status(404).json({ error: 'Tenant admin no encontrado' });
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
      message: 'No se pudo iniciar la sesión de admin',
      logLabel: 'auth admin-login',
    });
  }
});

module.exports = router;
