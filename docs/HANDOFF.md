# HANDOFF

## Purpose

Short operational snapshot for future chats.
Read this first, then read `CLAUDE.md` and `LESSONS-LEARNED.md` if the task touches behavior or production safety.
If the task is about the private voice app, also read `docs/VOICE-APP-REPORT.md`.

## Last Updated

- Date: 2026-04-07
- Branch: `main`
- Commit: `feb7a8b`
- Summary: admin mobile safe-area/notch fix deployed; `/admin` now resolves to `Comandos`; recurring schedules now choose a better source appointment, surface Google Calendar sync failures, and voice can activate recurrence with simpler phrasing
- Complexity note: this took longer than expected because the failure was split across 4 layers at once:
  `WKWebView`/safe-area behavior on iPhone, admin route entry behavior, recurring backend silently swallowing Google Calendar failures, and a separate voice parser path that did not share the same recurrence heuristics
- Workspace follow-up: booking concurrency hardening is now in progress without changing public UX; active appointments reserve minute-level slot claims in MySQL so overlapping concurrent bookings fail at DB level too
- UI follow-up: Clients and Appointments now expose a visible `Recurrencia` field/column with quick manual actions, instead of leaving recurrence implied by badges or backend runtime only
- UI follow-up 2: recurrence no longer depends on opening the full client popup; there is now a dedicated short recurrence modal
- Recurring follow-up: materializing a recurring occurrence now reuses the Google Calendar instance ID when the occurrence already comes from a recurring series, instead of creating a duplicate event
- Recurring sync follow-up: a daily 06:00 BOT cron now scans the next 14 days of GCal for recurring therapy events and can auto-create missing `recurring_schedules`
- Recurring lifecycle update: ending a recurring schedule now deletes the GCal master recurring series (best-effort, never blocks); pausing still does NOT touch GCal (intentional — the app just stops materializing/sending reminders)
- SSE follow-up: admin pages now auto-refresh via Server-Sent Events when data changes — no manual refresh needed for appointments, clients, recurring, payments, or dashboard
- Quick Actions fix: cancel route now calls `endRecurringSchedule()` service instead of direct SQL, so GCal deletion also happens from Quick Actions
- Voice recurring follow-up: the parser now recognizes `Fulano pasa a modo recurrencia`, `Fulano pasa a recurrencia`, and `Fulano está en recurrencia`
- Voice recurring follow-up 2: the parser now also recognizes `Fulano entra en recurrencia`
- Voice recurring follow-up 3: the parser now also recognizes simpler phrases like `pon en recurrencia a Fulano` and `pon a Fulano en recurrencia`
- Voice GCal follow-up: activating recurrence from voice now prefers the client’s latest standalone completed appointment as source, then falls back to the next standalone future appointment
- Voice status follow-up: voice can now answer whether a client is actively in recurrence, paused, ended, or not recurrent at all
- Voice integration follow-up: if recurrence is activated in the app but Google Calendar does not confirm the recurring series, voice now answers with an explicit warning instead of a false success
- Admin mobile follow-up: `/admin` now redirects to `/admin/quick-actions`; the dashboard moved to `/admin/dashboard`
- Admin mobile follow-up 2: the header/hamburger now respects the iPhone notch using `viewport-fit=cover` plus an explicit safe-area spacer, because relying on header padding alone was not enough inside the wrapper
- Recurring reliability follow-up: admin recurrence no longer assumes a completed session is mandatory; it now falls back to the next standalone future appointment when no completed base exists
- Recurring UX follow-up: Clients, Appointments, and Quick Actions now warn explicitly when the recurrence was saved in the app but Google Calendar did not confirm the weekly series
- Quick Actions follow-up: `/admin/quick-actions` is now a full command center (not a placeholder); it is the first sidebar item
- Quick Actions scope: 6 client actions (reschedule link, cancel, no-show, reminder, recurring, fee change), instant search, WhatsApp integration, result feedback panel, quick settings toggle
- Quick Actions backend: `server/routes/quickActions.js` with 6 auth-protected endpoints, all logged to `webhooks_log`
- Bug fix: `eventStart` undefined in `reminder.js` Try 3 fallback replaced with `event.start?.dateTime || event.start?.date`
- Bug fix: UNIQUE KEY `(tenant_id, client_id, day_of_week, time, started_at)` added to `recurring_schedules` as migration
- Bug fix: MRR calculation in analytics now respects `clients.frequency` (Semanal=4.33, Quincenal=2.17, Mensual=1) instead of hardcoded ×4.33
- Safety tag: `pre-recurring-fixes` tag created at commit `be55f34` as rollback point before bug fixes
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
- Booking concurrency hardening now exists in the backend:
  `appointment_slot_claims` reserves every minute covered by active appointments (`Agendada`, `Confirmada`, `Reagendada`) with a DB unique constraint on `(tenant_id, claim_time)`
  public booking, reschedule, recurring materialization, admin status changes, Quick Actions cancel/no-show, and auto-complete all sync those claims
  the public/client flow and API contract stay the same: no extra screen, no extra confirmation step, no extra client-side waiting state
