const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { saveFile, getFile } = require('../services/storage');
const { extractReceiptData } = require('../services/ocr');
const { updateEventSummary, getOAuthClient } = require('../services/calendar');
const { google } = require('googleapis');

const router = Router();

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
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/payments/:id/status — toggle payment status (manual)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Pendiente', 'Confirmado', 'Rechazado'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });

    // Update payment
    await pool.query(
      'UPDATE payments SET status = ?, confirmed_at = ? WHERE id = ? AND tenant_id = ?',
      [status, status === 'Confirmado' ? new Date() : null, req.params.id, req.tenantId]
    );

    // Update GCal event summary with $ prefix
    await updateGCalPaymentPrefix(req.params.id, req.tenantId, status === 'Confirmado');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/:id/receipt — upload receipt image + OCR
router.post('/:id/receipt', authMiddleware, async (req, res) => {
  try {
    const { image } = req.body; // base64 encoded image
    if (!image) return res.status(400).json({ error: 'No image provided' });

    // Decode base64
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const mimeType = image.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';

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
      ocrResult = await extractReceiptData(imageBuffer);
      if (ocrResult) {
        await pool.query(
          'UPDATE payments SET ocr_extracted_amount = ?, ocr_extracted_ref = ? WHERE id = ? AND tenant_id = ?',
          [ocrResult.amount, ocrResult.reference, req.params.id, req.tenantId]
        );
      }
    } catch (ocrErr) {
      console.error('[payments] OCR failed (non-fatal):', ocrErr.message);
    }

    res.json({
      success: true,
      file_key: fileKey,
      ocr: ocrResult ? { name: ocrResult.name, amount: ocrResult.amount, date: ocrResult.date, reference: ocrResult.reference, bank: ocrResult.bank } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/match-receipt — upload receipt without knowing which payment (auto-match)
router.post('/match-receipt', authMiddleware, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Run OCR first
    const ocrResult = await extractReceiptData(imageBuffer);
    if (!ocrResult) {
      return res.status(422).json({ error: 'No se pudo leer el comprobante' });
    }

    // Try to match by name + amount
    let matches = [];
    if (ocrResult.name) {
      const nameParts = ocrResult.name.split(' ').filter(p => p.length > 2);
      if (nameParts.length > 0) {
        const nameSearch = nameParts.map(p => `(c.first_name LIKE ? OR c.last_name LIKE ?)`).join(' AND ');
        const nameParams = nameParts.flatMap(p => [`%${p}%`, `%${p}%`]);

        const [rows] = await pool.query(
          `SELECT p.*, c.first_name, c.last_name, c.phone, c.fee,
                  a.date_time, a.gcal_event_id
           FROM payments p
           JOIN clients c ON p.client_id = c.id
           LEFT JOIN appointments a ON p.appointment_id = a.id
           WHERE p.tenant_id = ? AND p.status = 'Pendiente' AND ${nameSearch}
           ORDER BY p.created_at DESC LIMIT 5`,
          [req.tenantId, ...nameParams]
        );
        matches = rows;
      }
    }

    // If no name match, try by amount
    if (matches.length === 0 && ocrResult.amount) {
      const [rows] = await pool.query(
        `SELECT p.*, c.first_name, c.last_name, c.phone, c.fee,
                a.date_time, a.gcal_event_id
         FROM payments p
         JOIN clients c ON p.client_id = c.id
         LEFT JOIN appointments a ON p.appointment_id = a.id
         WHERE p.tenant_id = ? AND p.status = 'Pendiente' AND p.amount = ?
         ORDER BY p.created_at DESC LIMIT 5`,
        [req.tenantId, ocrResult.amount]
      );
      matches = rows;
    }

    res.json({
      ocr: { name: ocrResult.name, amount: ocrResult.amount, date: ocrResult.date, reference: ocrResult.reference, bank: ocrResult.bank },
      matches: matches.map(m => ({
        payment_id: m.id,
        client_name: `${m.first_name} ${m.last_name || ''}`.trim(),
        client_phone: m.phone,
        amount: parseFloat(m.amount),
        fee: parseFloat(m.fee || 0),
        date_time: m.date_time,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: add or remove $ from GCal event summary
async function updateGCalPaymentPrefix(paymentId, tenantId, isPaid) {
  try {
    const [rows] = await pool.query(
      `SELECT a.gcal_event_id, c.first_name, c.last_name, c.phone
       FROM payments p
       JOIN appointments a ON p.appointment_id = a.id
       JOIN clients c ON p.client_id = c.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [paymentId, tenantId]
    );

    if (!rows.length || !rows[0].gcal_event_id) return;

    const { gcal_event_id, first_name, last_name, phone } = rows[0];
    const baseSummary = `Terapia ${first_name} ${last_name} - ${phone}`;
    const newSummary = isPaid ? `$ ${baseSummary}` : baseSummary;

    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return;

    await updateEventSummary(calendarId, gcal_event_id, newSummary);
    console.log(`[payments] GCal updated: ${isPaid ? 'added $' : 'removed $'} for event ${gcal_event_id}`);
  } catch (err) {
    console.error('[payments] GCal update failed (non-fatal):', err.message);
  }
}

module.exports = router;
