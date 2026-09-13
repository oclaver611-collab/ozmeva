#!/usr/bin/env node
/**
 * lesson-slice-template.js
 *
 * Canonical pipeline for slicing a raw OBS lesson recording into portrait 9:16 clips.
 * All visual, caption, and sync settings are locked to verified Lesson 1 values.
 * Do NOT change constants without re-measuring the source app layout.
 *
 * Usage:
 *   node scripts/lesson-slice-template.js <manifest.js>
 *
 * The manifest file must export a LESSON object — see docs/lesson-slice-template.md
 * for the full schema and examples.
 */

'use strict';
const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ═══════════════════════════════════════════════════════════════════════════════
// LOCKED VISUAL CONSTANTS  (do not change without re-measuring — see docs)
// ═══════════════════════════════════════════════════════════════════════════════

// OBS crop: 390×693 window starting at x=445, y=18 within the 1280×720 OBS frame.
// x=445 keeps Ryan's orb fully visible on the left and Sofia's face fully in-frame
// on the right. Earlier attempt at x=490 clipped Sofia's right edge.
// y=18 trims the OS window chrome at the top.
let CROP = { x: 445, y: 18, w: 390, h: 693 };

// Output resolution: standard portrait short-form video.
const OUTPUT_W = 1080;
const OUTPUT_H = 1920;

// Background/card fill color (matches the Ozmeva dark UI palette).
const BG_HEX   = '0x15171C'; // ffmpeg color string
const BG_COLOR  = '#15171C'; // CSS-style for reference

// Dark caption box: covers everything below y=1125 with the background color,
// hiding the Ozmeva app's bottom chrome (paywall button, scroll indicators).
// y=1125 was chosen after pixel-scanning the raw OBS source: Sofia's "Sofia"
// name tag text ends at y=1111, so y=1125 gives a 14px margin before the dark
// box begins. Earlier value of y=1110 clipped the bottom 2 rows of her name.
let DRAWBOX_Y = 1125;
let DRAWBOX_H = OUTPUT_H - DRAWBOX_Y; // 795

// Caption positioning: ASS Alignment=8 (top-anchor), MarginV places the top
// of the first caption line this many pixels from the top of the frame.
// 1182 was derived as: DRAWBOX_Y + 80px desired gap − 23px libass internal offset.
// The 80px gap keeps captions visually separate from the content above the dark box.
let CAPTION_MARGIN_V    = 1182;
const CAPTION_FONT_SIZE   = 86;
const CAPTION_MAX_WORDS   = 6;    // max words per caption chunk
const CAPTION_PAUSE_BREAK = 0.45; // seconds of silence that forces a new chunk

// Speaker colors in ASS BGR hex (note: ASS is BBGGRR, not RRGGBB).
// Ryan (narrator): amber/gold.  Alex: cyan.  Sofia: soft pink/purple.
const COLOR_RYAN  = '&H0054A0D9'; // gold  (#D9A054 in RGB)
const COLOR_ALEX  = '&H00FFE500'; // cyan  (#00E5FF in RGB)
const COLOR_SOFIA = '&H00B97EFF'; // pink  (#FF7EB9 in RGB)

// Hook card: 2-second dark card at the very start of each slice.
const HOOK_DUR  = 2;  // seconds

// Outro card: 4-second dark card at the very end of each slice (after cliffhanger).
const OUTRO_DUR = 4;  // seconds

// Fish Audio TTS — Ryan's production voice clone.
// This voice ID is the one already cleared for production use in Lesson 1.
const FISH_VOICE_ID = '44b996214285427697767cb469793647';
const FISH_API_URL  = 'https://api.fish.audio/v1/tts';

// Groq Whisper model for word-level transcription.
const WHISPER_MODEL = 'whisper-large-v3-turbo';

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT / PATHS
// ═══════════════════════════════════════════════════════════════════════════════

const ROOT    = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.local');

