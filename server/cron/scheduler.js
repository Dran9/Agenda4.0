const { pool, withTransaction, withAdvisoryLock } = require('../db');
const { syncSlotClaimsForStatusTransition } = require('../services/appointmentSlotClaims');
const { checkAndSendReminders, checkAndSendPaymentReminders } = require('../services/reminder');
const { syncRecurringFromGCal } = require('../services/recurringSync');

let reminderTimer = null;
let autoCompleteTimer = null;
let paymentReminderTimer = null;
let recurringSyncTimer = null;
let metaHealthWatchdogTimer = null;

const LA_PAZ_TIMEZONE = 'America/La_Paz';
const DEFAULT_REMINDER_TIME = '18:40';

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
  metaHealthWatchdog: {
    label: 'Meta health watchdog',
    source: 'internal_timer',
    intervalMinutes: 60,
    enabled: null,
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  },
};

function getNowInLaPaz() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: LA_PAZ_TIMEZONE }));
}

function getDateKeyInLaPaz(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_PAZ_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function parseReminderTime(reminderTime = DEFAULT_REMINDER_TIME) {
  const [rawHours, rawMinutes] = String(reminderTime || DEFAULT_REMINDER_TIME).split(':').map(Number);
  const hours = Number.isInteger(rawHours) && rawHours >= 0 && rawHours <= 23 ? rawHours : 18;
  const minutes = Number.isInteger(rawMinutes) && rawMinutes >= 0 && rawMinutes <= 59 ? rawMinutes : 40;
  return { hours, minutes };
}

function getReminderTargetForToday(nowLP, reminderTime = DEFAULT_REMINDER_TIME) {
  const target = new Date(nowLP);
  const { hours, minutes } = parseReminderTime(reminderTime);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

function shouldRunAppointmentReminderNow({
  nowLP = getNowInLaPaz(),
  reminderTime = DEFAULT_REMINDER_TIME,
  lastRunAt = null,
} = {}) {
  const todayKey = getDateKeyInLaPaz(nowLP);
  if (!todayKey) return false;

  const lastRunKey = getDateKeyInLaPaz(lastRunAt);
  if (lastRunKey === todayKey) return false;

  return nowLP >= getReminderTargetForToday(nowLP, reminderTime);
}

function getNextReminderDelayMs({
  nowLP = getNowInLaPaz(),
  reminderTime = DEFAULT_REMINDER_TIME,
  lastRunAt = null,
} = {}) {
  if (shouldRunAppointmentReminderNow({ nowLP, reminderTime, lastRunAt })) {
    return 0;
  }

  const todayTarget = getReminderTargetForToday(nowLP, reminderTime);
  const lastRunKey = getDateKeyInLaPaz(lastRunAt);
  const todayKey = getDateKeyInLaPaz(nowLP);
  const nextTarget = new Date(todayTarget);

  if (nowLP >= todayTarget || (todayKey && lastRunKey === todayKey)) {
    nextTarget.setDate(nextTarget.getDate() + 1);
  }

  return Math.max(60 * 1000, nextTarget - nowLP);
}

async function evaluateAppointmentReminderDueState(tenantId) {
  const [rows] = await pool.query(
    `SELECT reminder_time, reminder_enabled, last_appointment_reminder_run_at
     FROM config
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );

  const cfg = rows[0] || null;
  const reminderTime = cfg?.reminder_time || DEFAULT_REMINDER_TIME;
  const enabled = !!cfg?.reminder_enabled;
  const lastRunAt = cfg?.last_appointment_reminder_run_at || null;
  const nowLP = getNowInLaPaz();

  return {
    cfg,
    enabled,
    reminderTime,
    lastRunAt,
    nowLP,
    shouldRunNow: enabled && shouldRunAppointmentReminderNow({
      nowLP,
      reminderTime,
      lastRunAt,
    }),
  };
}

async function runDueAppointmentReminder(tenantId) {
  return withAdvisoryLock(`appointment-reminder:${tenantId}`, 5, async () => {
    const state = await evaluateAppointmentReminderDueState(tenantId);
    if (!state.shouldRunNow) return { executed: false, ...state };

    console.log('[cron] Running reminder check...');
    const result = await checkAndSendReminders({ date: 'tomorrow', tenantId });
    await pool.query(
      'UPDATE config SET last_appointment_reminder_run_at = NOW() WHERE tenant_id = ?',
      [tenantId]
    );

    const executedAt = new Date();
    return {
      executed: true,
      ...state,
      lastRunAt: executedAt,
      nowLP: getNowInLaPaz(),
      result,
    };
  });
}

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
      `SELECT a.id, a.client_id, a.tenant_id, a.date_time, a.duration, a.status, c.fee, c.fee_currency
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE a.status IN ('Agendada','Confirmada','Reagendada')
         AND DATE_ADD(a.date_time, INTERVAL COALESCE(a.duration, 60) MINUTE) < DATE_SUB(NOW(), INTERVAL 1 HOUR)`
    );

    if (appts.length === 0) return { completed: 0 };

    for (const appt of appts) {
      await withTransaction(async (conn) => {
        await conn.query('UPDATE appointments SET status = ? WHERE id = ?', ['Completada', appt.id]);
        await syncSlotClaimsForStatusTransition(conn, appt, 'Completada');

        // Create pending payment if none exists
        const [existing] = await conn.query('SELECT id FROM payments WHERE appointment_id = ?', [appt.id]);
        if (existing.length === 0) {
          await conn.query(
            `INSERT INTO payments (tenant_id, client_id, appointment_id, amount, currency, status)
             VALUES (?, ?, ?, ?, ?, 'Pendiente')`,
            [
              appt.tenant_id,
              appt.client_id,
              appt.id,
              Number(appt.fee || 250),
              String(appt.fee_currency || 'BOB').toUpperCase(),
            ]
          );
        }
      });
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
      const runState = await runDueAppointmentReminder(1);
      const reminderTime = runState.reminderTime || DEFAULT_REMINDER_TIME;

      if (!runState.enabled) {
        console.log('[cron] Reminders disabled, checking again in 1 hour');
        const delay = 60 * 60 * 1000;
        schedulerState.appointmentReminder.enabled = false;
        setNextRun('appointmentReminder', delay);
        reminderTimer = setTimeout(scheduleNext, delay);
        return;
      }

      if (runState.executed) {
        console.log(
          `[cron] Reminders: sent=${runState.result.sent}, skipped=${runState.result.skipped}, total=${runState.result.total}`
        );
        markSuccess('appointmentReminder', runState.result, true);
      }

      const msUntil = getNextReminderDelayMs({
        nowLP: getNowInLaPaz(),
        reminderTime,
        lastRunAt: runState.lastRunAt,
      });

      console.log(`[cron] Next reminder check at ${reminderTime} BOT (in ${Math.round(msUntil / 60000)} min)`);
      schedulerState.appointmentReminder.enabled = true;
      setNextRun('appointmentReminder', msUntil);
      reminderTimer = setTimeout(scheduleNext, msUntil);
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

function startMetaHealthWatchdogCron() {
  async function run() {
    try {
      const { runMetaHealthWatchdogForDueTenants } = require('../services/metaHealth');
      const result = await runMetaHealthWatchdogForDueTenants();
      markSuccess('metaHealthWatchdog', result, true);
    } catch (err) {
      console.error('[cron] Meta health watchdog error:', err.message);
      markError('metaHealthWatchdog', err, true);
    }

    const delay = 60 * 60 * 1000;
    setNextRun('metaHealthWatchdog', delay);
    metaHealthWatchdogTimer = setTimeout(run, delay);
  }

  const initialDelay = 5 * 60 * 1000;
  schedulerState.metaHealthWatchdog.enabled = true;
  setNextRun('metaHealthWatchdog', initialDelay);
  metaHealthWatchdogTimer = setTimeout(run, initialDelay);
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

function stopMetaHealthWatchdogCron() {
  if (metaHealthWatchdogTimer) clearTimeout(metaHealthWatchdogTimer);
  metaHealthWatchdogTimer = null;
  schedulerState.metaHealthWatchdog.nextRunAt = null;
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
  startMetaHealthWatchdogCron,
  stopMetaHealthWatchdogCron,
  refreshConfigSchedulers,
  getSchedulerRuntime,
  getDateKeyInLaPaz,
  parseReminderTime,
  shouldRunAppointmentReminderNow,
  getNextReminderDelayMs,
};
