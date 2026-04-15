const { pool } = require('../db');
const { isTrustedDevMode } = require('../utils/devmode');

const DEFAULT_TENANT = 1;
const publicRateBuckets = new Map();

async function getPublicRateLimitConfig(tenantId) {
  const [rows] = await pool.query(
    'SELECT rate_limit_booking, rate_limit_window FROM config WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  const cfg = rows[0] || {};

  return {
    max: Math.max(1, parseInt(cfg.rate_limit_booking, 10) || 6),
    windowMs: Math.max(1, parseInt(cfg.rate_limit_window, 10) || 15) * 60 * 1000,
  };
}

async function publicRateLimit(req, res, next) {
  if (isTrustedDevMode(req)) return next();

  try {
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const { max, windowMs } = await getPublicRateLimitConfig(tenantId);
    const key = `${tenantId}:${req.ip}:${req.path}`;
    const now = Date.now();
    const recentHits = (publicRateBuckets.get(key) || []).filter((hitAt) => now - hitAt < windowMs);

    if (recentHits.length >= max) {
      const waitMinutes = Math.ceil(windowMs / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${waitMinutes} minutos.` });
    }

    recentHits.push(now);
    publicRateBuckets.set(key, recentHits);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPublicRateLimitConfig,
  publicRateLimit,
};
