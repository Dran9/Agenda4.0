const { pool, withTransaction, withAdvisoryLock } = require('../db');
const { listEvents, createEvent, deleteEvent } = require('./calendar');
const { getBusyRangesForDate } = require('./calendarBusy');
const { createPublicRescheduleToken } = require('./publicBookingToken');
const {
  createAppointmentSlotClaims,
  isSlotClaimConflictError,
} = require('./appointmentSlotClaims');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');

const CALENDAR_ID = () => process.env.CALENDAR_ID || 'danielmacleann@gmail.com';

function normalizeBookingContext(input = {}) {
  const timezone = input.timezone || null;
  const ipCountryCode = input.ip_country_code ? String(input.ip_country_code).toUpperCase() : null;
  const locationCountryCode = input.location_country_code ? String(input.location_country_code).toUpperCase() : null;

  const bookingContext = {
    timezone,
    ip_country_code: ipCountryCode,
    ip_country_name: input.ip_country_name || null,
    location_country_code: locationCountryCode,
    location_country_name: input.location_country_name || null,
    location_confirmed_manually: !!input.location_confirmed_manually,
    device_type: input.device_type || null,
  };

  if (!Object.values(bookingContext).some(Boolean)) {
    return { bookingContext: null, userAgent: input.user_agent || null };
  }

  return { bookingContext, userAgent: input.user_agent || null };
}

// ─── Check client status by phone ────────────────────────────────
async function checkClientByPhone(phone, tenantId, options = {}) {
  const { reactivateDeleted = false } = options;
  const canonicalPhone = normalizePhone(phone);

  // First check active clients
  let [clients] = await pool.query(
    `SELECT * FROM clients
     WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [canonicalPhone, tenantId]
  );

  // If not found, optionally reactivate a soft-deleted client during real booking flows
  if (clients.length === 0 && reactivateDeleted) {
    const [deleted] = await pool.query(
      `SELECT * FROM clients
       WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? AND deleted_at IS NOT NULL
       LIMIT 1`,
      [canonicalPhone, tenantId]
    );
    if (deleted.length > 0) {
      await pool.query('UPDATE clients SET phone = ?, deleted_at = NULL WHERE id = ?', [canonicalPhone, deleted[0].id]);
      console.log(`[booking] Reactivated soft-deleted client: ${deleted[0].first_name} (${canonicalPhone})`);
      clients = [{ ...deleted[0], phone: canonicalPhone, deleted_at: null }];
    }
  }

  if (clients.length === 0) return { status: 'new' };

  const client = clients[0];
  const [appointments] = await pool.query(
    `SELECT id, date_time FROM appointments
     WHERE client_id = ? AND tenant_id = ? AND status IN ('Agendada','Confirmada','Reagendada') AND date_time > NOW()
     ORDER BY date_time ASC LIMIT 1`,
    [client.id, tenantId]
  );

  if (appointments.length > 0) {
    const activeAppointment = appointments[0];
    return {
      status: 'has_appointment',
      client_name: client.first_name,
      client_id: client.id,
      appointment: { id: activeAppointment.id, date_time: activeAppointment.date_time },
      reschedule_token: createPublicRescheduleToken({
        tenantId,
        clientId: client.id,
        appointmentId: activeAppointment.id,
        phone: client.phone,
      }),
    };
  }

  return {
    status: 'returning',
    client_name: client.first_name,
    client_id: client.id,
  };
}

// ─── Create client from onboarding data ──────────────────────────
async function createClient(phone, onboarding, tenantId, conn, feeOverride) {
  const db = conn || pool;
  const canonicalPhone = normalizePhone(phone);
  const { first_name, last_name, age, city, country, source, timezone } = onboarding;

  const [cfgRows] = await db.query(
    'SELECT default_fee, capital_fee, capital_cities FROM config WHERE tenant_id = ?',
    [tenantId]
  );
  const cfg = cfgRows[0];
  const capitalCities = (cfg?.capital_cities || '').split(',').map(c => c.trim());
  const isBolivia = !country || country.trim().toLowerCase() === 'bolivia';
  const autoFee = isBolivia
    ? (capitalCities.includes(city) ? (cfg?.capital_fee || 300) : (cfg?.default_fee || 250))
    : 0;
  const autoFeeCurrency = isBolivia ? 'BOB' : 'USD';
  const fee = (feeOverride && parseInt(feeOverride) > 0) ? parseInt(feeOverride) : autoFee;
  const feeCurrency = (feeOverride && parseInt(feeOverride) > 0) ? 'BOB' : autoFeeCurrency;

  let newClient;
  try {
    const [result] = await db.query(
      `INSERT INTO clients (tenant_id, phone, first_name, last_name, age, city, country, timezone, source, fee, fee_currency, foreign_pricing_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [tenantId, canonicalPhone, first_name, last_name, age || null, city || 'Otro', country || 'Bolivia', timezone || 'America/La_Paz', source || 'Otro', fee, feeCurrency]
    );
    const [clients] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
    newClient = clients[0];
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Reactivate soft-deleted client and update their info
      await db.query(
        `UPDATE clients SET deleted_at = NULL, first_name = ?, last_name = ?, age = ?,
         city = ?, country = ?, timezone = ?, source = ?, fee = ?, fee_currency = ?, foreign_pricing_key = NULL
         WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ?`,
        [first_name, last_name, age || null, city || 'Otro', country || 'Bolivia', timezone || 'America/La_Paz', source || 'Otro', fee, feeCurrency, canonicalPhone, tenantId]
      );
      const [clients] = await db.query(
        `SELECT * FROM clients WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? LIMIT 1`,
        [canonicalPhone, tenantId]
      );
      newClient = clients[0];
      console.log(`[booking] Reactivated existing client: ${first_name} (${canonicalPhone})`);
    } else {
      throw err;
    }
  }

  // Create Google Contact + sync to Sheets (async, non-blocking)
  try {
    const { createContact } = require('./contacts');
    createContact({
      firstName: first_name,
      lastName: last_name,
      phone: `+${canonicalPhone}`,
      city: city || 'Otro',
    }).catch(err => console.error('[contacts] Create failed (non-fatal):', err.message));
  } catch (err) {
    console.error('[contacts] Import failed:', err.message);
  }

  try {
    const { syncClientToSheet } = require('./sheets');
    syncClientToSheet(newClient).catch(err => console.error('[sheets] Client sync failed (non-fatal):', err.message));
  } catch (err) {
    console.error('[sheets] Import failed:', err.message);
  }

  return newClient;
}

