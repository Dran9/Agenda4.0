const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

// GET /api/appointments — list with filters (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { from, to, status, search, page = 1, limit = 50 } = req.query;
    let where = 'a.tenant_id = ?';
    const params = [req.tenantId];

    if (from) { where += ' AND a.date_time >= ?'; params.push(from); }
    if (to) { where += ' AND a.date_time <= ?'; params.push(to + ' 23:59:59'); }
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    const [rows] = await pool.query(
      `SELECT a.*, c.first_name, c.last_name, c.phone as client_phone,
              p.status as payment_status, p.id as payment_id, p.amount as payment_amount,
              p.ocr_extracted_amount, p.ocr_extracted_ref, p.receipt_file_key, p.notes as payment_notes
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       LEFT JOIN payments p ON p.appointment_id = a.id
       WHERE ${where}
       ORDER BY a.date_time DESC
       LIMIT ? OFFSET ?`,
      params
    );

    // Total count for pagination
    const countParams = params.slice(0, -2);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM appointments a JOIN clients c ON a.client_id = c.id LEFT JOIN payments p ON p.appointment_id = a.id WHERE ${where}`,
      countParams
    );

    res.json({ appointments: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/appointments/:id/status — quick status change (admin)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Agendada', 'Confirmada', 'Reagendada', 'Cancelada', 'Completada', 'No-show'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });

    await pool.query(
      'UPDATE appointments SET status = ? WHERE id = ? AND tenant_id = ?',
      [status, req.params.id, req.tenantId]
    );

    // If completed, create pending payment
    if (status === 'Completada') {
      const [appt] = await pool.query(
        'SELECT a.*, c.fee FROM appointments a JOIN clients c ON a.client_id = c.id WHERE a.id = ?',
        [req.params.id]
      );
      if (appt.length > 0) {
        const [existing] = await pool.query(
          'SELECT id FROM payments WHERE appointment_id = ?', [req.params.id]
        );
        if (existing.length === 0) {
          await pool.query(
            `INSERT INTO payments (tenant_id, client_id, appointment_id, amount, status)
             VALUES (?, ?, ?, ?, 'Pendiente')`,
            [req.tenantId, appt[0].client_id, req.params.id, appt[0].fee || 250]
          );
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/appointments/:id/notes — add note (admin)
router.put('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const { notes } = req.body;
    await pool.query(
      'UPDATE appointments SET notes = ? WHERE id = ? AND tenant_id = ?',
      [notes, req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/appointments/today — today's appointments (admin)
router.get('/today', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, c.first_name, c.last_name, c.phone as client_phone,
              p.status as payment_status, p.id as payment_id, p.amount as payment_amount,
              p.ocr_extracted_amount, p.ocr_extracted_ref, p.receipt_file_key, p.notes as payment_notes
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       LEFT JOIN payments p ON p.appointment_id = a.id
       WHERE a.tenant_id = ? AND DATE(a.date_time) = CURDATE()
       ORDER BY a.date_time ASC`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/appointments/:id — delete appointment (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Also delete associated payment if any
    await pool.query('DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await pool.query('DELETE FROM appointments WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