- Booking flow intentionally stays operationally conservative for now:
  Google Calendar is still created before the DB commit and the day-scoped advisory lock is still in place
  this was not changed in this pass to avoid regressions in the current production flow
- Dashboard `/Hoy` now mixes real appointments with same-day virtual recurring sessions and materializes a virtual session automatically when the admin changes its status
- Clients UI now shows a weekly badge plus day/time for active recurring clients and lets admin activate, edit, pause, resume, or end the schedule from the client modal
- Clients UI now also shows an explicit `Recurrencia` column in the main table:
  `—` when there is no active recurrence, `Recurrente` or `Pausada` when it exists, plus a dedicated short recurrence modal and quick actions to pause, reactivate, or quitar recurrencia
- Appointments UI now also shows an explicit `Recurrencia` column tied to the client’s current schedule, with a dedicated short recurrence modal and quick actions to pause, reactivate, or quitar recurrencia directly from the appointments list
- Appointments UI is now the main fast path for recurrence:
  the quick modal preloads the latest completed session as source and defaults recurrence to the same weekday and hour as that session, while still letting the admin change day, time, or start date
- Appointments/Clients recurrence base rule is now:
  latest standalone completed appointment first, otherwise next standalone future appointment (`Agendada`, `Confirmada`, `Reagendada`)
- Recurring backend now returns transient sync metadata on create/update/resume:
  `gcal_sync_status` and `integration_warning`
  admin surfaces must use these fields to avoid fake success when Google Calendar did not confirm the weekly series
- Analytics now exposes recurring totals, paused/ended counts, 90-day churn, and projected monthly recurring revenue
- Voice admin now supports `activate_recurring`, `pause_recurring`, `resume_recurring`, and `deactivate_recurring`
- Voice admin now also supports `recurring_status`
- Reminder flow now tries recurring matching before the old phone-summary fallback so recurring sessions become real appointments before WhatsApp sends
- Voice activation of recurrence now prefers converting the latest standalone completed appointment in Google Calendar into a weekly recurring event, then falls back to the next standalone future appointment
- Voice recurring parser now supports simpler direct phrasing:
  `pon en recurrencia a Fulano`
  `poner en recurrencia a Fulano`
  `pon a Fulano en recurrencia`
- If recurrence is changed manually in Google Calendar, the daily `recurringSync` cron can import it back into the app from `recurringEventId`
- Admin pages now auto-refresh via SSE (Server-Sent Events):
  `GET /api/admin/events` is a persistent SSE connection that broadcasts `appointment:change`, `recurring:change`, `payment:change`, `client:change`
  Dashboard, Appointments, Clients, Finance, and Quick Actions all listen and auto-reload on relevant events
  SSE heartbeat every 25s keeps the connection alive through proxies
  The auth middleware now also accepts `?token=` query param so EventSource (which cannot set custom headers) can authenticate
- Ending a recurring schedule from the admin (via `/api/recurring/:id/end`, Quick Actions cancel, or voice) now also deletes the GCal master recurring series
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

## Files Changed In Latest Work (SSE + GCal Recurring Fix)

