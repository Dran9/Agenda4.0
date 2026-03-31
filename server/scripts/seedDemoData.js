require('dotenv').config();
const { withTransaction, pool } = require('../db');

const TENANT_ID = parseInt(process.env.DEMO_TENANT_ID || '1', 10);
const DEMO_PREFIX = '5917804';

const FIRST_NAMES = ['Sofia', 'Mateo', 'Valentina', 'Santiago', 'Camila', 'Thiago', 'Luciana', 'Nicolas', 'Martina', 'Andres', 'Daniela', 'Rodrigo', 'Paola', 'Sebastian', 'Gabriela', 'Marco', 'Elena', 'Jose', 'Renata', 'Alvaro'];
const LAST_NAMES = ['Rojas', 'Suarez', 'Vargas', 'Montano', 'Paredes', 'Lopez', 'Castro', 'Villca', 'Maldonado', 'Rivera', 'Arce', 'Soria', 'Salinas', 'Flores', 'Mendoza'];
const CITIES = ['Cochabamba', 'La Paz', 'Santa Cruz', 'Sucre', 'Tarija'];
const SOURCES = ['Instagram', 'Referencia', 'WhatsApp', 'Google', 'Otro'];
const MODALITIES = ['Presencial', 'Online', 'Mixto'];
const FREQUENCIES = ['Semanal', 'Quincenal', 'Mensual', 'Irregular'];

function rand(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function futureSlot(baseDays, hour) {
  const date = new Date();
  date.setDate(date.getDate() + baseDays);
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function main() {
  const [seededRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM clients WHERE tenant_id = ? AND notes LIKE '%[DEMO_SEED]%'`,
    [TENANT_ID]
  );

  if (seededRows[0]?.total >= 50) {
    console.log(`[seed:demo] Ya existen ${seededRows[0].total} clientes demo. No se insertó nada.`);
    return;
  }

  const [cfgRows] = await pool.query(
    'SELECT default_fee, capital_fee, special_fee FROM config WHERE tenant_id = ?',
    [TENANT_ID]
  );
  const cfg = cfgRows[0] || {};

  let insertedClients = 0;
  let insertedAppointments = 0;
  let insertedPayments = 0;

  await withTransaction(async (conn) => {
    for (let i = 0; i < 50; i++) {
      const phone = `${DEMO_PREFIX}${String(i).padStart(4, '0')}`;
      const [existing] = await conn.query(
        'SELECT id FROM clients WHERE tenant_id = ? AND phone = ?',
        [TENANT_ID, phone]
      );
      if (existing.length > 0) continue;

      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);
      const city = rand(CITIES);
      const fee = i % 8 === 0 ? (cfg.special_fee || 150) : i % 3 === 0 ? (cfg.capital_fee || 300) : (cfg.default_fee || 250);

      const [clientResult] = await conn.query(
        `INSERT INTO clients (
          tenant_id, phone, first_name, last_name, age, city, country, timezone,
          modality, frequency, source, fee, payment_method, notes
        ) VALUES (?, ?, ?, ?, ?, ?, 'Bolivia', 'America/La_Paz', ?, ?, ?, ?, 'QR', ?)`,
        [
          TENANT_ID,
          phone,
          firstName,
          lastName,
          20 + (i % 27),
          city,
          rand(MODALITIES),
          rand(FREQUENCIES),
          rand(SOURCES),
          fee,
          '[DEMO_SEED] Cliente generado para demo comercial',
        ]
      );
      insertedClients += 1;

      const clientId = clientResult.insertId;
      const futureAppointments = 1 + (i % 3);
      const hasCompletedHistory = i % 2 === 0;

      if (hasCompletedHistory) {
        const completedDate = new Date();
        completedDate.setDate(completedDate.getDate() - (3 + (i % 12)));
        completedDate.setHours(9 + (i % 6), 0, 0, 0);

        const [apptResult] = await conn.query(
          `INSERT INTO appointments (
            tenant_id, client_id, date_time, duration, gcal_event_id, status,
            is_first, session_number, phone, notes, confirmed_at
          ) VALUES (?, ?, ?, 60, NULL, 'Completada', ?, 1, ?, ?, NOW())`,
          [
            TENANT_ID,
            clientId,
            formatDateTime(completedDate),
            true,
            phone,
            '[DEMO_NO_CALENDAR] Historial demo sin evento en Google Calendar',
          ]
        );
        insertedAppointments += 1;

        await conn.query(
          `INSERT INTO payments (
            tenant_id, client_id, appointment_id, amount, status, method, confirmed_at, notes
          ) VALUES (?, ?, ?, ?, 'Confirmado', 'QR', NOW(), ?)`,
          [
            TENANT_ID,
            clientId,
            apptResult.insertId,
            fee,
            '[DEMO_SEED] Pago confirmado de historial',
          ]
        );
        insertedPayments += 1;
      }

      for (let j = 0; j < futureAppointments; j++) {
        const futureDate = futureSlot(1 + ((i + j) % 18), 8 + ((i + j) % 9));
        const status = j === 0 ? (i % 4 === 0 ? 'Confirmada' : 'Agendada') : 'Agendada';
        const [apptResult] = await conn.query(
          `INSERT INTO appointments (
            tenant_id, client_id, date_time, duration, gcal_event_id, status,
            is_first, session_number, phone, notes, confirmed_at
          ) VALUES (?, ?, ?, 60, NULL, ?, ?, ?, ?, ?, ?)`,
          [
            TENANT_ID,
            clientId,
            formatDateTime(futureDate),
            status,
            !hasCompletedHistory && j === 0,
            (hasCompletedHistory ? 2 : 1) + j,
            phone,
            '[DEMO_NO_CALENDAR] Cita demo sembrada sin crear evento en Google Calendar',
            status === 'Confirmada' ? new Date() : null,
          ]
        );
        insertedAppointments += 1;

        const paymentStatus = status === 'Confirmada' && i % 5 === 0 ? 'Confirmado' : i % 11 === 0 ? 'Mismatch' : 'Pendiente';
        await conn.query(
          `INSERT INTO payments (
            tenant_id, client_id, appointment_id, amount, status, method, confirmed_at, notes
          ) VALUES (?, ?, ?, ?, ?, 'QR', ?, ?)`,
          [
            TENANT_ID,
            clientId,
            apptResult.insertId,
            fee,
            paymentStatus,
            paymentStatus === 'Confirmado' ? new Date() : null,
            paymentStatus === 'Mismatch'
              ? '[DEMO_SEED] Comprobante demo con diferencia de monto'
              : '[DEMO_SEED] Pago demo',
          ]
        );
        insertedPayments += 1;
      }
    }
  });

  console.log(`[seed:demo] Clientes insertados: ${insertedClients}`);
  console.log(`[seed:demo] Citas insertadas: ${insertedAppointments}`);
  console.log(`[seed:demo] Pagos insertados: ${insertedPayments}`);
  console.log('[seed:demo] No se creó ningún evento en Google Calendar.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:demo] Error:', err.message);
    process.exit(1);
  });
