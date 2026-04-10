/**
 * WhatsApp Identity Resolution Service
 * =====================================
 * Meta está migrando de wa_id (teléfono) a Business-scoped User IDs (BSUID).
 *
 * BSUID (user_id) es único por usuario POR portfolio de negocio.
 * - NO es global como el teléfono — si tienes múltiples WABAs en portfolios distintos,
 *   el mismo usuario tendrá BSUIDs diferentes.
 * - El username puede cambiar en cualquier momento — NUNCA usarlo como key.
 * - parent_user_id aparece en cuentas de menores o supervisadas.
 *
 * Campos del webhook que Meta puede enviar (mayo 2026+):
 *   VIEJOS: msg.from (wa_id/teléfono), statuses[].recipient_id
 *   NUEVOS: msg.from_user_id, msg.user_id, statuses[].recipient_user_id,
 *           msg.parent_user_id, contacts[].user_id, contacts[].username
 *
 * Estrategia de resolución:
 *   1. Extraer todos los identificadores disponibles del webhook payload
 *   2. Buscar match en whatsapp_users por BSUID primero, luego por teléfono
 *   3. Si encontramos por un canal y el otro falta, fusionar (UPDATE, no INSERT nuevo)
 *   4. Si no existe nada, crear registro nuevo
 *   5. Siempre intentar vincular con clients.id por teléfono
 */

const { pool } = require('../db');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');

/**
 * Extrae la identidad canónica de un mensaje de webhook entrante.
 * Tolerante a la presencia o ausencia de campos viejos y nuevos.
 *
 * @param {object} msg - El mensaje individual del webhook (value.messages[i])
 * @param {object} value - El value completo del webhook (change.value)
 * @returns {{ phone: string|null, bsuid: string|null, parentBsuid: string|null, username: string|null }}
 */
function extractIdentity(msg, value) {
  // --- Teléfono (campo viejo, puede desaparecer) ---
  // msg.from es el wa_id — puede ser teléfono o vacío si Meta deja de enviarlo
  const rawPhone = msg.from || null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // --- BSUID (campo nuevo) ---
  // Meta puede enviar user_id o from_user_id — tomar el que exista
  const bsuid = msg.user_id || msg.from_user_id || null;

  // --- Parent BSUID (cuentas supervisadas) ---
  const parentBsuid = msg.parent_user_id || null;

  // --- Username (puede cambiar, solo informativo) ---
  // Viene en value.contacts[].user_id y value.contacts[].username
  let username = null;
  if (Array.isArray(value.contacts)) {
    for (const contact of value.contacts) {
      // Matchear por BSUID o wa_id
      if (
        (bsuid && contact.user_id === bsuid) ||
        (rawPhone && contact.wa_id === rawPhone)
      ) {
        username = contact.username || null;
        break;
      }
    }
  }

  return { phone: phone || null, bsuid: bsuid || null, parentBsuid, username };
}

/**
 * Extrae identidad de un status update (delivery receipts, read receipts, etc.)
 *
 * @param {object} statusItem - value.statuses[i]
 * @returns {{ phone: string|null, bsuid: string|null }}
 */
function extractStatusIdentity(statusItem) {
  const rawPhone = statusItem.recipient_id || null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const bsuid = statusItem.recipient_user_id || null;
  return { phone: phone || null, bsuid: bsuid || null };
}

/**
 * Resuelve o crea un registro en whatsapp_users.
 * Garantiza que no se crean duplicados aunque el usuario llegue primero por
 * teléfono y después por BSUID (o viceversa).
 *
 * Prioridad de búsqueda:
 *   1. BSUID (si existe) — match exacto por tenant + bsuid
 *   2. Teléfono (si existe) — match por tenant + phone normalizado
 *   3. Si hay match por un canal, fusionar el otro canal al mismo registro
 *   4. Si no hay match, crear nuevo
 *
 * @param {object} params
 * @param {number} params.tenantId
 * @param {string|null} params.phone
 * @param {string|null} params.bsuid
 * @param {string|null} params.parentBsuid
 * @param {string|null} params.username
 * @param {string|null} params.wabaId - ID del WABA que recibió el mensaje
 * @param {string|null} params.phoneNumberId - ID del número de teléfono de negocio
 * @returns {Promise<{ waUserId: number, clientId: number|null, phone: string|null, bsuid: string|null, isNew: boolean }>}
 */
