const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '-04:00', // Bolivia time — DATETIME values in DB are stored in La Paz time
});

// Set MySQL session timezone to Bolivia — ensures NOW(), CURDATE(), etc. return Bolivia time
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '-04:00'");
});

// Transaction helper — wraps callback in BEGIN/COMMIT/ROLLBACK
async function withTransaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function withAdvisoryLock(lockName, timeoutSeconds, callback) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds]);
    if (!rows[0]?.acquired) {
      const err = new Error('No se pudo adquirir el lock de reserva');
      err.code = 'LOCK_TIMEOUT';
      throw err;
    }
    return await callback();
  } finally {
    try {
      await conn.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    } catch (_) {
      // best effort
    }
    conn.release();
  }
}

// Schema: 11 tables, multi-tenant from day 1
async function initializeDatabase() {
  const conn = await pool.getConnection();
  try {
    // 1. tenants
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        logo_key VARCHAR(50),
        primary_color VARCHAR(7) DEFAULT '#2563eb',
        secondary_color VARCHAR(7) DEFAULT '#1e40af',
        welcome_text TEXT,
        domain VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 2. clients
    await conn.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        age INT,
        city VARCHAR(100) DEFAULT 'Cochabamba',
        country VARCHAR(100) DEFAULT 'Bolivia',
        timezone VARCHAR(50) DEFAULT 'America/La_Paz',
        modality ENUM('Presencial','Online','Mixto') DEFAULT 'Presencial',
        frequency ENUM('Semanal','Quincenal','Mensual','Irregular') DEFAULT 'Semanal',
        source VARCHAR(100) DEFAULT 'Otro',
        referred_by VARCHAR(200),
        fee INT DEFAULT 250,
        payment_method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR',
        rating TINYINT DEFAULT 0,
        diagnosis TEXT,
        notes TEXT,
        status_override VARCHAR(20),
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_phone_tenant (phone, tenant_id),
        KEY idx_tenant (tenant_id),
        KEY idx_deleted (deleted_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 3. appointments
    await conn.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        client_id INT NOT NULL,
        date_time DATETIME NOT NULL,
        duration INT DEFAULT 60,
        gcal_event_id VARCHAR(255),
        status ENUM('Agendada','Confirmada','Reagendada','Cancelada','Completada','No-show') DEFAULT 'Agendada',
        is_first BOOLEAN DEFAULT FALSE,
        session_number INT DEFAULT 1,
        phone VARCHAR(20),
        notes TEXT,
        user_agent VARCHAR(500),
        booking_context JSON DEFAULT NULL,
        confirmed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_client (client_id),
        KEY idx_datetime (date_time),
        KEY idx_status (status),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES clients(id)
      )
    `);

    // 4. config (one row per tenant)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL UNIQUE,
        available_hours JSON,
        available_days JSON,
        window_days INT DEFAULT 10,
        buffer_hours INT DEFAULT 3,
        appointment_duration INT DEFAULT 60,
        break_start VARCHAR(5) DEFAULT '13:00',
        break_end VARCHAR(5) DEFAULT '14:00',
        min_age INT DEFAULT 12,
        max_age INT DEFAULT 80,
        default_fee INT DEFAULT 250,
        capital_fee INT DEFAULT 300,
        capital_cities VARCHAR(255) DEFAULT 'La Paz,Santa Cruz,Cochabamba,Beni',
        special_fee INT DEFAULT 150,
        foreign_fee INT DEFAULT 40,
        foreign_currency VARCHAR(10) DEFAULT 'USD',
        qr_url_capital VARCHAR(500),
        qr_url_provincia VARCHAR(500),
        qr_url_especial VARCHAR(500),
        qr_url_generico VARCHAR(500),
        rate_limit_booking INT DEFAULT 6,
        rate_limit_window INT DEFAULT 15,
        custom_statuses JSON,
        custom_sources JSON,
        retention_rules JSON,
        reminder_time VARCHAR(5) DEFAULT '18:40',
        reminder_enabled BOOLEAN DEFAULT TRUE,
        payment_reminder_enabled BOOLEAN DEFAULT FALSE,
        payment_reminder_hours INT DEFAULT 2,
        payment_reminder_template VARCHAR(120),
        retention_risk_template VARCHAR(120),
        retention_lost_template VARCHAR(120),
        whatsapp_template_language VARCHAR(10) DEFAULT 'es',
        auto_reply_confirm TEXT DEFAULT 'Perfecto {{nombre}}, te esperamos el {{dia}} a las {{hora}}',
        auto_reply_reschedule TEXT DEFAULT 'Puedes reagendar tu cita aquí: {{link}}',
        auto_reply_contact TEXT DEFAULT 'Daniel te contactará pronto',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 5. payments
    await conn.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        client_id INT NOT NULL,
        appointment_id INT,
        amount INT NOT NULL,
        method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR',
        status ENUM('Pendiente','Confirmado','Rechazado') DEFAULT 'Pendiente',
        receipt_file_key VARCHAR(50),
        ocr_extracted_amount INT,
        ocr_extracted_ref VARCHAR(100),
        ocr_extracted_date VARCHAR(50),
        ocr_extracted_dest_name VARCHAR(255),
        notes TEXT,
        confirmed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_client (client_id),
        KEY idx_status (status),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (appointment_id) REFERENCES appointments(id)
      )
    `);

    // 6. deductions
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deductions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        percentage DECIMAL(5,2) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 7. financial_goals
    await conn.query(`
      CREATE TABLE IF NOT EXISTS financial_goals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        type ENUM('meta_mensual','deuda') NOT NULL,
        name VARCHAR(200) NOT NULL,
        target_amount DECIMAL(10,2) NOT NULL,
        monthly_payment DECIMAL(10,2),
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 8. files (QR, receipts, logos — MySQL BLOB)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        file_key VARCHAR(100) NOT NULL,
        data MEDIUMBLOB NOT NULL,
        mime_type VARCHAR(50) NOT NULL,
        original_name VARCHAR(255),
        size_bytes INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_key_tenant (file_key, tenant_id),
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 9. webhooks_log (activity + reminder dedup)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS webhooks_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        event VARCHAR(100) NOT NULL,
        type ENUM('reminder_sent','button_reply','message_sent','booking','reschedule','cancel','client_new','status_change') NOT NULL,
        payload JSON,
        status ENUM('enviado','recibido','error','procesado') DEFAULT 'enviado',
        client_phone VARCHAR(20),
        client_id INT,
        appointment_id INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_type (type),
        KEY idx_phone (client_phone),
        KEY idx_created (created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 10. wa_conversations (WhatsApp inbox)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wa_conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        client_id INT,
        client_phone VARCHAR(20) NOT NULL,
        direction ENUM('inbound','outbound') NOT NULL,
        message_type ENUM('text','button_reply','template','auto_reply') NOT NULL,
        content TEXT,
        button_payload VARCHAR(50),
        wa_message_id VARCHAR(100),
        is_read BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_client (client_id),
        KEY idx_phone (client_phone),
        KEY idx_read (is_read),
        KEY idx_created (created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES clients(id)
      )
    `);

    // 11. voice_commands_log (admin voice/text shortcut audit)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS voice_commands_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        source ENUM('shortcut','voice_web') NOT NULL DEFAULT 'shortcut',
        input_type ENUM('audio','text','audio_text') NOT NULL,
        raw_text TEXT,
        transcript TEXT,
        parsed_intent VARCHAR(100),
        parsed_entities JSON,
        response_text TEXT,
        status ENUM('resolved','clarification','error') NOT NULL DEFAULT 'resolved',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_created (created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // Seed: Daniel as first tenant (idempotent)
    const [tenants] = await conn.query('SELECT id FROM tenants WHERE slug = ?', ['daniel']);
    if (tenants.length === 0) {
      await conn.query(
        `INSERT INTO tenants (name, slug, domain) VALUES ('Daniel MacLean', 'daniel', 'agenda.danielmaclean.com')`
      );
      await conn.query(`
        INSERT INTO config (tenant_id, available_hours, available_days) VALUES (
          1,
          '{"lunes":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"martes":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"miercoles":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"jueves":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"viernes":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"]}',
          '["lunes","martes","miercoles","jueves","viernes"]'
        )
      `);
      console.log('[DB] Seed: tenant "daniel" + config created');
    }

    // Schema migrations (safe to re-run)
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS monthly_goal INT DEFAULT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS retention_rules JSON`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS payment_reminder_enabled BOOLEAN DEFAULT FALSE`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS payment_reminder_hours INT DEFAULT 2`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS payment_reminder_template VARCHAR(120)`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS retention_risk_template VARCHAR(120)`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS retention_lost_template VARCHAR(120)`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(10) DEFAULT 'es'`).catch(() => {});
    await conn.query(`ALTER TABLE appointments MODIFY COLUMN status ENUM('Agendada','Confirmada','Reagendada','Cancelada','Completada','No-show') DEFAULT 'Agendada'`).catch(() => {});
    await conn.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_context JSON DEFAULT NULL`).catch(() => {});
    // wa_conversations: add image/document types + metadata column for OCR data
    await conn.query(`ALTER TABLE wa_conversations MODIFY COLUMN message_type ENUM('text','button_reply','template','auto_reply','image','document') NOT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT NULL`).catch(() => {});
    // payments: add Mismatch status for OCR validation failures
    await conn.query(`ALTER TABLE payments MODIFY COLUMN status ENUM('Pendiente','Confirmado','Rechazado','Mismatch') DEFAULT 'Pendiente'`).catch(() => {});
    await conn.query(`ALTER TABLE voice_commands_log MODIFY COLUMN source ENUM('shortcut','voice_web') NOT NULL DEFAULT 'shortcut'`).catch(() => {});
    // Migrate old source values to new 3 options
    await conn.query(`UPDATE clients SET source = 'Redes sociales' WHERE source IN ('Instagram','Google','Sitio web','WhatsApp')`).catch(() => {});
    await conn.query(`UPDATE clients SET source = 'Referencia de amigos' WHERE source = 'Referido'`).catch(() => {});
    // Fee/amount columns → INT (no decimals, Bolivianos are whole numbers)
    await conn.query(`ALTER TABLE clients MODIFY COLUMN fee INT DEFAULT 250`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN default_fee INT DEFAULT 250`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN capital_fee INT DEFAULT 300`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN special_fee INT DEFAULT 150`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN foreign_fee INT DEFAULT 40`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN monthly_goal INT DEFAULT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE payments MODIFY COLUMN amount INT NOT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE payments MODIFY COLUMN ocr_extracted_amount INT`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ocr_extracted_date VARCHAR(50)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ocr_extracted_dest_name VARCHAR(255)`).catch(() => {});
    await conn.query(
      `UPDATE tenants
       SET domain = 'agenda.danielmaclean.com'
       WHERE slug = 'daniel' AND COALESCE(domain, '') <> 'agenda.danielmaclean.com'`
    ).catch(() => {});

    console.log('[DB] All 11 tables initialized');
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction, withAdvisoryLock, initializeDatabase };
