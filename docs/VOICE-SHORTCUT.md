# Voice Shortcut MVP

## Scope

First isolated MVP for admin voice control.

- Channel: iPhone Shortcut
- Inputs: audio and text
- Auth: secret token
- Output: short, operational text plus spoken response
- Safety: informational commands only

## Endpoint

- `POST /api/voice/shortcut`

Headers:

- `x-shortcut-token: <VOICE_ADMIN_TOKEN>`

Accepted input:

- `multipart/form-data` with file field `audio`
- optional text field `text`
- or JSON body with `text`

## Current Supported Commands

- agenda of today / tomorrow / explicit date
- pending payments
- sessions needed to reach a target amount
- find client by name
- upcoming appointments for a client

## Example Phrases

- `qué citas tengo hoy`
- `agenda de mañana`
- `pagos pendientes`
- `cuántas sesiones necesito para llegar a 5000`
- `buscar a Octavia Quiroga`
- `próximas citas de Juan Pérez`

## Suggested Shortcut Flow

1. Ask whether you want audio or text
2. If audio:
   Record Audio
3. If text:
   Ask for Text
4. Get Contents of URL
   - URL: `https://agenda.danielmaclean.com/api/voice/shortcut`
   - Method: `POST`
   - Headers:
     - `x-shortcut-token`
   - Body:
     - `audio` file and/or `text`
5. Read `reply_text`
6. Speak `spoken_text`

## Environment

- `GROQ_API_KEY`
- `VOICE_ADMIN_TOKEN`
- `VOICE_ADMIN_TENANT_ID`
- `GROQ_STT_MODEL`
- `GROQ_VOICE_MODEL`

## Notes

- No data mutation in this MVP
- Every request is logged in `voice_commands_log`
- Audio transcription and command parsing both happen server-side
