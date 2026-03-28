# Lessons Learned -- Booking App Deployment and Bugs

This document exists so future Claude sessions can avoid repeating mistakes that cost hours of debugging time.

---

## Why Hostinger "suddenly" stopped deploying frontend changes

### Timeline
- For weeks, the app worked fine with hashed Vite filenames (e.g., `index-abc123.js`)
- On 2026-03-27/28, Daniel noticed frontend changes were not appearing on production
- Multiple "fixes" were attempted over hours before finding root causes

### Root Cause 1: `express.static` with `maxAge: '1y', immutable: true`
- The assets were served with `express.static(path, { maxAge: '1y', immutable: true })`
- This told BOTH the browser AND LiteSpeed (Hostinger's reverse proxy) to cache assets for 1 year and never re-validate
- Even `Cmd+Shift+R` could not reliably bust `immutable` cache
- LiteSpeed cached at the proxy level -- even `curl` got stale files
- **Fix**: Changed to `maxAge: 0, etag: false` for all static assets
- **Rule**: NEVER use maxAge or immutable on express.static in Hostinger/LiteSpeed environments

### Root Cause 2: Hostinger runs `npm run build` during deploy
- The root `package.json` had `"build": "cd client && npm install --include=dev && npm run build"`
- Hostinger's git deploy process executes this build script automatically
- This overwrote our pre-committed `client/dist/` with a fresh build
- BUT the fresh build used stale source code from Hostinger's disk (possibly cached `node_modules` or incomplete git checkout)
- Result: different file hashes than what we committed, and old code in the built files
- **Fix**: Changed build script to no-op: `"build": "echo 'client/dist is pre-built and committed -- skipping build'"`
- **Rule**: The build script in root package.json MUST be a no-op. We pre-build locally and commit dist.

### Root Cause 3: Debug endpoint had wrong filter
- Created `/api/debug-dist` to list files on Hostinger disk
- Filter `f.startsWith('index-')` did not match new fixed filenames like `app.js`
- This made it APPEAR that assets were missing when they actually existed
- Wasted hours thinking Hostinger was not creating files
- **Fix**: Removed the filter
- **Rule**: Debug tools must not have assumptions baked in

### Why it "worked before"
- Before, the hashed filenames changed on every build (e.g., `index-abc123.js` to `index-def456.js`)
- Even with `maxAge: 1y`, NEW filenames meant NEW URLs with no cache
- The `immutable` cache only became a problem when we switched to FIXED filenames (without hashes) as a "fix" for the deploy issue
- Additionally, Hostinger's build script was running successfully before because the source code on disk matched what we expected. At some point, the disk state diverged.

### Failed "fixes" that wasted time (DO NOT repeat these)
1. Adding `X-LiteSpeed-Cache-Control: no-cache` header -- LiteSpeed ignores this when express.static sets its own Cache-Control
2. Adding `.htaccess` with RewriteRule for cache -- does not override Express headers
3. Switching to fixed filenames (no hashes) -- made the immutable cache problem WORSE
4. Force-touching files and recommitting -- Hostinger's build overwrote them anyway
5. Delete + re-create dist in separate commits -- same, build overwrote

### Correct deploy flow (CURRENT)
1. Make changes to client source code
2. `cd client && npm run build` locally
3. `git add client/dist/ && git commit && git push`
4. Hostinger pulls, runs no-op build script, uses our committed dist
5. New hashed filenames bypass any LiteSpeed cache

---

## Other bugs and lessons

### Soft delete to Hard delete
- **Problem**: Soft delete (`deleted_at IS NULL`) caused UNIQUE constraint violations when re-registering deleted clients
- **Fix**: Changed to hard DELETE with CASCADE through payments, appointments, wa_conversations
- **Rule**: Do not use soft delete unless there is a real business need for it. Ghost records cause more problems than they solve.

### `deleted_at IS NULL` remnants
- After switching to hard delete, several queries still had `AND deleted_at IS NULL`
- These silently failed to find clients
- **Rule**: When changing a pattern (soft to hard delete), grep the ENTIRE codebase for the old pattern

### WhatsApp timezone bug in auto-reply
- CONFIRM_NOW auto-reply used `date_time > NOW()` to find appointments
- `NOW()` returns UTC, but Bolivia is UTC-4
- A 14:00 BOT appointment = 18:00 UTC. If confirmed at 15:12 BOT (19:12 UTC), `NOW()` > appointment time
- Result: "te esperamos el  a las " (empty date and time)
- **Fix**: Use start of today in Bolivia time: `date_time >= todayStartInBoliviaAsUTC`
- **Rule**: NEVER use `NOW()` directly for Bolivia time comparisons. Always convert.

### Reminder dedup blocking force sends
- Reminder had dedup logic (24h check in webhooks_log) that prevented re-sending
- Dashboard buttons should use `force=1` to bypass dedup
- `summary.startsWith('Terapia')` failed when events had a prefix (checkmark or dollar sign) from payment confirmation
- **Fix**: Use `includes('Terapia')` and always send with `force=1` from admin buttons

### Rate limiter on admin routes
- `/api/clients` had rate limiter that blocked bulk admin operations
- Admin routes are protected by auth middleware -- rate limiting is redundant
- **Fix**: Only rate-limit public endpoints (/api/book, /api/reschedule, /api/client)

### OCR payment matching
- Match payments by WhatsApp phone number (sender), NOT by name on receipt
- Someone else often pays (spouse, parent, friend) -- name on receipt does not equal patient
- Priority: phone then amount then name (least reliable)
- Only run OCR if there is payment context in last 60 min (QR sent, CONFIRM pressed, pending payment)
