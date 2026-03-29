const { pool, withTransaction } = require('../db');
const { listEvents, createEvent, deleteEvent } = require('./calendar');

const CALENDAR_ID = () => process.env.CALENDAR_ID || 'danielmacleann@gmail.com';

// ─── Check client status by phone ────────────────────────────────
async function checkClientByPhone(phone, tenantId) {
  // First check active clients
  let [clients] = await pool.query(
    'SELECT * FROM clients WHERE phone = ? AND tenant_id = ? AND deleted_at IS NULL',
    [phone, tenantId]
  );

  // If not found, check soft-deleted and reactivate
  if (clients.length === 0) {
    const [deleted] = await pool.query(
      'SELECT * FROM clients WHERE phone = ? AND tenant_id = ? AND deleted_at IS NOT NULL',
      [phone, tenantId]
    );
    if (deleted.length > 0) {
      await pool.query('UPDATE clients SET deleted_at = NULL WHERE id = ?', [deleted[0].id]);
      console.log(`[booking] Reactivated soft-deleted client: ${deleted[0].first_name} (${phone})`);
      clients = [{ ...deleted[0], deleted_at: null }];
    }
  }

  if (clients.length === 0) return { status: 'new' };

  const client = clients[0];
  const [appointments] = await pool.query(
    `SELECT id, date_time FROM appointments
     WHERE client_id = ? AND tenant_id = ? AND status IN ('Agendada','Confirmada') AND date_time > NOW()
     ORDER BY date_time ASC LIMIT 1`,
    [client.id, tenantId]
  );

  if (appointments.length > 0) {
    return {
      status: 'has_appointment',
      client_name: client.first_name,
      client_id: client.id,
      appointment: { id: appointments[0].id, date_time: appointments[0].date_time },
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
  const { first_name, last_name, age, city, country, source } = onboarding;

  const [cfgRows] = await db.query(
    'SELECT default_fee, capital_fee, capital_cities FROM config WHERE tenant_id = ?',
    [tenantId]
  );
  const cfg = cfgRows[0];
  const capitalCities = (cfg?.capital_cities || '').split(',').map(c => c.trim());
  const autoFee = capitalCities.includes(city) ? (cfg?.capital_fee || 300) : (cfg?.default_fee || 250);
  const fee = (feeOverride && parseFloat(feeOverride) > 0) ? parseFloat(feeOverride) : autoFee;

  let newClient;
  try {
    const [result] = await db.query(
      `INSERT INTO clients (tenant_id, phone, first_name, last_name, age, city, country, source, fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, phone, first_name, last_name, age || null, city || 'Cochabamba', country || 'Bolivia', source || 'Otro', fee]
    );
    const [clients] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
    newClient = clients[0];
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Reactivate soft-deleted client and update their info
      await db.query(
        `UPDATE clients SET deleted_at = NULL, first_name = ?, last_name = ?, age = ?,
         city = ?, country = ?, source = ?, fee = ? WHERE phone = ? AND tenant_id = ?`,
        [first_name, last_name, age || null, city || 'Cochabamba', country || 'Bolivia', source || 'Otro', fee, phone, tenantId]
      );
      const [clients] = await db.query(
        'SELECT * FROM clients WHERE phone = ? AND tenant_id = ?', [phone, tenantId]
      );
      newClient = clients[0];
      console.log(`[booking] Reactivated existing client: ${first_name} (${phone})`);
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
      phone: phone.startsWith('+') ? phone : `+${phone}`,
      city: city || 'Cochabamba',
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

// ─── Create booking (GCal + DB atomic) ───────────────────────────
async function createBooking(client, dateTime, tenantId) {
  const calendarId = CALENDAR_ID();

  // Load config for duration
  const [cfgRows] = await pool.query(
    'SELECT appointment_duration FROM config WHERE tenant_id = ?', [tenantId]
  );
  const duration = cfgRows[0]?.appointment_duration || 60;

  // Verify slot is free (race condition check)
  const dayStr = dateTime.split('T')[0];
  const timeMin = new Date(`${dayStr}T00:00:00-04:00`).toISOString();
  const timeMax = new Date(`${dayStr}T23:59:59-04:00`).toISOString();
  const events = await listEvents(calendarId, timeMin, timeMax);

  const [hh, mm] = dateTime.split('T')[1].split(':').map(Number);
  const slotStartMin = hh * 60 + mm;
  const slotEndMin = slotStartMin + duration;

  const conflict = events.some(e => {
    const es = new Date(e.start.dateTime || e.start.date);
    const ee = new Date(e.end.dateTime || e.end.date);
    const esLP = new Date(es.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    const eeLP = new Date(ee.toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
    const eStart = esLP.getHours() * 60 + esLP.getMinutes();
    const eEnd = eeLP.getHours() * 60 + eeLP.getMinutes();
    return slotStartMin < eEnd && slotEndMin > eStart;
  });

  if (conflict) {
    return { error: 'El horario ya no está disponible', status: 409 };
  }

  // Build GCal times in -04:00 format
  const startISO = `${dateTime}:00-04:00`;
  const totalMin = hh * 60 + mm + duration;
  const endH = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
  const endM = String(totalMin % 60).padStart(2, '0');
  const endISO = `${dayStr}T${endH}:${endM}:00-04:00`;

  // Create GCal event
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

  // DB insert (atomic)
  const [prevAppts] = await pool.query(
    'SELECT COUNT(*) as cnt FROM appointments WHERE client_id = ? AND tenant_id = ?',
    [client.id, tenantId]
  );
  const sessionNumber = (prevAppts[0]?.cnt || 0) + 1;
  const isFirst = sessionNumber === 1;

  const [result] = await pool.query(
    `INSERT INTO appointments (tenant_id, client_id, date_time, gcal_event_id, status, confirmed_at, is_first, session_number, phone)
     VALUES (?, ?, ?, ?, 'Agendada', NOW(), ?, ?, ?)`,
    [tenantId, client.id, dateTime, gcalEvent.id, isFirst, sessionNumber, client.phone]
  );

  // Create pending payment
  const fee = client.fee || 250;
  await pool.query(
    `INSERT INTO payments (tenant_id, client_id, appointment_id, amount, status)
     VALUES (?, ?, ?, ?, 'Pendiente')`,
    [tenantId, client.id, result.insertId, fee]
  );

  // Log activity
  await pool.query(
    `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
     VALUES (?, ?, 'booking', ?, 'procesado', ?, ?, ?)`,
    [tenantId, `booking_${result.insertId}`, JSON.stringify({ date_time: dateTime }), client.phone, client.id, result.insertId]
  );

  const newAppt = {
    id: result.insertId,
    date_time: dateTime,
    gcal_event_id: gcalEvent.id,
    session_number: sessionNumber,
    is_first: isFirst,
    status: 'Agendada',
  };

  // Sync booking to Google Sheets (async, non-blocking)
  try {
    const { syncBookingToSheet } = require('./sheets');
    syncBookingToSheet(newAppt, client).catch(err => console.error('[sheets] Booking sync failed (non-fatal):', err.message));
  } catch (err) {
    console.error('[sheets] Import failed:', err.message);
  }

  return { success: true, appointment: newAppt };
}

// ─── Reschedule appointment ──────────────────────────────────────
async function rescheduleAppointment(clientId, oldAppointmentId, dateTime, tenantId) {
  const calendarId = CALENDAR_ID();

  // Get old appointment
  const [oldAppts] = await pool.query(
    'SELECT * FROM appointments WHERE id = ? AND client_id = ? AND tenant_id = ?',
    [oldAppointmentId, clientId, tenantId]
  );
  if (oldAppts.length === 0) {
    return { error: 'Cita no encontrada', status: 404 };
  }
  const oldAppt = oldAppts[0];

  // Cancel old GCal event
  if (oldAppt.gcal_event_id) {
    try {
      await deleteEvent(calendarId, oldAppt.gcal_event_id);
    } catch (delErr) {
      console.error('[reschedule] Failed to delete GCal event:', delErr.message);
    }
  }

  // Save old appointment payments before deleting
  // Move any confirmed payment to the new appointment later
  const [oldPayments] = await pool.query(
    `SELECT id, status FROM payments WHERE appointment_id = ? AND tenant_id = ?`,
    [oldAppointmentId, tenantId]
  );

  // Delete old appointment (and its pending payments)
  // Confirmed payments will be moved to the new appointment below
  await pool.query(`DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ? AND status = 'Pendiente'`, [oldAppointmentId, tenantId]);
  await pool.query(`DELETE FROM appointments WHERE id = ?`, [oldAppointmentId]);
  console.log(`[reschedule] Deleted old appointment ${oldAppointmentId}`);

  // Get client and book new
  const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [clientId, tenantId]);
  if (clients.length === 0) return { error: 'Cliente no encontrado', status: 404 };

  const result = await createBooking(clients[0], dateTime, tenantId);
  if (result.error) return result;

  // Mark new appointment as Reagendada
  if (result.appointment?.id) {
    await pool.query(`UPDATE appointments SET status = 'Reagendada' WHERE id = ?`, [result.appointment.id]);
  }

  // Move confirmed payment from old appointment to new one
  try {
    const newApptId = result.appointment?.id;
    const confirmedPayment = oldPayments.find(p => p.status === 'Confirmado');
    if (newApptId && confirmedPayment) {
      // Move the confirmed payment to the new appointment
      await pool.query(
        `UPDATE payments SET appointment_id = ? WHERE id = ?`,
        [newApptId, confirmedPayment.id]
      );
      // Delete the new "Pendiente" payment that createBooking just made (redundant)
      await pool.query(
        `DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ? AND status = 'Pendiente' AND id != ?`,
        [newApptId, tenantId, confirmedPayment.id]
      );
      console.log(`[reschedule] Moved confirmed payment ${confirmedPayment.id} → new appt ${newApptId}`);
    }
  } catch (payErr) {
    console.error('[reschedule] Payment transfer failed (non-fatal):', payErr.message);
  }

  // Log activity
  await pool.query(
    `INSERT INTO webhooks_log (tenant_id, event, type, payload, status, client_phone, client_id, appointment_id)
     VALUES (?, ?, 'reschedule', ?, 'procesado', ?, ?, ?)`,
    [tenantId, `reschedule_${result.appointment.id}`, JSON.stringify({ old_id: oldAppointmentId, new_date_time: dateTime }), clients[0].phone, clientId, result.appointment.id]
  );

  return { success: true, status: 'rescheduled', ...result };
}

module.exports = { checkClientByPhone, createClient, createBooking, rescheduleAppointment };
