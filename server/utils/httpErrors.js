const { isTrustedDevMode } = require('./devmode');

function shouldExposeErrorDetails(req) {
  return process.env.NODE_ENV !== 'production' || isTrustedDevMode(req) || process.env.EXPOSE_ERROR_DETAILS === '1';
}

function formatErrorDetails(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

function sendServerError(res, req, err, options = {}) {
  const {
    status = 500,
    message = 'Error interno',
    logLabel = 'server',
    extra = null,
  } = options;

  console.error(`[${logLabel}]`, err?.stack || err?.message || err);

  const payload = { error: message };
  if (extra && typeof extra === 'object') {
    Object.assign(payload, extra);
  }

  if (shouldExposeErrorDetails(req)) {
    payload.details = formatErrorDetails(err);
  }

  return res.status(status).json(payload);
}

module.exports = {
  sendServerError,
  shouldExposeErrorDetails,
};
