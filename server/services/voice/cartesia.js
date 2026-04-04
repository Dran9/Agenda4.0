const CARTESIA_BASE_URL = 'https://api.cartesia.ai';
const CARTESIA_VERSION = process.env.CARTESIA_VERSION || '2025-04-16';
const DEFAULT_MODEL_ID = process.env.CARTESIA_MODEL_ID || 'sonic-3';

let cachedVoiceId = null;

function getCartesiaApiKey() {
  return process.env.CARTESIA_API_KEY || '';
}

function getConfiguredVoiceId() {
  return process.env.CARTESIA_VOICE_ID || '';
}

function ensureCartesiaConfigured() {
  const apiKey = getCartesiaApiKey();
  if (!apiKey) {
    const err = new Error('CARTESIA_API_KEY no configurado');
    err.status = 500;
    throw err;
  }
  return apiKey;
}

async function cartesiaFetch(path, options = {}) {
  const apiKey = ensureCartesiaConfigured();
  return fetch(`${CARTESIA_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
      ...(options.headers || {}),
    },
  });
}

async function resolveVoiceId(language = 'es') {
  if (cachedVoiceId) return cachedVoiceId;

  const explicit = getConfiguredVoiceId().trim();
  if (explicit) {
    cachedVoiceId = explicit;
    return cachedVoiceId;
  }

  const response = await cartesiaFetch('/voices?limit=100');
  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`Cartesia voices error: ${body}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const voices = Array.isArray(data?.data) ? data.data : [];
  const preferred = voices.find((voice) => voice.language === language && voice.is_public);
  if (!preferred?.id) {
    const err = new Error(`No encontré una voz pública de Cartesia para idioma ${language}`);
    err.status = 500;
    throw err;
  }

  cachedVoiceId = preferred.id;
  return cachedVoiceId;
}

async function synthesizeSpeech(text, options = {}) {
  const transcript = String(text || '').trim();
  if (!transcript) {
    const err = new Error('Texto vacío para TTS');
    err.status = 400;
    throw err;
  }

  const language = options.language || 'es';
  const voiceId = options.voiceId || await resolveVoiceId(language);
  const response = await cartesiaFetch('/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: options.modelId || DEFAULT_MODEL_ID,
      transcript,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      output_format: {
        container: 'mp3',
        sample_rate: 44100,
        bit_rate: 128000,
      },
      language,
      generation_config: {
        speed: options.speed ?? 0.96,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`Cartesia TTS error: ${body}`);
    err.status = 502;
    throw err;
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: 'audio/mpeg',
    voiceId,
    modelId: options.modelId || DEFAULT_MODEL_ID,
  };
}

module.exports = {
  synthesizeSpeech,
};
