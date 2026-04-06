# HANDOFF

## Purpose

Short operational snapshot for future chats.
Read this first, then read `CLAUDE.md` and `LESSONS-LEARNED.md` if the task touches behavior or production safety.
If the task is about the private voice app, also read `docs/VOICE-APP-REPORT.md`.

## Last Updated

- Date: 2026-04-06
- Branch: `main`
- Commit: `f6a8cf5` (base pushed commit before the latest voice/GCal follow-up)
- Summary: recurring schedules were implemented end to end with lazy materialization, reminder integration, admin UI support, analytics, and voice controls; latest local follow-up adds stronger voice phrasing coverage plus GCal conversion from the source appointment
- UI follow-up: Clients and Appointments now expose a visible `Recurrencia` field/column with quick manual actions, instead of leaving recurrence implied by badges or backend runtime only
- Recurring follow-up: materializing a recurring occurrence now reuses the Google Calendar instance ID when the occurrence already comes from a recurring series, instead of creating a duplicate event
- Recurring sync follow-up: a daily 06:00 BOT cron now scans the next 14 days of GCal for recurring therapy events and can auto-create missing `recurring_schedules`
- Recurring lifecycle follow-up: pause/end inside the app does not automatically delete the master recurring event in Google Calendar; the app simply stops materializing/sending reminders for that schedule
- Voice recurring follow-up: the parser now recognizes `Fulano pasa a modo recurrencia`, `Fulano pasa a recurrencia`, and `Fulano está en recurrencia`
- Voice GCal follow-up: activating recurrence from voice now uses the client’s next standalone future appointment as source when possible and converts that Google Calendar event into a weekly recurring series instead of always creating a separate master event
- Voice status follow-up: voice can now answer whether a client is actively in recurrence, paused, ended, or not recurrent at all
- Voice integration follow-up: if recurrence is activated in the app but Google Calendar does not confirm the recurring series, voice now answers with an explicit warning instead of a false success
- UI follow-up: reschedule screen copy now injects the client name in the banner, "already booked" title, and trust message
- CI follow-up: GitHub `Frontend Guard` was failing because `client/dist` was out of sync with source; local `lint` and `build` passed, but `git diff --exit-code -- client/dist` failed
- OCR follow-up: destination validation must depend on exact matches against whitelisted destination accounts after stripping separators
- BNB follow-up: some BNB receipts expose a top `Cuenta:` block plus a lower destination block; OCR must prioritize `Nombre del destinatario` and `Se acreditó a la cuenta` instead of generic `Cuenta:`
- Appointments UI follow-up: appointments toolbar now labels the date-range inputs clearly (`Desde`, `Hasta`) and supports sorting by date, name, created-at, and status
- Receipt mismatch follow-up: WhatsApp mismatch replies now enumerate reasons as bullet points, not slash-separated text
- Receipt destination rule: recipient validation now depends only on matching a whitelisted destination bank account; recipient names are informational only
- OCR debug follow-up: WhatsApp inbox now shows a temporary raw OCR text box to inspect exactly what Google Vision returned on digital receipts
- BNB parser follow-up: `La suma de Bs.:` must be recognized as amount and `Bancarización:` can be used as the extracted reference when no numeric transfer code is present
- Date validation follow-up: receipt date must be compared against the latest payment context sent by WhatsApp (reminder/QR), not against the appointment date
- Branding follow-up: public URLs must use `https://agenda.danielmaclean.com/` and browser-visible app name should be `Agenda Daniel MacLean`
- Voice shortcut follow-up: first MVP must stay isolated from client-facing flows and support only informational commands
- Voice shortcut expansion: now supports richer operational queries and a controlled create-appointment action for existing clients only
- Voice shortcut actions: now also supports reminder toggles, manual reminder sends for today/tomorrow, and day-level availability changes split by morning/tarde while respecting the midday pause
- Voice web app: new private route `/voice` now provides a dedicated mobile-first voice console with real audio recording, text fallback, spoken replies, and recent command history
- Voice natural-language booking: create-appointment parsing is now more tolerant of phrases like `nueva cita para Fidalgo el martes a las 8`, and ambiguous client names should trigger human clarification prompts instead of rigid format errors
- Voice integration guardrail: if Google Calendar returns `invalid_grant`, voice booking now replies with a human message about reconnecting Google instead of looking like an LLM/intelligence failure
- Voice safety guardrail: availability commands now require an explicit change directive, so queries like `horas libres para el lunes` should no longer mutate or fake-update availability
- Google OAuth follow-up: temporary token-generation script should be removed after successful setup; root package must stay CommonJS and should not keep `open` or `"type": "module"` just for one-off token generation

