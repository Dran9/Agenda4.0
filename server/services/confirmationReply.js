const { isBoliviaCountry, resolveForeignPricingProfile } = require('./clientPricing');

function parseBookingContext(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function formatFirstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function hasBoliviaPaymentSignal(appointment = {}) {
  const bookingContext = parseBookingContext(appointment.booking_context);
  const normalizedPhone = String(appointment.client_phone || appointment.phone || '').replace(/\D/g, '');
  const isBoliviaPhone = normalizedPhone.startsWith('591');
  const ipCountryCode = String(bookingContext?.ip_country_code || '').toUpperCase();
  const locationCountryCode = String(bookingContext?.location_country_code || '').toUpperCase();
  const rawClientCountry = String(appointment.client_country || appointment.country || '').trim();
  const clientCountry = rawClientCountry.toUpperCase();
  const hasClientCountrySignal = !!rawClientCountry && isBoliviaCountry(rawClientCountry);
  const locationConfirmedManually = !!bookingContext?.location_confirmed_manually;
  const hasBoliviaSignal =
    locationCountryCode === 'BO'
    || ipCountryCode === 'BO'
    || clientCountry === 'BO'
    || clientCountry === 'BOLIVIA'
    || hasClientCountrySignal;
  const hasAnyLocationSignal = !!(
    locationCountryCode
    || ipCountryCode
    || locationConfirmedManually
    || clientCountry
  );

  return hasBoliviaSignal || (isBoliviaPhone && !hasAnyLocationSignal);
}

function resolveAttendancePaymentInstruction({ appointment = null, config = {} } = {}) {
  if (!appointment) return { kind: 'none' };
  if (appointment.payment_status === 'Confirmado') return { kind: 'paid' };

  const stripeProfile = resolveForeignPricingProfile({ client: appointment, config });
  if (stripeProfile) return { kind: 'stripe', stripeProfile };

  const needsStripeLink = !!appointment.foreign_pricing_key
    || String(appointment.fee_currency || 'BOB').toUpperCase() !== 'BOB';
  if (needsStripeLink) return { kind: 'missing_stripe' };

  if (hasBoliviaPaymentSignal(appointment)) return { kind: 'qr' };
  return { kind: 'none' };
}

function buildAttendanceConfirmationReply(firstName, instruction = { kind: 'none' }) {
  const name = formatFirstName(firstName);
  const greeting = name ? `👏 Perfecto ${name},` : '👏 Perfecto,';
  const base = `${greeting} te esperamos para darle un giro a tu vida.`;

  if (instruction.kind === 'paid') {
    return `${base}\n\nTu pago ya está registrado.`;
  }
  if (instruction.kind === 'qr') {
    return `${base}\n\nEn un momento te mandamos el *QR* para pago adelantado por favor.`;
  }
  if (instruction.kind === 'stripe') {
    return `${base}\n\nEn un momento te mandamos el enlace para pago adelantado por favor.`;
  }
  if (instruction.kind === 'missing_stripe') {
    return `${base}\n\nDaniel revisará contigo el enlace de pago.`;
  }

  return base;
}

module.exports = {
  buildAttendanceConfirmationReply,
  hasBoliviaPaymentSignal,
  parseBookingContext,
  resolveAttendancePaymentInstruction,
};
