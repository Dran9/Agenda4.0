const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getDateKeyInLaPaz,
  parseReminderTime,
  shouldRunAppointmentReminderNow,
  getNextReminderDelayMs,
} = require('../server/cron/scheduler');

test('parseReminderTime: usa fallback cuando el valor es inválido', () => {
  assert.deepEqual(parseReminderTime('18:30'), { hours: 18, minutes: 30 });
  assert.deepEqual(parseReminderTime('xx'), { hours: 18, minutes: 40 });
});

test('getDateKeyInLaPaz: conserva la fecha Bolivia aunque el Date esté en UTC', () => {
  assert.equal(getDateKeyInLaPaz(new Date('2026-04-24T00:30:00Z')), '2026-04-23');
  assert.equal(getDateKeyInLaPaz(new Date('2026-04-24T04:30:00Z')), '2026-04-24');
});

test('shouldRunAppointmentReminderNow: corre solo una vez por día y solo después de la hora configurada', () => {
  const beforeDue = new Date('2026-04-23T22:29:00Z'); // 18:29 BOT
  const afterDue = new Date('2026-04-23T22:31:00Z'); // 18:31 BOT
  const ranToday = new Date('2026-04-23T22:30:05Z'); // 18:30:05 BOT

  assert.equal(
    shouldRunAppointmentReminderNow({ nowLP: beforeDue, reminderTime: '18:30', lastRunAt: null }),
    false
  );
  assert.equal(
    shouldRunAppointmentReminderNow({ nowLP: afterDue, reminderTime: '18:30', lastRunAt: null }),
    true
  );
  assert.equal(
    shouldRunAppointmentReminderNow({ nowLP: afterDue, reminderTime: '18:30', lastRunAt: ranToday }),
    false
  );
});

test('getNextReminderDelayMs: apunta a hoy antes de la hora y a mañana si ya corrió', () => {
  const beforeDue = new Date('2026-04-23T22:00:00Z'); // 18:00 BOT
  const afterRun = new Date('2026-04-23T23:00:00Z'); // 19:00 BOT
  const ranToday = new Date('2026-04-23T22:30:05Z'); // 18:30:05 BOT

  const untilToday = getNextReminderDelayMs({
    nowLP: beforeDue,
    reminderTime: '18:30',
    lastRunAt: null,
  });
  assert.equal(untilToday, 30 * 60 * 1000);

  const untilTomorrow = getNextReminderDelayMs({
    nowLP: afterRun,
    reminderTime: '18:30',
    lastRunAt: ranToday,
  });
  assert.equal(untilTomorrow, (23 * 60 + 30) * 60 * 1000);
});