## Current State

- Canonical phone rule:
  store and compare phones as digits only, with country code, no `+`, no spaces, no separators
- Input handling now normalizes phone values before validation or comparison
- Admin client forms now strip non-digits while typing
- Public booking and reschedule flows now compare normalized phone values
- WhatsApp webhook client resolution now matches by normalized phone
- Payment receipt matching now matches by normalized phone
- Reminder matching fallback now matches by normalized phone
- Recurring schedules now exist as first-class operational data:
  `recurring_schedules` stores the weekly pattern and `appointments.source_schedule_id` links materialized occurrences back to that pattern
- New recurring admin API exists at `/api/recurring`
- Dashboard `/Hoy` now mixes real appointments with same-day virtual recurring sessions and materializes a virtual session automatically when the admin changes its status
- Clients UI now shows a weekly badge plus day/time for active recurring clients and lets admin activate, edit, pause, resume, or end the schedule from the client modal
- Clients UI now also shows an explicit `Recurrencia` column in the main table:
  `—` when there is no active recurrence, `Recurrente` or `Pausada` when it exists, plus quick dropdown actions to open the client, pause, reactivate, or quitar recurrencia
- Appointments UI now also shows an explicit `Recurrencia` column tied to the client’s current schedule, with quick dropdown actions to pause, reactivate, or quitar recurrencia directly from the appointments list
- Analytics now exposes recurring totals, paused/ended counts, 90-day churn, and projected monthly recurring revenue
- Voice admin now supports `activate_recurring`, `pause_recurring`, `resume_recurring`, and `deactivate_recurring`
- Voice admin now also supports `recurring_status`
- Reminder flow now tries recurring matching before the old phone-summary fallback so recurring sessions become real appointments before WhatsApp sends
- Voice activation of recurrence now prefers converting the next standalone future appointment in Google Calendar into a weekly recurring event
- If recurrence is changed manually in Google Calendar, the daily `recurringSync` cron can import it back into the app from `recurringEventId`
- Payment success WhatsApp reply is being simplified to `✅ Pago recibido correctamente, ¡Gracias!`
- Automatic QR follow-up after reminder confirmation no longer depends strictly on `booking_context`; for Bolivian clients, legacy/manual appointments without location metadata should still receive the correct QR by fee
- Voice Shortcut MVP is now being added as a separate backend module with Groq transcription, token auth, and audit logging
- Voice Shortcut now supports reminder checks, confirmation checks, rescheduled lists, monthly new-client counts, pending-amount totals, unconfirmed tomorrow, confirmed today, weekly appointment counts, and appointment creation for existing clients
- Voice Shortcut local expansion now includes:
  reminder on/off, reminder send today/tomorrow, and availability updates like `jueves de 8 a 12 en la mañana, en la tarde nada`
- The new primary UX layer for admin voice is now the private web app at `/voice`, authenticated with the normal admin JWT instead of exposing `VOICE_ADMIN_TOKEN` to the browser
- Voice booking parsing now resolves relative dates like `mañana` and weekdays like `martes` directly before falling back to the LLM
- Voice planner follow-up: `/voice` now keeps short recent context, stores `result_data` in `voice_commands_log`, resolves clarifications like `el otro` / `el de Santa Cruz`, and can use read-only grounding tools before deciding the final command
- Voice TTS follow-up: `/voice` now has backend Cartesia TTS at `POST /api/voice/tts`, with browser `speechSynthesis` kept only as fallback if Cartesia fails or is unavailable
- Voice agenda follow-up: `/voice` now resolves agenda day/week queries more deterministically before the LLM, including `mañana`, weekdays, `esta semana`, and `la próxima semana`
- Voice date-label follow-up: calendar-date labels in voice replies must be formatted as pure dates, so explicit dates like `2026-04-08` no longer drift back one day in Bolivia
- Google integrations are healthy again with the new `agenda40` Google Cloud project:
  Calendar, Sheets, and People all authenticate from the backend using the same refresh token and current Hostinger env vars
