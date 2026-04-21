const crypto = require('crypto');
const { Router } = require('express');
const { pool } = require('../db');
const { updateEventSummary } = require('../services/calendar');
const { buildCalendarSummary } = require('../services/calendarSummary');
const { broadcast } = require('../services/adminEvents');

const router = Router();
const DEFAULT_TENANT = 1;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function normalizeCurrency(value) {
  return String(value || 'USD').trim().toUpperCase();
}

function amountFromMinorUnits(amountMinor, currency) {
  const numeric = Number(amountMinor || 0);
  if (!Number.isFinite(numeric)) return 0;
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return numeric;
  return Math.round((numeric / 100) * 100) / 100;
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');
    if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function parseStripeSignatureHeader(headerValue) {
  const parts = String(headerValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const result = { timestamp: null, signatures: [] };
  for (const part of parts) {
    const [key, value] = part.split('=', 2);
    if (!key || !value) continue;
    if (key === 't') result.timestamp = Number(value);
    if (key === 'v1') result.signatures.push(value);
  }
  return result;
}

function verifyStripeSignature({ rawBody, signatureHeader, secret, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS }) {
  if (!rawBody || !secret || !signatureHeader) {
    return { ok: false, reason: 'missing_signature_input' };
  }

  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  if (!timestamp || !Number.isFinite(timestamp) || signatures.length === 0) {
    return { ok: false, reason: 'malformed_signature' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'signature_too_old' };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const isValid = signatures.some((candidate) => safeEqualHex(expected, candidate));
  return isValid ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

function toNullableString(value, max = 255) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function parseForeignProfiles(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      const key = toNullableString(item?.key, 60);
      const amount = Number(item?.amount);
      const currency = normalizeCurrency(item?.currency || 'USD');
      const url = toNullableString(item?.url, 500);
      if (!key || !Number.isFinite(amount) || amount <= 0 || !url) return null;
      return {
        key,
        amount: Math.round(amount * 100) / 100,
        currency,
        url,
      };
    })
    .filter(Boolean);
}

function resolveProfileKey({ profiles, sessionAmount, sessionCurrency, sessionPaymentLinkId, metadata }) {
  const metaKey = toNullableString(metadata?.profile_key || metadata?.foreign_pricing_key || metadata?.stripe_profile_key, 60);
  if (metaKey && profiles.some((profile) => profile.key === metaKey)) {
    return metaKey;
  }

  const byAmount = profiles.filter((profile) => (
    profile.currency === sessionCurrency &&
    Math.abs(Number(profile.amount) - Number(sessionAmount)) < 0.0001
  ));
  if (byAmount.length === 1) return byAmount[0].key;

  if (sessionPaymentLinkId) {
    const byLink = profiles.filter((profile) => profile.url.includes(sessionPaymentLinkId));
    if (byLink.length === 1) return byLink[0].key;
  }

  return null;
}

async function loadStripeConfig(tenantId) {
  const [rows] = await pool.query(
    `SELECT stripe_webhook_secret, foreign_pricing_profiles
     FROM config
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );
  const row = rows[0] || {};
  return {
    secret: toNullableString(row.stripe_webhook_secret, 255),
    profiles: parseForeignProfiles(row.foreign_pricing_profiles),
  };
}

async function findPendingStripeCandidates({ tenantId, amount, currency, profileKey }) {
  const params = [tenantId, currency, amount];
  let profileClause = '';
  if (profileKey) {
    profileClause = ' AND c.foreign_pricing_key = ?';
    params.push(profileKey);
  }

  const [rows] = await pool.query(
    `SELECT
       p.id,
       p.amount,
       p.currency,
       p.appointment_id,
       a.date_time,
       a.status AS appointment_status,
       a.gcal_event_id,
       c.id AS client_id,
       c.first_name,
       c.last_name,
       c.phone AS client_phone,
       c.foreign_pricing_key
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
     JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
     WHERE p.tenant_id = ?
       AND p.status IN ('Pendiente', 'Mismatch')
       AND UPPER(COALESCE(NULLIF(p.currency, ''), 'BOB')) = ?
       AND p.amount = ?
       ${profileClause}
     ORDER BY
       CASE WHEN a.date_time >= NOW() THEN 0 ELSE 1 END,
       ABS(TIMESTAMPDIFF(MINUTE, a.date_time, NOW())) ASC,
       p.updated_at DESC,
       p.id DESC
     LIMIT 8`,
    params
  );

  return rows;
}

async function markStripePaymentConfirmed({ tenantId, paymentRow, event, amount, amountMinor, currency }) {
  const session = event?.data?.object || {};
  const sessionId = toNullableString(session.id);
  const paymentIntentId = toNullableString(session.payment_intent);
  const paymentLinkId = toNullableString(session.payment_link);
  const chargeId = toNullableString(session.payment_status === 'paid' ? session.payment_intent : null);
  const customerEmail = toNullableString(session.customer_details?.email || session.customer_email);

  await pool.query(
    `UPDATE payments
     SET status = 'Confirmado',
         confirmed_at = COALESCE(confirmed_at, NOW()),
         settled_amount = ?,
         settled_currency = ?,
         settled_source = 'STRIPE',
         stripe_event_id = ?,
         stripe_session_id = ?,
         stripe_payment_intent = ?,
         stripe_payment_link_id = ?,
         stripe_charge_id = ?,
         stripe_customer_email = ?,
         stripe_amount_minor = ?,
         currency = ?
     WHERE id = ? AND tenant_id = ?`,
    [
      amount,
      currency,
      toNullableString(event.id),
      sessionId,
      paymentIntentId,
      paymentLinkId,
      chargeId,
      customerEmail,
      Number.isFinite(Number(amountMinor)) ? Number(amountMinor) : null,
      currency,
      paymentRow.id,
      tenantId,
    ]
  );

  try {
    const calendarId = process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID;
    if (calendarId && paymentRow.gcal_event_id) {
      const currentSummary = `Terapia ${paymentRow.first_name} ${paymentRow.last_name || ''} - ${paymentRow.client_phone}`.trim();
      await updateEventSummary(
        calendarId,
        paymentRow.gcal_event_id,
        buildCalendarSummary(currentSummary, {
          confirmed: ['Confirmada', 'Completada'].includes(paymentRow.appointment_status),
          paid: true,
        })
      );
    }
  } catch (calendarErr) {
    console.error('[stripe-webhook] calendar update failed:', calendarErr.message);
  }

  broadcast('payment:change', {
    id: Number(paymentRow.id),
    action: 'confirmed',
    source: 'stripe',
  }, tenantId);
}

async function processCheckoutSessionEvent({ tenantId, event, profiles }) {
  const session = event?.data?.object || {};
  const currency = normalizeCurrency(session.currency || 'USD');
  const amountMinor = Number(session.amount_total ?? session.amount_received ?? 0);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return {
      processedStatus: 'ignored',
      notes: 'Evento Stripe sin monto válido',
      profileKey: null,
      matchedPaymentId: null,
      currency,
      amountMinor: null,
      amount: 0,
    };
  }

  const amount = amountFromMinorUnits(amountMinor, currency);
  const profileKey = resolveProfileKey({
    profiles,
    sessionAmount: amount,
    sessionCurrency: currency,
    sessionPaymentLinkId: toNullableString(session.payment_link),
    metadata: session.metadata,
  });

  const candidates = await findPendingStripeCandidates({
    tenantId,
    amount,
    currency,
    profileKey,
  });

  if (candidates.length === 1) {
    await markStripePaymentConfirmed({
      tenantId,
      paymentRow: candidates[0],
      event,
      amount,
      amountMinor,
      currency,
    });
    return {
      processedStatus: 'processed',
      notes: 'Pago Stripe conciliado y confirmado',
      profileKey,
      matchedPaymentId: candidates[0].id,
      currency,
      amountMinor,
      amount,
    };
  }

  if (candidates.length > 1) {
    return {
      processedStatus: 'unmatched',
      notes: `Stripe recibido pero hay ${candidates.length} pagos candidatos pendientes`,
      profileKey,
      matchedPaymentId: null,
      currency,
      amountMinor,
      amount,
    };
  }

  return {
    processedStatus: 'unmatched',
    notes: 'Stripe recibido sin match automático en pagos pendientes',
    profileKey,
    matchedPaymentId: null,
    currency,
    amountMinor,
    amount,
  };
}

router.post('/webhook', async (req, res) => {
  const tenantId = DEFAULT_TENANT;

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body || {});

  let event;
  try {
    event = JSON.parse(rawBody || '{}');
  } catch {
    return res.status(400).json({ error: 'Payload Stripe inválido' });
  }

  if (!event?.id || !event?.type) {
    return res.status(400).json({ error: 'Evento Stripe inválido' });
  }

  try {
    const stripeConfig = await loadStripeConfig(tenantId);
    if (!stripeConfig.secret) {
      return res.status(503).json({ error: 'Webhook Stripe no configurado en Ajustes > Aranceles' });
    }

    const signatureHeader = req.get('stripe-signature');
    const signatureResult = verifyStripeSignature({
      rawBody,
      signatureHeader,
      secret: stripeConfig.secret,
    });

    if (!signatureResult.ok) {
      return res.status(400).json({ error: 'Firma Stripe inválida' });
    }

    const dataObject = event?.data?.object || {};
    const eventCurrency = normalizeCurrency(dataObject.currency || 'USD');
    const eventAmountMinor = Number(dataObject.amount_total ?? dataObject.amount_received ?? 0);
    const eventAmount = Number.isFinite(eventAmountMinor)
      ? amountFromMinorUnits(eventAmountMinor, eventCurrency)
      : null;

    let stripeEventRowId = null;
    try {
      const [insertResult] = await pool.query(
        `INSERT INTO stripe_events (
          tenant_id,
          stripe_event_id,
          event_type,
          livemode,
          currency,
          amount_minor,
          amount,
          payment_link_id,
          checkout_session_id,
          payment_intent_id,
          customer_email,
          payload,
          processed_status,
          notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ignored', ?)` ,
        [
          tenantId,
          toNullableString(event.id),
          toNullableString(event.type, 120),
          event.livemode ? 1 : 0,
          eventCurrency,
          Number.isFinite(eventAmountMinor) ? eventAmountMinor : null,
          eventAmount,
          toNullableString(dataObject.payment_link),
          toNullableString(dataObject.id),
          toNullableString(dataObject.payment_intent),
          toNullableString(dataObject.customer_details?.email || dataObject.customer_email),
          JSON.stringify(event),
          'Stripe event recibido',
        ]
      );
      stripeEventRowId = insertResult.insertId;
    } catch (insertErr) {
      if (insertErr.code === 'ER_DUP_ENTRY') {
        return res.json({ received: true, duplicate: true });
      }
      throw insertErr;
    }

    let processing = {
      processedStatus: 'ignored',
      notes: `Evento Stripe ignorado: ${event.type}`,
      profileKey: null,
      matchedPaymentId: null,
      currency: eventCurrency,
      amountMinor: Number.isFinite(eventAmountMinor) ? eventAmountMinor : null,
      amount: eventAmount,
    };

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      processing = await processCheckoutSessionEvent({
        tenantId,
        event,
        profiles: stripeConfig.profiles,
      });
    }

    if (stripeEventRowId) {
      await pool.query(
        `UPDATE stripe_events
         SET processed_status = ?,
             notes = ?,
             profile_key = ?,
             matched_payment_id = ?,
             currency = ?,
             amount_minor = ?,
             amount = ?,
             payment_link_id = COALESCE(payment_link_id, ?),
             checkout_session_id = COALESCE(checkout_session_id, ?),
             payment_intent_id = COALESCE(payment_intent_id, ?),
             customer_email = COALESCE(customer_email, ?)
         WHERE id = ? AND tenant_id = ?`,
        [
          processing.processedStatus,
          toNullableString(processing.notes, 500),
          processing.profileKey,
          processing.matchedPaymentId,
          processing.currency,
          processing.amountMinor,
          processing.amount,
          toNullableString(dataObject.payment_link),
          toNullableString(dataObject.id),
          toNullableString(dataObject.payment_intent),
          toNullableString(dataObject.customer_details?.email || dataObject.customer_email),
          stripeEventRowId,
          tenantId,
        ]
      );
    }

    return res.json({
      received: true,
      processed: processing.processedStatus,
      matched_payment_id: processing.matchedPaymentId,
    });
  } catch (err) {
    console.error('[stripe-webhook] error:', err.message);
    return res.status(500).json({ error: 'No se pudo procesar webhook de Stripe' });
  }
});

module.exports = router;
