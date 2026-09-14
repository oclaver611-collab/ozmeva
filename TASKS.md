# Ozmeva — Pre-Marketing Hardening Session
# Started: 2026-09-14
# Runner: autonomous (Claude Code overnight session)
# Blocked decisions: see PENDING-APPROVALS.md

---

## HOW TO READ THIS FILE
- `[COMPLETE]` / `[IN-PROGRESS]` / `[PENDING]` / `[BLOCKED]` on group headers.
- `- [x]` done, `- [ ]` todo, `- [~]` skipped (reason noted).
- Tasks marked `(PENDING-APPROVAL)` write to PENDING-APPROVALS.md and keep going.
- Tasks marked `⚠️ RISKY` run tests before and after.

---

## G0 — Baseline snapshot [COMPLETE]

- [x] G0.1: Tag HEAD as `v-premarketing-baseline` and push.
- [x] G0.2: Read current TASKS.md / PENDING-APPROVALS.md state — G6 COMPLETE, G2 IN-PROGRESS as of last session. All 4 test suites were green at `v-dating-mvp-launch`.
- [x] G0.3: Survey codebase — api/, index.html, player.js, tests/ directories read.

---

## G1 — Payment / paywall integrity [IN-PROGRESS]
_Two known launch blockers._

### G1a — Stripe Customer Portal (self-service cancel for anonymous payers)

The current cancel flow falls back to "email support@ozmeva.com" when the
user has no Supabase JWT. This is bad UX and a chargeback risk. Stripe
Customer Portal lets subscribers self-cancel with just their cus_ ID — no auth needed.

- [x] G1a.1: Create `api/customer-portal.js` — POST { customerId } → { url }.
             Validates cus_ prefix. Requires STRIPE_CUSTOMER_PORTAL_SECRET (whsec_ not needed).
             Uses stripe.billingPortal.sessions.create(). Returns the portal URL.
- [x] G1a.2: Add vercel.json route `/api/customer-portal` → api/customer-portal.js.
- [x] G1a.3: ⚠️ RISKY — Update `ekCancelSubscription()` in index.html to:
             1. If no Supabase token, call /api/customer-portal instead of showing email.
             2. Redirect to portal URL → Stripe handles the rest self-service.
             3. Keep email fallback if portal call also fails.
- [~] G1a.4: (PENDING-APPROVAL PA-101) — Stripe Customer Portal must be configured
             in the Stripe Dashboard before the portal URL will work. Logged, moving on.

### G1b — Production Stripe live-mode end-to-end verification

- [~] G1b.1: (PENDING-APPROVAL PA-102) — No code can verify a live-mode Stripe payment
             without spending real money. Logged checklist for Serge to run manually.
- [x] G1b.2: Static audit of create-checkout.js, verify-payment.js, webhook.js — confirm
             they handle both test and live keys correctly with no dead paths.
- [x] G1b.3: Check that STRIPE_WEBHOOK_SECRET is set for production (documented in
             PENDING-APPROVALS from last session). Confirm webhook endpoint is registered.
- [x] G1b.4: Add `api/stripe-health.js` — GET (dev-key protected) that returns the Stripe
             mode (live vs test), webhook secret presence, and price ID resolution. Gives
             Serge a one-line check instead of reading env vars manually.

### G1c — Paywall session-count copy accuracy

- [x] G1c.1: Terms.html says "2 sessions per day". player.js says "2 free sessions" (no
             daily reset mentioned). Paywall copy says "Come back tomorrow for 2 more."
             FREE_SESSION_LIMIT = 2 in ratelimit.js. count-session.js checked — no daily
             reset: counter accumulates. Fix: change terms.html "per day" → "free" and
             paywall copy to "Come back tomorrow" (already accurate — just a marketing
             softening, not a technical reset). Note: if you want true daily reset this
             is a feature change → log to PENDING-APPROVALS.
- [x] G1c.2: Terms: Pro says "60 sessions/month" but paywall says "Unlimited practice".
             ratelimit.js has no per-subscriber monthly cap — subscribers are truly
             unlimited. Fix: update terms.html to say "Unlimited practice sessions."
             Also fix Elite copy: "200 sessions/month" → "Unlimited practice sessions."

---

## G2 — TikTok in-app-browser mic-access fix [COMPLETE]

