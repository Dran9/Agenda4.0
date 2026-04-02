const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { deleteEvent } = require('../services/calendar');
const { sendServerError } = require('../utils/httpErrors');

const router = Router();
const CALENDAR_ID = () => process.env.CALENDAR_ID || 'danielmacleann@gmail.com';
const PAYMENT_JOIN = `
  LEFT JOIN payments p ON p.id = (
    SELECT p2.id
    FROM payments p2
    WHERE p2.appointment_id = a.id AND p2.tenant_id = a.tenant_id
    ORDER BY
      CASE p2.status
        WHEN 'Confirmado' THEN 0
        WHEN 'Pendiente' THEN 1
        WHEN 'Mismatch' THEN 2
        WHEN 'Rechazado' THEN 3
        ELSE 4
      END,
      p2.updated_at DESC,
      p2.id DESC
    LIMIT 1
  )
`;

async function deleteCalendarEventIfPresent(eventId) {
  if (!eventId) return;
  try {
    await deleteEvent(CALENDAR_ID(), eventId);
  } catch (err) {
    if (![404, 410].includes(err.code)) throw err;
  }
}

// GET /api/appointments — list with filters (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { from, to, status, search, page = 1, limit = 50, sort_by, sort_dir } = req.query;
    let where = 'a.tenant_id = ?';
    const params = [req.tenantId];
    const sortKey = String(sort_by || 'date');
    const sortDirection = String(sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortMap = {
      date: `a.date_time ${sortDirection}, a.id DESC`,
      name: `c.first_name ${sortDirection}, c.last_name ${sortDirection}, a.date_time DESC`,
      created: `a.created_at ${sortDirection}, a.id DESC`,
      status: `a.status ${sortDirection}, a.date_time DESC`,
    };
    const orderBy = sortMap[sortKey] || sortMap.date;

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
              p.ocr_extracted_amount, p.ocr_extracted_ref, p.ocr_extracted_date, p.ocr_extracted_dest_name,
              p.receipt_file_key, p.notes as payment_notes
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       ${PAYMENT_JOIN}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      params
    );

    // Total count for pagination
    const countParams = params.slice(0, -2);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE ${where}`,
      countParams
    );

    res.json({ appointments: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron cargar las citas',
      logLabel: 'appointments list',
    });
  }
});

// PUT /api/appointments/:id/status — quick status change (admin)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Agendada', 'Confirmada', 'Reagendada', 'Cancelada', 'Completada', 'No-show'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });

    const [updateResult] = await pool.query(
      `UPDATE appointments
       SET status = ?,
           confirmed_at = CASE
             WHEN ? = 'Confirmada' THEN COALESCE(confirmed_at, NOW())
             WHEN ? IN ('Agendada', 'Reagendada', 'Cancelada', 'No-show') THEN NULL
             ELSE confirmed_at
           END
       WHERE id = ? AND tenant_id = ?`,
      [status, status, status, req.params.id, req.tenantId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // If completed, create pending payment
    if (status === 'Completada') {
      const [appt] = await pool.query(
        'SELECT a.*, c.fee FROM appointments a JOIN clients c ON a.client_id = c.id WHERE a.id = ? AND a.tenant_id = ?',
        [req.params.id, req.tenantId]
      );
      if (appt.length > 0) {
        const [existing] = await pool.query(
          'SELECT id FROM payments WHERE appointment_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]
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
    sendServerError(res, req, err, {
      message: 'No se pudo actualizar la cita',
      logLabel: 'appointments status',
    });
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
    sendServerError(res, req, err, {
      message: 'No se pudo guardar la nota',
      logLabel: 'appointments notes',
    });
  }
});

// GET /api/appointments/today — today's appointments (admin)
router.get('/today', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, c.first_name, c.last_name, c.phone as client_phone,
              p.status as payment_status, p.id as payment_id, p.amount as payment_amount,
              p.ocr_extracted_amount, p.ocr_extracted_ref, p.ocr_extracted_date, p.ocr_extracted_dest_name,
              p.receipt_file_key, p.notes as payment_notes
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       ${PAYMENT_JOIN}
       WHERE a.tenant_id = ? AND DATE(a.date_time) = CURDATE()
       ORDER BY a.date_time ASC`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudieron cargar las citas de hoy',
      logLabel: 'appointments today',
    });
  }
});

// DELETE /api/appointments/:id — delete appointment (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT gcal_event_id FROM appointments WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const gcalEventId = rows[0].gcal_event_id;
    await deleteCalendarEventIfPresent(gcalEventId);

    await pool.query('DELETE FROM payments WHERE appointment_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await pool.query('DELETE FROM appointments WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo eliminar la cita',
      logLabel: 'appointments delete',
    });
  }
});

module.exports = router;
