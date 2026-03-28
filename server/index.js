require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { initializeDatabase } = require('./db');
const { startReminderCron } = require('./cron/scheduler');

// Routes
const bookingRoutes = require('./routes/booking');
const slotsRoutes = require('./routes/slots');
const configRoutes = require('./routes/config');
const clientsRoutes = require('./routes/clients');
const appointmentsRoutes = require('./routes/appointments');
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhook');
const analyticsRoutes = require('./routes/analytics');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ─── Rate limiter for client check ───────────────────────────────
function isDevMode(req) {
  return req.query.devmode === '1';
}

const clientLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: isDevMode,
  message: { error: 'Demasiados intentos.' },
});

// ─── Reminder trigger (admin) ────────────────────────────────────
const { checkAndSendReminders } = require('./services/reminder');

// ─── Mount routes ────────────────────────────────────────────────
app.use('/api', bookingRoutes);  // booking routes handle their own limiting
app.use('/api/slots', slotsRoutes);
app.use('/api', slotsRoutes); // /api/config/public lives here
app.use('/api/config', configRoutes);
app.use('/api/clients', clientLimiter, clientsRoutes);
app.use('/api/client', clientLimiter, clientsRoutes); // /api/client/check
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/analytics', analyticsRoutes);

// ─── Admin reminder trigger ─────────────────────────────────────
app.get('/api/admin/test-reminder', async (req, res) => {
  try {
    const { date, force } = req.query; // 'today' or 'tomorrow', force=1 to skip dedup
    const result = await checkAndSendReminders({ date: date || 'tomorrow', tenantId: 1, force: force === '1' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Debug: test Sheets connection ───────────────────────────────
app.get('/api/admin/test-sheets', async (req, res) => {
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
      sheetsId,
    });
  } catch (err) {
    res.json({ error: err.message, code: err.code });
  }
});


// ─── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', timestamp: new Date().toISOString() });
});

// ─── Serve client build ──────────────────────────────────────────
const distPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ─── Debug env (TEMPORARY — remove after fixing OAuth) ──────────
app.get('/api/debug-env', (req, res) => {
  res.json({
    GOOGLE_CLIENT_ID_len: (process.env.GOOGLE_CLIENT_ID || '').length,
    GOOGLE_CLIENT_SECRET_len: (process.env.GOOGLE_CLIENT_SECRET || '').length,
    GOOGLE_REFRESH_TOKEN_len: (process.env.GOOGLE_REFRESH_TOKEN || '').length,
    CALENDAR_ID: process.env.CALENDAR_ID || '(not set)',
    GOOGLE_CLIENT_ID_start: (process.env.GOOGLE_CLIENT_ID || '').substring(0, 15),
    GOOGLE_CLIENT_ID_end: (process.env.GOOGLE_CLIENT_ID || '').slice(-10),
  });
});

// ─── SPA fallback ────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Agenda 3.0 — server running. Client build pending.');
  }
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initializeDatabase();
    startReminderCron();
    app.listen(PORT, () => {
      console.log(`Agenda 3.0 running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
