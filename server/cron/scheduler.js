const { pool } = require('../db');
const { checkAndSendReminders } = require('../services/reminder');

let reminderTimer = null;
let autoCompleteTimer = null;

// Auto-complete appointments ~1h after their scheduled time
async function autoCompleteAppointments() {
  try {
    // Find appointments that ended >1h ago and are still Agendada/Confirmada
    const [appts] = await pool.query(
      `SELECT a.id, a.client_id, a.tenant_id, a.duration, c.fee
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE a.status IN ('Agendada','Confirmada')
         AND DATE_ADD(a.date_time, INTERVAL COALESCE(a.duration, 60) MINUTE) < DATE_SUB(NOW(), INTERVAL 1 HOUR)`
    );

    if (appts.length === 0) return { completed: 0 };

    for (const appt of appts) {
      await pool.query('UPDATE appointments SET status = ? WHERE id = ?', ['Completada', appt.id]);
      // Create pending payment if none exists
      const [existing] = await pool.query('SELECT id FROM payments WHERE appointment_id = ?', [appt.id]);
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO payments (tenant_id, client_id, appointment_id, amount, status)
           VALUES (?, ?, ?, ?, 'Pendiente')`,
          [appt.tenant_id, appt.client_id, appt.id, appt.fee || 250]
        );
      }
    }

    console.log(`[cron] Auto-completed ${appts.length} appointments`);
    return { completed: appts.length };
  } catch (err) {
    console.error('[cron] Auto-complete error:', err.message);
    return { completed: 0, error: err.message };
  }
}

function startAutoCompleteCron() {
  async function run() {
    await autoCompleteAppointments();
    // Run every hour
    autoCompleteTimer = setTimeout(run, 60 * 60 * 1000);
  }
  // First run after 5 minutes (let server warm up)
  autoCompleteTimer = setTimeout(run, 5 * 60 * 1000);
}

function startReminderCron() {
  async function scheduleNext() {
    try {
      // Get reminder time from config (default 18:40 BOT)
      const [rows] = await pool.query('SELECT reminder_time, reminder_enabled FROM config WHERE tenant_id = 1');
      const cfg = rows[0];

      if (!cfg?.reminder_enabled) {
        console.log('[cron] Reminders disabled, checking again in 1 hour');
        reminderTimer = setTimeout(scheduleNext, 60 * 60 * 1000);
        return;
      }

      const reminderTime = cfg?.reminder_time || '18:40';
      const [rH, rM] = reminderTime.split(':').map(Number);

      // Calculate next trigger time in La Paz
      const nowLP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
      const target = new Date(nowLP);
      target.setHours(rH, rM, 0, 0);

      // If already past today's time, schedule for tomorrow
      if (nowLP >= target) {
        target.setDate(target.getDate() + 1);
      }

      const msUntil = target - nowLP;
      console.log(`[cron] Next reminder check at ${reminderTime} BOT (in ${Math.round(msUntil / 60000)} min)`);

      reminderTimer = setTimeout(async () => {
        console.log('[cron] Running reminder check...');
        try {
          const result = await checkAndSendReminders({ date: 'tomorrow', tenantId: 1 });
          console.log(`[cron] Reminders: sent=${result.sent}, skipped=${result.skipped}, total=${result.total}`);
        } catch (err) {
          console.error('[cron] Reminder error:', err.message);
        }
        // Schedule next
        scheduleNext();
      }, msUntil);
    } catch (err) {
      console.error('[cron] Scheduler error:', err.message);
      reminderTimer = setTimeout(scheduleNext, 5 * 60 * 1000);
    }
  }

  scheduleNext();
}

function stopReminderCron() {
  if (reminderTimer) clearTimeout(reminderTimer);
}

function stopAutoCompleteCron() {
  if (autoCompleteTimer) clearTimeout(autoCompleteTimer);
}

module.exports = { startReminderCron, stopReminderCron, startAutoCompleteCron, stopAutoCompleteCron };
