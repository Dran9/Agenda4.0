const { Router } = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

// GET /api/analytics — aggregated data for dashboard
router.get('/', authMiddleware, async (req, res) => {
  try {
    const t = req.tenantId;

    // Run all queries in parallel
    const [
      [totals],
      [sessionsByWeek],
      [sessionsByStatus],
      [clientsByCity],
      [clientsBySource],
      [popularHours],
      [clientsByStatus],
      [recentActivity],
    ] = await Promise.all([
      // Totals
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM clients WHERE tenant_id = ? AND deleted_at IS NULL) as total_clients,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = ?) as total_appointments,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = ? AND status = 'Completada') as total_completed,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = ? AND status = 'Cancelada') as total_cancelled,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = ? AND status = 'No-show') as total_noshow,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = ? AND status = 'Reagendada') as total_rescheduled,
          (SELECT COUNT(*) FROM clients WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as new_clients_30d
      `, [t, t, t, t, t, t, t]),

      // Sessions by week (last 12 weeks)
      pool.query(`
        SELECT YEARWEEK(date_time, 1) as yw,
               DATE_FORMAT(MIN(date_time), '%d/%m') as week_label,
               COUNT(*) as total,
               SUM(status = 'Completada') as completed,
               SUM(status = 'Cancelada') as cancelled,
               SUM(status = 'No-show') as noshow
        FROM appointments WHERE tenant_id = ? AND date_time >= DATE_SUB(NOW(), INTERVAL 12 WEEK)
        GROUP BY yw ORDER BY yw
      `, [t]),

      // Sessions by status
      pool.query(`
        SELECT status, COUNT(*) as count
        FROM appointments WHERE tenant_id = ?
        GROUP BY status ORDER BY count DESC
      `, [t]),

      // Clients by city
      pool.query(`
        SELECT COALESCE(city, 'Sin ciudad') as city, COUNT(*) as count
        FROM clients WHERE tenant_id = ? AND deleted_at IS NULL
        GROUP BY city ORDER BY count DESC
      `, [t]),

      // Clients by source
      pool.query(`
        SELECT COALESCE(source, 'Sin fuente') as source, COUNT(*) as count
        FROM clients WHERE tenant_id = ? AND deleted_at IS NULL
        GROUP BY source ORDER BY count DESC
      `, [t]),

      // Popular hours
      pool.query(`
        SELECT HOUR(date_time) as hour, COUNT(*) as count
        FROM appointments WHERE tenant_id = ? AND status IN ('Completada', 'Confirmada')
        GROUP BY hour ORDER BY hour
      `, [t]),

      // Client status distribution (calculated)
      pool.query(`
        SELECT
          SUM(CASE
            WHEN c.status_override = 'Archivado' THEN 0
            WHEN c.status_override IS NOT NULL THEN 0
            WHEN completed = 0 THEN 1 ELSE 0 END) as nuevos,
          SUM(CASE
            WHEN (future_appt > 0 OR last_completed > DATE_SUB(NOW(), INTERVAL 21 DAY)) AND completed < 10 THEN 1 ELSE 0 END) as activos,
          SUM(CASE
            WHEN (future_appt > 0 OR last_completed > DATE_SUB(NOW(), INTERVAL 21 DAY)) AND completed >= 10 THEN 1 ELSE 0 END) as recurrentes,
          SUM(CASE
            WHEN last_completed BETWEEN DATE_SUB(NOW(), INTERVAL 56 DAY) AND DATE_SUB(NOW(), INTERVAL 21 DAY) AND future_appt = 0 THEN 1 ELSE 0 END) as en_pausa,
          SUM(CASE
            WHEN last_completed < DATE_SUB(NOW(), INTERVAL 56 DAY) AND future_appt = 0 AND completed > 0 THEN 1 ELSE 0 END) as inactivos
        FROM clients c
        LEFT JOIN (
          SELECT client_id,
            COUNT(*) as completed,
            MAX(date_time) as last_completed
          FROM appointments WHERE status = 'Completada'
          GROUP BY client_id
        ) a ON a.client_id = c.id
        LEFT JOIN (
          SELECT client_id, COUNT(*) as future_appt
          FROM appointments WHERE status = 'Confirmada' AND date_time > NOW()
          GROUP BY client_id
        ) f ON f.client_id = c.id
        WHERE c.tenant_id = ? AND c.deleted_at IS NULL
      `, [t]),

      // Recent activity (last 10 appointments)
      pool.query(`
        SELECT a.date_time, a.status, c.first_name, c.last_name
        FROM appointments a JOIN clients c ON a.client_id = c.id
        WHERE a.tenant_id = ?
        ORDER BY a.created_at DESC LIMIT 10
      `, [t]),
    ]);

    res.json({
      totals: totals[0],
      sessions_by_week: sessionsByWeek,
      sessions_by_status: sessionsByStatus,
      clients_by_city: clientsByCity,
      clients_by_source: clientsBySource,
      popular_hours: popularHours,
      client_status_distribution: clientsByStatus[0] || {},
      recent_activity: recentActivity,
    });
  } catch (err) {
    console.error('[analytics] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
