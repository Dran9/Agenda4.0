const { pool } = require('../db');
const { checkAndSendReminders, checkAndSendPaymentReminders } = require('../services/reminder');
const { syncRecurringFromGCal } = require('../services/recurringSync');

let reminderTimer = null;
let autoCompleteTimer = null;
let paymentReminderTimer = null;
let recurringSyncTimer = null;

const schedulerState = {
  appointmentReminder: {
    label: 'Recordatorios de cita',
    source: 'internal_timer',
    intervalMinutes: 1440,
    enabled: null,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  },
  paymentReminder: {
    label: 'Recordatorios de pago',
    source: 'internal_timer',
    intervalMinutes: 15,
    enabled: null,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  },
  autoComplete: {
    label: 'Auto completar sesiones',
    source: 'internal_timer',
    intervalMinutes: 60,
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  },
  recurringSync: {
    label: 'Sync de recurrencia',
    source: 'internal_timer',
    intervalMinutes: 1440,
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  },
};

function setNextRun(key, msFromNow) {
  schedulerState[key].nextRunAt = new Date(Date.now() + msFromNow).toISOString();
}

function markSuccess(key, result, enabled = schedulerState[key].enabled) {
  schedulerState[key].enabled = enabled;
  schedulerState[key].lastRunAt = new Date().toISOString();
  schedulerState[key].lastResult = result;
  schedulerState[key].lastError = null;
}

function markError(key, err, enabled = schedulerState[key].enabled) {
  schedulerState[key].enabled = enabled;
  schedulerState[key].lastRunAt = new Date().toISOString();
  schedulerState[key].lastError = err?.message || String(err);
}

// Auto-complete appointments ~1h after their scheduled time
async function autoCompleteAppointments() {
  try {
    // Find appointments that ended >1h ago and are still pending completion
    const [appts] = await pool.query(
      `SELECT a.id, a.client_id, a.tenant_id, a.duration, c.fee
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE a.status IN ('Agendada','Confirmada','Reagendada')
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
    try {
      const result = await autoCompleteAppointments();
      markSuccess('autoComplete', result, true);
    } catch (err) {
      markError('autoComplete', err, true);
    }
    // Run every hour
    const delay = 60 * 60 * 1000;
    setNextRun('autoComplete', delay);
    autoCompleteTimer = setTimeout(run, delay);
  }
  // First run after 5 minutes (let server warm up)
  const initialDelay = 5 * 60 * 1000;
  setNextRun('autoComplete', initialDelay);
  autoCompleteTimer = setTimeout(run, initialDelay);
}

function startReminderCron() {
  async function scheduleNext() {
    try {
      // Get reminder time from config (default 18:40 BOT)
      const [rows] = await pool.query('SELECT reminder_time, reminder_enabled FROM config WHERE tenant_id = 1');
      const cfg = rows[0];

      if (!cfg?.reminder_enabled) {
        console.log('[cron] Reminders disabled, checking again in 1 hour');
        const delay = 60 * 60 * 1000;
        schedulerState.appointmentReminder.enabled = false;
        setNextRun('appointmentReminder', delay);
        reminderTimer = setTimeout(scheduleNext, delay);
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
      schedulerState.appointmentReminder.enabled = true;
      setNextRun('appointmentReminder', msUntil);

      reminderTimer = setTimeout(async () => {
        console.log('[cron] Running reminder check...');
        try {
          const result = await checkAndSendReminders({ date: 'tomorrow', tenantId: 1 });
          console.log(`[cron] Reminders: sent=${result.sent}, skipped=${result.skipped}, total=${result.total}`);
          markSuccess('appointmentReminder', result, true);
        } catch (err) {
          console.error('[cron] Reminder error:', err.message);
          markError('appointmentReminder', err, true);
        }
        // Schedule next
        scheduleNext();
      }, msUntil);
    } catch (err) {
      console.error('[cron] Scheduler error:', err.message);
      markError('appointmentReminder', err, schedulerState.appointmentReminder.enabled);
      const delay = 5 * 60 * 1000;
      setNextRun('appointmentReminder', delay);
      reminderTimer = setTimeout(scheduleNext, delay);
    }
  }

  scheduleNext();
}

function startPaymentReminderCron() {
  async function run() {
    try {
      const result = await checkAndSendPaymentReminders({ tenantId: 1 });
      schedulerState.paymentReminder.enabled = !!result.enabled;
      markSuccess('paymentReminder', result, !!result.enabled);
      console.log(`[cron] Payment reminders: sent=${result.sent}, skipped=${result.skipped}, total=${result.total}`);
    } catch (err) {
      console.error('[cron] Payment reminder error:', err.message);
      markError('paymentReminder', err, schedulerState.paymentReminder.enabled);
    }

    const delay = 15 * 60 * 1000;
    setNextRun('paymentReminder', delay);
    paymentReminderTimer = setTimeout(run, delay);
  }

  const initialDelay = 2 * 60 * 1000;
  setNextRun('paymentReminder', initialDelay);
  paymentReminderTimer = setTimeout(run, initialDelay);
}

function startRecurringSyncCron() {
  async function scheduleNext() {
    try {
      const nowLP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/La_Paz' }));
      const target = new Date(nowLP);
      target.setHours(6, 0, 0, 0);

      if (nowLP >= target) {
        target.setDate(target.getDate() + 1);
      }

      const msUntil = target - nowLP;
      setNextRun('recurringSync', msUntil);
      recurringSyncTimer = setTimeout(async () => {
        try {
          const result = await syncRecurringFromGCal(1);
          console.log(
            `[cron] Recurring sync: created=${result.created}, already_exists=${result.already_exists}, no_client_match=${result.no_client_match}`
          );
          markSuccess('recurringSync', result, true);
        } catch (err) {
          console.error('[cron] Recurring sync error:', err.message);
          markError('recurringSync', err, true);
        }
        scheduleNext();
      }, msUntil);
    } catch (err) {
      console.error('[cron] Recurring sync scheduler error:', err.message);
      markError('recurringSync', err, true);
      const delay = 5 * 60 * 1000;
      setNextRun('recurringSync', delay);
      recurringSyncTimer = setTimeout(scheduleNext, delay);
    }
  }

  scheduleNext();
}

function stopReminderCron() {
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = null;
  schedulerState.appointmentReminder.nextRunAt = null;
}

function stopAutoCompleteCron() {
  if (autoCompleteTimer) clearTimeout(autoCompleteTimer);
  autoCompleteTimer = null;
  schedulerState.autoComplete.nextRunAt = null;
}

function stopPaymentReminderCron() {
  if (paymentReminderTimer) clearTimeout(paymentReminderTimer);
  paymentReminderTimer = null;
  schedulerState.paymentReminder.nextRunAt = null;
}

function stopRecurringSyncCron() {
  if (recurringSyncTimer) clearTimeout(recurringSyncTimer);
  recurringSyncTimer = null;
  schedulerState.recurringSync.nextRunAt = null;
}

function refreshConfigSchedulers() {
  stopReminderCron();
  stopPaymentReminderCron();
  startReminderCron();
  startPaymentReminderCron();
}

function getSchedulerRuntime() {
  return {
    serverTime: new Date().toISOString(),
    timezone: 'America/La_Paz',
    schedulers: JSON.parse(JSON.stringify(schedulerState)),
  };
}

module.exports = {
  startReminderCron,
  stopReminderCron,
  startAutoCompleteCron,
  stopAutoCompleteCron,
  startPaymentReminderCron,
  stopPaymentReminderCron,
  startRecurringSyncCron,
  stopRecurringSyncCron,
  refreshConfigSchedulers,
  getSchedulerRuntime,
};
