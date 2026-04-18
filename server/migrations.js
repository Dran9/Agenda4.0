const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64),
      duration_ms INT
    )
  `);
}

async function getAppliedVersions(conn) {
  const [rows] = await conn.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function versionFromFilename(filename) {
  return filename.replace(/\.sql$/, '');
}

// True if after stripping comments+whitespace nothing remains — pure comment/whitespace
// shouldn't count as a statement.
function isEffectivelyEmpty(stmt) {
  const stripped = stmt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
  return stripped.length === 0;
}

// Split SQL into individual statements, respecting quoted strings and
// mysql-style delimiters. Good enough for DDL — not a real SQL parser.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      current += ch;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        current += '--';
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        current += '/*';
        i++;
        continue;
      }
    }

    if (!inDouble && !inBacktick && ch === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
    } else if (!inSingle && !inBacktick && ch === '"' && sql[i - 1] !== '\\') {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
    }

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed.length > 0 && !isEffectivelyEmpty(trimmed)) statements.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }

  const trailing = current.trim();
  if (trailing.length > 0 && !isEffectivelyEmpty(trailing)) statements.push(trailing);
  return statements;
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [tableName]
  );
  return rows[0].c > 0;
}

// If this is an existing DB (tenants table present) and schema_migrations is empty,
// register the baseline as applied without running it. This prevents accidentally
// re-running `001_baseline.sql` on prod and breaking things.
async function bootstrapExistingDatabase(conn, applied) {
  if (applied.size > 0) return;

  const hasTenants = await tableExists(conn, 'tenants');
  if (!hasTenants) return; // fresh DB — let migrations run normally

  const files = listMigrationFiles();
  const baseline = files.find((f) => f.startsWith('001_'));
  if (!baseline) return;

  const version = versionFromFilename(baseline);
  await conn.query(
    'INSERT IGNORE INTO schema_migrations (version, applied_at, duration_ms) VALUES (?, NOW(), 0)',
    [version]
  );
  console.log(`[migrations] bootstrap: registered ${version} as already applied (existing DB)`);
  applied.add(version);
}

async function applyMigration(filename) {
  const version = versionFromFilename(filename);
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(fullPath, 'utf-8');
  const statements = splitStatements(sql);

  const conn = await pool.getConnection();
  const startedAt = Date.now();
  try {
    await conn.beginTransaction();
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    const duration = Date.now() - startedAt;
    await conn.query(
      'INSERT INTO schema_migrations (version, applied_at, duration_ms) VALUES (?, NOW(), ?)',
      [version, duration]
    );
    await conn.commit();
    console.log(`[migrations] applied ${version} (${statements.length} stmts, ${duration}ms)`);
  } catch (err) {
    await conn.rollback();
    console.error(`[migrations] FAILED ${version}:`, err.message);
    throw err;
  } finally {
    conn.release();
  }
}

async function runMigrations() {
  const conn = await pool.getConnection();
  let applied;
  try {
    await ensureMigrationsTable(conn);
    applied = await getAppliedVersions(conn);
    await bootstrapExistingDatabase(conn, applied);
  } finally {
    conn.release();
  }

  const files = listMigrationFiles();
  const pending = files.filter((f) => !applied.has(versionFromFilename(f)));

  if (pending.length === 0) {
    console.log('[migrations] nothing to apply');
    return { applied: 0 };
  }

  for (const file of pending) {
    await applyMigration(file);
  }

  return { applied: pending.length };
}

module.exports = { runMigrations, splitStatements };