async function resolveIdentity({ tenantId, phone, bsuid, parentBsuid, username, wabaId, phoneNumberId }) {
  // Necesitamos al menos uno de los dos identificadores
  if (!phone && !bsuid) {
    console.warn('[wa-identity] Mensaje sin teléfono NI BSUID — no se puede resolver identidad');
    return { waUserId: null, clientId: null, phone: null, bsuid: null, isNew: false };
  }

  let existing = null;

  // 1. Buscar por BSUID (más específico, prioridad)
  if (bsuid) {
    const [rows] = await pool.query(
      'SELECT * FROM whatsapp_users WHERE bsuid = ? AND tenant_id = ? LIMIT 1',
      [bsuid, tenantId]
    );
    existing = rows[0] || null;
  }

  // 2. Si no encontró por BSUID, buscar por teléfono
  if (!existing && phone) {
    const [rows] = await pool.query(
      `SELECT * FROM whatsapp_users WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? LIMIT 1`,
      [phone, tenantId]
    );
    existing = rows[0] || null;
  }

  // 3. Si encontramos, actualizar campos faltantes (fusión)
  if (existing) {
    const updates = [];
    const values = [];

    // Fusionar BSUID si llegó nuevo y no lo teníamos
    if (bsuid && !existing.bsuid) {
      updates.push('bsuid = ?');
      values.push(bsuid);
    }
    // Fusionar teléfono si llegó nuevo y no lo teníamos
    if (phone && !existing.phone) {
      updates.push('phone = ?');
      values.push(phone);
    }
    // Actualizar parent_bsuid si vino
    if (parentBsuid && parentBsuid !== existing.parent_bsuid) {
      updates.push('parent_bsuid = ?');
      values.push(parentBsuid);
    }
    // Actualizar username si vino (puede cambiar, siempre tomar el último)
    if (username && username !== existing.username) {
      updates.push('username = ?');
      values.push(username);
    }
    // Actualizar WABA metadata
    if (wabaId && wabaId !== existing.source_waba_id) {
      updates.push('source_waba_id = ?');
      values.push(wabaId);
    }
    if (phoneNumberId && phoneNumberId !== existing.source_phone_number_id) {
      updates.push('source_phone_number_id = ?');
      values.push(phoneNumberId);
    }
    // Siempre actualizar last_seen_at
    updates.push('last_seen_at = NOW()');

    // Resolver client_id si no lo teníamos y ahora tenemos teléfono
    let clientId = existing.client_id;
    if (!clientId) {
      const resolvedPhone = phone || existing.phone;
      if (resolvedPhone) {
        clientId = await resolveClientByPhone(tenantId, resolvedPhone);
        if (clientId) {
          updates.push('client_id = ?');
          values.push(clientId);
        }
      }
    }

    if (updates.length > 1) { // más que solo last_seen_at
      values.push(existing.id);
      await pool.query(
        `UPDATE whatsapp_users SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    } else {
      // Solo actualizar last_seen_at
      await pool.query('UPDATE whatsapp_users SET last_seen_at = NOW() WHERE id = ?', [existing.id]);
    }

    return {
      waUserId: existing.id,
      clientId: clientId || null,
      phone: phone || existing.phone || null,
      bsuid: bsuid || existing.bsuid || null,
      isNew: false,
    };
  }

  // 4. No existe — crear nuevo registro
  const clientId = phone ? await resolveClientByPhone(tenantId, phone) : null;

  const [result] = await pool.query(
    `INSERT INTO whatsapp_users (tenant_id, bsuid, parent_bsuid, phone, username, client_id, source_waba_id, source_phone_number_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, bsuid || null, parentBsuid || null, phone || null, username || null, clientId, wabaId || null, phoneNumberId || null]
  );

  // Log para monitoreo: detectar temprano cuando Meta manda BSUID sin teléfono
  if (bsuid && !phone) {
    console.warn(`[wa-identity] ALERTA: nuevo usuario con BSUID pero SIN teléfono. bsuid=${bsuid}, tenant=${tenantId}`);
  }

  return {
    waUserId: result.insertId,
    clientId,
    phone: phone || null,
    bsuid: bsuid || null,
    isNew: true,
  };
}

/**
 * Busca un client_id por teléfono en la tabla clients.
 * Retorna null si no encuentra.
 */
async function resolveClientByPhone(tenantId, phone) {
  if (!phone) return null;
  const [rows] = await pool.query(
    `SELECT id FROM clients WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [phone, tenantId]
  );
  return rows[0]?.id || null;
}

/**
 * Busca un client_id por BSUID (a través de whatsapp_users).
 * Útil cuando el webhook ya no trae teléfono.
 */
async function resolveClientByBsuid(tenantId, bsuid) {
  if (!bsuid) return null;
  const [rows] = await pool.query(
    `SELECT wu.client_id, wu.phone
     FROM whatsapp_users wu
     WHERE wu.bsuid = ? AND wu.tenant_id = ? AND wu.client_id IS NOT NULL
     LIMIT 1`,
    [bsuid, tenantId]
  );
  return rows[0] || null;
}

/**
 * Dado un client_id, obtiene el mejor identificador para enviarle un mensaje.
 * Prioridad: teléfono (si existe y es reciente) > BSUID.
 *
 * @param {number} tenantId
 * @param {number} clientId
 * @returns {Promise<{ phone: string|null, bsuid: string|null, preferPhone: boolean }>}
 */
async function getMessageTarget(tenantId, clientId) {
  // Primero intentar desde clients (teléfono directo)
  const [clientRows] = await pool.query(
    'SELECT phone FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1',
    [clientId, tenantId]
  );
  const clientPhone = clientRows[0]?.phone ? normalizePhone(clientRows[0].phone) : null;

  // Buscar en whatsapp_users para BSUID
  const [waRows] = await pool.query(
    `SELECT bsuid, phone FROM whatsapp_users
     WHERE client_id = ? AND tenant_id = ?
     ORDER BY last_seen_at DESC LIMIT 1`,
    [clientId, tenantId]
  );
  const waUser = waRows[0] || null;
  const bsuid = waUser?.bsuid || null;
  const waPhone = waUser?.phone ? normalizePhone(waUser.phone) : null;

  // Usar el teléfono más reciente disponible
  const phone = clientPhone || waPhone || null;

  // Política de prioridad:
  // - Si tenemos teléfono, preferirlo (más confiable, funciona con todos los templates)
  // - Si no tenemos teléfono pero sí BSUID, usar BSUID (desde mayo 2026)
  // - Templates de autenticación SIEMPRE requieren teléfono (limitación de Meta)
  return {
    phone,
    bsuid,
    preferPhone: !!phone, // true = usar `to`, false = usar `recipient`
  };
}

/**
 * Dado un teléfono, obtiene el BSUID si lo tenemos.
 * Útil para logging y monitoreo.
 */
async function getBsuidByPhone(tenantId, phone) {
  if (!phone) return null;
  const [rows] = await pool.query(
    `SELECT bsuid FROM whatsapp_users WHERE ${normalizedPhoneSql('phone')} = ? AND tenant_id = ? LIMIT 1`,
    [phone, tenantId]
  );
  return rows[0]?.bsuid || null;
}

module.exports = {
  extractIdentity,
  extractStatusIdentity,
  resolveIdentity,
  resolveClientByPhone,
  resolveClientByBsuid,
  getMessageTarget,
  getBsuidByPhone,
};
