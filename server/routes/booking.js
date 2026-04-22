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
const { publicRateLimit } = require('../middleware/publicRateLimit');
const { checkClientByPhone, createClient, createBooking, rescheduleAppointment } = require('../services/booking');
const { verifyPublicRescheduleToken, verifyPublicFeeToken } = require('../services/publicBookingToken');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone } = require('../utils/phone');
const { broadcast } = require('../services/adminEvents');
const { getSpecialFee } = require('../services/clientPricing');
const { sendTextMessage } = require('../services/whatsapp');
const { sendTelegramOperationalNotice } = require('../services/metaHealth');

const router = Router();

// Default tenant (Daniel) — later resolved by domain/slug
const DEFAULT_TENANT = 1;

function formatRescheduleConfirmationDateParts(dateInput, timeZone = 'America/La_Paz') {
  const date = new Date(String(dateInput).includes('T') ? `${dateInput}:00-04:00` : dateInput);
  const dateLabel = new Intl.DateTimeFormat('es-BO', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('es-BO', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  return {
    dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    timeLabel,
  };
}

async function sendPublicRescheduleConfirmation({ tenantId, clientId, phone, dateTime }) {
  if (!phone) return;

  const [clientRows] = await pool.query(
    'SELECT first_name, timezone FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1',
    [clientId, tenantId]
  );
  const client = clientRows[0];
  if (!client) return;

  const { dateLabel, timeLabel } = formatRescheduleConfirmationDateParts(
    dateTime,
    client.timezone || 'America/La_Paz'
  );
  const message = `✅ Perfecto ${client.first_name || 'hola'}, tu sesión está reprogramada para el *${dateLabel}* a las *${timeLabel}*.\nHasta pronto.`;
  const result = await sendTextMessage(phone, message);

  await pool.query(
    `INSERT INTO wa_conversations (tenant_id, client_id, client_phone, direction, message_type, content, wa_message_id)
     VALUES (?, ?, ?, 'outbound', 'auto_reply', ?, ?)`,
    [tenantId, clientId, phone, message, result.messages?.[0]?.id || null]
  ).catch(() => {});
}

async function sendPublicRescheduleTelegramNotice({ tenantId, clientId, dateTime }) {
  const [clientRows] = await pool.query(
    'SELECT first_name FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1',
    [clientId, tenantId]
  );
  const client = clientRows[0];
  if (!client) return;

  const { dateLabel, timeLabel } = formatRescheduleConfirmationDateParts(dateTime, 'America/La_Paz');
  const message = `👉 ${client.first_name || 'Cliente'} ha reagendado para ${dateLabel} a las ${timeLabel}`;

  await sendTelegramOperationalNotice(tenantId, {
    text: message,
    alertType: 'reschedule_notice',
    severity: 'info',
    payload: {
      source: 'public_reschedule',
      client_id: clientId,
      client_name: client.first_name || null,
      date_time: dateTime,
      timezone: 'America/La_Paz',
    },
  });
}

async function sendPublicBookingTelegramNotice({ tenantId, clientId, dateTime }) {
  const [clientRows] = await pool.query(
    'SELECT first_name FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1',
    [clientId, tenantId]
  );
  const client = clientRows[0];
  if (!client) return;

  const { dateLabel, timeLabel } = formatRescheduleConfirmationDateParts(dateTime, 'America/La_Paz');
  const message = `🎁 ${client.first_name || 'Cliente'} ha agendado una sesión ${dateLabel} a las ${timeLabel}`;

  await sendTelegramOperationalNotice(tenantId, {
    text: message,
    alertType: 'booking_notice',
    severity: 'info',
    payload: {
      source: 'public_booking',
      client_id: clientId,
      client_name: client.first_name || null,
      date_time: dateTime,
      timezone: 'America/La_Paz',
    },
  });
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
  const canonicalPhone = normalizePhone(phone);

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
    normalizePhone(decoded.phone) !== canonicalPhone ||
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

async function syncSpecialFeeClientIfNeeded(client, tenantId) {
  if (!client || !client.special_fee_enabled) return client;

  const [rows] = await pool.query(
    'SELECT special_fee FROM config WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  const specialFee = getSpecialFee(rows[0]);

  if (
    parseInt(client.fee, 10) !== specialFee
    || String(client.fee_currency || '').toUpperCase() !== 'BOB'
    || client.foreign_pricing_key
  ) {
    await pool.query(
      'UPDATE clients SET fee = ?, fee_currency = ?, foreign_pricing_key = NULL WHERE id = ? AND tenant_id = ?',
      [specialFee, 'BOB', client.id, tenantId]
    );
  }

  client.fee = specialFee;
  client.fee_currency = 'BOB';
  client.foreign_pricing_key = null;
  return client;
}

// POST /api/admin/book
router.post('/admin/book', authMiddleware, validate(adminBookingSchema), async (req, res) => {
  try {
    const { client_id, date_time, fee_override } = req.validated;
    const tenantId = req.tenantId;

    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [client_id, tenantId]);
    if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    const client = clients[0];
    await syncSpecialFeeClientIfNeeded(client, tenantId);
    if (fee_override && parseInt(fee_override, 10) > 0) {
      const newFee = parseInt(fee_override, 10);
      await pool.query(
        'UPDATE clients SET fee = ?, fee_currency = ? WHERE id = ? AND tenant_id = ?',
        [newFee, 'BOB', client.id, tenantId]
      );
      client.fee = newFee;
      client.fee_currency = 'BOB';
    }

    const result = await createBooking(client, date_time, tenantId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    broadcast('appointment:change', { id: result.appointment_id, action: 'created', source: 'admin' }, tenantId);
    return res.json(result);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo crear la reserva',
      logLabel: 'booking admin',
    });
  }
});

// POST /api/book
router.post('/book', publicRateLimit, validate(publicBookingSchema), async (req, res) => {
  try {
    const {
      phone,
      date_time,
      onboarding,
      fee_mode,
      code,
      timezone,
      ip_country_code,
      ip_country_name,
      location_country_code,
      location_country_name,
      location_confirmed_manually,
      device_type,
      user_agent,
    } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const bookingContext = {
      timezone,
      ip_country_code,
      ip_country_name,
      location_country_code,
      location_country_name,
      location_confirmed_manually,
      device_type,
      user_agent,
    };
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
      const result = await createBooking(newClient, date_time, tenantId, bookingContext);
      if (result.error) return res.status(result.status).json({ error: result.error });
      broadcast('appointment:change', { id: result.appointment_id, action: 'created', source: 'public' }, tenantId);
      broadcast('client:change', { id: newClient.id, action: 'created' }, tenantId);

      sendPublicBookingTelegramNotice({
        tenantId,
        clientId: newClient.id,
        dateTime: result?.appointment?.date_time || date_time,
      }).catch((telegramErr) => {
        console.error('[booking] Public booking Telegram notice failed:', telegramErr.message);
      });

      return res.json({ status: 'booked', ...result, client_name: newClient.first_name });
    }

    if (check.status === 'has_appointment') {
      return res.json(sanitizePublicClientStatus(check));
    }

    // Returning client — book directly
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [check.client_id, tenantId]);
    const client = clients[0];
    await syncSpecialFeeClientIfNeeded(client, tenantId);
    if (feeOverride && parseInt(feeOverride, 10) > 0) {
      const newFee = parseInt(feeOverride, 10);
      await pool.query(
        'UPDATE clients SET fee = ?, fee_currency = ?, foreign_pricing_key = NULL, special_fee_enabled = 1 WHERE id = ? AND tenant_id = ?',
        [newFee, 'BOB', client.id, tenantId]
      );
      client.fee = newFee;
      client.fee_currency = 'BOB';
      client.foreign_pricing_key = null;
      client.special_fee_enabled = 1;
      console.log(`[booking] Public fee mode applied: client ${client.id} → Bs ${newFee}`);
    }
    const result = await createBooking(client, date_time, tenantId, bookingContext);
    if (result.error) return res.status(result.status).json({ error: result.error });
    broadcast('appointment:change', { id: result.appointment_id, action: 'created', source: 'public' }, tenantId);

    sendPublicBookingTelegramNotice({
      tenantId,
      clientId: client.id,
      dateTime: result?.appointment?.date_time || date_time,
    }).catch((telegramErr) => {
      console.error('[booking] Public booking Telegram notice failed:', telegramErr.message);
    });

    return res.json({ status: 'booked', ...result, client_name: client.first_name });
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
    broadcast('appointment:change', { action: 'rescheduled', source: 'admin' }, tenantId);
    res.json(result);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo reagendar la cita',
      logLabel: 'reschedule admin',
    });
  }
});

