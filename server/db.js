const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const mysql = require('mysql2/promise');
const { backfillActiveAppointmentSlotClaims } = require('./services/appointmentSlotClaims');

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

// Schema: core tables, multi-tenant from day 1
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
        fee_currency VARCHAR(8) DEFAULT 'BOB',
        foreign_pricing_key VARCHAR(60),
        special_fee_enabled BOOLEAN DEFAULT FALSE,
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

    // 4. appointment_slot_claims (DB-enforced overlap protection)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS appointment_slot_claims (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        appointment_id INT NOT NULL,
        claim_time DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_slot_claim_minute (tenant_id, claim_time),
        KEY idx_appointment (appointment_id),
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
      )
    `);

    // 5. recurring_schedules
    await conn.query(`
      CREATE TABLE IF NOT EXISTS recurring_schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        client_id INT NOT NULL,
        day_of_week TINYINT NOT NULL,
        time VARCHAR(5) NOT NULL,
        duration INT DEFAULT 60,
        gcal_recurring_event_id VARCHAR(255),
        source_appointment_id INT DEFAULT NULL,
        started_at DATE NOT NULL,
        paused_at DATE DEFAULT NULL,
        ended_at DATE DEFAULT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_client (client_id),
        KEY idx_active (tenant_id, ended_at, paused_at),
        KEY idx_gcal_recurring (gcal_recurring_event_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (source_appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
      )
    `);

    // 6. config (one row per tenant)
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
        foreign_pricing_profiles JSON,
        stripe_webhook_url VARCHAR(500),
        stripe_webhook_secret VARCHAR(255),
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
        last_appointment_reminder_run_at DATETIME DEFAULT NULL,
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

    // 7. payments
    await conn.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        client_id INT NOT NULL,
        appointment_id INT,
        amount INT NOT NULL,
        currency VARCHAR(8) DEFAULT 'BOB',
        method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR',
        status ENUM('Pendiente','Confirmado','Rechazado') DEFAULT 'Pendiente',
        receipt_file_key VARCHAR(50),
        ocr_extracted_amount INT,
        ocr_extracted_ref VARCHAR(100),
        ocr_extracted_date VARCHAR(50),
        ocr_extracted_dest_name VARCHAR(255),
        settled_amount DECIMAL(10,2),
        settled_currency VARCHAR(8),
        settled_source VARCHAR(20),
        stripe_event_id VARCHAR(255),
        stripe_session_id VARCHAR(255),
        stripe_payment_intent VARCHAR(255),
        stripe_payment_link_id VARCHAR(255),
        stripe_charge_id VARCHAR(255),
        stripe_customer_email VARCHAR(255),
        stripe_amount_minor BIGINT,
        notes TEXT,
        confirmed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_client (client_id),
        KEY idx_status (status),
        KEY idx_currency (currency),
        KEY idx_stripe_event (stripe_event_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (appointment_id) REFERENCES appointments(id)
      )
    `);

    // 8. stripe_events (idempotency + webhook audit)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS stripe_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        stripe_event_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(120) NOT NULL,
        livemode BOOLEAN DEFAULT FALSE,
        currency VARCHAR(10),
        amount_minor BIGINT,
        amount DECIMAL(10,2),
        payment_link_id VARCHAR(255),
        checkout_session_id VARCHAR(255),
        payment_intent_id VARCHAR(255),
        customer_email VARCHAR(255),
        profile_key VARCHAR(60),
        matched_payment_id INT,
        processed_status ENUM('processed','ignored','unmatched','error') DEFAULT 'processed',
        notes VARCHAR(500),
        payload JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_tenant_stripe_event (tenant_id, stripe_event_id),
        KEY idx_tenant_created (tenant_id, created_at),
        KEY idx_processed_status (tenant_id, processed_status, created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (matched_payment_id) REFERENCES payments(id) ON DELETE SET NULL
      )
    `);

    // 9. deductions
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

    // 10. financial_goals
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

    // 11. files (QR, receipts, logos — MySQL BLOB)
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

    // 12. webhooks_log (activity + reminder dedup)
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

    // 13. wa_conversations (WhatsApp inbox)
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

    // 14. voice_commands_log (admin voice/text shortcut audit)
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
        result_data JSON,
        status ENUM('resolved','clarification','error') NOT NULL DEFAULT 'resolved',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_created (created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // 15. whatsapp_users — BSUID identity resolution layer
    // Meta está migrando de wa_id (teléfono) a Business-scoped user IDs (BSUID).
    // Esta tabla mapea BSUIDs ↔ teléfonos ↔ clientes internos.
    // Un mismo usuario puede llegar primero por teléfono y después por BSUID (o viceversa);
    // la lógica de resolución en whatsappIdentity.js se encarga de fusionar sin duplicar.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        bsuid VARCHAR(255) DEFAULT NULL,
        parent_bsuid VARCHAR(255) DEFAULT NULL,
        phone VARCHAR(20) DEFAULT NULL,
        username VARCHAR(100) DEFAULT NULL,
        client_id INT DEFAULT NULL,
        source_waba_id VARCHAR(50) DEFAULT NULL,
        source_phone_number_id VARCHAR(50) DEFAULT NULL,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_bsuid_tenant (bsuid, tenant_id),
        UNIQUE KEY unique_phone_tenant (phone, tenant_id),
        KEY idx_tenant (tenant_id),
        KEY idx_client (client_id),
        KEY idx_username (username),
        KEY idx_parent_bsuid (parent_bsuid),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
      )
    `);

    // 16. meta_health_config (monitoring by tenant)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL UNIQUE,
        monitoring_enabled BOOLEAN DEFAULT TRUE,
        watchdog_interval_minutes INT DEFAULT 60,
        silence_warning_minutes INT DEFAULT 180,
        silence_critical_minutes INT DEFAULT 480,
        stale_after_minutes INT DEFAULT 360,
        alert_cooldown_minutes INT DEFAULT 30,
        alert_info_enabled BOOLEAN DEFAULT FALSE,
        alert_warning_enabled BOOLEAN DEFAULT TRUE,
        alert_critical_enabled BOOLEAN DEFAULT TRUE,
        coexistence_enabled BOOLEAN DEFAULT TRUE,
        smb_message_echoes_enabled BOOLEAN DEFAULT FALSE,
        flows_enabled BOOLEAN DEFAULT FALSE,
        monitored_phone_number_id VARCHAR(120),
        monitored_waba_id VARCHAR(120),
        alert_channels JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_monitoring (monitoring_enabled),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);

    // 17. meta_health_webhook_raw (raw webhook payloads)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_webhook_raw (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        request_id VARCHAR(100) NOT NULL,
        source VARCHAR(40) DEFAULT 'meta_webhook',
        signature_valid BOOLEAN DEFAULT TRUE,
        field_hint VARCHAR(100),
        payload_hash VARCHAR(64) NOT NULL,
        payload JSON NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed BOOLEAN DEFAULT FALSE,
        processed_at DATETIME DEFAULT NULL,
        processing_error TEXT,
        UNIQUE KEY uniq_request_id (request_id),
        KEY idx_tenant_received (tenant_id, received_at),
        KEY idx_payload_hash (tenant_id, payload_hash),
        KEY idx_processed (tenant_id, processed, received_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);

    // 18. meta_health_events (normalized webhook/watchdog events)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        raw_webhook_id BIGINT DEFAULT NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'meta_webhook',
        field_name VARCHAR(100) NOT NULL,
        event_type VARCHAR(160) NOT NULL,
        severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
        occurred_at DATETIME NOT NULL,
        received_at DATETIME NOT NULL,
        waba_id VARCHAR(120),
        phone_number_id VARCHAR(120),
        template_name VARCHAR(120),
        template_language VARCHAR(30),
        status VARCHAR(120),
        quality VARCHAR(120),
        reason TEXT,
        summary VARCHAR(600),
        recommended_action VARCHAR(600),
        normalized_payload JSON,
        dedupe_key VARCHAR(64) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_meta_event_dedupe (tenant_id, dedupe_key),
        KEY idx_tenant_received (tenant_id, received_at),
        KEY idx_field (tenant_id, field_name, received_at),
        KEY idx_severity (tenant_id, severity, received_at),
        KEY idx_phone (tenant_id, phone_number_id, received_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (raw_webhook_id) REFERENCES meta_health_webhook_raw(id) ON DELETE SET NULL
      )
    `);

    // 19. meta_health_last_seen (last timestamps by event key)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_last_seen (
        tenant_id INT NOT NULL,
        event_key VARCHAR(180) NOT NULL,
        last_received_at DATETIME NOT NULL,
        last_occurred_at DATETIME NOT NULL,
        last_event_id BIGINT DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, event_key),
        KEY idx_last_event_id (last_event_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (last_event_id) REFERENCES meta_health_events(id) ON DELETE SET NULL
      )
    `);

    // 20. meta_health_state (aggregated dashboard state)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_state (
        tenant_id INT PRIMARY KEY,
        global_status ENUM('green','yellow','red') DEFAULT 'yellow',
        global_reason VARCHAR(700),
        last_internal_refresh_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_webhook_received_at DATETIME DEFAULT NULL,
        last_critical_event_at DATETIME DEFAULT NULL,
        last_event_received_at DATETIME DEFAULT NULL,
        last_watchdog_run_at DATETIME DEFAULT NULL,
        watchdog_status VARCHAR(30) DEFAULT 'unknown',
        pipeline_status VARCHAR(30) DEFAULT 'unknown',
        cards JSON,
        diagnostics JSON,
        metrics JSON,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);

    // 21. meta_health_history (state snapshots)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        global_status ENUM('green','yellow','red') NOT NULL,
        global_reason VARCHAR(700),
        snapshot JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant_created (tenant_id, created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);

    // 22. meta_health_alerts (alert dispatch log)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_alerts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        event_id BIGINT DEFAULT NULL,
        alert_type VARCHAR(160) NOT NULL,
        severity ENUM('info','warning','critical') NOT NULL,
        channel ENUM('telegram') NOT NULL DEFAULT 'telegram',
        dedupe_key VARCHAR(64) NOT NULL,
        status ENUM('queued','sent','error','skipped') NOT NULL DEFAULT 'queued',
        payload JSON,
        response_status INT DEFAULT NULL,
        response_body TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME DEFAULT NULL,
        KEY idx_tenant_created (tenant_id, created_at),
        KEY idx_event (event_id),
        KEY idx_status (tenant_id, status, created_at),
        KEY idx_dedupe (tenant_id, channel, dedupe_key, created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES meta_health_events(id) ON DELETE SET NULL
      )
    `);

    // 23. meta_health_watchdog_runs (watchdog execution history)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_watchdog_runs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        status ENUM('ok','warning','critical') NOT NULL,
        checked_at DATETIME NOT NULL,
        duration_ms INT,
        result_payload JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant_checked (tenant_id, checked_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);

    // 24. meta_health_pipeline_checks (internal pipeline checks)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meta_health_pipeline_checks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        check_name VARCHAR(120) NOT NULL,
        status ENUM('ok','warning','critical') NOT NULL,
        details JSON,
        checked_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant_check (tenant_id, check_name, checked_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
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
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS last_appointment_reminder_run_at DATETIME DEFAULT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS retention_risk_template VARCHAR(120)`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS retention_lost_template VARCHAR(120)`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(10) DEFAULT 'es'`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS foreign_pricing_profiles JSON`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS stripe_webhook_url VARCHAR(500)`).catch(() => {});
    await conn.query(`ALTER TABLE config ADD COLUMN IF NOT EXISTS stripe_webhook_secret VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE appointments MODIFY COLUMN status ENUM('Agendada','Confirmada','Reagendada','Cancelada','Completada','No-show') DEFAULT 'Agendada'`).catch(() => {});
    await conn.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_context JSON DEFAULT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source_schedule_id INT DEFAULT NULL`).catch(() => {});
    // wa_conversations: add image/document types + metadata column for OCR data
    await conn.query(`ALTER TABLE wa_conversations MODIFY COLUMN message_type ENUM('text','button_reply','template','auto_reply','image','document') NOT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT NULL`).catch(() => {});
    // payments: add Mismatch status for OCR validation failures
    await conn.query(`ALTER TABLE payments MODIFY COLUMN status ENUM('Pendiente','Confirmado','Rechazado','Mismatch') DEFAULT 'Pendiente'`).catch(() => {});
    await conn.query(`ALTER TABLE voice_commands_log MODIFY COLUMN source ENUM('shortcut','voice_web') NOT NULL DEFAULT 'shortcut'`).catch(() => {});
    await conn.query(`ALTER TABLE voice_commands_log ADD COLUMN IF NOT EXISTS result_data JSON DEFAULT NULL`).catch(() => {});
    // Migrate old source values to new 3 options
    await conn.query(`UPDATE clients SET source = 'Redes sociales' WHERE source IN ('Instagram','Google','Sitio web','WhatsApp')`).catch(() => {});
    await conn.query(`UPDATE clients SET source = 'Referencia de amigos' WHERE source = 'Referido'`).catch(() => {});
    // Fee/amount columns → INT (no decimals, Bolivianos are whole numbers)
    await conn.query(`ALTER TABLE clients MODIFY COLUMN fee INT DEFAULT 250`).catch(() => {});
    await conn.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(8) DEFAULT 'BOB'`).catch(() => {});
    await conn.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS foreign_pricing_key VARCHAR(60)`).catch(() => {});
    await conn.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS special_fee_enabled BOOLEAN DEFAULT FALSE`).catch(() => {});
    await conn.query(`ALTER TABLE clients ADD KEY IF NOT EXISTS idx_foreign_pricing_key (foreign_pricing_key)`).catch(() => {});
    await conn.query(`UPDATE clients SET fee_currency = 'BOB' WHERE fee_currency IS NULL OR fee_currency = ''`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN default_fee INT DEFAULT 250`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN capital_fee INT DEFAULT 300`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN special_fee INT DEFAULT 150`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN foreign_fee INT DEFAULT 40`).catch(() => {});
    await conn.query(`ALTER TABLE config MODIFY COLUMN monthly_goal INT DEFAULT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE payments MODIFY COLUMN amount INT NOT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(8) DEFAULT 'BOB'`).catch(() => {});
    await conn.query(`ALTER TABLE payments MODIFY COLUMN ocr_extracted_amount INT`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ocr_extracted_date VARCHAR(50)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ocr_extracted_dest_name VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS settled_amount DECIMAL(10,2)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS settled_currency VARCHAR(8)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS settled_source VARCHAR(20)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_event_id VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_intent VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_link_id VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_charge_id VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_customer_email VARCHAR(255)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_amount_minor BIGINT`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD KEY IF NOT EXISTS idx_currency (currency)`).catch(() => {});
    await conn.query(`ALTER TABLE payments ADD KEY IF NOT EXISTS idx_stripe_event (stripe_event_id)`).catch(() => {});
    await conn.query(`UPDATE payments SET currency = 'BOB' WHERE currency IS NULL OR currency = ''`).catch(() => {});
    await conn.query(
      `UPDATE tenants
       SET domain = 'agenda.danielmaclean.com'
       WHERE slug = 'daniel' AND COALESCE(domain, '') <> 'agenda.danielmaclean.com'`
    ).catch(() => {});
    // Prevent duplicate active recurring schedules per client
    await conn.query(
      `ALTER TABLE recurring_schedules ADD UNIQUE KEY unique_active_client (tenant_id, client_id, day_of_week, time, started_at)`
    ).catch(() => {});
    // BSUID migration: agregar columnas para soportar identidad WhatsApp por BSUID además de teléfono
    await conn.query(`ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS bsuid VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await conn.query(`ALTER TABLE wa_conversations ADD KEY IF NOT EXISTS idx_bsuid (bsuid)`).catch(() => {});
    await conn.query(`ALTER TABLE webhooks_log ADD COLUMN IF NOT EXISTS bsuid VARCHAR(255) DEFAULT NULL`).catch(() => {});

    const slotClaimBackfill = await backfillActiveAppointmentSlotClaims(conn).catch((err) => {
      console.error('[DB] appointment_slot_claims backfill skipped:', err.message);
      return null;
    });
    if (slotClaimBackfill) {
      console.log(
        `[DB] appointment_slot_claims backfill: ${slotClaimBackfill.backfilledAppointments}/${slotClaimBackfill.appointments} appointments, conflicts=${slotClaimBackfill.conflictingAppointments}`
      );
    }

    console.log('[DB] Core tables initialized');
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction, withAdvisoryLock, initializeDatabase };
