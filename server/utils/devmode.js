function isTrustedDevMode(req) {
  if (req?.query?.devmode !== '1') return false;

  const host = String(req.hostname || req.headers?.host || '')
    .split(':')[0]
    .trim()
    .toLowerCase();

  return process.env.ALLOW_DEVMODE_BYPASS === '1' || host === 'localhost' || host === '127.0.0.1';
}

module.exports = { isTrustedDevMode };