// ─── Create booking (GCal + DB with compensation) ───────────────
async function createBooking(client, dateTime, tenantId, bookingInput = {}) {
  const calendarId = CALENDAR_ID();
  const dayStr = dateTime.split('T')[0];
  const { bookingContext, userAgent } = normalizeBookingContext(bookingInput);
  try {
    return await withAdvisoryLock(`booking:${tenantId}:${dayStr}`, 10, async () => {
      // Load config for duration
      const [cfgRows] = await pool.query(
        'SELECT appointment_duration FROM config WHERE tenant_id = ?', [tenantId]
      );
      const duration = cfgRows[0]?.appointment_duration || 60;

      // Verify slot is free while holding a day-scoped lock to prevent overlapping concurrent bookings
      const timeMin = new Date(`${dayStr}T00:00:00-04:00`).toISOString();
      const timeMax = new Date(`${dayStr}T23:59:59-04:00`).toISOString();
      const events = await listEvents(calendarId, timeMin, timeMax);

      const [hh, mm] = dateTime.split('T')[1].split(':').map(Number);
      const slotStartMin = hh * 60 + mm;
      const slotEndMin = slotStartMin + duration;
      const busyRanges = getBusyRangesForDate(events, dayStr);

      const conflict = busyRanges.some((range) => slotStartMin < range.end && slotEndMin > range.start);

      if (conflict) {
        return { error: 'El horario ya no está disponible', status: 409 };
      }

      // Build GCal times in -04:00 format
      const startISO = `${dateTime}:00-04:00`;
      const totalMin = hh * 60 + mm + duration;
      const endH = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
      const endM = String(totalMin % 60).padStart(2, '0');
      const endISO = `${dayStr}T${endH}:${endM}:00-04:00`;

      // Create GCal event first (external system)
      let gcalEvent;
      try {
        gcalEvent = await createEvent(calendarId, {
          summary: `Terapia ${client.first_name} ${client.last_name} - ${client.phone}`,
          description: `Teléfono: ${client.phone}`,
          startDateTime: startISO,
          endDateTime: endISO,
        });
        console.log(`[booking] GCal event created: ${gcalEvent.id} for ${dateTime}`);
      } catch (gcalErr) {
        console.error('[booking] GCal create FAILED:', gcalErr.message);
        throw new Error('No se pudo crear el evento en Google Calendar');
      }

      // DB inserts in transaction — if any fail, compensate by deleting GCal event
      let newAppt;
      try {
        newAppt = await withTransaction(async (conn) => {
          const [prevAppts] = await conn.query(
            'SELECT COUNT(*) as cnt FROM appointments WHERE client_id = ? AND tenant_id = ?',
            [client.id, tenantId]
          );
          const sessionNumber = (prevAppts[0]?.cnt || 0) + 1;
          const isFirst = sessionNumber === 1;

          const [result] = await conn.query(
            `INSERT INTO appointments (
               tenant_id, client_id, date_time, duration, gcal_event_id, status, confirmed_at,
               is_first, session_number, phone, user_agent, booking_context
             )
             VALUES (?, ?, ?, ?, ?, 'Agendada', NULL, ?, ?, ?, ?, ?)`,
            [tenantId, client.id, dateTime, duration, gcalEvent.id, isFirst, sessionNumber, client.phone, userAgent, bookingContext ? JSON.stringify(bookingContext) : null]
          );

          await createAppointmentSlotClaims(conn, {
            id: result.insertId,
            tenant_id: tenantId,
            date_time: dateTime,
            duration,
          });

          const fee = Number(client.fee || 250);
          const feeCurrency = String(client.fee_currency || 'BOB').toUpperCase();
          await conn.query(
            `INSERT INTO payments (tenant_id, client_id, appointment_id, amount, currency, status)
             VALUES (?, ?, ?, ?, ?, 'Pendiente')`,
            [tenantId, client.id, result.insertId, fee, feeCurrency]
          );

          await conn.query(
            `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
             VALUES (?, ?, 'booking', ?, 'procesado', ?, ?, ?)`,
            [tenantId, `booking_${result.insertId}`, JSON.stringify({ date_time: dateTime }), client.phone, client.id, result.insertId]
          );

          return {
            id: result.insertId,
            date_time: dateTime,
            gcal_event_id: gcalEvent.id,
            session_number: sessionNumber,
            is_first: isFirst,
            status: 'Agendada',
          };
        });
      } catch (dbErr) {
        // DB failed — compensate by removing the GCal event we just created
        console.error('[booking] DB insert failed, rolling back GCal event:', dbErr.message);
        try { await deleteEvent(calendarId, gcalEvent.id); } catch (e) { /* best effort */ }
        if (isSlotClaimConflictError(dbErr)) {
          return { error: 'El horario ya no está disponible', status: 409 };
        }
        throw dbErr;
      }

      // Sync booking to Google Sheets (async, non-blocking)
      try {
        const { syncBookingToSheet } = require('./sheets');
        syncBookingToSheet(newAppt, client).catch(err => console.error('[sheets] Booking sync failed (non-fatal):', err.message));
      } catch (err) {
        console.error('[sheets] Import failed:', err.message);
      }

      return { success: true, appointment: newAppt };
    });
  } catch (err) {
    if (err.code === 'LOCK_TIMEOUT') {
      return { error: 'El horario ya no está disponible', status: 409 };
    }
    throw err;
  }
}

