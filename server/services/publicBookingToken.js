const jwt = require('jsonwebtoken');

const RESCHEDULE_PURPOSE = 'public_reschedule';
const RESCHEDULE_EXPIRES_IN = '2h';
const FEE_PURPOSE = 'public_fee';
const FEE_EXPIRES_IN = '30d';

function getPublicFlowSecret() {
  return process.env.JWT_SECRET || process.env.WA_VERIFY_TOKEN || process.env.ADMIN_PASSWORD || null;
}

function createPublicRescheduleToken({ tenantId, clientId, appointmentId, phone }) {
  const secret = getPublicFlowSecret();
  if (!secret) throw new Error('No hay secreto configurado para proteger la reagenda pública');

  return jwt.sign(
    {
      purpose: RESCHEDULE_PURPOSE,
      tenantId,
      clientId,
      appointmentId,
      phone: String(phone),
    },
    secret,
    { expiresIn: RESCHEDULE_EXPIRES_IN }
  );
}

function verifyPublicRescheduleToken(token) {
  const secret = getPublicFlowSecret();
  if (!secret) throw new Error('No hay secreto configurado para proteger la reagenda pública');

  const decoded = jwt.verify(token, secret);
  if (decoded?.purpose !== RESCHEDULE_PURPOSE) {
    throw new Error('Token de reagenda inválido');
  }
  return decoded;
}

function createPublicFeeToken({ tenantId, phone, feeMode = 'pe' }) {
  const secret = getPublicFlowSecret();
  if (!secret) throw new Error('No hay secreto configurado para proteger el precio especial');

  return jwt.sign(
    {
      purpose: FEE_PURPOSE,
      tenantId,
      phone: String(phone),
      feeMode,
    },
    secret,
    { expiresIn: FEE_EXPIRES_IN }
  );
}

function verifyPublicFeeToken(token) {
  const secret = getPublicFlowSecret();
  if (!secret) throw new Error('No hay secreto configurado para proteger el precio especial');

  const decoded = jwt.verify(token, secret);
  if (decoded?.purpose !== FEE_PURPOSE) {
    throw new Error('Token de precio especial inválido');
  }
  return decoded;
}

module.exports = {
  createPublicRescheduleToken,
  verifyPublicRescheduleToken,
  createPublicFeeToken,
  verifyPublicFeeToken,
};
