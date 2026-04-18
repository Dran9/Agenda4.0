const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPublicRoute } = require('../server/middleware/authGate');

function mockReq(method, path) {
  return { method, path };
}

// Rutas públicas esperadas

test('authGate: booking público es público', () => {
  assert.equal(isPublicRoute(mockReq('POST', '/api/book')), true);
  assert.equal(isPublicRoute(mockReq('POST', '/api/reschedule')), true);
  assert.equal(isPublicRoute(mockReq('POST', '/api/client/check')), true);
});

test('authGate: login público', () => {
  assert.equal(isPublicRoute(mockReq('POST', '/api/auth/login')), true);
  assert.equal(isPublicRoute(mockReq('POST', '/api/auth/voice-login')), true);
  assert.equal(isPublicRoute(mockReq('POST', '/api/auth/admin-login')), true);
});

test('authGate: webhook Meta público (verifica HMAC internamente)', () => {
  assert.equal(isPublicRoute(mockReq('GET', '/api/webhook')), true);
  assert.equal(isPublicRoute(mockReq('POST', '/api/webhook')), true);
  assert.equal(isPublicRoute(mockReq('POST', '/api/webhook/')), true);
});

test('authGate: slots y config públicos GET', () => {
  assert.equal(isPublicRoute(mockReq('GET', '/api/slots')), true);
  assert.equal(isPublicRoute(mockReq('GET', '/api/slots/batch')), true);
  assert.equal(isPublicRoute(mockReq('GET', '/api/config/public')), true);
  assert.equal(isPublicRoute(mockReq('GET', '/api/config/qr/capital')), true);
});

test('authGate: voice shortcut tiene su propia auth', () => {
  assert.equal(isPublicRoute(mockReq('POST', '/api/voice/shortcut')), true);
});

test('authGate: health público', () => {
  assert.equal(isPublicRoute(mockReq('GET', '/api/health')), true);
});

// Rutas admin — NUNCA públicas

test('authGate: admin routes son privadas', () => {
  assert.equal(isPublicRoute(mockReq('POST', '/api/admin/book')), false);
  assert.equal(isPublicRoute(mockReq('POST', '/api/admin/reschedule')), false);
  assert.equal(isPublicRoute(mockReq('GET', '/api/admin/events')), false);
  assert.equal(isPublicRoute(mockReq('GET', '/api/admin/test-reminder')), false);
});

test('authGate: clients, appointments, payments requieren auth', () => {
  assert.equal(isPublicRoute(mockReq('GET', '/api/clients')), false);
  assert.equal(isPublicRoute(mockReq('PUT', '/api/clients/5')), false);
  assert.equal(isPublicRoute(mockReq('GET', '/api/appointments')), false);
  assert.equal(isPublicRoute(mockReq('PUT', '/api/payments/3/status')), false);
});

test('authGate: métodos incorrectos no filtran', () => {
  // POST /api/slots no debería filtrar como público (solo GET lo es)
  assert.equal(isPublicRoute(mockReq('POST', '/api/slots')), false);
  // GET /api/book no existe, pero tampoco debe colarse por el patrón POST
  assert.equal(isPublicRoute(mockReq('GET', '/api/book')), false);
});

test('authGate: path traversal no engaña el whitelist', () => {
  assert.equal(isPublicRoute(mockReq('GET', '/api/health/../clients')), false);
  assert.equal(isPublicRoute(mockReq('GET', '/api/webhook/secret')), false);
  assert.equal(isPublicRoute(mockReq('GET', '/api/config/public/leak')), false);
});

test('authGate: rutas non-/api/ no le interesan al gate (ruta estática del cliente)', () => {
  // isPublicRoute solo se pregunta si /api/* es pública. Las rutas fuera de /api
  // el gate mismo las deja pasar sin chequear isPublicRoute.
  // Este test documenta que isPublicRoute devuelve false para paths no-api
  // (el gate no las ve como "públicas" pero tampoco les aplica auth — las ignora).
  assert.equal(isPublicRoute(mockReq('GET', '/assets/logo.png')), false);
  assert.equal(isPublicRoute(mockReq('GET', '/')), false);
});
