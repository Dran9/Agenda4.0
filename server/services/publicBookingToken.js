const jwt = require('jsonwebtoken');

const PURPOSE = 'public_reschedule';
const EXPIRES_IN = '2h';

function getPublicFlowSecret() {
  return process.env.JWT_SECRET || process.env.WA_VERIFY_TOKEN || process.env.ADMIN_PASSWORD || null;
}

function createPublicRescheduleToken({ tenantId, clientId, appointmentId, phone }) {
  const secret = getPublicFlowSecret();
  if (!secret) throw new Error('No hay secreto configurado para proteger la reagenda pública');

  return jwt.sign(
    {
      purpose: PURPOSE,
      tenantId,
      clientId,
      appointmentId,
      phone: String(phone),
    },
    secret,
    { expiresIn: EXPIRES_IN }
  );
}

function verifyPublicRescheduleToken(token) {
  const secret = getPublicFlowSecret();
  if (!secret) throw new Error('No hay secreto configurado para proteger la reagenda pública');

  const decoded = jwt.verify(token, secret);
  if (decoded?.purpose !== PURPOSE) {
    throw new Error('Token de reagenda inválido');
  }
  return decoded;
}

module.exports = {
  createPublicRescheduleToken,
  verifyPublicRescheduleToken,
};
