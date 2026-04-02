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
const { verifyPublicRescheduleToken, verifyPublicFeeToken } = require('../services/publicBookingToken');
const { isTrustedDevMode } = require('../utils/devmode');
const { sendServerError } = require('../utils/httpErrors');

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
    max: Math.max(1, parseInt(cfg.rate_limit_booking, 10) || 6),
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

function sanitizePublicClientStatus(result) {
  if (!result?.status) return { status: 'new' };
  if (result.status === 'has_appointment') {
    return {
      status: 'has_appointment',
      appointment: result.appointment,
      reschedule_token: result.reschedule_token,
    };
  }
  return { status: result.status };
}

async function resolvePublicFeeOverride({ tenantId, phone, feeMode, code }) {
  if (!feeMode) return null;

  if (feeMode !== 'pe') {
    const err = new Error('Modo de arancel público inválido');
    err.status = 400;
    err.publicMessage = 'Enlace de precio especial inválido';
    throw err;
  }

  if (!code) {
    const err = new Error('Falta token para precio especial');
    err.status = 401;
    err.publicMessage = 'El enlace de precio especial expiró o es inválido';
    throw err;
  }

  let decoded;
  try {
    decoded = verifyPublicFeeToken(code);
  } catch (tokenErr) {
    tokenErr.status = 401;
    tokenErr.publicMessage = 'El enlace de precio especial expiró o es inválido';
    throw tokenErr;
  }

  if (
    String(decoded.tenantId) !== String(tenantId) ||
    String(decoded.phone) !== String(phone) ||
    String(decoded.feeMode) !== String(feeMode)
  ) {
    const err = new Error('Token de precio especial no coincide con la solicitud');
    err.status = 403;
    err.publicMessage = 'No autorizado para usar este precio especial';
    throw err;
  }

  const [rows] = await pool.query(
    'SELECT special_fee FROM config WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  return parseInt(rows[0]?.special_fee, 10) || 150;
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
    sendServerError(res, req, err, {
      message: 'No se pudo crear la reserva',
      logLabel: 'booking admin',
    });
  }
});

// POST /api/book
router.post('/book', bookingLimiter, validate(publicBookingSchema), async (req, res) => {
  try {
    const { phone, date_time, onboarding, fee_mode, code } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;
    let feeOverride = null;

    try {
      feeOverride = await resolvePublicFeeOverride({ tenantId, phone, feeMode: fee_mode, code });
    } catch (feeErr) {
      return res.status(feeErr.status || 403).json({ error: feeErr.publicMessage || 'No autorizado para usar este enlace' });
    }

    // Public flow: uses phone
    const check = await checkClientByPhone(phone, tenantId, { reactivateDeleted: true });

    if (check.status === 'new') {
      if (!onboarding || !onboarding.first_name || !onboarding.last_name) {
        return res.json({ status: 'needs_onboarding' });
      }
      const newClient = await createClient(phone, onboarding, tenantId, null, feeOverride);
      const result = await createBooking(newClient, date_time, tenantId);
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ status: 'booked', ...result });
    }

    if (check.status === 'has_appointment') {
      return res.json(sanitizePublicClientStatus(check));
    }

    // Returning client — book directly
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [check.client_id, tenantId]);
    const client = clients[0];
    if (feeOverride && parseInt(feeOverride, 10) > 0) {
      const newFee = parseInt(feeOverride, 10);
      await pool.query('UPDATE clients SET fee = ? WHERE id = ? AND tenant_id = ?', [newFee, client.id, tenantId]);
      client.fee = newFee;
      console.log(`[booking] Public fee mode applied: client ${client.id} → Bs ${newFee}`);
    }
    const result = await createBooking(client, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ status: 'booked', ...result });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo completar la reserva',
      logLabel: 'booking public',
    });
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
    sendServerError(res, req, err, {
      message: 'No se pudo reagendar la cita',
      logLabel: 'reschedule admin',
    });
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
    sendServerError(res, req, err, {
      message: 'No se pudo reagendar la cita',
      logLabel: 'reschedule public',
    });
  }
});

module.exports = router;
