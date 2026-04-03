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

- `x-voice-token: <VOICE_ADMIN_TOKEN>`

Accepted input:

- `multipart/form-data` with file field `audio`
- optional text field `text`
- or JSON body with `text`

## Current Supported Commands

- agenda of today / tomorrow / explicit date
- pending payments
- pending amount
- sessions needed to reach a target amount
- find client by name
- upcoming appointments for a client
- check whether a reminder was sent to a client
- check whether a client confirmed
- list rescheduled appointments
- count new clients by month
- list unconfirmed appointments for tomorrow
- list confirmed appointments for today
- count appointments this week
- create an appointment for an existing client with explicit date and time

## Example Phrases

- `qué citas tengo hoy`
- `agenda de mañana`
- `pagos pendientes`
- `cuántas sesiones necesito para llegar a 5000`
- `buscar a Octavia Quiroga`
- `próximas citas de Juan Pérez`
- `has enviado recordatorio a Ana Faby`
- `ha confirmado Patricia`
- `quiénes han reagendado`
- `cuántos nuevos tuve en marzo`
- `cuánto dinero pendiente tengo`
- `quiénes no han confirmado mañana`
- `quiénes confirmaron hoy`
- `cuántas citas tengo esta semana`
- `crea evento el 10 de abril a las 8 para Cecilia de Ugarte`

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
     - `x-voice-token`
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

- Only one data-changing action is enabled in this phase: creating an appointment for an existing client
- Every request is logged in `voice_commands_log`
- Audio transcription and command parsing both happen server-side
