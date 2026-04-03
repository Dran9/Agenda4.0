const STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

function getGroqApiKey() {
  return process.env.GROQ_API_KEY || '';
}

function getSpeechModel() {
  return process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
}

function getTextModel() {
  return process.env.GROQ_VOICE_MODEL || 'llama-3.1-8b-instant';
}

function ensureGroqConfigured() {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    const err = new Error('GROQ_API_KEY no configurado');
    err.status = 500;
    throw err;
  }
  return apiKey;
}

async function transcribeAudio(buffer, mimeType = 'audio/mpeg', filename = 'voice-message.m4a') {
  const apiKey = ensureGroqConfigured();
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('model', getSpeechModel());
  form.append('language', 'es');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  const res = await fetch(STT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Groq STT error: ${body}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  return {
    text: String(data.text || '').trim(),
    raw: data,
  };
}

async function completeJson(messages, { temperature = 0.1 } = {}) {
  const apiKey = ensureGroqConfigured();
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getTextModel(),
      temperature,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Groq chat error: ${body}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || '').trim();
}

module.exports = {
  completeJson,
  transcribeAudio,
};
