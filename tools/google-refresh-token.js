#!/usr/bin/env node
require('dotenv').config();

const http = require('http');
const { execFile } = require('child_process');
const { google } = require('googleapis');

const DEFAULT_PORT = 42813;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printHeader() {
  console.log('\nAgenda 4.0 — Google refresh token generator');
  console.log('Scopes:');
  for (const scope of SCOPES) console.log(`- ${scope}`);
  console.log('');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} no está definido en el env donde estás corriendo este script.`);
  }
  return value;
}

function openBrowser(url) {
  if (hasFlag('no-open')) return;

  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];

  execFile(command, args, (err) => {
    if (err) {
      console.log('No pude abrir el navegador automáticamente. Abre esta URL manualmente:');
      console.log(url);
    }
  });
}

function createOAuthClient() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const port = Number(getArg('port', process.env.GOOGLE_OAUTH_PORT || DEFAULT_PORT));
  const redirectUri = getArg(
    'redirect-uri',
    process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://127.0.0.1:${port}/oauth2callback`
  );

  return {
    port,
    redirectUri,
    oauth2Client: new google.auth.OAuth2(clientId, clientSecret, redirectUri),
  };
}

function buildAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
  });
}

async function exchangeCode(oauth2Client, code) {
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google no devolvió refresh_token. Revoca el acceso anterior de la app en tu cuenta Google y vuelve a intentar con prompt=consent.'
    );
  }

  console.log('\nNuevo env para Hostinger:');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nNo compartas este valor. Pégalo en el env del servidor y reinicia la app.');
}

async function runManualCodeMode() {
  const code = getArg('code');
  if (!code) return false;

  printHeader();
  const { oauth2Client, redirectUri } = createOAuthClient();
  console.log(`Redirect URI usado: ${redirectUri}`);
  await exchangeCode(oauth2Client, code);
  return true;
}

async function runInteractiveMode() {
  printHeader();
  const { oauth2Client, port, redirectUri } = createOAuthClient();
  const authUrl = buildAuthUrl(oauth2Client);

  console.log(`Redirect URI usado: ${redirectUri}`);
  console.log('\nSi Google muestra redirect_uri_mismatch, agrega ese Redirect URI al OAuth Client en Google Cloud.');
  console.log('\nAbriendo autorización de Google...');
  console.log(authUrl);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== new URL(redirectUri).pathname) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        throw new Error(`Google OAuth error: ${error}`);
      }

      const code = url.searchParams.get('code');
      if (!code) {
        throw new Error('Google no devolvió code en el callback.');
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Token recibido. Puedes volver a Codex/Terminal.');

      await exchangeCode(oauth2Client, code);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.message);
      console.error(`\nError: ${err.message}`);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  openBrowser(authUrl);
}

(async () => {
  try {
    if (await runManualCodeMode()) return;
    await runInteractiveMode();
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    console.error('\nUso:');
    console.error('  npm run google:refresh-token');
    console.error('  npm run google:refresh-token -- --no-open');
    console.error('  npm run google:refresh-token -- --code=AUTH_CODE');
    process.exit(1);
  }
})();
