const { authMiddleware } = require('./auth');

// Rutas públicas expuestas sin JWT. Agregar acá antes de crear un endpoint público nuevo.
// Las firmas (HMAC, rate-limit, tokens temporales, auth propia del endpoint) siguen
// aplicándose dentro de cada handler — la puerta solo verifica JWT.
const PUBLIC_ROUTES = [
  // Health
  { method: 'GET', pattern: /^\/api\/health$/ },

  // Auth
  { method: 'POST', pattern: /^\/api\/auth\/login$/ },
  { method: 'POST', pattern: /^\/api\/auth\/voice-login$/ },
  { method: 'POST', pattern: /^\/api\/auth\/admin-login$/ },
  { method: 'POST', pattern: /^\/api\/auth\/telegram$/ },

  // Booking público (rate-limited en el handler)
  { method: 'POST', pattern: /^\/api\/book$/ },
  { method: 'POST', pattern: /^\/api\/reschedule$/ },

  // Check público de cliente
  { method: 'POST', pattern: /^\/api\/client\/check$/ },

  // Slots y config pública (página de booking)
  { method: 'GET', pattern: /^\/api\/slots\/?$/ },
  { method: 'GET', pattern: /^\/api\/slots\/batch$/ },
  { method: 'GET', pattern: /^\/api\/slots\/config\/public$/ },
  { method: 'GET', pattern: /^\/api\/config\/public$/ },

  // QR públicos (se muestran en la página de booking)
  { method: 'GET', pattern: /^\/api\/config\/qr\/[^/]+$/ },

  // Webhooks Meta/Telegram (HMAC y token propios se verifican dentro del handler)
  { method: 'GET', pattern: /^\/api\/webhook\/?$/ },
  { method: 'POST', pattern: /^\/api\/webhook\/?$/ },
  { method: 'POST', pattern: /^\/api\/stripe\/webhook\/?$/ },

  // Voice shortcut (usa su propia auth tipo assertShortcutAuth)
  { method: 'POST', pattern: /^\/api\/voice\/shortcut$/ },
];

function isPublicRoute(req) {
  return PUBLIC_ROUTES.some((r) => r.method === req.method && r.pattern.test(req.path));
}

// Aplica authMiddleware por defecto a todo /api/* excepto las rutas explícitamente públicas.
// Si en el futuro alguien agrega un endpoint sin auth, este gate lo protege automáticamente.
function authGate(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (isPublicRoute(req)) return next();
  return authMiddleware(req, res, next);
}

module.exports = { authGate, PUBLIC_ROUTES, isPublicRoute };