- There is now a dedicated starter report for the voice product line in `docs/VOICE-APP-REPORT.md`
- WhatsApp QR follow-up after `CONFIRM_NOW` now records explicit `enviado`, `skipped`, and `error` entries in `webhooks_log` to diagnose cases where the client says the QR never arrived

## Files Changed In Latest Work

- `CLAUDE.md`
- `docs/HANDOFF.md`
- `server/utils/phone.js`
- `server/middleware/validate.js`
- `server/routes/clients.js`
- `server/services/booking.js`
- `server/routes/config.js`
- `server/services/publicBookingToken.js`
- `server/routes/booking.js`
- `server/routes/webhook.js`
- `server/routes/voice.js`
- `server/routes/recurring.js`
- `server/routes/payments.js`
- `server/services/reminder.js`
- `server/services/recurring.js`
- `server/services/recurringSync.js`
- `server/services/messageContext.js`
- `server/services/voice/cartesia.js`
- `server/services/voice/context.js`
- `server/services/voice/planner.js`
- `server/services/voice/parseCommand.js`
- `server/services/voice/executeCommand.js`
- `docs/VOICE-APP-REPORT.md`
- `server/services/calendar.js`
- `server/services/retention.js`
- `server/cron/scheduler.js`
- `server/db.js`
- `server/index.js`
- `server/routes/analytics.js`
- `client/src/pages/VoiceAssistant.jsx`
- `client/src/pages/Admin/Analytics.jsx`
- `client/src/pages/Admin/Appointments.jsx`
- `client/src/pages/Admin/Clients.jsx`
- `client/src/pages/Admin/Dashboard.jsx`
- `client/src/utils/dates.js`

## Important Decisions

- We did not run any aggressive migration over old client data
- We did not merge existing clients automatically
- The current fix is forward-safe: new writes and comparisons should use canonical phone format
- Recurring implementation scope:
  lazy materialization was chosen over infinite appointment rows
  recurring reminders materialize on demand
  app-side pause/end does not destructively edit Google Calendar master series
- Voice recurring scope:
  activation by voice should convert the client’s next standalone future Google Calendar event into a weekly recurrence when possible
  if no suitable source appointment exists, voice may still create a new recurring series
- Never push automatically. Ask the user explicitly before every push.
- Untracked mockup files were intentionally not committed:
  `Skills/`, `ocr-sample.png`, `ocr-sample-2.png`

## Validation Done

- Backend syntax check passed with `node --check` on all touched server files
- Additional backend syntax checks passed for:
  `server/services/recurring.js`
  `server/routes/recurring.js`
  `server/services/reminder.js`
  `server/services/calendar.js`
  `server/routes/analytics.js`
  `server/routes/clients.js`
  `server/cron/scheduler.js`
  `server/services/voice/parseCommand.js`
  `server/services/voice/executeCommand.js`
  `server/services/voice/planner.js`
- Voice parser smoke check passed locally for:
  `Juan Perez pasa a modo recurrencia`
  `Juan Perez pasa a recurrencia`
  `Juan Perez esta en recurrencia`
- No real client build was available from root `package.json`
  current `build` script is a no-op placeholder
- Frontend guard diagnosis:
  `npm run lint` passed with warnings only
  `npm run build` passed
  failure source was the committed `client/dist` being stale
- Client build passed after recurring changes and refreshed `client/dist`
- Client lint passed with warnings only; no new lint errors were introduced by the recurring work
- OCR destination validation was tightened:
  valid destination now requires an exact whitelisted destination account after stripping spaces and hyphens; recipient names are display-only
- BNB parsing was tightened:
  generic `cuenta` fallback no longer has priority over destination-specific labels
