const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log(`[browser] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[browser] ERROR: ${err.message}`));

  // ── 1. Load the page once so localStorage is available ───────────────────
  console.log('[TEST] Initial load...');
  await page.goto('https://ozmeva.com', { waitUntil: 'domcontentloaded' });

  // ── 1b. Mock /api/check-session so it returns "not allowed" for this test ──
  // The real endpoint checks Supabase IP count — we control the browser-side check here.
  await page.route('**/api/check-session', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ allowed: false, sessionsUsed: 2, sessionsRemaining: 0 }),
    });
  });
  console.log('[TEST] /api/check-session mocked → allowed:false');

  // ── 2. Set state atomically before reload ─────────────────────────────────
  await page.evaluate(() => {
    localStorage.removeItem('ek-dev-key');
    localStorage.removeItem('ekDevKey');
    localStorage.removeItem('ek-stripe-cus');
    localStorage.setItem(
      'ek-daily-v1',
      JSON.stringify({ date: new Date().toISOString().slice(0, 10), count: 3 })
    );
    // Skip onboarding overlay so it doesn't block card clicks
    console.log('[TEST] State set — reloading fresh');
  });

  // ── 3. Reload so the app boots with count:3 already in localStorage ───────
  console.log('[TEST] Reloading with count:3 in localStorage...');
  await page.reload({ waitUntil: 'networkidle' });

  // ── 4. Verify state survived the reload ───────────────────────────────────
  const state = await page.evaluate(() => ({
    devKey:   localStorage.getItem('ek-dev-key'),
    ekDevKey: localStorage.getItem('ekDevKey'),
    daily:    localStorage.getItem('ek-daily-v1'),
    cookie:   document.cookie,
  }));
  console.log('[TEST] After reload:');
  console.log('  ek-dev-key  =', state.devKey,   '(should be null)');
  console.log('  ekDevKey    =', state.ekDevKey,  '(should be null)');
  console.log('  ek-daily-v1 =', state.daily,     '(should show count:3)');
  console.log('  cookies     =', state.cookie || '(none)');

  // ── 5. Click #ek-h6-start to dismiss the splash overlay ────────────────
  console.log('[TEST] Waiting for #ek-h6-start...');
  await page.waitForSelector('#ek-h6-start', { timeout: 15000 });
  console.log('[TEST] Clicking #ek-h6-start...');
  await page.locator('#ek-h6-start').click();

  // Wait for overlay to be removed (KokoroSpeech preloads then it removes itself)
  console.log('[TEST] Waiting for #ek-hero-v6 to be removed...');
  await page.waitForSelector('#ek-hero-v6', { state: 'detached', timeout: 30000 });
  console.log('[TEST] Splash overlay gone');

  // ── 6. Wait for Ryan's "Pick a scenario" line (or fall back to 4s) ────────
  let ryanDone = false;
  const ryanDonePromise = new Promise(resolve => {
    page.on('console', msg => {
      if (!ryanDone && msg.text().includes('Pick a scenario')) {
        ryanDone = true;
        resolve();
      }
    });
  });
  await Promise.race([ryanDonePromise, page.waitForTimeout(4000)]);
  console.log('[TEST] Ryan intro wait complete (done =', ryanDone, ')');

  // ── 7. Log DailyLimit.canPlay() result from page context ─────────────────
  const canPlayResult = await page.evaluate(async () => {
    if (typeof window.DailyLimit === 'undefined') return 'DailyLimit not on window (private IIFE)';
    try {
      return await window.DailyLimit.canPlay();
    } catch (e) {
      return 'threw: ' + e.message;
    }
  });
  console.log('[TEST] DailyLimit.canPlay() =', canPlayResult);

  // ── 8. Click first visible scenario card ─────────────────────────────────
  // Lesson player tab system defaults to LEARN tab — switch to PRACTICE first
  const practiceTab = page.locator('#ek-tab-practice');
  if (await practiceTab.count() > 0) {
    console.log('[TEST] Switching to PRACTICE tab...');
    await practiceTab.click();
  }

  const cardCount = await page.locator('.nf-card').count();
  console.log(`[TEST] Visible scenario cards: ${cardCount}`);

  if (cardCount > 0) {
    console.log('[TEST] Clicking first .nf-card...');
    await page.locator('.nf-card').first().click();
    // Dismiss practice-focus-modal if it appeared. #pfm-free is the Free Practice
    // button in BOTH the zero-lesson and returning-user modal variants (same id,
    // same click handler wired unconditionally in showPracticeFocusModal()) —
    // one selector covers whichever variant actually renders.
    try {
      await page.waitForSelector('#practice-focus-modal #pfm-free', { timeout: 2000 });
      console.log('[TEST] Practice focus modal appeared — selecting Free Practice');
      await page.locator('#practice-focus-modal #pfm-free').click();
    } catch (_) { /* modal not shown — ok */ }
  } else {
    console.log('[TEST] No .nf-card found — dispatching scenarioSelect change as fallback');
    await page.evaluate(() => {
      const sel = document.getElementById('scenarioSelect');
      if (sel && sel.options.length > 0) {
        sel.value = sel.options[0].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // ── 9. Wait up to 5s for paywall ──────────────────────────────────────────
  console.log('[TEST] Waiting up to 5s for paywall...');
  let paywallFound = false;
  try {
    await page.waitForSelector('#ek-paywall, .ek-paywall', { timeout: 5000 });
    paywallFound = true;
  } catch (_) {
    // Try text fallback
    try {
      await page.getByText('free sessions').waitFor({ timeout: 1000 });
      paywallFound = true;
    } catch (__) {
      paywallFound = false;
    }
  }

  // ── 9. Report result ──────────────────────────────────────────────────────
  if (paywallFound) {
    console.log('[TEST] ✓ PASS — paywall appeared');
    await page.screenshot({ path: 'tests/paywall-pass.png', fullPage: false });
    console.log('[TEST] Screenshot: tests/paywall-pass.png');
  } else {
    console.log('[TEST] ✗ FAIL — paywall did NOT appear after 5s');
    await page.screenshot({ path: 'tests/paywall-fail.png', fullPage: false });
    console.log('[TEST] Screenshot: tests/paywall-fail.png');

    const diag = await page.evaluate(async () => {
      const daily = localStorage.getItem('ek-daily-v1');
      const hasDL = typeof window.DailyLimit !== 'undefined';
      let canPlay = 'n/a';
      if (hasDL) {
        try { canPlay = await window.DailyLimit.canPlay(); }
        catch (e) { canPlay = 'threw: ' + e.message; }
      }
      const paywall = document.getElementById('ek-paywall');
      return {
        daily,
        hasDailyLimit: hasDL,
        canPlay,
        paywallInDOM: !!paywall,
        paywallDisplay: paywall ? paywall.style.display : 'n/a',
      };
    });
    console.log('[TEST] Diagnostics:');
    console.log('  ek-daily-v1     =', diag.daily);
    console.log('  DailyLimit      =', diag.hasDailyLimit);
    console.log('  canPlay()       =', diag.canPlay);
    console.log('  #ek-paywall DOM =', diag.paywallInDOM);
    console.log('  paywall display =', diag.paywallDisplay);
  }

  await browser.close();
  console.log('[TEST] Done.');
  process.exit(paywallFound ? 0 : 1);
})();
