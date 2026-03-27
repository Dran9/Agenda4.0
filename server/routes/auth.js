const { Router } = require('express');
const { pool } = require('../db');
const { generateToken } = require('../middleware/auth');

const router = Router();

// POST /api/auth/login — simple password-based login
router.post('/login', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
