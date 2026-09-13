#!/usr/bin/env node
/**
 * record-lesson2-raw.js
 * Opens a VISIBLE browser window running Lesson 2 for OBS to capture.
 * Pauses after launch so you can aim OBS's Window Capture at the window,
 * then plays through automatically until ozmeva_lesson2_complete fires.
 *
 * Run:   node scripts/record-lesson2-raw.js
 * OBS records the window; this script drives the lesson playback.
 */

'use strict';
const { chromium } = require('playwright');

const BASE_URL    = 'https://ozmeva.com';
const VIEWPORT    = { width: 540, height: 960 };
const MAX_MS      = 30 * 60 * 1000; // 30-minute hard cap
const OBS_SETUP_S = 30;             // seconds to aim OBS before playback starts

async function countdown(seconds) {
  for (let s = seconds; s > 0; s--) {
    process.stdout.write(`\r  Starting in ${s}s — aim OBS now...   `);
    await new Promise(r => setTimeout(r, 1000));
  }
  process.stdout.write('\r  Starting now!                        \n');
}

(async () => {
  console.log('\n════════════════════════════════════════════');
  console.log('  LESSON 2 — OBS RECORDER (HEADED MODE)');
  console.log('════════════════════════════════════════════\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security',
      '--window-position=100,50',
      '--window-size=540,960',
    ],
  });

  const tStart = Date.now();

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
    });

    await context.addInitScript(() => {
      localStorage.setItem('ek-dev-key',                    'ek_dev_2026');
      localStorage.setItem('ek-onboarding-v1',              '1');
      localStorage.setItem('ek-practice-banner-dismissed',  '1');
      localStorage.setItem('ozmeva_lesson1_complete',        'true');
      localStorage.removeItem('ozmeva_lesson2_progress');
      localStorage.removeItem('ozmeva_lesson2_complete');
    });

    const page = await context.newPage();

    console.log(`  → Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss hero overlay if present
    const heroBtn = page.locator('#ek-h6-start');
    if (await heroBtn.isVisible().catch(() => false)) {
      console.log('  → Dismissing hero overlay...');
      await heroBtn.click();
      await page.waitForSelector('#ek-hero-v6', { state: 'detached', timeout: 20000 });
      console.log('  ✓ Hero dismissed');
    } else {
      console.log('  → No hero overlay (skipped via localStorage)');
    }

    // Switch to Learn tab
    const learnTab = page.locator('#ek-tab-learn');
    if (await learnTab.isVisible().catch(() => false)) {
      await learnTab.click();
      await page.waitForTimeout(600);
    }

    // Ensure Lesson 2 start button is visible, then wait for OBS setup
    await page.waitForSelector('#ek-start-lesson2', { timeout: 15000 });
    console.log('\n  ✓ Browser ready — Lesson 2 card visible.');
    console.log(`  → Aim OBS Window Capture at the Chromium window and start recording.`);
    console.log(`  → Playback begins automatically in ${OBS_SETUP_S} seconds.\n`);

    await countdown(OBS_SETUP_S);

    console.log('\n  → Starting Lesson 2...');
    await page.locator('#ek-start-lesson2').click();
    await page.waitForSelector('#ek-lesson-player', { state: 'visible', timeout: 10000 });
    console.log('  ✓ Lesson 2 player open — lesson running\n');

    // Poll for completion
    const pollStart = Date.now();
    let lastLogSec  = 0;

    while (Date.now() - pollStart < MAX_MS) {
      await page.waitForTimeout(10000);

      const elapsed = Math.floor((Date.now() - pollStart) / 1000);

      const complete = await page.evaluate(
        () => localStorage.getItem('ozmeva_lesson2_complete') === 'true'
      ).catch(() => false);

      if (complete) {
        console.log(`  ✓ ozmeva_lesson2_complete set — lesson finished at ${elapsed}s`);
        break;
      }

      if (elapsed - lastLogSec >= 60) {
        lastLogSec = elapsed;
        const segText = await page.evaluate(() => {
          const el = document.querySelector('#ek-lesson-player .ek-seg-title');
          return el ? el.textContent.trim() : '(unknown segment)';
        }).catch(() => '(unknown segment)');
        console.log(`  … ${elapsed}s — ${segText}`);
      }

      if (elapsed >= MAX_MS / 1000 - 10) {
        console.warn(`  ! Hard cap (${MAX_MS / 60000}m) reached — stopping`);
        break;
      }
    }

    // 10s buffer — gives you time to stop OBS recording before browser closes
    console.log('  → Lesson complete. Stopping in 10s — stop OBS recording now.');
    await page.waitForTimeout(10000);
    await context.close();

  } finally {
    await browser.close();
  }

  const wallSec = ((Date.now() - tStart) / 1000).toFixed(0);
  console.log('\n════════════════════════════════════════════');
  console.log(`  Done — wall time: ${wallSec}s`);
  console.log('  Save the OBS recording as:');
  console.log('    content/lesson2/lesson2-raw.mp4');
  console.log('  Then create manifests/lesson2.js and run:');
  console.log('    node scripts/lesson-slice-template.js manifests/lesson2.js');
  console.log('════════════════════════════════════════════\n');

})().catch(err => {
  console.error('\n✗ Fatal:', err.message);
  process.exit(1);
});