// ─── Reschedule appointment ──────────────────────────────────────
// Safe order: create new FIRST → only delete old if new succeeds
async function rescheduleAppointment(clientId, oldAppointmentId, dateTime, tenantId, bookingInput = {}) {
  const calendarId = CALENDAR_ID();

  // 1. Validate old appointment exists
  const [oldAppts] = await pool.query(
    'SELECT * FROM appointments WHERE id = ? AND client_id = ? AND tenant_id = ?',
    [oldAppointmentId, clientId, tenantId]
  );
  if (oldAppts.length === 0) {
    return { error: 'Cita no encontrada', status: 404 };
  }
  const oldAppt = oldAppts[0];

  // 2. Get client
  const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [clientId, tenantId]);
  if (clients.length === 0) return { error: 'Cliente no encontrado', status: 404 };

  // 3. Create NEW booking first (GCal + DB) — old appointment still exists as safety net
  const result = await createBooking(clients[0], dateTime, tenantId, bookingInput);
  if (result.error) return result; // Failed — old appointment untouched, no data loss

  // 4. New booking succeeded — now safe to clean up old appointment
  const newAppt = result.appointment;
  const newApptId = newAppt?.id;

  // Move/remove old payments and delete old appointment atomically
  try {
    await withTransaction(async (conn) => {
      // Mark new appointment as Reagendada
      if (newApptId) {
        await conn.query(`UPDATE appointments SET status = 'Reagendada', confirmed_at = NULL WHERE id = ? AND tenant_id = ?`, [newApptId, tenantId]);
      }

      const [oldPayments] = await conn.query(
        `SELECT id, status FROM payments WHERE appointment_id = ? AND tenant_id = ?`,
        [oldAppointmentId, tenantId]
      );

      const confirmedPayment = oldPayments.find(p => p.status === 'Confirmado');
      if (newApptId && confirmedPayment) {
        await conn.query(
          `UPDATE payments SET appointment_id = ? WHERE id = ? AND tenant_id = ?`,
          [newApptId, confirmedPayment.id, tenantId]
        );
        await conn.query(
          `DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ? AND id != ?`,
          [newApptId, tenantId, confirmedPayment.id]
        );
        console.log(`[reschedule] Moved confirmed payment ${confirmedPayment.id} → new appt ${newApptId}`);
      }

      await conn.query(`DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ?`, [oldAppointmentId, tenantId]);
      await conn.query(`DELETE FROM appointments WHERE id = ? AND tenant_id = ?`, [oldAppointmentId, tenantId]);

      await conn.query(
        `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
         VALUES (?, ?, 'reschedule', ?, 'procesado', ?, ?, ?)`,
        [tenantId, `reschedule_${newApptId}`, JSON.stringify({ old_id: oldAppointmentId, new_date_time: dateTime }), clients[0].phone, clientId, newApptId]
      );
    });
  } catch (cleanupErr) {
    console.error('[reschedule] Cleanup failed, rolling back new appointment:', cleanupErr.message);
    try {
      await withTransaction(async (conn) => {
        await conn.query(`DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ?`, [newApptId, tenantId]);
        await conn.query(`DELETE FROM appointments WHERE id = ? AND tenant_id = ?`, [newApptId, tenantId]);
      });
      if (newAppt?.gcal_event_id) {
        try { await deleteEvent(calendarId, newAppt.gcal_event_id); } catch (e) {
          console.error('[reschedule] Failed to delete new GCal event during rollback:', e.message);
        }
      }
    } catch (rollbackErr) {
      console.error('[reschedule] Failed to rollback new appointment:', rollbackErr.message);
    }
    throw cleanupErr;
  }

  // Delete old GCal event (non-fatal)
  if (oldAppt.gcal_event_id) {
    try { await deleteEvent(calendarId, oldAppt.gcal_event_id); } catch (e) {
      console.error('[reschedule] Failed to delete old GCal event (non-fatal):', e.message);
    }
  }

  console.log(`[reschedule] Old appointment ${oldAppointmentId} deleted, new ${newApptId} created`);

  return { success: true, status: 'rescheduled', ...result };
}

module.exports = { checkClientByPhone, createClient, createBooking, rescheduleAppointment };