- `server/services/adminEvents.js` (NEW — SSE broadcast service with tenant isolation)
- `server/services/recurring.js` (endRecurringSchedule now deletes GCal master series)
- `server/middleware/auth.js` (accept ?token= query param for EventSource SSE)
- `server/index.js` (mount SSE endpoint /api/admin/events)
- `server/routes/quickActions.js` (cancel now calls endRecurringSchedule service + broadcasts)
- `server/routes/appointments.js` (broadcast on status change and delete)
- `server/routes/recurring.js` (broadcast on create/update/pause/resume/end/materialize)
- `server/routes/booking.js` (broadcast on book and reschedule)
- `server/routes/webhook.js` (broadcast on CONFIRM_NOW and payment auto-match)
- `server/routes/payments.js` (broadcast on manual payment status change)
- `client/src/hooks/useAdminEvents.js` (NEW — SSE React hook with debounce + reconnect)
- `client/src/pages/Admin/Dashboard.jsx` (wired SSE auto-refresh)
- `client/src/pages/Admin/Appointments.jsx` (wired SSE auto-refresh)
- `client/src/pages/Admin/Clients.jsx` (wired SSE auto-refresh)
- `client/src/pages/Admin/Finance.jsx` (wired SSE auto-refresh)
- `client/src/pages/Admin/QuickActions.jsx` (wired SSE auto-refresh)
- `client/dist/` (rebuilt)
- `CLAUDE.md`
- `docs/HANDOFF.md`

## Files Changed In Latest Work (Recurring Reliability + Admin iPhone Safe Area)

- `client/index.html` (`viewport-fit=cover` for iPhone/WKWebView safe area)
- `client/src/components/AdminLayout.jsx` (real notch spacer + safer mobile hamburger positioning)
- `client/src/components/RecurringQuickModal.jsx` (less misleading recurrence source copy)
- `client/src/pages/Admin/Clients.jsx` (recurrence source fallback + explicit Google sync warning)
- `client/src/pages/Admin/Appointments.jsx` (same recurrence source/sync-warning behavior)
- `client/src/pages/Admin/QuickActions.jsx` (same recurrence sync-warning behavior)
- `client/src/utils/recurring.js` (NEW — shared recurrence source + sync-warning helpers)
- `server/services/recurring.js` (default source fallback, safer source conversion, explicit sync metadata on create/update/resume)
- `server/services/voice/executeCommand.js` (reuse recurrence source logic + warn when GCal does not confirm update/create/resume)
- `server/services/voice/parseCommand.js` (recognize `pon en recurrencia a ...` phrasing)
- `client/dist/` (rebuilt)
- `CLAUDE.md`
- `docs/HANDOFF.md`

## Current Workspace Changes (Booking Concurrency Hardening)

- `server/services/appointmentSlotClaims.js` (NEW — minute-level DB slot claim helper shared across booking/status flows)
- `server/db.js` (creates `appointment_slot_claims` table + startup backfill for active appointments)
- `server/services/booking.js` (stores `appointments.duration` and claims slot minutes inside the booking transaction)
- `server/services/recurring.js` (claims slot minutes when materializing recurring occurrences)
- `server/routes/appointments.js` (status changes now sync slot claims transactionally)
- `server/routes/quickActions.js` (cancel/no-show now release slot claims transactionally)
- `server/cron/scheduler.js` (auto-complete now releases slot claims transactionally)
- `CLAUDE.md`
- `docs/HANDOFF.md`

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
- Complexity lesson from the latest pass:
  recurrence could not be fixed correctly in a single file because the visible bug was produced by inconsistent assumptions across backend sync, three admin entry points, and the voice parser
  similarly, the admin mobile header looked like a CSS-only issue but the real fix also required `viewport-fit=cover` so iPhone would expose the safe area correctly inside the wrapper
- We did not add any new client-facing step, modal, spinner, or extra API hop for booking concurrency hardening
- We intentionally kept the current GCal-first booking order and day-scoped advisory lock in this pass to minimize production regression risk
- Never push automatically. Ask the user explicitly before every push.
- Untracked mockup files were intentionally not committed:
  `Skills/`, `ocr-sample.png`, `ocr-sample-2.png`

## Validation Done