- Appointments list now supports backend-driven sorting through `sort_by` and `sort_dir` query params
- Receipt mismatch detection now stores separate destination verification flags (`destNameVerified`, `destAccountVerified`) to avoid losing the `destinatario` reason
- OCR `Para ...` parsing was fixed to stay on the same line and avoid capturing labels like `CI/NIT` as the recipient name
- Destination validation now also accepts an exact whitelisted bank account found anywhere in the OCR text after stripping separators like spaces and hyphens
- WhatsApp inbox should show both parsed OCR fields and raw OCR text for debugging until receipt parsing stabilizes
- BNB OCR parsing now recognizes `La suma de Bs.:` as amount, strips the stray leading `:` from `Nombre del destinatario`, and uses `Bancarización:` as reference when needed
- Receipt date validation now uses the latest outbound payment-context message date instead of the appointment date, so same-day prepayments for tomorrow's session are accepted
- Local rename in progress:
  hardcoded public domain is being moved to `agenda.danielmaclean.com`, and browser-visible branding to `Agenda Daniel MacLean`
- Voice Shortcut MVP scope:
  iPhone Shortcut only, audio + text input, short operational responses, secret-token auth, informational commands only, logged in DB
- Voice Shortcut v1.1 scope:
  still isolated from public/client flows, but now allows creating an appointment for an existing client when the command includes a unique client plus explicit date and time
- Voice Shortcut v1.2 scope:
  still isolated from public/client flows, now also allows operational admin actions over reminders and weekly availability without adding any client-facing UI weight
- Voice web app scope:
  private route only, audio-first, mobile-friendly, elegant minimal UI, text responses always visible, browser speech output optional, and recent command history loaded from `voice_commands_log`
- Voice planner scope:
  heuristics first, then recent-context follow-up resolution, then tool-grounded planning, then execution; the LLM should no longer behave like a blind classifier with no operational memory
- Voice agenda scope:
  when the user asks for agenda by relative day or week range, parse to a deterministic day or `agenda_scope` first; do not let `agenda_query` silently fall back to `hoy` just because the LLM omitted a `date_key`
- Voice TTS scope:
  Cartesia runs server-side so the browser never sees `CARTESIA_API_KEY`; `/voice` should prefer Cartesia audio and fall back to browser speech only on failure
- Google OAuth cleanup scope:
  remove `generate-token.js` after token generation, remove `open` from dependencies, keep backend runtime in CommonJS, and document the new `agenda40` setup in both `HANDOFF.md` and `CLAUDE.md`
- WhatsApp confirmation QR follow-up was syntax-checked after making the Bolivia fallback less strict for legacy/manual appointments
- Voice agenda smoke check against production DB confirmed:
  `lunes` resolves to `2026-04-06`, `próxima semana` resolves to the range `2026-04-06` to `2026-04-13`, and explicit voice date labels no longer render one day early

## Known Follow-Ups

- Optional: normalize legacy phone values already stored in DB
- Optional: add DB-level migration to rewrite old formatted phones to canonical format
- Optional: add automated tests for phone normalization across booking, clients, and webhook flows
- Optional: add unique enforcement strategy for legacy environments if old data becomes real instead of mockup
- Optional: if desired, standardize punctuation in personalized UI copy across the rest of `BookingFlow.jsx`
- Optional: add a DB-level unique constraint for recurring materializations if legacy data is first cleaned; for now duplication is prevented with advisory locks plus existence checks
- Optional: decide whether pausing/finalizing in app should also patch or cancel the master recurring event in Google Calendar after a human-reviewed UX decision
- Optional: add a small recurring trend chart in Analytics if monthly series visibility becomes commercially useful

## Useful Commands

- Current status:
  `git -C "/Users/dran/Documents/Codex openai/agenda4.0" status --short`
- Latest commit:
  `git -C "/Users/dran/Documents/Codex openai/agenda4.0" log -1 --oneline`
- Run server:
  `npm start`
- Dev mode:
  `npm run dev`

## Update Rule

When finishing an important task, update this file and `CLAUDE.md` together with:

- date
- branch
- latest commit
- what changed
- what was intentionally not changed
- what remains risky or pending
