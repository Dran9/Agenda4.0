# agenda4.0 — Daniel MacLean

App de agendamiento de sesiones de psicoterapia. Deploy en Hostinger + Render (reminders legacy).

**Dueño:** Daniel MacLean, psicólogo en Cochabamba, Bolivia. Tel: 59172034151. WA Business: 59169650802.
**URLs:** producción `https://agenda.danielmaclean.com` · health `/api/health` · devmode `/?devmode=1`
**Repo:** `Dran9/Agenda4.0` rama `main`

## Stack
- Backend: Express + MySQL (Hostinger) — `server/`
- Frontend: React 18 + Vite + Tailwind — `client/`
- Integraciones: Google Calendar, Google Vision OCR, WhatsApp Cloud API

## Reglas Hostinger (CRÍTICAS)
- `dns.setDefaultResultOrder('ipv4first')` DEBE ser la primera línea de `server/db.js`
- `client/dist/` se commitea al repo — Hostinger no ejecuta builds
- El script `"build"` en `package.json` raíz es un **no-op** — Hostinger lo ejecuta en cada deploy
- Después de cambios en `client/`: `cd client && npm run build` → commitear `client/dist/`
- `express.static()` con `maxAge: 0, etag: false` — LiteSpeed cachea agresivamente
- SPA fallback usa `fs.readFileSync()`, no `res.sendFile()`

## Reglas React
- `type="button"` en todo `<button>` que no sea submit de form — sin esto, page reload y React state se borra
- BookingFlow usa `useReducer`, no múltiples useState
- Textos en español: NUNCA unicode escapes (`\u00f3`), siempre caracteres directos (`ó`, `é`, `í`, etc.)

## Reglas Timezone
- Siempre `America/La_Paz` (-04:00). Bolivia no tiene DST
- `timezone: '-04:00'` en mysql2 pool — NUNCA quitar
- `toISOString()` devuelve UTC — para mostrar horas en Bolivia usar `toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })`
- NUNCA doble conversión: `toLocaleString()` + `toLocaleTimeString()` resta 4h dos veces

## WhatsApp
- WABA ID: `1400277624968330` · Phone Number ID: `887756534426165`
- Graph API: `v22.0`
- Después de configurar Callback URL en Meta, ejecutar:
  ```bash
  curl -X POST "https://graph.facebook.com/v22.0/1400277624968330/subscribed_apps" \
    -H "Authorization: Bearer {WA_TOKEN}"
  ```
  Sin esto los mensajes reales no llegan.
- Template de recordatorio: `recordatorionovum26`
- BSUID: infraestructura lista en `server/services/whatsappIdentity.js`

## Preferencias de Daniel
- Sin emojis en la UI (excepto banderas en selector de país)
- Sin `AskUserQuestion`
- Responder TODAS las preguntas, sin cherry-pick
- Nunca hacer push sin pedido explícito
- Fonts: +2pt respecto al diseño base. No bajarlos
- Mobile: padding 12px móvil, 24px en >=520px

## Archivos clave
- `client/src/pages/BookingFlow.jsx` — flujo de booking público (screens 1-7)
- `client/src/utils/api.js` — fetch wrapper con auto-redirect a login en 401
- `server/routes/webhook.js` — webhook WhatsApp entrante
- `server/services/whatsappIdentity.js` — resolución BSUID ↔ teléfono
- `server/services/whatsapp.js` — envío de mensajes WA (phone o BSUID)
- `server/services/reminder.js` — recordatorios automáticos (cron 18:40 BOT)
- `server/db.js` — schema MySQL + migraciones (corren al arrancar)
- `server/routes/booking.js` — API pública de agendamiento
- `server/routes/clients.js` — CRUD clientes (soft-delete con `deleted_at`)
- `server/routes/quickActions.js` — 6 acciones admin (reagendar, cancelar, no-show, etc.)
- `server/middleware/auth.js` — JWT, tokens duran 7 días

## Flujo de booking
```
Calendario → Slot → Teléfono → Confirmar
  → "booked"           → Screen 5 (éxito)
  → "needs_onboarding" → campos slide-in → resubmit
  → "has_appointment"  → Screen 6 (cita existente + nueva) → Reagendar/Conservar
```
Recordatorio diario: GCal mañana → match DB → WhatsApp template → [Confirmo / Reagendar / Daniel]

## Modelo de datos WhatsApp
- `clients` — FK principal: `phone`
- `wa_conversations` — columnas: `client_phone`, `client_id`, `bsuid`
- `webhooks_log` — columnas: `client_phone`, `client_id`, `bsuid`
- `whatsapp_users` — identidad: `bsuid ↔ phone ↔ client_id`

## Variables de entorno
Ver `.env.example`. Se configuran en hPanel de Hostinger.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.
