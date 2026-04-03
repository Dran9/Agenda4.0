const { Router } = require('express');
const multer = require('multer');

const { pool } = require('../db');
const { sendServerError } = require('../utils/httpErrors');
const { transcribeAudio } = require('../services/voice/groq');
const { parseVoiceCommand } = require('../services/voice/parseCommand');
const { executeVoiceCommand } = require('../services/voice/executeCommand');

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
  inputType,
  rawText,
  transcript,
  parsedIntent,
  parsedEntities,
  responseText,
  status,
  errorMessage,
}) {
  await pool.query(
    `INSERT INTO voice_commands_log
       (tenant_id, source, input_type, raw_text, transcript, parsed_intent, parsed_entities, response_text, status, error_message)
     VALUES (?, 'shortcut', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      inputType,
      rawText || null,
      transcript || null,
      parsedIntent || null,
      parsedEntities ? JSON.stringify(parsedEntities) : null,
      responseText || null,
      status || 'resolved',
      errorMessage || null,
    ]
  );
}

router.post('/shortcut', assertShortcutAuth, upload.single('audio'), async (req, res) => {
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

    parsedCommand = await parseVoiceCommand(commandText);
    const execution = await executeVoiceCommand({
      tenantId: req.tenantId,
      parsedCommand,
    });

    const inputType = req.file?.buffer?.length
      ? (providedText ? 'audio_text' : 'audio')
      : 'text';

    await insertVoiceLog({
      tenantId: req.tenantId,
      inputType,
      rawText,
      transcript: transcript || null,
      parsedIntent: parsedCommand.intent,
      parsedEntities: parsedCommand.entities,
      responseText: execution.replyText,
      status: execution.status,
      errorMessage: null,
    });

    return res.json({
      ok: true,
      status: execution.status,
      input_type: inputType,
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
        inputType,
        rawText,
        transcript: transcript || null,
        parsedIntent: parsedCommand?.intent || 'unknown',
        parsedEntities: parsedCommand?.entities || {},
        responseText: null,
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
});

module.exports = router;
