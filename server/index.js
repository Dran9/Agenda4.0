require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { initializeDatabase } = require('./db');
const { startReminderCron, startAutoCompleteCron, startPaymentReminderCron } = require('./cron/scheduler');
const { isTrustedDevMode } = require('./utils/devmode');

// Routes
const bookingRoutes = require('./routes/booking');
const slotsRoutes = require('./routes/slots');
const configRoutes = require('./routes/config');
const clientsRoutes = require('./routes/clients');
const appointmentsRoutes = require('./routes/appointments');
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhook');
const analyticsRoutes = require('./routes/analytics');
const paymentsRoutes = require('./routes/payments');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const clientLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: isTrustedDevMode,
  message: { error: 'Demasiados intentos.' },
});

// ─── Reminder trigger (admin) ────────────────────────────────────
const { checkAndSendReminders, checkAndSendPaymentReminders } = require('./services/reminder');
const { authMiddleware } = require('./middleware/auth');

// ─── Mount routes ────────────────────────────────────────────────
app.use('/api', bookingRoutes);  // booking routes handle their own limiting
app.use('/api/slots', slotsRoutes);
app.use('/api', slotsRoutes); // /api/config/public lives here
app.use('/api/config', configRoutes);
app.use('/api/clients', clientsRoutes);  // admin routes — auth protects, no rate limit
app.use('/api/client', clientLimiter, clientsRoutes); // public /api/client/check — rate limited
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentsRoutes);

// ─── Admin reminder trigger (protected) ─────────────────────────
app.get('/api/admin/test-reminder', authMiddleware, async (req, res) => {
  try {
    const { date, force, appointment_id, client_id, phone } = req.query;
    const hasTarget = !!(appointment_id || client_id || phone);
    if (force === '1' && !hasTarget) {
      return res.status(400).json({ error: 'force=1 solo está permitido para envíos dirigidos' });
    }
    const result = await checkAndSendReminders({
      date: date || 'tomorrow',
      tenantId: req.tenantId,
      force: force === '1',
      appointmentId: appointment_id || null,
      clientId: client_id || null,
      phone: phone || null,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/test-payment-reminder', authMiddleware, async (req, res) => {
  try {
    const { force } = req.query;
    const result = await checkAndSendPaymentReminders({ tenantId: req.tenantId, force: force === '1' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: test Sheets connection (protected) ──────────────────
app.get('/api/admin/test-sheets', authMiddleware, async (req, res) => {
  try {
    const sheetsId = process.env.GOOGLE_SHEETS_ID;
    if (!sheetsId) return res.json({ error: 'GOOGLE_SHEETS_ID not set' });

    const { google } = require('googleapis');
    const { getOAuthClient } = require('./services/calendar');
    const sheets = google.sheets({ version: 'v4', auth: getOAuthClient() });

    const info = await sheets.spreadsheets.get({ spreadsheetId: sheetsId });
    res.json({
      ok: true,
      title: info.data.properties.title,
      sheets: info.data.sheets.map(s => s.properties.title),
    });
  } catch (err) {
    res.json({ error: err.message, code: err.code });
  }
});


// ─── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '4.0.0', timestamp: new Date().toISOString() });
});

app.get('/api/static/reminder-header.png', (req, res) => {
  const reminderHeaderPath = path.join(__dirname, '..', 'client', 'public', 'favicon-ladrillo.png');
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(reminderHeaderPath);
});

// ─── Serve client build ──────────────────────────────────────────
const distPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  // LiteSpeed ignores Cache-Control — must use its own header
  app.use((req, res, next) => {
    res.set('X-LiteSpeed-Cache-Control', 'no-cache');
    next();
  });
  app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: 0, etag: false }));
  app.use(express.static(distPath, { maxAge: 0, etag: false }));
}


// ─── SPA fallback ────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    // Read fresh from disk every time (no sendFile cache)
    const html = fs.readFileSync(indexPath, 'utf-8');
    res.set('Content-Type', 'text/html; charset=UTF-8');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('X-LiteSpeed-Cache-Control', 'no-cache');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.send(html);
  } else {
    res.send('Agenda 4.0 — server running. Client build pending.');
  }
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initializeDatabase();
    startReminderCron();
    startPaymentReminderCron();
    startAutoCompleteCron();
    app.listen(PORT, () => {
      console.log(`Agenda 4.0 running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
