const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { validate, paymentGoalSchema, paymentStatusSchema } = require('../middleware/validate');
const { saveFile, getFile } = require('../services/storage');
const { extractReceiptData } = require('../services/ocr');
const { updateEventSummary, getOAuthClient } = require('../services/calendar');
const { buildCalendarSummary } = require('../services/calendarSummary');
const { google } = require('googleapis');
const { sendServerError } = require('../utils/httpErrors');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');
const { broadcast } = require('../services/adminEvents');

const router = Router();

function sanitizeReceiptDate(value) {
  return value ? String(value).trim().slice(0, 50) : null;
}

function sanitizeReceiptDestName(value) {
  return value ? String(value).trim().slice(0, 255) : null;
}

// GET /api/payments — list payments with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, from, to, search, page = 1, limit = 50 } = req.query;
    let where = 'p.tenant_id = ?';
    const params = [req.tenantId];

    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (from) { where += ' AND a.date_time >= ?'; params.push(from); }
    if (to) { where += ' AND a.date_time <= ?'; params.push(to + ' 23:59:59'); }
    if (search) {
      where += ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    const [rows] = await pool.query(
      `SELECT p.*, c.first_name, c.last_name, c.phone as client_phone, c.fee as client_fee,
              a.date_time, a.status as appt_status, a.gcal_event_id, a.session_number
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       LEFT JOIN appointments a ON p.appointment_id = a.id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    const countParams = params.slice(0, -2);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM payments p
       JOIN clients c ON p.client_id = c.id
       LEFT JOIN appointments a ON p.appointment_id = a.id
       WHERE ${where}`,
      countParams
    );

    res.json({ payments: rows, total: countResult[0].total });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron cargar los pagos',
      logLabel: 'payments list',
    });
  }
});

// PUT /api/payments/:id/status — toggle payment status (manual)
router.put('/:id/status', authMiddleware, validate(paymentStatusSchema), async (req, res) => {
  try {
    const { status } = req.validated;

    let updateResult;
    if (status === 'Confirmado') {
      [updateResult] = await pool.query(
        `UPDATE payments
         SET status = ?,
             confirmed_at = COALESCE(confirmed_at, NOW()),
             settled_amount = COALESCE(settled_amount, amount),
             settled_currency = COALESCE(NULLIF(settled_currency, ''), NULLIF(currency, ''), 'BOB'),
             settled_source = COALESCE(NULLIF(settled_source, ''), 'MANUAL')
         WHERE id = ? AND tenant_id = ?`,
        [status, req.params.id, req.tenantId]
      );
    } else {
      [updateResult] = await pool.query(
        `UPDATE payments
         SET status = ?,
             confirmed_at = NULL,
             settled_amount = NULL,
             settled_currency = NULL,
             settled_source = NULL
         WHERE id = ? AND tenant_id = ?`,
        [status, req.params.id, req.tenantId]
      );
    }
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // Update GCal event summary with $ prefix
    await updateGCalPaymentPrefix(req.params.id, req.tenantId, status === 'Confirmado');

    broadcast('payment:change', { id: Number(req.params.id), action: 'status', status }, req.tenantId);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo actualizar el pago',
      logLabel: 'payments status',
    });
  }
});

// POST /api/payments/:id/receipt — upload receipt image + OCR
router.post('/:id/receipt', authMiddleware, async (req, res) => {
  try {
    const { image } = req.body; // base64 encoded image
    if (!image) return res.status(400).json({ error: 'No image provided' });

    // Decode base64
    const base64Data = image.replace(/^data:[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const mimeType = image.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';

    // Save receipt to storage
    const fileKey = `receipt_${req.params.id}`;
    await saveFile(req.tenantId, fileKey, imageBuffer, mimeType, `comprobante_${req.params.id}.jpg`);

    // Update payment with file key
    await pool.query(
      'UPDATE payments SET receipt_file_key = ? WHERE id = ? AND tenant_id = ?',
      [fileKey, req.params.id, req.tenantId]
    );

    // Run OCR
    let ocrResult = null;
    try {
      ocrResult = await extractReceiptData(imageBuffer, mimeType);
      if (ocrResult) {
        await pool.query(
          `UPDATE payments
           SET ocr_extracted_amount = ?, ocr_extracted_ref = ?, ocr_extracted_date = ?, ocr_extracted_dest_name = ?
           WHERE id = ? AND tenant_id = ?`,
          [
            ocrResult.amount,
            ocrResult.reference,
            sanitizeReceiptDate(ocrResult.date),
            sanitizeReceiptDestName(ocrResult.destName),
            req.params.id,
            req.tenantId,
          ]
        );
      }
    } catch (ocrErr) {
      console.error('[payments] OCR failed (non-fatal):', ocrErr.message);
    }

    res.json({
      success: true,
      file_key: fileKey,
      ocr: ocrResult ? {
        name: ocrResult.name,
        amount: ocrResult.amount,
        date: ocrResult.date,
        reference: ocrResult.reference,
        bank: ocrResult.bank,
        destName: ocrResult.destName,
      } : null,
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo subir el comprobante',
      logLabel: 'payments upload-receipt',
    });
  }
});

// GET /api/payments/:id/receipt — view receipt image
router.get('/:id/receipt', authMiddleware, async (req, res) => {
  try {
    const [payment] = await pool.query(
      'SELECT receipt_file_key FROM payments WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!payment.length || !payment[0].receipt_file_key) {
      return res.status(404).json({ error: 'No receipt found' });
    }

    const file = await getFile(req.tenantId, payment[0].receipt_file_key);
    if (!file) return res.status(404).json({ error: 'File not found' });

    res.set('Content-Type', file.mime_type);
    res.send(file.data);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el comprobante',
      logLabel: 'payments get-receipt',
    });
  }
});