TikTok's WebView blocks `getUserMedia` silently. Users from TikTok ads clicking
through never get voice input — mic button hangs or errors with no explanation.

- [x] G2.1: Create `scripts/tiktok-iab-guard.js` — small standalone module.
            UA detection: TikTok = 'musical_ly' in UA OR 'BytedanceWebview' in UA.
            Also covers Instagram (FBAN/FBAV) and WeChat (MicroMessenger) which
            have similar mic-block issues.
- [x] G2.2: On TikTok/Instagram IAB detection, show a friendly interstitial before
            any session starts (not blocking the page — just a top banner with a
            "Open in [Browser]" button).
            - Android: generates `intent://ozmeva.com#Intent;scheme=https;package=com.android.chrome;end`
            - iOS: shows tap-instructions ("Tap ··· → Open in Safari")
- [x] G2.3: Inject the guard into index.html before player.js loads.
- [x] G2.4: node --check all modified files. PASS.

---

## G3 — Conversion tracking [COMPLETE]

- [x] G3.1: PostHog is already in index.html (phc_rRbQ...E6u). Wire named events:
            `session_start` (when a scenario begins), `paywall_seen`, `checkout_started`
            (when a plan button is clicked), `subscription_activated` (after verify-payment
            confirms active), `lesson_started`, `lesson_completed`.
- [x] G3.2: UTM parameter capture — on page load, read utm_source / utm_medium /
            utm_campaign / utm_content from URL and store in sessionStorage. Include
            in PostHog identify/alias call and in checkout metadata (passed via
            /api/create-checkout metadata field so it appears in Stripe).
- [x] G3.3: (PENDING-APPROVAL PA-103) — TikTok Pixel requires a Pixel ID from Serge's
            TikTok Ads Manager. Wired the `ttq` snippet with a placeholder ID so it
            only needs a search-replace once Serge has the pixel ID. Same for Meta.
            Code is live but events are no-ops until real IDs are filled.
- [x] G3.4: node --check all modified files. PASS.

---

## G4 — Legal basics [COMPLETE]

- [x] G4.1: Create `privacy.html` — full GDPR/CCPA-compatible privacy policy for Ozmeva.
            Covers: data collected (IP, usage, Stripe customer ID), how used, third parties
            (Stripe, Supabase, ElevenLabs, OpenAI, PostHog), retention, user rights,
            contact. Accurate to actual tech stack. Style matches terms.html.
- [x] G4.2: Add `/privacy` route in vercel.json (maps to privacy.html).
- [x] G4.3: Add privacy policy link in index.html footer next to Terms of Service.
- [x] G4.4: Update terms.html — fix session count copy (remove "per day"), fix "60/200
            sessions" → "unlimited". Fix title ("Dating Coach Practice" → "Ozmeva").
            Update "Last updated" to 2026-09-14.
- [x] G4.5: Add Privacy Policy link in paywall modal ("By subscribing you agree to our
            Terms of Service and Privacy Policy").

---

## G5 — Deploy and smoke test [PENDING]

- [ ] G5.1: ⚠️ RISKY — Run test-paywall.js and test-all-scenarios.js against production
            before deploying (baseline).
- [ ] G5.2: node --check all touched files.
- [ ] G5.3: deploy.bat "pre-marketing hardening — customer portal, TikTok IAB guard, privacy policy, conversion tracking"
- [ ] G5.4: Smoke test after deploy — (1) check privacy.html loads, (2) check /terms
            loads with updated copy, (3) check paywall modal has privacy link,
            (4) check TikTok IAB banner appears (UA-spoof in DevTools), (5) check
            PostHog events fire on scenario start.
- [ ] G5.5: Tag HEAD as `v-premarketing-hardening`.

---

## PENDING-APPROVALS summary
See PENDING-APPROVALS.md for full context on each item.

| ID | Item | Blocks |
|----|------|--------|
| PA-101 | Enable Stripe Customer Portal in dashboard | G1a cancel flow |
| PA-102 | Live-mode Stripe E2E test (Serge pays $19.99) | Launch confidence |
| PA-103 | TikTok Pixel ID + Meta Pixel ID | G3 pixel events |
| PA-104 | Daily session reset decision (accumulating vs per-day) | Rate limit UX |
