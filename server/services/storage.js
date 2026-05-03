const { pool } = require('../db');

// Save file as MySQL BLOB (survives deploys)
async function saveFile(tenantId, fileKey, data, mimeType, originalName) {
  const sizeBytes = data.length;
  await pool.query(
    `INSERT INTO files (tenant_id, file_key, data, mime_type, original_name, size_bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE data = VALUES(data), mime_type = VALUES(mime_type),
     original_name = VALUES(original_name), size_bytes = VALUES(size_bytes), updated_at = NOW()`,
    [tenantId, fileKey, data, mimeType, originalName, sizeBytes]
  );
}

// Get file by key (full BLOB)
async function getFile(tenantId, fileKey) {
  const [rows] = await pool.query(
    'SELECT data, mime_type, original_name, updated_at FROM files WHERE tenant_id = ? AND file_key = ?',
    [tenantId, fileKey]
  );
  return rows[0] || null;
}

// Get file metadata only (no BLOB) — used for cache-buster timestamps
async function getFileMeta(tenantId, fileKey) {
  const [rows] = await pool.query(
    'SELECT mime_type, original_name, size_bytes, updated_at FROM files WHERE tenant_id = ? AND file_key = ?',
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
    'SELECT file_key, mime_type, original_name, size_bytes, created_at, updated_at FROM files WHERE tenant_id = ? AND file_key LIKE ?',
    [tenantId, `${prefix}%`]
  );
  return rows;
}

// Compute cache-buster value (unix seconds) for a stored file's URL.
// WhatsApp Cloud API caches media by URL — appending ?v=<this> forces Meta
// to re-fetch when the underlying file is replaced.
async function getFileCacheBuster(tenantId, fileKey) {
  const meta = await getFileMeta(tenantId, fileKey);
  if (!meta || !meta.updated_at) return null;
  const ts = meta.updated_at instanceof Date
    ? meta.updated_at.getTime()
    : new Date(meta.updated_at).getTime();
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
}

module.exports = { saveFile, getFile, getFileMeta, deleteFile, listFiles, getFileCacheBuster };
