const { Router } = require('express');
const { pool } = require('../db');
const {
  validate,
  publicBookingSchema,
  adminBookingSchema,
  publicRescheduleSchema,
  adminRescheduleSchema,
} = require('../middleware/validate');
const { authMiddleware } = require('../middleware/auth');
const { checkClientByPhone, createClient, createBooking, rescheduleAppointment } = require('../services/booking');
const { verifyPublicRescheduleToken } = require('../services/publicBookingToken');
const { isTrustedDevMode } = require('../utils/devmode');

const router = Router();

// Default tenant (Daniel) — later resolved by domain/slug
const DEFAULT_TENANT = 1;
const bookingRateBuckets = new Map();

async function getBookingRateLimitConfig(tenantId) {
  const [rows] = await pool.query(
    'SELECT rate_limit_booking, rate_limit_window FROM config WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  const cfg = rows[0] || {};
  return {
    max: Math.max(1, parseInt(cfg.rate_limit_booking, 10) || 3),
    windowMs: Math.max(1, parseInt(cfg.rate_limit_window, 10) || 15) * 60 * 1000,
  };
}

async function bookingLimiter(req, res, next) {
  if (isTrustedDevMode(req)) return next();

  try {
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const { max, windowMs } = await getBookingRateLimitConfig(tenantId);
    const key = `${tenantId}:${req.ip}:${req.path}`;
    const now = Date.now();
    const recentHits = (bookingRateBuckets.get(key) || []).filter(hitAt => now - hitAt < windowMs);

    if (recentHits.length >= max) {
      const waitMinutes = Math.ceil(windowMs / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${waitMinutes} minutos.` });
    }

    recentHits.push(now);
    bookingRateBuckets.set(key, recentHits);
    next();
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/book
router.post('/admin/book', authMiddleware, validate(adminBookingSchema), async (req, res) => {
  try {
    const { client_id, date_time, fee_override } = req.validated;
    const tenantId = req.tenantId;

    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [client_id, tenantId]);
    if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    const client = clients[0];
    if (fee_override && parseInt(fee_override, 10) > 0) {
      const newFee = parseInt(fee_override, 10);
      await pool.query('UPDATE clients SET fee = ? WHERE id = ? AND tenant_id = ?', [newFee, client.id, tenantId]);
      client.fee = newFee;
    }

    const result = await createBooking(client, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  } catch (err) {
    console.error('[booking admin] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/book
router.post('/book', bookingLimiter, validate(publicBookingSchema), async (req, res) => {
  try {
    const { phone, date_time, onboarding, fee_override } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;

    // Public flow: uses phone
    const check = await checkClientByPhone(phone, tenantId, { reactivateDeleted: true });

    if (check.status === 'new') {
      if (!onboarding || !onboarding.first_name || !onboarding.last_name) {
        return res.json({ status: 'needs_onboarding' });
      }
      const newClient = await createClient(phone, onboarding, tenantId, null, fee_override);
      const result = await createBooking(newClient, date_time, tenantId);
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ status: 'booked', ...result });
    }

    if (check.status === 'has_appointment') {
      return res.json(check);
    }

    // Returning client — book directly
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [check.client_id, tenantId]);
    const client = clients[0];
    // Apply fee override if provided (from ?fee= URL param)
    if (fee_override && parseInt(fee_override) > 0) {
      const newFee = parseInt(fee_override);
      await pool.query('UPDATE clients SET fee = ? WHERE id = ?', [newFee, client.id]);
      client.fee = newFee;
      console.log(`[booking] Fee override: client ${client.id} → Bs ${newFee}`);
    }
    const result = await createBooking(client, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ status: 'booked', ...result });
  } catch (err) {
    console.error('[booking] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reschedule
router.post('/admin/reschedule', authMiddleware, validate(adminRescheduleSchema), async (req, res) => {
  try {
    const { client_id, old_appointment_id, date_time } = req.validated;
    const tenantId = req.tenantId;
    const result = await rescheduleAppointment(client_id, old_appointment_id, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[reschedule admin] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reschedule
router.post('/reschedule', bookingLimiter, validate(publicRescheduleSchema), async (req, res) => {
  try {
    const { phone, old_appointment_id, date_time, reschedule_token } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;
    let decoded;

    try {
      decoded = verifyPublicRescheduleToken(reschedule_token);
    } catch (tokenErr) {
      return res.status(401).json({ error: 'La autorización para reagendar expiró. Vuelve a verificar tu teléfono.' });
    }

    if (
      String(decoded.tenantId) !== String(tenantId) ||
      String(decoded.appointmentId) !== String(old_appointment_id) ||
      String(decoded.phone) !== String(phone)
    ) {
      return res.status(403).json({ error: 'No autorizado para reagendar esta cita' });
    }

    const result = await rescheduleAppointment(decoded.clientId, decoded.appointmentId, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[reschedule] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
