CREATE TABLE IF NOT EXISTS bank_email_watch_state (
  tenant_id INT NOT NULL PRIMARY KEY,
  email_address VARCHAR(255),
  label_name VARCHAR(120),
  label_id VARCHAR(120),
  pubsub_topic VARCHAR(255),
  last_history_id VARCHAR(64),
  watch_expiration_at DATETIME,
  last_watch_at DATETIME,
  last_notification_at DATETIME,
  last_error VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