function loadEnv() {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const get = (key) => {
    const line = lines.find(l => l.startsWith(key + '='));
    if (!line) throw new Error(`Missing ${key} in .env.local`);
    return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
  };
  return { groqKey: get('GROQ_API_KEY'), fishKey: get('FISH_AUDIO_API_KEY') };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASS SUBTITLE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function assTime(s) {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// Full ASS header with all locked styles.
function makeAssHeader() {
  const mv = CAPTION_MARGIN_V;
  const fs = CAPTION_FONT_SIZE;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUTPUT_W}
PlayResY: ${OUTPUT_H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial Black,${fs},${COLOR_RYAN},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,8,80,80,${mv},1
Style: AlexCaption,Arial Black,${fs},${COLOR_ALEX},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,8,80,80,${mv},1
Style: SofiaCaption,Arial Black,${fs},${COLOR_SOFIA},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,8,80,80,${mv},1
Style: Badge,Arial Black,40,&H00FFFFFF,&H000000FF,&H00000000,&H44000000,-1,0,0,0,100,100,0,0,3,12,0,9,20,20,40,1
Style: HookText,Arial Black,86,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,2,5,80,80,0,1
Style: OutroTag,Arial,46,&H00C8A0A0,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,80,80,0,1
Style: OutroUrl,Arial Black,70,${COLOR_RYAN},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,5,80,80,0,1
Style: OutroSub,Arial,38,&H00888888,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,80,80,0,1
Style: CliffCaption,Arial Black,72,${COLOR_RYAN},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,5,80,80,0,1
Style: OutroFollow,Arial Black,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

let ASS_HEADER; // set in main() after manifest overrides are applied

function voiceToStyle(voice) {
  if (voice === 'alex')  return 'AlexCaption';
  if (voice === 'sofia') return 'SofiaCaption';
  return 'Caption'; // Ryan / narrator
}

function buildCaptionASS(captions, badge, dur) {
  const lines = [`Dialogue: 0,${assTime(0)},${assTime(dur)},Badge,,0,0,0,,${badge}`];
  for (const c of captions) {
    lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${voiceToStyle(c.voice)},, 0,0,0,,${c.text}`);
  }
  return ASS_HEADER + '\n' + lines.join('\n');
}

function buildHookASS(hookLine, badge) {
  return ASS_HEADER + '\n' +
    `Dialogue: 0,${assTime(0)},${assTime(HOOK_DUR)},Badge,,0,0,0,,${badge}\n` +
    `Dialogue: 0,${assTime(0.25)},${assTime(HOOK_DUR - 0.25)},HookText,,0,0,0,,${hookLine}`;
}

function buildOutroASS(sliceNum, totalSlices) {
  const followLine = (sliceNum < totalSlices)
    ? `Dialogue: 0,0:00:00.20,0:00:04.00,OutroFollow,,0,0,0,,{\\pos(540,700)}Follow for Part ${sliceNum + 1}\n`
    : '';
  return ASS_HEADER + '\n' +
    followLine +
    `Dialogue: 0,0:00:00.20,0:00:04.00,OutroTag,,0,0,0,,{\\pos(540,830)}Want to try this yourself?\n` +
    `Dialogue: 0,0:00:00.50,0:00:04.00,OutroUrl,,0,0,0,,{\\pos(540,960)}ozmeva.com\n` +
    `Dialogue: 0,0:00:01.00,0:00:04.00,OutroSub,,0,0,0,,{\\pos(540,1090)}2 free sessions · no card required`;
}

function buildCliffASS(captions) {
  const lines = captions.map(c =>
    `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},CliffCaption,,0,0,0,,${c.text}`
  );
  return ASS_HEADER + '\n' + lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPTION CHUNKING
// ═══════════════════════════════════════════════════════════════════════════════

// Group Whisper word-level timestamps into display chunks.
// New chunk starts when: gap between words >= pauseThreshold OR chunk is full.
function groupWordsIntoCaptions(words, maxWords = CAPTION_MAX_WORDS, pauseThreshold = CAPTION_PAUSE_BREAK) {
  const groups = [];
  let current  = [];
  for (const w of words) {
    const pause = current.length > 0 ? w.start - current[current.length - 1].end : 0;
    if (current.length >= maxWords || (current.length > 0 && pause >= pauseThreshold)) {
      groups.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length > 0) groups.push(current);
  return groups.map(g => ({
    start: g[0].start,
    end:   g[g.length - 1].end,
    text:  g.map(w => w.word.trim()).join(' '),
  }));
}

// Split a pre-written exchange line (known text, no Whisper) proportionally.
// Used only for exchange dialogue where we have the transcript but not word timestamps.
function chunkSegment(text, start, end, maxWords = CAPTION_MAX_WORDS) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return [{ start, end, text: text.trim() }];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  if (sentences.length > 1) {
    const total = words.length;
    let cum = start;
    const out = [];
    for (const s of sentences) {
      const sw = s.trim().split(/\s+/).length;
      const d  = (end - start) * (sw / total);
      out.push(...chunkSegment(s, cum, cum + d, maxWords));
      cum += d;
    }
    return out;
  }
  const half = Math.ceil(words.length / 2);
  const mid  = start + (end - start) * (half / words.length);
  return [
    { start, end: mid, text: words.slice(0, half).join(' ') },
    { start: mid, end,  text: words.slice(half).join(' ') },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHISPER TRANSCRIPTION
// ═══════════════════════════════════════════════════════════════════════════════

function whisperWords(audioPath, groqKey) {
  console.log(`  Whisper: ${path.basename(audioPath)}...`);
  const raw = execSync([
    'curl', '-s', 'https://api.groq.com/openai/v1/audio/transcriptions',
    '-H', `"Authorization: Bearer ${groqKey}"`,
    '-F', `"model=${WHISPER_MODEL}"`,
    '-F', `"file=@${audioPath.replace(/\\/g, '/')}"`,
    '-F', '"response_format=verbose_json"',
    '-F', '"language=en"',
    '-F', '"timestamp_granularities[]=word"',
  ].join(' '), { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

  const data = JSON.parse(raw);
  if (data.error) throw new Error('Whisper API error: ' + JSON.stringify(data.error));
  const words = data.words || [];
  console.log(`    → ${words.length} words`);
  return words;
}

// Extract lesson-only audio from a rendered slice for Whisper input.
// Pulls from OBS directly (t=0 in lesson time = obsStart in OBS file).
function extractLessonAudio(obsFile, obsStart, dur, outMp3) {
  execSync(
    `ffmpeg -y -ss ${obsStart.toFixed(3)} -i "${obsFile}" ` +
    `-t ${dur.toFixed(3)} -vn -ac 1 -ar 16000 "${outMp3}"`,
    { stdio: ['pipe', 'pipe', 'inherit'] }
  );
  console.log(`  ✓ lesson audio extracted: ${path.basename(outMp3)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FISH AUDIO TTS
// ═══════════════════════════════════════════════════════════════════════════════

function generateCliffhanger(text, outMp3, fishKey) {
  console.log(`  Fish TTS: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
  const body = JSON.stringify({
    text,
    reference_id: FISH_VOICE_ID,
    format:       'mp3',
    streaming:    false,
  });
  const bodyFile = outMp3 + '.body.json';
  fs.writeFileSync(bodyFile, body);
  execSync(
    `curl -s -X POST "${FISH_API_URL}" ` +
    `-H "Authorization: Bearer ${fishKey}" ` +
    `-H "Content-Type: application/json" ` +
    `--data-binary "@${bodyFile.replace(/\\/g, '/')}" ` +
    `-o "${outMp3.replace(/\\/g, '/')}"`,
    { encoding: 'utf8' }
  );
  fs.unlinkSync(bodyFile);

  // Measure actual duration
  const dur = parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outMp3}"`,
    { encoding: 'utf8' }
  ).trim());
  console.log(`    → ${dur.toFixed(2)}s`);
  return dur;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPTION BUILD — narration + optional exchange
// ═══════════════════════════════════════════════════════════════════════════════

// sliceConfig.exchange (optional):
//   { offsetSec, lines: [{t, end, text, voice}], contamZone?: {start, end} }
function buildCaptions(words, sliceConfig) {
  const exch = sliceConfig.exchange;

  let narrWords = exch
    ? words.filter(w => w.start < exch.offsetSec - 0.5)
    : words;

  if (exch && exch.contamZone) {
    const { start: cs, end: ce } = exch.contamZone;
    narrWords = narrWords.filter(w => !(w.start >= cs && w.start < ce));
  }

  const narrCaps = groupWordsIntoCaptions(narrWords);

  if (!exch) return narrCaps;

  const exchCaps = [];
  for (const line of exch.lines) {
    for (const chunk of chunkSegment(line.text, exch.offsetSec + line.t, exch.offsetSec + line.end)) {
      exchCaps.push({ ...chunk, voice: line.voice });
    }
  }

  return [...narrCaps, ...exchCaps].sort((a, b) => a.start - b.start);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FFMPEG RENDER — 4-segment concat: hook → lesson → cliffhanger → outro
// ═══════════════════════════════════════════════════════════════════════════════

function renderSlice({ obsFile, obsStart, lessonDur, clifDur, outFile, tmp, sliceNum }) {
  const d   = lessonDur.toFixed(3);
  const cd  = clifDur.toFixed(3);
  const bn  = (n) => String(n);
  const darkCard = (dur) => `color=c=${BG_HEX}:s=${OUTPUT_W}x${OUTPUT_H}:r=30:d=${dur}`;

  // Inputs:  [0]=OBS  [1]=outro-lavfi  [2]=hook-lavfi  [3]=cliff-lavfi  [4]=cliff-mp3
  const FC = [
    `[0:v]trim=duration=${d},setpts=PTS-STARTPTS,` +
      `crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y},` +
      `scale=${OUTPUT_W}:${OUTPUT_H}:flags=lanczos,setsar=1,fps=30,` +
      `drawbox=x=0:y=${DRAWBOX_Y}:w=${OUTPUT_W}:h=${DRAWBOX_H}:c=${BG_HEX}@1:t=fill,` +
      `ass='slice${sliceNum}.ass'[lesson]`,
    `[2:v]fps=30,ass='hook${sliceNum}.ass'[hook]`,
    `[3:v]fps=30,ass='cliff${sliceNum}.ass'[cliff_v]`,
    `[1:v]fps=30,ass='outro${sliceNum}.ass'[outro]`,
    `[hook][lesson][cliff_v][outro]concat=n=4:v=1:a=0[outv]`,
    `aevalsrc=0:d=${HOOK_DUR}[hook_sil]`,
    `[0:a]atrim=duration=${d},asetpts=PTS-STARTPTS,loudnorm=I=-14:LRA=11:TP=-1.5[lsn_a]`,
    `[4:a]asetpts=PTS-STARTPTS[cliff_a]`,
    `aevalsrc=0:d=${OUTRO_DUR}[outro_sil]`,
    `[hook_sil][lsn_a][cliff_a][outro_sil]concat=n=4:v=0:a=1[outa]`,
  ].join(';');

  const cliffMp3 = path.join(tmp, `cliffhanger_s${sliceNum}.mp3`).replace(/\\/g, '/');

  execSync(
    `ffmpeg -y -ss ${obsStart.toFixed(3)} -i "${obsFile}" ` +
    `-f lavfi -i "${darkCard(OUTRO_DUR)}" ` +
    `-f lavfi -i "${darkCard(HOOK_DUR)}" ` +
    `-f lavfi -i "${darkCard(clifDur)}" ` +
    `-i "${cliffMp3}" ` +
    `-filter_complex "${FC}" ` +
    `-map "[outv]" -map "[outa]" ` +
    `-c:v libx264 -crf 18 -preset fast ` +
    `-c:a aac -b:a 192k ` +
    `-movflags +faststart ` +
    `"${outFile}"`,
    { stdio: ['pipe', 'pipe', 'inherit'], cwd: tmp }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node scripts/lesson-slice-template.js <manifest.js>');
    process.exit(1);
  }

  const LESSON = require(path.resolve(manifestPath));
  const { obsFile, lessonNum, totalSlices, outputDir, slices } = LESSON;

  // Apply manifest-level visual overrides (crop, drawbox, caption position).
  // If absent the locked Lesson 1 defaults above remain in effect.
  if (LESSON.crop)                  CROP             = LESSON.crop;
  if (LESSON.drawboxY     != null)  DRAWBOX_Y        = LESSON.drawboxY;
  if (LESSON.captionMarginV != null) CAPTION_MARGIN_V = LESSON.captionMarginV;
  DRAWBOX_H  = OUTPUT_H - DRAWBOX_Y;
  ASS_HEADER = makeAssHeader();

  if (!fs.existsSync(obsFile)) throw new Error(`OBS file not found: ${obsFile}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const tmp = path.join(os.tmpdir(), `ek-lesson${lessonNum}`);
  fs.mkdirSync(tmp, { recursive: true });

  const env = loadEnv();

  const tag = (n) => `lesson${lessonNum}-slice${String(n).padStart(2,'0')}-of${String(totalSlices).padStart(2,'0')}`;

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`Lesson ${lessonNum} — ${slices.length} slices  →  ${outputDir}`);
  console.log(`${'═'.repeat(72)}\n`);

  // ── Step 1: Extract lesson audio for Whisper ─────────────────────────────
  console.log('── Step 1: Extracting lesson audio');
  for (const s of slices) {
    const mp3 = path.join(tmp, `lesson_s${s.num}.mp3`);
    if (!fs.existsSync(mp3)) {
      extractLessonAudio(obsFile, s.obsStart, s.dur, mp3);
    } else {
      console.log(`  (exists) ${path.basename(mp3)}`);
    }
  }

  // ── Step 2: Whisper word-level transcription ──────────────────────────────
  console.log('\n── Step 2: Whisper transcription');
  const wordMap = {};
  for (const s of slices) {
    const mp3 = path.join(tmp, `lesson_s${s.num}.mp3`);
    wordMap[s.num] = whisperWords(mp3, env.groqKey);
  }

  // ── Step 3: Build captions ────────────────────────────────────────────────
  console.log('\n── Step 3: Building captions');
  const captionMap = {};
  for (const s of slices) {
    captionMap[s.num] = buildCaptions(wordMap[s.num], s);
    const c = captionMap[s.num];
    const rCount = c.filter(x => !x.voice).length;
    const aCount = c.filter(x => x.voice === 'alex').length;
    const sCount = c.filter(x => x.voice === 'sofia').length;
    console.log(`  Slice ${s.num}: ${c.length} chunks — Ryan=${rCount} Alex=${aCount} Sofia=${sCount}`);
  }

  // ── Step 4: Generate cliffhanger TTS ─────────────────────────────────────
  console.log('\n── Step 4: Cliffhanger TTS (Fish Audio)');
  const clifDurMap = {};
  for (const s of slices) {
    const mp3 = path.join(tmp, `cliffhanger_s${s.num}.mp3`);
    if (!fs.existsSync(mp3)) {
      clifDurMap[s.num] = generateCliffhanger(s.cliffhanger, mp3, env.fishKey);
    } else {
      clifDurMap[s.num] = parseFloat(execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp3}"`,
        { encoding: 'utf8' }
      ).trim());
      console.log(`  (exists) cliffhanger_s${s.num}.mp3  (${clifDurMap[s.num].toFixed(2)}s)`);
    }
  }

  // ── Step 5: Write ASS files ───────────────────────────────────────────────
  console.log('\n── Step 5: Writing ASS files');
  for (const s of slices) {
    const n = s.num;
    const clifDur = clifDurMap[n];

    fs.writeFileSync(path.join(tmp, `outro${n}.ass`),
      buildOutroASS(n, totalSlices), 'utf8');

    fs.writeFileSync(path.join(tmp, `slice${n}.ass`),
      buildCaptionASS(captionMap[n], s.badge, s.dur), 'utf8');

    fs.writeFileSync(path.join(tmp, `hook${n}.ass`),
      buildHookASS(s.hook, s.badge), 'utf8');

    const cliffCaps = chunkSegment(s.cliffhanger, 0, clifDur);
    fs.writeFileSync(path.join(tmp, `cliff${n}.ass`),
      buildCliffASS(cliffCaps), 'utf8');

    console.log(`  ✓ outro${n}.ass + slice${n}.ass + hook${n}.ass + cliff${n}.ass`);
  }

  // ── Step 6: Render ────────────────────────────────────────────────────────
  console.log('\n── Step 6: Rendering');
  for (const s of slices) {
    const outFile = path.join(outputDir, `${tag(s.num)}.mp4`).replace(/\\/g, '/');
    console.log(`\n  Slice ${s.num}: OBS t=${s.obsStart.toFixed(3)}s, dur=${s.dur.toFixed(3)}s, cliff=${clifDurMap[s.num].toFixed(2)}s`);

    renderSlice({
      obsFile:   obsFile,
      obsStart:  s.obsStart,
      lessonDur: s.dur,
      clifDur:   clifDurMap[s.num],
      outFile,
      tmp,
      sliceNum:  s.num,
    });

    const mb = (fs.statSync(outFile.replace(/\//g, path.sep)).size / 1e6).toFixed(1);
    console.log(`  ✓ ${path.basename(outFile)}  (${mb} MB)`);
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`Done. ${slices.length} slices written to ${outputDir}`);
  console.log(`${'═'.repeat(72)}\n`);
}

main();