- Backend syntax check passed with `node --check` on all 9 touched server files (SSE + GCal fix):
  `server/services/adminEvents.js`, `server/middleware/auth.js`, `server/index.js`,
  `server/routes/quickActions.js`, `server/routes/appointments.js`, `server/routes/recurring.js`,
  `server/routes/booking.js`, `server/routes/webhook.js`, `server/routes/payments.js`
- Frontend build passed after wiring `useAdminEvents` hook into Dashboard, Appointments, Clients, Finance, QuickActions
- Previous backend syntax check passed with `node --check` on all touched server files
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
- Frontend build passed after adding:
  the dedicated recurrence modal,
  fast recurrence entry from Appointments,
  reusable recurrence entry from Clients,
  and the `Comandos` placeholder page in the sidebar
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
- Booking concurrency hardening syntax checks passed for:
  `server/services/appointmentSlotClaims.js`
  `server/services/booking.js`
  `server/services/recurring.js`
  `server/routes/appointments.js`
  `server/routes/quickActions.js`
  `server/cron/scheduler.js`
  `server/db.js`
- 2026-04-07 — branch `main` — theme sensitivity pass:
  admin login, admin shell, recurring modal, toast, and `/voice` now support `system | light | dark` via `useUiTheme` + `ThemeModeButton`; system mode follows `prefers-color-scheme`, user override persists in `localStorage`, and `client/dist` was rebuilt
- 2026-04-07 — not changed intentionally:
  no Meta reschedule template wiring yet; `POST /api/quick-actions/send-reschedule-link` still sends free-form WhatsApp text because no approved reschedule template name/shape has been wired into `server/services/whatsapp.js`
- 2026-04-07 — Meta template status:
  payment reminder is already wired end-to-end via `sendPaymentReminderTemplate()` plus config/env override
  reschedule link is not; next step is to add a dedicated template sender and switch quick actions to use it
- 2026-04-07 — Meta template wiring updated:
  quick actions reschedule link now uses approved template `reprogramar_sesion` with `{{1}} = nombre` and `{{2}} = link`
  payment reminder fallback template now points to `recordatorio_pago`
  current payment sender assumes the approved template body only needs `{{1}} = nombre`
- 2026-04-07 — Admin mobile layout fix:
  dark theme CSS was forcing `position: relative` onto every direct child of `.admin-shell`, which broke the fixed mobile sidebar and pushed the whole admin canvas to the right on iPhone
  that selector was removed and the frontend bundle was rebuilt
- 2026-04-08 — Quick Actions naming + payment reminder:
  admin `Comandos` now includes a dedicated manual action for payment reminders
  button labels were refined for mobile readability: `Recordar cita`, `Recordar cobro`, `Gestionar recurrencia`, `Ajustar arancel`
  the action grid now supports two-line labels with consistent height and centered text
  manual payment reminder bypasses the scheduled toggle/window and targets a single client on purpose

## Known Follow-Ups

- Optional: normalize legacy phone values already stored in DB
- Optional: add DB-level migration to rewrite old formatted phones to canonical format
- Optional: add automated tests for phone normalization across booking, clients, and webhook flows
- Optional: add unique enforcement strategy for legacy environments if old data becomes real instead of mockup
- Optional: once production risk is acceptable, move Google Calendar creation to post-commit retry/outbox so DB becomes the primary source of truth instead of the external system
- Optional: if desired, standardize punctuation in personalized UI copy across the rest of `BookingFlow.jsx`
- Optional: add a DB-level unique constraint for recurring materializations if legacy data is first cleaned; for now duplication is prevented with advisory locks plus existence checks
- DONE: ending recurrence now deletes GCal series; pausing intentionally does NOT
- DONE: SSE real-time admin updates — Dashboard, Appointments, Clients, Finance, Quick Actions all auto-refresh
- Optional: add a small recurring trend chart in Analytics if monthly series visibility becomes commercially useful
- Optional: create WhatsApp templates (Meta-approved) for cancel notification and no-show notification instead of using free-form text messages
- Pending verification: confirm in production that Meta accepted `recordatorio_pago` with only one body placeholder; if the approved template has more fields, update the sender to provide them

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
