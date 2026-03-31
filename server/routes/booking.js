const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { validate, bookingSchema, rescheduleSchema } = require('../middleware/validate');
const { checkClientByPhone, createClient, createBooking, rescheduleAppointment } = require('../services/booking');

const router = Router();

// Default tenant (Daniel) — later resolved by domain/slug
const DEFAULT_TENANT = 1;

// Rate limiter: 3 attempts per 15 min (only on book/reschedule)
function isDevMode(req) { return req.query.devmode === '1'; }
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  skip: isDevMode,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
});

// POST /api/book
router.post('/book', bookingLimiter, validate(bookingSchema), async (req, res) => {
  try {
    const { phone, date_time, onboarding, client_id, fee_override } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;

    // Admin flow: uses client_id directly
    if (client_id && !phone) {
      const { pool } = require('../db');
      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [client_id, tenantId]);
      if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      const result = await createBooking(clients[0], date_time, tenantId);
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    }

    // Public flow: uses phone
    if (!phone) return res.status(400).json({ error: 'Campo requerido: phone' });

    const check = await checkClientByPhone(phone, tenantId);

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
    const { pool } = require('../db');
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
router.post('/reschedule', bookingLimiter, validate(rescheduleSchema), async (req, res) => {
  try {
    const { client_id, old_appointment_id, date_time } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const result = await rescheduleAppointment(client_id, old_appointment_id, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[reschedule] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
