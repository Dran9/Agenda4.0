const { pool } = require('../db');
const { normalizePhone, normalizedPhoneSql } = require('../utils/phone');

const BOOKING_TERMS = [
  'agendar', 'agenda', 'cita', 'sesion', 'reagendar', 'reagenda', 'reprogramar',
  'reprograma', 'cambiar hora', 'cambiar horario', 'otro horario', 'cancelar',
  'cancelacion', 'confirmo', 'confirmar', 'nos vemos', 'no podre', 'llego tarde',
];

const PAYMENT_TERMS = [
  'pago', 'pagado', 'pague', 'transferi', 'transferencia', 'comprobante', 'deposito',
  'qr', 'envie', 'te mande', 'recibo',
];

function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, terms) {
  return terms.some(term => text.includes(term));
}

async function getOperationalContext({ tenantId, phone, clientId }) {
  const canonicalPhone = normalizePhone(phone);
  const context = {
    clientKnown: !!clientId,
    hasFutureAppointment: false,
    hasPendingPayment: false,
    recentOperationalWindow: false,
    recentBookingWindow: false,
    recentPaymentWindow: false,
  };

  if (clientId) {
    const [[stats]] = await pool.query(
      `SELECT
         EXISTS(
           SELECT 1
           FROM appointments
           WHERE client_id = ? AND tenant_id = ?
             AND status IN ('Agendada','Confirmada','Reagendada')
             AND date_time > NOW()
         ) AS has_future_appointment,
         EXISTS(
           SELECT 1
           FROM payments
           WHERE client_id = ? AND tenant_id = ? AND status IN ('Pendiente', 'Mismatch')
         ) AS has_pending_payment`,
      [clientId, tenantId, clientId, tenantId]
    );
    context.hasFutureAppointment = !!stats?.has_future_appointment;
    context.hasPendingPayment = !!stats?.has_pending_payment;
  }

  const [recentMessages] = await pool.query(
    `SELECT direction, message_type, content
     FROM wa_conversations
     WHERE tenant_id = ? AND ${normalizedPhoneSql('client_phone')} = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY created_at DESC
     LIMIT 20`,
    [tenantId, canonicalPhone]
  );

  const recentOutboundOperational = recentMessages.filter(
    row => row.direction === 'outbound' && ['template', 'auto_reply'].includes(row.message_type)
  );

  context.recentOperationalWindow =
    recentOutboundOperational.length > 0 || context.hasFutureAppointment || context.hasPendingPayment;

  context.recentPaymentWindow =
    context.hasPendingPayment ||
    recentOutboundOperational.some(row => {
      const text = normalizeText(row.content);
      return text.includes('qr de pago') || text.includes('recordatorio de pago') || text.includes('pago pendiente');
    });

  context.recentBookingWindow =
    context.hasFutureAppointment ||
    recentOutboundOperational.some(row => {
      const text = normalizeText(row.content);
      return text.includes('cita') || text.includes('reprogramar') || text.includes('te esperamos');
    });

  return context;
}

function classifyIncomingMessage({ messageType, text = '', caption = '', filename = '', context }) {
  const content = normalizeText([text, caption, filename].filter(Boolean).join(' '));
  const hasBookingKeywords = includesAny(content, BOOKING_TERMS);
  const hasPaymentKeywords = includesAny(content, PAYMENT_TERMS);

  if (messageType === 'image' || messageType === 'document') {
    if (context.hasPendingPayment || context.recentPaymentWindow || hasPaymentKeywords) {
      return {
        shouldStore: true,
        contextType: 'payment',
        reason: context.hasPendingPayment ? 'pending_payment_context' : hasPaymentKeywords ? 'payment_keywords' : 'recent_payment_window',
      };
    }

    return {
      shouldStore: false,
      contextType: 'noise',
      reason: 'media_without_payment_context',
    };
  }

  if (messageType === 'text') {
    if (hasPaymentKeywords) {
      return { shouldStore: true, contextType: 'payment', reason: 'payment_keywords' };
    }
    if (hasBookingKeywords) {
      return { shouldStore: true, contextType: 'booking', reason: 'booking_keywords' };
    }
    if (context.hasPendingPayment) {
      return { shouldStore: true, contextType: 'payment', reason: 'pending_payment_context' };
    }
    if (context.hasFutureAppointment) {
      return { shouldStore: true, contextType: 'booking', reason: 'future_appointment_context' };
    }
    if (context.recentPaymentWindow) {
      return { shouldStore: true, contextType: 'payment', reason: 'recent_payment_window' };
    }
    if (context.recentBookingWindow) {
      return { shouldStore: true, contextType: 'booking', reason: 'recent_booking_window' };
    }

    return {
      shouldStore: false,
      contextType: 'noise',
      reason: 'no_operational_context',
    };
  }

  return {
    shouldStore: false,
    contextType: 'noise',
    reason: 'unsupported_message_type',
  };
}

function buildClassificationMetadata(classification, context, extra = {}) {
  return JSON.stringify({
    context_type: classification.contextType,
    classification_reason: classification.reason,
    context_snapshot: {
      client_known: context.clientKnown,
      has_future_appointment: context.hasFutureAppointment,
      has_pending_payment: context.hasPendingPayment,
      recent_operational_window: context.recentOperationalWindow,
      recent_booking_window: context.recentBookingWindow,
      recent_payment_window: context.recentPaymentWindow,
    },
    ...extra,
  });
}

module.exports = {
  getOperationalContext,
  classifyIncomingMessage,
  buildClassificationMetadata,
  normalizeText,
};
