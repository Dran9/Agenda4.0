const { Router } = require('express');
const multer = require('multer');

const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendServerError } = require('../utils/httpErrors');
const { transcribeAudio } = require('../services/voice/groq');
const { synthesizeSpeech } = require('../services/voice/cartesia');
const { parseVoiceCommand } = require('../services/voice/parseCommand');
const { executeVoiceCommand } = require('../services/voice/executeCommand');
const { getRecentVoiceContext } = require('../services/voice/context');

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

function getShortcutToken() {
  return process.env.VOICE_ADMIN_TOKEN || '';
}

function getVoiceTenantId() {
  return Number(process.env.VOICE_ADMIN_TENANT_ID || 1);
}

function readToken(req) {
  const headerToken = req.get('x-shortcut-token') || req.get('x-voice-token');
  if (headerToken) return headerToken;
  const authHeader = req.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return '';
}

function assertShortcutAuth(req, res, next) {
  const expected = getShortcutToken();
  const received = readToken(req);

  if (!expected) {
    return res.status(500).json({ error: 'VOICE_ADMIN_TOKEN no configurado' });
  }
  if (!received || received !== expected) {
    return res.status(401).json({ error: 'Token de Shortcut inválido' });
  }

  req.tenantId = getVoiceTenantId();
  next();
}

async function insertVoiceLog({
  tenantId,
  source = 'shortcut',
  inputType,
  rawText,
  transcript,
  parsedIntent,
  parsedEntities,
  responseText,
  resultData,
  status,
  errorMessage,
}) {
  await pool.query(
    `INSERT INTO voice_commands_log
       (tenant_id, source, input_type, raw_text, transcript, parsed_intent, parsed_entities, response_text, result_data, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      source,
      inputType,
      rawText || null,
      transcript || null,
      parsedIntent || null,
      parsedEntities ? JSON.stringify(parsedEntities) : null,
      responseText || null,
      resultData ? JSON.stringify(resultData) : null,
      status || 'resolved',
      errorMessage || null,
    ]
  );
}

async function processVoiceRequest(req, res, { source = 'shortcut' } = {}) {
  let rawText = '';
  let transcript = '';
  let parsedCommand = null;

  try {
    const providedText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    rawText = providedText;

    if (req.file?.buffer?.length) {
      const transcription = await transcribeAudio(
        req.file.buffer,
        req.file.mimetype || 'audio/mpeg',
        req.file.originalname || 'voice-message.m4a'
      );
      transcript = transcription.text;
    }

    const commandText = transcript || providedText;
    if (!commandText) {
      await insertVoiceLog({
        tenantId: req.tenantId,
        source,
        inputType: 'text',
        rawText: providedText,
        transcript: null,
        parsedIntent: 'unknown',
        parsedEntities: {},
        responseText: 'No llegó audio ni texto.',
        status: 'error',
        errorMessage: 'empty_input',
      });
      return res.status(400).json({ error: 'No llegó audio ni texto' });
    }

    const recentContext = await getRecentVoiceContext({
      tenantId: req.tenantId,
      source,
      limit: 6,
    });

    parsedCommand = await parseVoiceCommand(commandText, {
      tenantId: req.tenantId,
      source,
      recentContext,
    });
    const execution = await executeVoiceCommand({
      tenantId: req.tenantId,
      parsedCommand,
    });

    const inputType = req.file?.buffer?.length
      ? (providedText ? 'audio_text' : 'audio')
      : 'text';

    await insertVoiceLog({
      tenantId: req.tenantId,
      source,
      inputType,
      rawText,
      transcript: transcript || null,
      parsedIntent: parsedCommand.intent,
      parsedEntities: parsedCommand.entities,
      responseText: execution.replyText,
      resultData: execution.data,
      status: execution.status,
      errorMessage: null,
    });

    return res.json({
      ok: true,
      status: execution.status,
      input_type: inputType,
      input_text: commandText,
      raw_text: rawText || null,
      transcript: transcript || null,
      parsed: {
        intent: parsedCommand.intent,
        confidence: parsedCommand.confidence,
        entities: parsedCommand.entities,
      },
      reply_text: execution.replyText,
      spoken_text: execution.replyText,
      data: execution.data,
    });
  } catch (err) {
    const inputType = req.file?.buffer?.length
      ? (rawText ? 'audio_text' : 'audio')
      : 'text';

    try {
      await insertVoiceLog({
        tenantId: req.tenantId || getVoiceTenantId(),
        source,
        inputType,
        rawText,
        transcript: transcript || null,
        parsedIntent: parsedCommand?.intent || 'unknown',
        parsedEntities: parsedCommand?.entities || {},
        responseText: null,
        resultData: null,
        status: 'error',
        errorMessage: err.message,
      });
    } catch (_) {
      // best effort
    }

    return sendServerError(res, req, err, {
      message: 'No se pudo procesar el comando de voz',
      logLabel: 'voice shortcut',
    });
  }
}

router.post('/shortcut', assertShortcutAuth, upload.single('audio'), async (req, res) => {
  return processVoiceRequest(req, res, { source: 'shortcut' });
});

router.post('/admin-command', authMiddleware, upload.single('audio'), async (req, res) => {
  return processVoiceRequest(req, res, { source: 'voice_web' });
});

router.post('/tts', authMiddleware, async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'Texto requerido para TTS' });
    }

    const result = await synthesizeSpeech(text, {
      language: 'es',
    });

    res.set('Content-Type', result.mimeType);
    res.set('Cache-Control', 'no-store');
    res.send(result.buffer);
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo generar el audio TTS',
      logLabel: 'voice tts',
    });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, source, input_type, raw_text, transcript, parsed_intent, parsed_entities, response_text, result_data, status, error_message, created_at
       FROM voice_commands_log
       WHERE tenant_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 18`,
      [req.tenantId]
    );
    res.json({
      items: rows.map((row) => ({
        ...row,
        parsed_entities: typeof row.parsed_entities === 'string'
          ? (() => {
              try {
                return JSON.parse(row.parsed_entities);
              } catch (_) {
                return null;
              }
            })()
          : row.parsed_entities,
        result_data: typeof row.result_data === 'string'
          ? (() => {
              try {
                return JSON.parse(row.result_data);
              } catch (_) {
                return null;
              }
            })()
          : row.result_data,
      })),
    });
  } catch (err) {
    sendServerError(res, req, err, {
      message: 'No se pudo cargar el historial de voz',
      logLabel: 'voice history',
    });
  }
});

module.exports = router;
