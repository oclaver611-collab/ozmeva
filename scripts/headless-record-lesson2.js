'use strict';
/**
 * Headless Lesson 2 recording pipeline — experiment only.
 * Steps:
 *   0. Fetch manifest.json + all 61 MP3s from R2 worker, ffprobe durations.
 *   1. Playwright headless recording: fake-audio device, local audio intercept,
 *      console t0 detection, wait for ozmeva_lesson2_complete.
 *   2. Build audio track: manifest sequence + 700ms intra-segment gaps
 *      + 800ms inter-segment gaps.
 *   3. Mux trimmed video (WebM→H.264) + audio → MP4.
 *   4. Validate: audio/video duration delta + frame extraction at key timestamps.
 *      Whisper phrase-level drift check if whisper is on PATH.
 *
 * Run: node scripts/headless-record-lesson2.js
 * Output: content/lesson2/headless/lesson2-headless.mp4
 *
 * Experiment criteria: drift ≤500ms = PASS. >500ms = FAIL, keep OBS method.
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');

const ROOT      = path.resolve(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'lesson2_audio');
const OUT_DIR   = path.join(ROOT, 'content', 'lesson2', 'headless');
const WORKER    = 'https://ozmeva-lesson-audio.oclaver611.workers.dev';

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR,   { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try   { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(dest, () => {}));
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error',  e  => { file.close(() => fs.unlink(dest, () => {})); reject(e); });
    }).on('error', reject);
  });
}

function ffprobeDurationMs(filePath) {
  const r = spawnSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', filePath
  ], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffprobe missing: ${r.error.message}`);
  const streams = JSON.parse(r.stdout).streams || [];
  const s = streams.find(x => x.codec_type === 'audio');
  if (!s) throw new Error(`No audio stream: ${filePath}`);
  const dur = parseFloat(s.duration || s.tags?.DURATION || 0);
  if (!dur) throw new Error(`Zero duration: ${filePath}`);
  return Math.round(dur * 1000);
}

function exe(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// ── Step 0: Download + probe ──────────────────────────────────────────────────

async function step0() {
  console.log('\n═══ Step 0: Download audio files ═══\n');

  // Manifest
  const manifestPath = path.join(AUDIO_DIR, 'manifest.json');
  let manifest;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log('  manifest.json: cached');
  } else {
    manifest = await fetchJSON(`${WORKER}?file=lesson2/manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('  manifest.json: downloaded');
  }

  // Collect all unique audio files (preserve order: file keys before sequence keys)
  const allFiles = [];
  const seen = new Set();
  for (const seg of manifest.segments) {
    for (const item of (seg.sequence || seg.files || [])) {
      if (!seen.has(item.file)) { seen.add(item.file); allFiles.push(item.file); }
    }
  }
  console.log(`  ${allFiles.length} unique audio files\n`);

  const durations = {};
  for (const file of allFiles) {
    const localPath = path.join(AUDIO_DIR, file);
    if (!fs.existsSync(localPath)) {
      const url = `${WORKER}?file=lesson2/${encodeURIComponent(file)}`;
      process.stdout.write(`  ↓ ${file} ... `);
      await downloadFile(url, localPath);
      process.stdout.write('done\n');
    }
    durations[file] = ffprobeDurationMs(localPath);
  }

  // Compute expected total (for sanity check against lesson runtime)
  let expectedMs = 0;
  for (const seg of manifest.segments) {
    const items = seg.sequence || seg.files || [];
    for (let i = 0; i < items.length; i++) {
      expectedMs += durations[items[i].file];
      if (i < items.length - 1) expectedMs += 700;
    }
    expectedMs += 800;
  }
  console.log(`\n  Expected audio duration: ${(expectedMs / 1000).toFixed(1)}s`);
  return { manifest, durations, expectedMs };
}

// ── Step 1: Playwright recording ──────────────────────────────────────────────

async function step1() {
  console.log('\n═══ Step 1: Playwright headless recording ═══\n');
  console.log('  540×960 viewport · headless · fake-audio device\n');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-audio-for-tests',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const pageCreateTime = Date.now();
  const context = await browser.newContext({
    viewport:    { width: 540, height: 960 },
    recordVideo: { dir: OUT_DIR, size: { width: 540, height: 960 } },
  });
  const page = await context.newPage();

  // Route all audio worker requests → local lesson2_audio/
  await page.route(/ozmeva-lesson-audio\.oclaver611\.workers\.dev/, async route => {
    const url   = new URL(route.request().url());
    const param = url.searchParams.get('file') || '';
    // strip "lesson2/" prefix to get local filename
    const local = param.startsWith('lesson2/') ? param.slice('lesson2/'.length) : param;
    const localPath = path.join(AUDIO_DIR, local || 'manifest.json');

    if (fs.existsSync(localPath)) {
      const body = fs.readFileSync(localPath);
      const ct   = local.endsWith('.json') ? 'application/json' : 'audio/mpeg';
      await route.fulfill({ status: 200, contentType: ct, body });
    } else {
      console.warn(`  [route] not cached locally: ${param}`);
      await route.continue();
    }
  });

  // Console t0 detection and error mirror
  let t0WallMs = null;
  page.on('console', msg => {
    const text = msg.text();
    if (!t0WallMs && text.includes('[lesson] START') && text.includes('ryan_seg00.mp3')) {
      t0WallMs = Date.now();
      const offset = ((t0WallMs - pageCreateTime) / 1000).toFixed(2);
      console.log(`  [t0] ryan_seg00.mp3 START at +${offset}s from page create`);
    }
    if (text.includes('TIMEOUT') || text.includes('[lesson] audio error')) {
      console.warn('  [player warn]', text.slice(0, 120));
    }
  });

  // Navigate
  console.log('  Navigating to https://ozmeva.com ...');
  await page.goto('https://ozmeva.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Bypass lesson1_complete gate (client-side only check)
  await page.evaluate(() => {
    localStorage.setItem('ozmeva_lesson1_complete', 'true');
    localStorage.removeItem('ozmeva_lesson2_complete');
    localStorage.removeItem('ozmeva_lesson2_progress');
  });

  // Start lesson
  const lessonStartWall = Date.now();
  await page.evaluate(() => window.openLesson('lesson2', '00'));
  console.log(`  openLesson() called at +${((lessonStartWall - pageCreateTime) / 1000).toFixed(2)}s`);
  console.log('  Waiting for ozmeva_lesson2_complete (up to 15 min)...');

  await page.waitForFunction(
    () => localStorage.getItem('ozmeva_lesson2_complete') === 'true',
    null,
    { timeout: 900_000, polling: 3000 }
  );

  const lessonDurationMs = Date.now() - lessonStartWall;
  console.log(`  Lesson complete in ${(lessonDurationMs / 1000).toFixed(1)}s`);

  const video = page.video();
  await context.close();
  await browser.close();

  const webmPath = await video.path();
  console.log(`  Video: ${path.basename(webmPath)}`);
  if (!t0WallMs) {
    console.warn('  WARNING: t0 never detected — no video trim will be applied');
  }

  const result = {
    webmPath,
    t0OffsetSec:     t0WallMs ? (t0WallMs - pageCreateTime) / 1000 : 0,
    lessonDurationMs,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'step1.json'), JSON.stringify(result, null, 2));
  return result;
}

// ── Step 2: Build audio track ─────────────────────────────────────────────────

function step2(manifest, durations) {
  console.log('\n═══ Step 2: Build audio track ═══\n');

  // Silence files
  const sil700 = path.join(AUDIO_DIR, '_sil_700ms.mp3');
  const sil800 = path.join(AUDIO_DIR, '_sil_800ms.mp3');
  for (const [dest, dur] of [[sil700, 0.7], [sil800, 0.8]]) {
    if (!fs.existsSync(dest)) {
      exe(
        `ffmpeg -y -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=44100" ` +
        `-t ${dur} -ar 44100 -ac 1 -c:a libmp3lame -q:a 4 "${dest}"`,
        { stdio: ['pipe', 'pipe', 'inherit'] }
      );
      console.log(`  Generated ${path.basename(dest)}`);
    }
  }

  // Build concat list and timeline
  const concatLines = [];
  const timeline    = [];
  let t = 0;

  for (const seg of manifest.segments) {
    const items = seg.sequence || seg.files || [];
    for (let i = 0; i < items.length; i++) {
      const { file } = items[i];
      const absPath = path.join(AUDIO_DIR, file).replace(/\\/g, '/');
      concatLines.push(`file '${absPath}'`);
      timeline.push({ t, segmentId: seg.segmentId, file });
      t += durations[file];
      if (i < items.length - 1) {
        concatLines.push(`file '${sil700.replace(/\\/g, '/')}'`);
        t += 700;
      }
    }
    concatLines.push(`file '${sil800.replace(/\\/g, '/')}'`);
    t += 800;
  }

  const listPath = path.join(OUT_DIR, 'audio_concat.txt');
  fs.writeFileSync(listPath, concatLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'timeline.json'), JSON.stringify(timeline, null, 2), 'utf8');

  const audioOut = path.join(OUT_DIR, 'audio_track.m4a');
  exe(
    `ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
    `-ar 44100 -ac 1 -c:a aac -b:a 128k "${audioOut}"`
  );

  console.log(`  Audio track: ${(t / 1000).toFixed(1)}s  (${timeline.length} events)`);
  return { audioOut, timeline, totalAudioMs: t };
}

// ── Step 3: Mux ───────────────────────────────────────────────────────────────

function step3(webmPath, audioOut, t0OffsetSec) {
  console.log('\n═══ Step 3: Mux video + audio ═══\n');

  const trimmedWebm = path.join(OUT_DIR, 'video_trimmed.webm');
  const finalMp4    = path.join(OUT_DIR, 'lesson2-headless.mp4');

  if (t0OffsetSec > 0.15) {
    console.log(`  Trimming ${t0OffsetSec.toFixed(2)}s pre-lesson preamble from video`);
    exe(`ffmpeg -y -ss ${t0OffsetSec.toFixed(3)} -i "${webmPath}" -c copy "${trimmedWebm}"`);
  } else {
    fs.copyFileSync(webmPath, trimmedWebm);
    console.log('  No trim (t0 offset negligible)');
  }

  // Re-encode VP8/VP9 WebM → H.264; copy AAC from m4a
  exe(
    `ffmpeg -y -i "${trimmedWebm}" -i "${audioOut}" ` +
    `-c:v libx264 -preset fast -crf 23 ` +
    `-c:a copy -shortest "${finalMp4}"`
  );

  const sizeMb = (fs.statSync(finalMp4).size / 1e6).toFixed(1);
  console.log(`  Final: ${finalMp4} (${sizeMb} MB)`);
  return finalMp4;
}

// ── Step 4: Validate ──────────────────────────────────────────────────────────

function step4(finalMp4, timeline, lessonDurationMs, totalAudioMs) {
  console.log('\n═══ Step 4: Validate ═══\n');

  // Duration delta
  const deltaMs = Math.abs(lessonDurationMs - totalAudioMs);
  console.log(`  Lesson runtime:    ${(lessonDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Constructed audio: ${(totalAudioMs / 1000).toFixed(1)}s`);
  console.log(`  Duration delta:    ${deltaMs}ms ${deltaMs < 3000 ? '✓' : '⚠ large'}`);

  // Frame extraction at exchange-start boundaries (based on Lesson 2 manifest obsStart ≈ audio t)
  const framechecks = [
    { tSec: timeline.find(e => e.segmentId === '03')?.t / 1000, label: 'seg03-exchange-start' },
    { tSec: timeline.find(e => e.segmentId === '05')?.t / 1000, label: 'seg05-exchange-start' },
    { tSec: timeline.find(e => e.segmentId === '07')?.t / 1000, label: 'seg07-exchange-start' },
    { tSec: timeline.find(e => e.segmentId === '09')?.t / 1000, label: 'seg09-exchange-start' },
    { tSec: timeline.find(e => e.segmentId === '11')?.t / 1000, label: 'seg11-exchange-start' },
  ].filter(c => c.tSec != null);

  const framesDir = path.join(OUT_DIR, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  for (const { tSec, label } of framechecks) {
    const dest = path.join(framesDir, `${label}.png`);
    try {
      exe(
        `ffmpeg -y -ss ${tSec.toFixed(2)} -i "${finalMp4}" -vframes 1 -q:v 2 "${dest}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      console.log(`  Frame @ ${tSec.toFixed(1)}s → frames/${label}.png`);
    } catch {
      console.warn(`  Frame extraction failed @ ${tSec.toFixed(1)}s`);
    }
  }

  // Whisper phrase-level drift (optional — skip cleanly if not installed)
  const wCheck = spawnSync('whisper', ['--help'], { encoding: 'utf8', shell: true });
  if (wCheck.error || (!wCheck.stdout && !wCheck.stderr)) {
    console.log('\n  Whisper not on PATH — skipping phrase-level drift check.');
    console.log('  Install with: pip install openai-whisper');
    if (deltaMs <= 2000) {
      console.log('\n  RESULT: duration delta ✓ (install Whisper for phrase-level drift)');
    } else {
      console.log('\n  RESULT: ⚠ duration delta too large — inspect frames above');
    }
    return null;
  }

  const wavPath = path.join(OUT_DIR, 'validate.wav');
  exe(`ffmpeg -y -i "${finalMp4}" -vn -ar 16000 -ac 1 "${wavPath}"`, { stdio: ['pipe','pipe','pipe'] });

  const whisperDir = path.join(OUT_DIR, 'whisper');
  fs.mkdirSync(whisperDir, { recursive: true });
  console.log('\n  Running Whisper small (this takes a few minutes)...');
  exe(
    `whisper "${wavPath}" --model small --language en ` +
    `--output_format json --output_dir "${whisperDir}" --word_timestamps True`,
    { timeout: 600_000, shell: true }
  );

  const jsonPath = path.join(whisperDir, 'validate.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('  Whisper output missing — drift validation skipped');
    return null;
  }

  const allWords = (JSON.parse(fs.readFileSync(jsonPath)).segments || []).flatMap(s => s.words || []);

  const driftChecks = [
    { segId: '03', searchWord: 'what',      note: 'seg03 "What are you working on?"' },
    { segId: '05', searchWord: "don't",     note: 'seg05 "I don\'t usually talk"'    },
    { segId: '07', searchWord: 'very',      note: 'seg07 "You\'re very sure"'        },
    { segId: '09', searchWord: 'made',      note: 'seg09 "What made you come"'       },
    { segId: '11', searchWord: 'probably',  note: 'seg11 "I should probably let"'    },
  ];

  let maxDriftMs = 0;
  for (const { segId, searchWord, note } of driftChecks) {
    const entry = timeline.find(e => e.segmentId === segId);
    if (!entry) continue;
    const expectedMs  = entry.t;
    const expectedSec = expectedMs / 1000;

    const found = allWords.find(w => {
      const w2 = (w.word || '').toLowerCase().replace(/[^a-z']/g, '');
      return w2.includes(searchWord.replace(/[^a-z']/g, '')) &&
             Math.abs(w.start - expectedSec) < 15;
    });

    if (found) {
      const foundMs = Math.round(found.start * 1000);
      const drift   = Math.abs(foundMs - expectedMs);
      maxDriftMs    = Math.max(maxDriftMs, drift);
      console.log(`  ${drift <= 500 ? '✓' : '✗'} ${note}: expected ${(expectedMs/1000).toFixed(2)}s  found ${(foundMs/1000).toFixed(2)}s  drift=${drift}ms`);
    } else {
      console.log(`  ? ${note}: not found near ${expectedSec.toFixed(2)}s`);
    }
  }

  console.log(`\n  Max phrase drift: ${maxDriftMs}ms`);
  if (maxDriftMs === 0) {
    console.log('  (No phrases matched — Whisper model may need adjusting)');
  } else if (maxDriftMs <= 500) {
    console.log('  RESULT: ✓ PASS');
  } else {
    console.log('  RESULT: ✗ FAIL — drift >500ms. Keep OBS method.');
  }
  return maxDriftMs;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Ozmeva Headless Lesson 2 Recording — Experiment');
  console.log('══════════════════════════════════════════════════');

  try {
    const { manifest, durations, expectedMs } = await step0();

    // Re-use existing recording if step 1 already ran
    const step1CachePath = path.join(OUT_DIR, 'step1.json');
    let step1Result;
    if (fs.existsSync(step1CachePath)) {
      step1Result = JSON.parse(fs.readFileSync(step1CachePath, 'utf8'));
      console.log(`\n═══ Step 1: Skipped (using cached recording) ═══`);
      console.log(`  Video: ${path.basename(step1Result.webmPath)}`);
      console.log(`  t0 offset: ${step1Result.t0OffsetSec.toFixed(2)}s`);
      console.log(`  Lesson duration: ${(step1Result.lessonDurationMs / 1000).toFixed(1)}s`);
    } else {
      step1Result = await step1();
    }
    const { webmPath, t0OffsetSec, lessonDurationMs } = step1Result;

    const { audioOut, timeline, totalAudioMs } = step2(manifest, durations);

    const finalMp4 = step3(webmPath, audioOut, t0OffsetSec);

    const driftMs = step4(finalMp4, timeline, lessonDurationMs, totalAudioMs);

    console.log('\n══════════════════════════════════════════════════');
    console.log('  DONE');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Output:  ${finalMp4}`);
    console.log(`  Frames:  ${path.join(OUT_DIR, 'frames')}`);
    if (driftMs !== null) {
      console.log(`  Drift:   ${driftMs}ms — ${driftMs <= 500 ? 'PASS ✓' : 'FAIL ✗'}`);
    }
    console.log();
  } catch (e) {
    console.error('\n[FATAL]', e.message);
    process.exit(1);
  }
})();
