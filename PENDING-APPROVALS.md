# PENDING-APPROVALS
# Pre-Marketing Hardening Session — items requiring Serge's action
# Earlier session items (PA-001 through PA-007) are preserved at the bottom.

---

## PA-101 — Enable Stripe Customer Portal in dashboard ⚡ DO THIS FIRST

**What:** The cancel subscription flow now calls `/api/customer-portal` which redirects
subscribers to Stripe's hosted self-cancel portal. But the portal must be configured
in the Stripe Dashboard before it returns a valid URL. Until you do this, the cancel
flow falls back to the JWT path, then email support.

**How to enable (5 minutes):**
1. Go to https://dashboard.stripe.com/settings/billing/portal (live mode)
2. Enable the portal (toggle on if not already)
3. Under "Customer actions" → check "Cancel subscriptions"
4. Under "Features" → enable "Invoice history" (optional but nice)
5. Set the default redirect URL to `https://ozmeva.com/`
6. Save

**Why it matters:** Without this, anonymous paying subscribers (which is everyone
right now — no auth required) cannot self-cancel. They see "email support" instead.
Chargebacks are likely if someone can't cancel easily.

**No code change needed after you enable it.** The `api/customer-portal.js` endpoint
is deployed and ready.

---

## PA-102 — Live-mode Stripe end-to-end test (Serge manually pays $19.99)

**What:** Nobody has verified the full live-mode payment flow end-to-end on
ozmeva.com (not preview, not test mode — the real live deployment). The preview
test in G4.1 of the last session used test keys (cs_test_…). The production
deployment uses live keys.

**Checklist to run manually (15 minutes):**

1. Go to https://ozmeva.com in an incognito window
2. Start 2 practice sessions to hit the paywall
3. Click "Choose Pro"
4. Complete checkout with a **real card** (or use Stripe's test clock if you have
   one configured in live mode — you likely don't, so a real card is needed)
5. Verify: redirect back to ozmeva.com with `?stripe_session=cs_live_…`
6. Verify: "Welcome to Ozmeva Pro! Unlimited sessions activated." banner appears
7. Verify: `ek-stripe-cus` is set in localStorage (open DevTools → Application → Local Storage)
8. Start a 3rd session — verify it's allowed (paywall doesn't appear)
9. In Stripe dashboard → Customers → find your customer → verify subscription is Active
10. In Vercel logs → find the `/api/verify-payment` call → verify it returned `active:true`

**To cancel after testing:**
- Go to Stripe dashboard → Subscriptions → cancel the test subscription
- Or use the "Cancel subscription" link in the app footer (once PA-101 is done)

**Risk if skipped:** Revenue is live. If the webhook is misconfigured, a real
subscriber could pay and not get access (no `subscription.checkout.completed`
handling — only `checkout.sessions.retrieve` on redirect, which should work).

---

## PA-103 — TikTok Pixel ID + Meta Pixel ID

**What:** The `_ekTrack()` function in index.html fires events to PostHog (working)
plus TikTok `ttq.track()` and Meta `fbq()` if those objects exist. Right now,
neither TikTok Pixel nor Meta Pixel is loaded — there's just a no-op stub.

**Events wired and ready to fire:**
- `paywall_seen` → `fbq('track', 'ViewContent')` / `ttq.track('ViewContent')`
- `checkout_started` → `fbq('track', 'InitiateCheckout')` / `ttq.track('InitiateCheckout')`
- `subscription_activated` → `fbq('track', 'Purchase')` / `ttq.track('CompletePayment')`

**To activate (2 steps per platform):**

### TikTok
1. Go to https://ads.tiktok.com → Events → Web Events → Create Pixel
2. Choose "Manually install pixel code"
3. Copy the pixel ID (looks like `C3XXXXXXXXXXXXX`)
4. Tell me the ID (or add these 2 lines to index.html before `</head>`):
```html
<script src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=YOUR_PIXEL_ID&lib=ttq" async></script>
```
5. The pixel fires automatically on `paywall_seen`, `checkout_started`, `subscription_activated`.

### Meta (Facebook/Instagram ads)
1. Go to https://business.facebook.com → Events Manager → Connect Data Sources → Web
2. Create a pixel → copy the pixel ID (looks like `123456789012345`)
3. Tell me the ID. I'll add the standard fbq snippet to index.html.

**No urgency:** PostHog tracks the same events in the meantime. Add pixels before
you start paid TikTok/Meta campaigns.

---

## PA-104 — Daily session reset decision (accumulating vs per-day)

**What:** The paywall copy says "Come back tomorrow for 2 more" — but the session
counter in Supabase accumulates and never resets. A free user who used their 2
sessions will never get more unless you manually reset their row in Supabase.

**Options:**
- **A) Accumulating (current behavior):** 2 lifetime free sessions. Simple, no DB
  changes, but "come back tomorrow" is a lie. Consider changing copy to
  "You've used your free sessions. Subscribe to continue."
- **B) Daily reset:** count-session.js tracks `last_session_date` (UTC date string).
  If the date changed since last session, reset `sessions_used` to 0. 2 sessions
  per calendar day. Slightly more generous, more accurate to the copy.
- **C) Weekly reset:** Same pattern but reset weekly.

**Recommendation:** B (daily reset) — it matches the UX copy and is more
retentive (free users can keep coming back and experiencing the value).
Implementation is ~30 lines in `api/count-session.js` + DB migration.
Tell me which you want and I'll implement it.

---

---

## Pre-existing items from dating-mvp-build session (PA-001 through PA-007)

### PA-001 — Voice input platform strategy ✅ RESOLVED
Implemented OpenAI Whisper via MediaRecorder for iOS Safari. Done in G3.

### PA-002 — Landing page / hero ✅ RESOLVED
Hero added in G5. "Stop overthinking it. Start practicing."

### PA-003 — Which 3 anchor scenarios ✅ RESOLVED
Beach/Sofia, Museum/Isabelle, Gym/Zoe confirmed as anchors.

### PA-004 — Auth before or after payment ✅ DECISION: A (keep anonymous for MVP)
Stripe customer ID in localStorage. Add auth in v1.1.

### PA-005 — Paywall price mismatch ✅ RESOLVED
$19.99/$39.99 confirmed live in Stripe. UI matches.

### PA-007 — Payment funnel findings ✅ RESOLVED
STRIPE_WEBHOOK_SECRET set for preview. Live checkout verified by Serge on 2026-08-27.

### PA-006 — iOS/WebKit surprises ✅ RESOLVED
navigator.storage polyfill deployed. MediaRecorder real-device test recommended.
