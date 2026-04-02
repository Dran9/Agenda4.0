# HANDOFF

## Purpose

Short operational snapshot for future chats.
Read this first, then read `CLAUDE.md` and `LESSONS-LEARNED.md` if the task touches behavior or production safety.

## Last Updated

- Date: 2026-04-02
- Branch: `main`
- Commit: `0cf7e02`
- Summary: normalized phone handling across admin, booking, WhatsApp, reminders, payment matching, and public tokens
- UI follow-up: reschedule screen copy now injects the client name in the banner, "already booked" title, and trust message
- CI follow-up: GitHub `Frontend Guard` was failing because `client/dist` was out of sync with source; local `lint` and `build` passed, but `git diff --exit-code -- client/dist` failed
- OCR follow-up: destination-account validation was too permissive and could treat some invalid receipts as valid if a whitelisted account appeared anywhere in the OCR text
- BNB follow-up: some BNB receipts expose a top `Cuenta:` block plus a lower destination block; OCR must prioritize `Nombre del destinatario` and `Se acreditó a la cuenta` instead of generic `Cuenta:`
- Appointments UI follow-up: appointments toolbar now labels the date-range inputs clearly (`Desde`, `Hasta`) and supports sorting by date, name, created-at, and status
- Receipt mismatch follow-up: WhatsApp mismatch replies now enumerate reasons as bullet points, not slash-separated text

## Current State

- Canonical phone rule:
  store and compare phones as digits only, with country code, no `+`, no spaces, no separators
- Input handling now normalizes phone values before validation or comparison
- Admin client forms now strip non-digits while typing
- Public booking and reschedule flows now compare normalized phone values
- WhatsApp webhook client resolution now matches by normalized phone
- Payment receipt matching now matches by normalized phone
- Reminder matching fallback now matches by normalized phone

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
  valid destination now requires a whitelisted destination account found in destination context, or a destination name that clearly matches Daniel
- BNB parsing was tightened:
  generic `cuenta` fallback no longer has priority over destination-specific labels
- Appointments list now supports backend-driven sorting through `sort_by` and `sort_dir` query params
- Receipt mismatch detection now stores separate destination verification flags (`destNameVerified`, `destAccountVerified`) to avoid losing the `destinatario` reason

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
