# HANDOFF

## Purpose

Short operational snapshot for future chats.
Read this first, then read `CLAUDE.md` and `LESSONS-LEARNED.md` if the task touches behavior or production safety.

## Last Updated

- Date: 2026-04-03
- Branch: `main`
- Commit: `98a887f`
- Summary: receipt validation is stable again; local pending changes rename the public domain to `agenda.danielmaclean.com`, rename the app to `Agenda Daniel MacLean`, and simplify the payment success copy
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

## Current State

- Canonical phone rule:
  store and compare phones as digits only, with country code, no `+`, no spaces, no separators
- Input handling now normalizes phone values before validation or comparison
- Admin client forms now strip non-digits while typing
- Public booking and reschedule flows now compare normalized phone values
- WhatsApp webhook client resolution now matches by normalized phone
- Payment receipt matching now matches by normalized phone
- Reminder matching fallback now matches by normalized phone
- Payment success WhatsApp reply is being simplified to `✅ Pago recibido correctamente, ¡Gracias!`
- Voice Shortcut MVP is now being added as a separate backend module with Groq transcription, token auth, and audit logging

## Files Changed In Latest Work

- `server/utils/phone.js`
- `server/middleware/validate.js`
- `server/routes/clients.js`
- `server/services/booking.js`
- `server/routes/config.js`
- `server/services/publicBookingToken.js`
- `server/routes/booking.js`
- `server/routes/webhook.js`
- `server/routes/payments.js`
- `server/services/reminder.js`
- `server/services/messageContext.js`
- `client/src/pages/Admin/Clients.jsx`

## Important Decisions

- We did not run any aggressive migration over old client data
- We did not merge existing clients automatically
- The current fix is forward-safe: new writes and comparisons should use canonical phone format
- Never push automatically. Ask the user explicitly before every push.
- Untracked mockup files were intentionally not committed:
  `Skills/`, `ocr-sample.png`, `ocr-sample-2.png`

## Validation Done

- Backend syntax check passed with `node --check` on all touched server files
- No real client build was available from root `package.json`
  current `build` script is a no-op placeholder
- Frontend guard diagnosis:
  `npm run lint` passed with warnings only
  `npm run build` passed
  failure source was the committed `client/dist` being stale
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

## Known Follow-Ups

- Optional: normalize legacy phone values already stored in DB
- Optional: add DB-level migration to rewrite old formatted phones to canonical format
- Optional: add automated tests for phone normalization across booking, clients, and webhook flows
- Optional: add unique enforcement strategy for legacy environments if old data becomes real instead of mockup
- Optional: if desired, standardize punctuation in personalized UI copy across the rest of `BookingFlow.jsx`

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

When finishing an important task, update this file with:

- date
- branch
- latest commit
- what changed
- what was intentionally not changed
- what remains risky or pending
