const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  paymentGoalSchema,
  paymentStatusSchema,
  appointmentStatusSchema,
  appointmentNotesSchema,
} = require('../server/middleware/validate');

// paymentGoalSchema ──────────────────────────────────────────────

test('paymentGoalSchema: acepta número positivo', () => {
  const r = paymentGoalSchema.safeParse({ goal: 5000 });
  assert.equal(r.success, true);
  assert.equal(r.data.goal, 5000);
});

test('paymentGoalSchema: acepta string numérico', () => {
  const r = paymentGoalSchema.safeParse({ goal: '3500' });
  assert.equal(r.success, true);
  assert.equal(r.data.goal, 3500);
});

test('paymentGoalSchema: null vacía la meta', () => {
  const r = paymentGoalSchema.safeParse({ goal: null });
  assert.equal(r.success, true);
  assert.equal(r.data.goal, null);
});

test('paymentGoalSchema: string vacío → null', () => {
  const r = paymentGoalSchema.safeParse({ goal: '' });
  assert.equal(r.success, true);
  assert.equal(r.data.goal, null);
});

test('paymentGoalSchema: rechaza negativo', () => {
  assert.equal(paymentGoalSchema.safeParse({ goal: -100 }).success, false);
});

test('paymentGoalSchema: rechaza fuera de rango', () => {
  assert.equal(paymentGoalSchema.safeParse({ goal: 5_000_000 }).success, false);
});

test('paymentGoalSchema: rechaza no-numérico', () => {
  assert.equal(paymentGoalSchema.safeParse({ goal: 'hola' }).success, false);
});

// paymentStatusSchema ────────────────────────────────────────────

test('paymentStatusSchema: acepta los 4 estados válidos', () => {
  for (const s of ['Pendiente', 'Confirmado', 'Rechazado', 'Mismatch']) {
    assert.equal(paymentStatusSchema.safeParse({ status: s }).success, true, `falla ${s}`);
  }
});

test('paymentStatusSchema: rechaza estado inventado', () => {
  assert.equal(paymentStatusSchema.safeParse({ status: 'Otro' }).success, false);
});

test('paymentStatusSchema: rechaza payload sin status', () => {
  assert.equal(paymentStatusSchema.safeParse({}).success, false);
});

// appointmentStatusSchema ────────────────────────────────────────

test('appointmentStatusSchema: acepta los 6 estados válidos', () => {
  for (const s of ['Agendada', 'Confirmada', 'Reagendada', 'Cancelada', 'Completada', 'No-show']) {
    assert.equal(appointmentStatusSchema.safeParse({ status: s }).success, true, `falla ${s}`);
  }
});

test('appointmentStatusSchema: rechaza estado inventado', () => {
  assert.equal(appointmentStatusSchema.safeParse({ status: 'Pagada' }).success, false);
});

// appointmentNotesSchema ─────────────────────────────────────────

test('appointmentNotesSchema: acepta nota normal', () => {
  const r = appointmentNotesSchema.safeParse({ notes: 'Paciente llega 10 min tarde.' });
  assert.equal(r.success, true);
});

test('appointmentNotesSchema: acepta null/ausente', () => {
  assert.equal(appointmentNotesSchema.safeParse({ notes: null }).success, true);
  assert.equal(appointmentNotesSchema.safeParse({}).success, true);
});

test('appointmentNotesSchema: rechaza nota > 5000 chars', () => {
  const r = appointmentNotesSchema.safeParse({ notes: 'x'.repeat(5001) });
  assert.equal(r.success, false);
});

test('appointmentNotesSchema: rechaza tipos no-string', () => {
  assert.equal(appointmentNotesSchema.safeParse({ notes: 123 }).success, false);
});
