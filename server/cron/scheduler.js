const { pool } = require('../db');
const { checkAndSendReminders } = require('../services/reminder');

let reminderTimer = null;

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

module.exports = { startReminderCron, stopReminderCron };
