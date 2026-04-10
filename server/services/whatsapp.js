const GRAPH_API_URL = 'https://graph.facebook.com/v22.0';
const DEFAULT_REMINDER_HEADER_IMAGE_URL = 'https://urls.danielmaclean.com/codigs/imago-recordatio-fb.jpg';

/**
 * Construye el body del mensaje con el destinatario correcto.
 *
 * Política de Meta (mayo 2026+):
 * - `to` = teléfono (wa_id) — el campo clásico
 * - `recipient` = BSUID — el nuevo campo
 * - Si mandas AMBOS, `to` tiene prioridad (Meta ignora `recipient`)
 * - Templates de autenticación SIEMPRE requieren `to` (teléfono)
 * - Para mensajes normales, si solo tienes BSUID puedes enviar solo con `recipient`
 *
 * @param {{ phone?: string, bsuid?: string }} target
 * @returns {{ to?: string, recipient?: string }}
 */
function buildRecipientFields(target) {
  // Prioridad: teléfono si existe (más confiable, compatible con todo)
  if (target.phone) {
    return { to: target.phone };
  }
  // Fallback: BSUID (disponible desde mayo 2026)
  if (target.bsuid) {
    return { recipient: target.bsuid };
  }
  // No debería llegar aquí — el caller debe validar antes
  throw new Error('Se requiere phone o bsuid para enviar mensaje de WhatsApp');
}

function getDayInSpanish(date) {
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  return days[date.getDay()];
}

function parseLaPazDate(fechaISO) {
  if (fechaISO instanceof Date) return fechaISO;
  let dateStr = String(fechaISO).replace(' ', 'T');
  if (!/[Z+]/.test(dateStr) && !/-\d{2}:\d{2}$/.test(dateStr)) dateStr += '-04:00';
  return new Date(dateStr);
}

function formatTemplateDateParts(date) {
  const lpOpts = { timeZone: 'America/La_Paz' };
  const dayName = new Intl.DateTimeFormat('es-BO', { weekday: 'long', ...lpOpts }).format(date);
  const dayNum = new Intl.DateTimeFormat('es-BO', { day: 'numeric', ...lpOpts }).format(date);
  return {
    fecha: dayName.charAt(0).toUpperCase() + dayName.slice(1) + ' ' + dayNum,
    hora: date.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, ...lpOpts }),
  };
}

function formatFirstName(nombre) {
  const firstName = (nombre || '').split(' ')[0] || 'hola';
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

/**
 * Envía un template message. Acepta phone (string) O target ({ phone?, bsuid? }).
 * Retrocompatible: si recibes un string, se trata como teléfono (comportamiento original).
 */
async function sendTemplateMessage(phoneOrTarget, template, token, phoneNumberId) {
  const target = typeof phoneOrTarget === 'string'
    ? { phone: phoneOrTarget }
    : phoneOrTarget;

  const recipientFields = buildRecipientFields(target);

  const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...recipientFields,
      type: 'template',
      template,
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`WhatsApp API error ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendConfirmationTemplate(phone, nombre, fechaISO) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;
  const reminderHeaderImageUrl = (process.env.WA_REMINDER_HEADER_IMAGE_URL || DEFAULT_REMINDER_HEADER_IMAGE_URL).trim();

  // Parse date — handle Date objects (from mysql2) and strings
  const date = parseLaPazDate(fechaISO);

  const nombrewa = formatFirstName(nombre);

  // Format day and time in Bolivia timezone (single conversion via Intl — no double-conversion)
  const { fecha: fechawa, hora: horawa } = formatTemplateDateParts(date);

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: 'recordatorionovum26',
      language: { code: 'es' },
      components: [
        {
          type: 'header',
          parameters: [{
            type: 'image',
            image: { link: reminderHeaderImageUrl }
          }]
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nombrewa },
            { type: 'text', text: fechawa },
            { type: 'text', text: horawa }
          ]
        },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRM_NOW' }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'REAGEN_NOW' }] },
        { type: 'button', sub_type: 'quick_reply', index: '2', parameters: [{ type: 'payload', payload: 'DANIEL_NOW' }] }
      ]
    }
  };

  return sendTemplateMessage(phone, payload.template, token, phoneNumberId);
}

async function sendRescheduleTemplate(phone, nombre, link, options = {}) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;
  const templateName = options.templateName || process.env.WA_RESCHEDULE_TEMPLATE || 'reprogramar_sesion';
  const languageCode = options.languageCode || 'es';
  const nombrewa = formatFirstName(nombre);

  return sendTemplateMessage(phone, {
    name: templateName,
    language: { code: languageCode },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: nombrewa },
          { type: 'text', text: String(link || '') },
        ]
      }
    ]
  }, token, phoneNumberId);
}

async function sendPaymentReminderTemplate(phone, nombre, fechaISO, amount, options = {}) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;
  const templateName = options.templateName || process.env.WA_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago';
  const languageCode = options.languageCode || 'es';

  const nombrewa = formatFirstName(nombre);

  return sendTemplateMessage(phone, {
    name: templateName,
    language: { code: languageCode },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: nombrewa },
        ]
      }
    ]
  }, token, phoneNumberId);
}

/**
 * Envía un mensaje de texto libre. Acepta phone (string) O target ({ phone?, bsuid? }).
 */
async function sendTextMessage(phoneOrTarget, text) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;

  const target = typeof phoneOrTarget === 'string'
    ? { phone: phoneOrTarget }
    : phoneOrTarget;

  const recipientFields = buildRecipientFields(target);

  const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...recipientFields,
      type: 'text',
      text: { body: text }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('[whatsapp] Error:', JSON.stringify(data));
    throw new Error(`WhatsApp API error: ${response.status}`);
  }
  return data;
}

/**
 * Envía una imagen. Acepta phone (string) O target ({ phone?, bsuid? }).
 */
async function sendImageMessage(phoneOrTarget, imageUrl, caption) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;

  const target = typeof phoneOrTarget === 'string'
    ? { phone: phoneOrTarget }
    : phoneOrTarget;

  const recipientFields = buildRecipientFields(target);

  const payload = {
    messaging_product: 'whatsapp',
    ...recipientFields,
    type: 'image',
    image: { link: imageUrl },
  };
  if (caption) payload.image.caption = caption;

  const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('[whatsapp] Image error:', JSON.stringify(data));
    throw new Error(`WhatsApp API error: ${response.status}`);
  }
  return data;
}

module.exports = { sendConfirmationTemplate, sendRescheduleTemplate, sendPaymentReminderTemplate, sendTextMessage, sendImageMessage, buildRecipientFields };
