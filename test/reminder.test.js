const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getDateKeyInTimeZone,
  getTargetDateKeyForTimezone,
  getEventDateKeyInTimeZone,
  getTimeKeyInTimeZone,
  hasRecentPaymentProof,
  isReminderDueForTimezone,
} = require('../server/services/reminder');

test('appointment reminders use the client timezone day and configured local time', () => {
  const saturdayReminderRun = new Date('2026-04-25T22:30:00Z'); // 18:30 Bolivia, 00:30 Sunday Madrid
  const sundayMadridReminderRun = new Date('2026-04-26T16:30:00Z'); // 18:30 Madrid

  assert.equal(getDateKeyInTimeZone(saturdayReminderRun, 'Europe/Madrid'), '2026-04-26');
  assert.equal(getTimeKeyInTimeZone(saturdayReminderRun, 'Europe/Madrid'), '00:30');
  assert.equal(getTargetDateKeyForTimezone('tomorrow', 'Europe/Madrid', sundayMadridReminderRun), '2026-04-27');
});

test('Madrid Monday appointment is due Sunday 18:30 Madrid, not Saturday 18:30 Bolivia', () => {
  const mondayAppointment = {
    start: { dateTime: '2026-04-27T16:00:00-04:00' },
  };
  const saturdayReminderRun = new Date('2026-04-25T22:30:00Z');
  const sundayBeforeReminder = new Date('2026-04-26T16:29:00Z');
  const sundayReminderRun = new Date('2026-04-26T16:30:00Z');

  assert.equal(
    getEventDateKeyInTimeZone(mondayAppointment, 'Europe/Madrid'),
    '2026-04-27'
  );
  assert.equal(isReminderDueForTimezone({
    event: mondayAppointment,
    timeZone: 'Europe/Madrid',
    date: 'tomorrow',
    reminderTime: '18:30',
    now: saturdayReminderRun,
  }), false);
  assert.equal(isReminderDueForTimezone({
    event: mondayAppointment,
    timeZone: 'Europe/Madrid',
    date: 'tomorrow',
    reminderTime: '18:30',
    now: sundayBeforeReminder,
  }), false);
  assert.equal(isReminderDueForTimezone({
    event: mondayAppointment,
    timeZone: 'Europe/Madrid',
    date: 'tomorrow',
    reminderTime: '18:30',
    now: sundayReminderRun,
  }), true);
});

test('hasRecentPaymentProof: skips payment reminders after a received receipt', () => {
  assert.equal(hasRecentPaymentProof(new Date('2026-06-08T21:04:55.000Z')), true);
  assert.equal(hasRecentPaymentProof('2026-06-08 17:04:55'), true);
  assert.equal(hasRecentPaymentProof(null), false);
});