// POST /api/reschedule
router.post('/reschedule', publicRateLimit, validate(publicRescheduleSchema), async (req, res) => {
  try {
    const {
      phone,
      old_appointment_id,
      date_time,
      reschedule_token,
      timezone,
      ip_country_code,
      ip_country_name,
      location_country_code,
      location_country_name,
      location_confirmed_manually,
      device_type,
      user_agent,
    } = req.validated;
    const tenantId = req.tenantId || DEFAULT_TENANT;
    const bookingContext = {
      timezone,
      ip_country_code,
      ip_country_name,
      location_country_code,
      location_country_name,
      location_confirmed_manually,
      device_type,
      user_agent,
    };
    let decoded;

    try {
      decoded = verifyPublicRescheduleToken(reschedule_token);
    } catch (tokenErr) {
      return res.status(401).json({ error: 'La autorización para reagendar expiró. Vuelve a verificar tu teléfono.' });
    }

    if (
      String(decoded.tenantId) !== String(tenantId) ||
      String(decoded.appointmentId) !== String(old_appointment_id) ||
      normalizePhone(decoded.phone) !== normalizePhone(phone)
    ) {
      return res.status(403).json({ error: 'No autorizado para reagendar esta cita' });
    }

    const result = await rescheduleAppointment(decoded.clientId, decoded.appointmentId, date_time, tenantId, bookingContext);
    if (result.error) return res.status(result.status).json({ error: result.error });
    broadcast('appointment:change', { action: 'rescheduled', source: 'public' }, tenantId);

    sendPublicRescheduleConfirmation({
      tenantId,
      clientId: decoded.clientId,
      phone: normalizePhone(phone),
      dateTime: result?.appointment?.date_time || date_time,
    }).catch((waErr) => {
      console.error('[booking] Public reschedule confirmation WhatsApp failed:', waErr.message);
    });

    sendPublicRescheduleTelegramNotice({
      tenantId,
      clientId: decoded.clientId,
      dateTime: result?.appointment?.date_time || date_time,
    }).catch((telegramErr) => {
      console.error('[booking] Public reschedule Telegram notice failed:', telegramErr.message);
    });

    res.json(result);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo reagendar la cita',
      logLabel: 'reschedule public',
    });
  }
});

module.exports = router;
