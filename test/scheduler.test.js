const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getDateKeyInLaPaz,
  parseReminderTime,
} = require('../server/cron/scheduler');

test('parseReminderTime: usa fallback cuando el valor es inválido', () => {
  assert.deepEqual(parseReminderTime('18:30'), { hours: 18, minutes: 30 });
  assert.deepEqual(parseReminderTime('xx'), { hours: 18, minutes: 40 });
});

test('getDateKeyInLaPaz: conserva la fecha Bolivia aunque el Date esté en UTC', () => {
  assert.equal(getDateKeyInLaPaz(new Date('2026-04-24T00:30:00Z')), '2026-04-23');
  assert.equal(getDateKeyInLaPaz(new Date('2026-04-24T04:30:00Z')), '2026-04-24');
});
