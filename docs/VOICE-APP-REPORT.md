# Voice Admin Report

## Purpose

Documento de arranque para retomar en otro chat el trabajo de la app privada de comandos por voz con LLM.

Esta capa es solo para Daniel, no para clientes.

## Product Goal

Construir la forma más rápida, elegante y eficiente de darle instrucciones a la agenda usando voz como input principal.

No queremos:

- depender de WhatsApp como consola admin
- depender del UX torpe de Apple Shortcuts
- depender de respuestas de voz feas del navegador como solución final

Sí queremos:

- pulsar y hablar
- recibir respuesta en texto siempre
- ejecutar consultas y acciones admin rápidas
- pedir aclaración solo cuando haya ambigüedad real

## Current State

Ya existe una app privada en:

- `https://agenda.danielmaclean.com/voice`

Ya existe un backend operativo para voz con:

- transcripción STT vía Groq
- planner híbrido con heurísticas, contexto reciente y grounding por tools
- TTS backend vía Cartesia con fallback a `speechSynthesis`
- ejecución contra la base
- logging completo
- agenda day/week queries más robustas: `mañana`, weekdays, `esta semana` y `próxima semana` ya no deberían caer por defecto en `hoy`

Google Calendar, Google Sheets y Google Contacts están nuevamente sanos con el proyecto Google Cloud `agenda40`.

## Architecture

### Frontend

- Ruta principal: [client/src/pages/VoiceAssistant.jsx](/Users/dran/Documents/Codex%20openai/agenda4.0/client/src/pages/VoiceAssistant.jsx)
- Router: [client/src/App.jsx](/Users/dran/Documents/Codex%20openai/agenda4.0/client/src/App.jsx)
- API wrapper: [client/src/utils/api.js](/Users/dran/Documents/Codex%20openai/agenda4.0/client/src/utils/api.js)
- Estilos globales y modo `/voice`: [client/src/index.css](/Users/dran/Documents/Codex%20openai/agenda4.0/client/src/index.css)

### Backend

- Rutas de voz: [server/routes/voice.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/routes/voice.js)
- STT y chat Groq: [server/services/voice/groq.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/groq.js)
- TTS Cartesia: [server/services/voice/cartesia.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/cartesia.js)
- Parser de lenguaje natural: [server/services/voice/parseCommand.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/parseCommand.js)
- Contexto conversacional corto: [server/services/voice/context.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/context.js)
- Planner con tools de grounding: [server/services/voice/planner.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/planner.js)
- Ejecutor de acciones: [server/services/voice/executeCommand.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/executeCommand.js)
- Booking real: [server/services/booking.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/booking.js)
- Google Calendar OAuth: [server/services/calendar.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/calendar.js)

### Endpoints

- `POST /api/voice/shortcut`
  pensado para Shortcut o clientes externos autenticados por token secreto
- `POST /api/voice/admin-command`
  usado por la web app privada `/voice`, autenticada con JWT admin normal
- `POST /api/voice/tts`
  genera audio privado desde backend usando Cartesia
- `GET /api/voice/history`
  historial reciente de comandos

### Logging

Todos los comandos quedan en `voice_commands_log` con:

- source
- input_type
- raw_text
- transcript
- parsed_intent
- parsed_entities
- response_text
- result_data
- status
- error_message

## What Already Works

### Inputs

- texto
- audio grabado desde la web app
- Shortcut con texto o audio

### Queries

- agenda de hoy / mañana
- agenda por weekday o rango semanal (`lunes`, `esta semana`, `próxima semana`)
- pagos pendientes
- monto pendiente por cobrar
- sesiones necesarias para llegar a una meta
- buscar cliente
- próximas citas de un cliente
- si se envió recordatorio a un cliente
- si un cliente confirmó
- reagendados
- clientes nuevos por mes
- no confirmados mañana
- confirmados hoy
- citas de la semana

### Actions

- crear cita para cliente existente
- activar recurrencia semanal
- consultar si un cliente está en recurrencia
- pausar, reactivar o desactivar recurrencia
- activar recordatorios
- desactivar recordatorios
- mandar recordatorios hoy
- mandar recordatorios mañana
- cambiar disponibilidad por día, mañana y tarde

### Recurrence Voice Phrases

- `Fulano pasa a modo recurrencia`
- `Fulano pasa a recurrencia`
- `Fulano entra en recurrencia`
- `Fulano está en recurrencia`

Cuando voz activa una recurrencia, por defecto intenta usar la última sesión completada del cliente como fuente. Si no existe una utilizable, cae a la próxima cita individual futura.

- deriva día y hora si el comando no los dijo explícitamente
- convierte el evento individual en Google Calendar en una serie semanal
- guarda el `gcal_recurring_event_id` en `recurring_schedules`

Si no existe una cita fuente convertible, la app crea una serie nueva en Google Calendar y deja la recurrencia activa en backend.

Si Google Calendar no confirma la serie, voz ya no responde falso positivo: devuelve una advertencia explícita.

### Intelligence Already Added

- resuelve `hoy`, `mañana`, `pasado mañana`
- resuelve días de semana como `martes`
- acepta horas naturales como `a las 8`, `9am`, `18`
- si hay varias coincidencias de cliente, intenta preguntar de forma humana
- guarda contexto reciente para follow-ups tipo `el otro`, `el de Santa Cruz`, `sí`, `a las 8`
- puede resolver clientes exactos con `client_id` cuando el planner ya aterrizó la ambigüedad
- el planner puede usar tools de solo lectura antes de decidir el comando final

## Current Pain Points

### 1. UX de voz todavía insuficiente

