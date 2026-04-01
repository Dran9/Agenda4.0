const GRAPH_API_URL = 'https://graph.facebook.com/v18.0';
const DEFAULT_REMINDER_HEADER_IMAGE_URL = 'https://plum-rhinoceros-787093.hostingersite.com/api/static/reminder-header.png';

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

async function sendConfirmationTemplate(phone, nombre, fechaISO) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;
  const reminderHeaderImageUrl = (process.env.WA_REMINDER_HEADER_IMAGE_URL || DEFAULT_REMINDER_HEADER_IMAGE_URL).trim();

  // Parse date — handle Date objects (from mysql2) and strings
  const date = parseLaPazDate(fechaISO);

  let nombrewa = nombre.split(' ')[0];
  nombrewa = nombrewa.charAt(0).toUpperCase() + nombrewa.slice(1).toLowerCase();

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

  const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`WhatsApp API error ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendPaymentReminderTemplate(phone, nombre, fechaISO, amount, options = {}) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;
  const templateName = options.templateName || process.env.WA_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago_pendiente';
  const languageCode = options.languageCode || 'es';

  const date = parseLaPazDate(fechaISO);
  const firstName = (nombre || '').split(' ')[0] || 'hola';
  const nombrewa = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  const { fecha, hora } = formatTemplateDateParts(date);

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nombrewa },
            { type: 'text', text: `${fecha} ${hora}`.trim() },
            { type: 'text', text: String(amount ?? '') },
          ]
        }
      ]
    }
  };

  const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`WhatsApp API error ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendTextMessage(phone, text) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;

  const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
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

async function sendImageMessage(phone, imageUrl, caption) {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_ID;

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
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

module.exports = { sendConfirmationTemplate, sendPaymentReminderTemplate, sendTextMessage, sendImageMessage };