// POST /api/payments/match-receipt — upload receipt + match by phone (primary) or amount (fallback)
router.post('/match-receipt', authMiddleware, async (req, res) => {
  try {
    const { image } = req.body;
    const phone = normalizePhone(req.body?.phone); // phone is the WhatsApp sender number
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const base64Data = image.replace(/^data:[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const mimeType = image.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';

    // Run OCR
    const ocrResult = await extractReceiptData(imageBuffer, mimeType);
    if (!ocrResult) {
      return res.status(422).json({ error: 'No se pudo leer el comprobante' });
    }

    let matches = [];
    let matchedBy = null;

    // Priority 1: Match by phone number (most reliable — the patient sends from their WhatsApp)
    if (phone) {
      const [rows] = await pool.query(
        `SELECT p.*, c.first_name, c.last_name, c.phone, c.fee,
                a.date_time, a.gcal_event_id
         FROM payments p
         JOIN clients c ON p.client_id = c.id
         LEFT JOIN appointments a ON p.appointment_id = a.id
         WHERE p.tenant_id = ? AND p.status = 'Pendiente' AND ${normalizedPhoneSql('c.phone')} = ?
         ORDER BY a.date_time ASC LIMIT 5`,
        [req.tenantId, phone]
      );
      matches = rows;
      if (rows.length > 0) matchedBy = 'phone';
    }

    // Priority 2: Match by amount (when admin uploads manually without phone)
    if (matches.length === 0 && ocrResult.amount) {
      const [rows] = await pool.query(
        `SELECT p.*, c.first_name, c.last_name, c.phone, c.fee,
                a.date_time, a.gcal_event_id
         FROM payments p
         JOIN clients c ON p.client_id = c.id
         LEFT JOIN appointments a ON p.appointment_id = a.id
         WHERE p.tenant_id = ? AND p.status = 'Pendiente' AND (p.amount = ? OR c.fee = ?)
         ORDER BY a.date_time ASC LIMIT 5`,
        [req.tenantId, ocrResult.amount, ocrResult.amount]
      );
      matches = rows;
      if (rows.length > 0) matchedBy = 'amount';
    }

    // Priority 3: Name from OCR (least reliable — someone else may have paid)
    if (matches.length === 0 && ocrResult.name) {
      const nameParts = ocrResult.name.split(' ').filter(p => p.length > 2);
      if (nameParts.length > 0) {
        const nameSearch = nameParts.map(() => `(c.first_name LIKE ? OR c.last_name LIKE ?)`).join(' AND ');
        const nameParams = nameParts.flatMap(p => [`%${p}%`, `%${p}%`]);

        const [rows] = await pool.query(
          `SELECT p.*, c.first_name, c.last_name, c.phone, c.fee,
                  a.date_time, a.gcal_event_id
           FROM payments p
           JOIN clients c ON p.client_id = c.id
           LEFT JOIN appointments a ON p.appointment_id = a.id
           WHERE p.tenant_id = ? AND p.status = 'Pendiente' AND ${nameSearch}
           ORDER BY a.date_time ASC LIMIT 5`,
          [req.tenantId, ...nameParams]
        );
        matches = rows;
        if (rows.length > 0) matchedBy = 'name';
      }
    }

    res.json({
      ocr: {
        name: ocrResult.name,
        amount: ocrResult.amount,
        date: ocrResult.date,
        reference: ocrResult.reference,
        bank: ocrResult.bank,
        destName: ocrResult.destName,
      },
      matched_by: matches.length > 0 ? matchedBy : null,
      matches: matches.map(m => ({
        payment_id: m.id,
        client_name: `${m.first_name} ${m.last_name || ''}`.trim(),
        client_phone: m.phone,
        amount: Number(m.amount || 0),
        fee: Number(m.fee || 0),
        date_time: m.date_time,
      })),
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo procesar el comprobante',
      logLabel: 'payments match-receipt',
    });
  }
});

// GET /api/payments/summary — monthly income summary for finance dashboard
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const t = req.tenantId;
    const { year, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;

    // Current month stats
    const [[current]] = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 1 THEN 1 ELSE 0 END), 0) as paid_sessions,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 0 AND p.has_pending = 1 THEN 1 ELSE 0 END), 0) as pending_sessions,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 1 THEN p.income_confirmed_bob ELSE 0 END), 0) as income_confirmed_bob,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 1 THEN p.income_confirmed_usd ELSE 0 END), 0) as income_confirmed_usd,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 0 AND p.has_pending = 1 THEN p.income_pending_bob ELSE 0 END), 0) as income_pending_bob,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 0 AND p.has_pending = 1 THEN p.income_pending_usd ELSE 0 END), 0) as income_pending_usd
      FROM appointments a
      LEFT JOIN (
        SELECT
          tenant_id,
          appointment_id,
          MAX(CASE WHEN status = 'Confirmado' THEN 1 ELSE 0 END) as has_confirmed,
          MAX(CASE WHEN status = 'Pendiente' THEN 1 ELSE 0 END) as has_pending,
          SUM(
            CASE
              WHEN status = 'Confirmado' AND UPPER(COALESCE(NULLIF(settled_currency, ''), NULLIF(currency, ''), 'BOB')) = 'BOB'
                THEN COALESCE(settled_amount, amount, 0)
              ELSE 0
            END
          ) as income_confirmed_bob,
          SUM(
            CASE
              WHEN status = 'Confirmado' AND UPPER(COALESCE(NULLIF(settled_currency, ''), NULLIF(currency, ''), 'BOB')) = 'USD'
                THEN COALESCE(settled_amount, amount, 0)
              ELSE 0
            END
          ) as income_confirmed_usd,
          SUM(
            CASE
              WHEN status = 'Pendiente' AND UPPER(COALESCE(NULLIF(currency, ''), 'BOB')) = 'BOB'
                THEN COALESCE(amount, 0)
              ELSE 0
            END
          ) as income_pending_bob,
          SUM(
            CASE
              WHEN status = 'Pendiente' AND UPPER(COALESCE(NULLIF(currency, ''), 'BOB')) = 'USD'
                THEN COALESCE(amount, 0)
              ELSE 0
            END
          ) as income_pending_usd
        FROM payments
        WHERE tenant_id = ?
        GROUP BY tenant_id, appointment_id
      ) p ON p.appointment_id = a.id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND YEAR(a.date_time) = ? AND MONTH(a.date_time) = ?
        AND a.status IN ('Completada', 'Confirmada', 'Agendada', 'Reagendada')
    `, [t, t, y, m]);

    // Monthly history (last 6 months)
    const [history] = await pool.query(`
      SELECT
        YEAR(a.date_time) as year,
        MONTH(a.date_time) as month,
        COUNT(*) as sessions,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 1 THEN p.income_confirmed_bob ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN p.has_confirmed = 1 THEN p.income_confirmed_usd ELSE 0 END), 0) as income_usd
      FROM appointments a
      LEFT JOIN (
        SELECT
          tenant_id,
          appointment_id,
          MAX(CASE WHEN status = 'Confirmado' THEN 1 ELSE 0 END) as has_confirmed,
          SUM(
            CASE
              WHEN status = 'Confirmado' AND UPPER(COALESCE(NULLIF(settled_currency, ''), NULLIF(currency, ''), 'BOB')) = 'BOB'
                THEN COALESCE(settled_amount, amount, 0)
              ELSE 0
            END
          ) as income_confirmed_bob,
          SUM(
            CASE
              WHEN status = 'Confirmado' AND UPPER(COALESCE(NULLIF(settled_currency, ''), NULLIF(currency, ''), 'BOB')) = 'USD'
                THEN COALESCE(settled_amount, amount, 0)
              ELSE 0
            END
          ) as income_confirmed_usd
        FROM payments
        WHERE tenant_id = ?
        GROUP BY tenant_id, appointment_id
      ) p ON p.appointment_id = a.id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.date_time >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        AND a.status IN ('Completada', 'Confirmada', 'Agendada', 'Reagendada')
      GROUP BY YEAR(a.date_time), MONTH(a.date_time)
      ORDER BY year DESC, month DESC
    `, [t, t]);

    // Payment detail for current month
    const [payments] = await pool.query(`
      SELECT p.*, c.first_name, c.last_name, c.phone as client_phone, c.fee as client_fee, c.fee_currency as client_fee_currency,
             COALESCE(
               CASE WHEN p.status = 'Confirmado' THEN p.settled_amount END,
               p.amount,
               c.fee,
               0
             ) as effective_amount,
             UPPER(
               COALESCE(
                 CASE WHEN p.status = 'Confirmado' THEN NULLIF(p.settled_currency, '') END,
                 NULLIF(p.currency, ''),
                 NULLIF(c.fee_currency, ''),
                 'BOB'
               )
             ) as effective_currency,
             a.date_time, a.status as appt_status, a.session_number,
             p.ocr_extracted_amount, p.ocr_extracted_ref
      FROM payments p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN appointments a ON p.appointment_id = a.id
      WHERE p.tenant_id = ? AND YEAR(a.date_time) = ? AND MONTH(a.date_time) = ?
      ORDER BY a.date_time DESC
    `, [t, y, m]);

    // Get goal from config
    const [[cfg]] = await pool.query(
      'SELECT monthly_goal, default_fee, capital_fee, special_fee FROM config WHERE tenant_id = ?',
      [t]
    );

    const normalizedCurrent = {
      ...current,
      year: y,
      month: m,
      total_sessions: Number(current?.total_sessions || 0),
      paid_sessions: Number(current?.paid_sessions || 0),
      pending_sessions: Number(current?.pending_sessions || 0),
      income_confirmed_bob: Number(current?.income_confirmed_bob || 0),
      income_confirmed_usd: Number(current?.income_confirmed_usd || 0),
      income_pending_bob: Number(current?.income_pending_bob || 0),
      income_pending_usd: Number(current?.income_pending_usd || 0),
    };
    normalizedCurrent.income_confirmed = normalizedCurrent.income_confirmed_bob; // backward compatibility
    normalizedCurrent.income_pending = normalizedCurrent.income_pending_bob; // backward compatibility

    const normalizedHistory = history.map((row) => ({
      ...row,
      year: Number(row.year),
      month: Number(row.month),
      sessions: Number(row.sessions || 0),
      income: Number(row.income || 0),
      income_usd: Number(row.income_usd || 0),
    }));

    const normalizedPayments = payments.map((payment) => ({
      ...payment,
      effective_amount: Number(payment.effective_amount || 0),
      effective_currency: String(payment.effective_currency || 'BOB').toUpperCase(),
    }));

    res.json({
      current: normalizedCurrent,
      history: normalizedHistory,
      payments: normalizedPayments,
      monthly_goal: cfg?.monthly_goal || null,
      pricing: {
        default_fee: Number(cfg?.default_fee || 250),
        capital_fee: Number(cfg?.capital_fee || 300),
        special_fee: Number(cfg?.special_fee || 150),
      },
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el resumen de pagos',
      logLabel: 'payments summary',
    });
  }
});

// PUT /api/payments/goal — set monthly income goal
router.put('/goal', authMiddleware, validate(paymentGoalSchema), async (req, res) => {
  try {
    const { goal } = req.validated;
    await pool.query(
      'UPDATE config SET monthly_goal = ? WHERE tenant_id = ?',
      [goal, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo guardar la meta mensual',
      logLabel: 'payments goal',
    });
  }
});

// Helper: add or remove $ from GCal event summary
async function updateGCalPaymentPrefix(paymentId, tenantId, isPaid) {
  try {
    const [rows] = await pool.query(
      `SELECT a.gcal_event_id, a.status as appointment_status, c.first_name, c.last_name, c.phone
       FROM payments p
       JOIN appointments a ON p.appointment_id = a.id
       JOIN clients c ON p.client_id = c.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [paymentId, tenantId]
    );

    if (!rows.length || !rows[0].gcal_event_id) return;

    const { gcal_event_id, appointment_status, first_name, last_name, phone } = rows[0];
    const baseSummary = `Terapia ${first_name} ${last_name} - ${phone}`.trim();
    const isConfirmed = ['Confirmada', 'Completada'].includes(appointment_status);
    const newSummary = buildCalendarSummary(baseSummary, { paid: isPaid, confirmed: isConfirmed });

    const calendarId = process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return;

    await updateEventSummary(calendarId, gcal_event_id, newSummary);
    console.log(`[payments] GCal updated: ${isPaid ? 'added 💰' : 'removed 💰'} for event ${gcal_event_id}`);
  } catch (err) {
    console.error('[payments] GCal update failed (non-fatal):', err.message);
  }
}

module.exports = router;