La web app ya es mejor que Shortcut, pero todavía no se siente premium.

Problemas reales:

- la voz de salida actual usa `speechSynthesis` del navegador
- eso suena feo y poco serio
- el micrófono funciona, pero la experiencia todavía no se siente instantánea ni elegante del todo

### 2. Inteligencia todavía irregular

Aunque mejoró mucho, todavía hay comandos que pueden sentirse rígidos.

Meta clara:

- que parezca un operador inteligente, no Siri
- que pida aclaración solo si hace falta
- que use el contexto real de nombre, fecha y agenda con mucha más soltura

Hoy ya no está limitado a `intent -> switch` puro, pero todavía le falta:

- más tools operativas
- más acciones mutables útiles
- una política mejor de confirmación antes de ejecutar cambios sensibles

### 3. Falta un layer mejor de respuesta oral

La respuesta en texto ya es obligatoria y correcta.

La respuesta hablada todavía no tiene calidad suficiente para ser “la experiencia final”.

## Important Guardrails

- Esta app es privada, solo para Daniel
- No tocar el flujo público del booking por culpa de experimentos de voz
- Si Google devuelve `invalid_grant`, la respuesta debe culpar a Google auth claramente
- Si una activación de recurrencia no logró confirmarse en Google Calendar, la respuesta debe decirlo claramente
- Las consultas sobre disponibilidad no deben mutar disponibilidad
- Para acciones sensibles, pedir aclaración o confirmación humana cuando haya ambigüedad

## GCal Interop

Además del comando por voz, la recurrencia también puede nacer directamente en Google Calendar:

- el cron `recurringSync` corre a las 06:00 BOT
- revisa 14 días hacia adelante con `singleEvents: true`
- agrupa por `recurringEventId`
- si detecta una serie de terapia con cliente matcheable, puede crear el `recurring_schedule` faltante en la app

No es realtime. El modelo operativo actual es sync diario, no webhook de Google Calendar.

## Environment

### Voice / Groq

- `GROQ_API_KEY`
- `GROQ_STT_MODEL`
- `GROQ_VOICE_MODEL`
- `VOICE_ADMIN_TOKEN`
- `VOICE_ADMIN_TENANT_ID`

### Voice / Cartesia

- `CARTESIA_API_KEY`
- `CARTESIA_VERSION`
- `CARTESIA_MODEL_ID`
- `CARTESIA_VOICE_ID`

### Google

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `CALENDAR_ID`
- `GOOGLE_SHEETS_ID`

## Current Model Choices

- STT: `whisper-large-v3-turbo`
- parser/chat: `llama-3.1-8b-instant`

## Model Discussion

El cuello de botella actual no siempre es Groq. Muchas veces el límite vino de:

- lógica nuestra demasiado rígida
- falta de mejores heurísticas antes o después del LLM
- UX que no deja claro lo que el sistema entendió
- bugs nuestros de normalización temporal; por ejemplo, una `date_key` no debe renderizarse como si fuera medianoche UTC en Bolivia porque eso corre la etiqueta al día anterior

Aun así, próximos upgrades razonables a evaluar:

- mantener Groq para STT
- probar un modelo más fuerte para parseo
- evaluar DeepSeek como parser alternativo
- no mezclar todavía un cambio de modelo con cambios grandes de UX en el mismo paso

## Suggested Next Iteration

### Priority 1

Expandir el planner tool-based para que no solo clasifique, sino que pueda razonar con más grounding real:

- más tools de lectura y escritura seguras
- mejores aclaraciones multi-turn
- mejor continuidad conversacional
- confirmaciones explícitas antes de mutaciones sensibles

### Priority 2

Mejorar la experiencia de voz:

- mantener respuesta en texto siempre
- dejar la voz del navegador como fallback, no como experiencia ideal
- Cartesia ya puede cubrir la salida hablada inicial; lo siguiente es afinar voz, latencia percibida y manejo de interrupciones

### Priority 3

Pulir acciones realmente útiles del día a día:

- crear cita con lenguaje natural más libre
- consultar horas libres sin que eso se confunda con modificar disponibilidad
- comandos más comerciales y operativos

## Files To Read First In A New Chat

1. [docs/HANDOFF.md](/Users/dran/Documents/Codex%20openai/agenda4.0/docs/HANDOFF.md)
2. [CLAUDE.md](/Users/dran/Documents/Codex%20openai/agenda4.0/CLAUDE.md)
3. [docs/VOICE-APP-REPORT.md](/Users/dran/Documents/Codex%20openai/agenda4.0/docs/VOICE-APP-REPORT.md)
4. [client/src/pages/VoiceAssistant.jsx](/Users/dran/Documents/Codex%20openai/agenda4.0/client/src/pages/VoiceAssistant.jsx)
5. [server/routes/voice.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/routes/voice.js)
6. [server/services/voice/parseCommand.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/parseCommand.js)
7. [server/services/voice/planner.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/planner.js)
8. [server/services/voice/context.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/context.js)
9. [server/services/voice/executeCommand.js](/Users/dran/Documents/Codex%20openai/agenda4.0/server/services/voice/executeCommand.js)

## Suggested Prompt For The Next Chat

Usar algo de este estilo:

> Lee `docs/HANDOFF.md`, `CLAUDE.md` y `docs/VOICE-APP-REPORT.md`.  
> Quiero continuar la app privada `/voice` de Agenda Daniel MacLean.  
> Prioridad: que entienda lenguaje natural mucho mejor y que el UX se sienta premium, rápido y nada torpe.  
> No tocar el flujo cliente. Todo cambio debe quedar aislado a la capa de voz/admin.
