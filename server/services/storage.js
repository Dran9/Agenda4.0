const { pool } = require('../db');

// Save file as MySQL BLOB (survives deploys)
async function saveFile(tenantId, fileKey, data, mimeType, originalName) {
  const sizeBytes = data.length;
  await pool.query(
    `INSERT INTO files (tenant_id, file_key, data, mime_type, original_name, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), mime_type = VALUES(mime_type),
     original_name = VALUES(original_name), size_bytes = VALUES(size_bytes)`,
    [tenantId, fileKey, data, mimeType, originalName, sizeBytes]
  );
}

// Get file by key
async function getFile(tenantId, fileKey) {
  const [rows] = await pool.query(
    'SELECT data, mime_type, original_name FROM files WHERE tenant_id = ? AND file_key = ?',
    [tenantId, fileKey]
  );
  return rows[0] || null;
}

// Delete file
async function deleteFile(tenantId, fileKey) {
  await pool.query(
    'DELETE FROM files WHERE tenant_id = ? AND file_key = ?',
    [tenantId, fileKey]
  );
}

// List files by prefix
async function listFiles(tenantId, prefix) {
  const [rows] = await pool.query(
    'SELECT file_key, mime_type, original_name, size_bytes, created_at FROM files WHERE tenant_id = ? AND file_key LIKE ?',
    [tenantId, `${prefix}%`]
  );
  return rows;
}

module.exports = { saveFile, getFile, deleteFile, listFiles };
