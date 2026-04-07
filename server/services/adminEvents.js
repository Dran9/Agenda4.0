/**
 * Server-Sent Events (SSE) broadcast service for real-time admin updates.
 *
 * Usage — server side:
 *   const { broadcast } = require('./services/adminEvents');
 *   broadcast('appointment:change', { id: 42 });
 *
 * Usage — client side:
 *   const es = new EventSource('/api/admin/events', { headers … });
 *   es.addEventListener('appointment:change', (e) => { … });
 *
 * Each connected admin tab is held in a Set keyed by tenant so broadcasts
 * only reach admins of the same tenant.
 */

// Map<tenantId, Set<res>>
const tenantClients = new Map();

/**
 * SSE handler — call from Express route:
 *   app.get('/api/admin/events', authMiddleware, sseHandler);
 */
function sseHandler(req, res) {
  const tenantId = req.tenantId;

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx / LiteSpeed
  });
  res.flushHeaders();

  // Initial heartbeat so the client knows the connection is alive
  res.write(':ok\n\n');

  // Register
  if (!tenantClients.has(tenantId)) tenantClients.set(tenantId, new Set());
  tenantClients.get(tenantId).add(res);

  // Keep alive every 25 s (prevents proxy timeouts)
  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, 25000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    const set = tenantClients.get(tenantId);
    if (set) {
      set.delete(res);
      if (set.size === 0) tenantClients.delete(tenantId);
    }
  });
}

/**
 * Broadcast an event to all connected admin tabs of a tenant.
 *
 * @param {string} eventName  e.g. 'appointment:change', 'client:change'
 * @param {object} data       JSON-serialisable payload
 * @param {number} [tenantId] optional — omit to broadcast to ALL tenants
 */
function broadcast(eventName, data, tenantId) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data || {})}\n\n`;

  if (tenantId !== undefined) {
    const set = tenantClients.get(tenantId);
    if (set) set.forEach((res) => res.write(payload));
  } else {
    // Broadcast to every tenant (rare)
    for (const set of tenantClients.values()) {
      set.forEach((res) => res.write(payload));
    }
  }
}

/**
 * How many admin tabs are currently connected (useful for health checks).
 */
function connectedCount(tenantId) {
  if (tenantId !== undefined) return tenantClients.get(tenantId)?.size || 0;
  let n = 0;
  for (const set of tenantClients.values()) n += set.size;
  return n;
}

module.exports = { sseHandler, broadcast, connectedCount };
