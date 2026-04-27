const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecurringReschedulePrompt } = require('../server/services/recurringReschedulePrompt');

test('buildRecurringReschedulePrompt: renders the selected copy with schedule details', () => {
  const message = buildRecurringReschedulePrompt(
    { first_name: 'Valentina', last_name: 'Nunez' },
    { day_of_week: 4, time: '19:00' }
  );

  assert.match(message, /^Valentina, qué tal\./);
  assert.match(message, /todos los jueves a las 19:00/);
  assert.match(message, /has reprogramado las últimas 2/);
  assert.match(message, /algo puntual/);
  assert.match(message, /día y la hora que tienes fijos/);
});
