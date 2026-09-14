'use strict';
/**
 * manifests/lesson4.js
 * 6-slice manifest for Lesson 4 (CHAIN — The Thread).
 *
 * Timestamps derived from Whisper word-level transcription of lesson4-raw.mp4
 * (trimmed OBS recording, Ryan's first word "Lesson" at t=0.00s).
 *
 * Segment boundaries (absolute in trimmed file):
 *   seg00   0.00s  Welcome + CHAIN setup
 *   seg01  51.70s  Exchange — Watch: Threading Fail  (bad example)
 *   seg02  77.02s  What Just Happened (C and H intro)
 *   seg03 130.78s  Exchange — Watch: C and H          (good example)
 *   seg04 164.66s  C — Catch · H — Hook coaching
 *   seg05 211.78s  Exchange — Watch: A and I           (good example)
 *   seg06 255.66s  A — Ask · I — Inject coaching
 *   seg07 303.50s  Exchange — Watch: N                 (good example)
 *   seg08 343.00s  N — Never Abandon coaching
 *   seg09 388.10s  Your Five Steps (CHAIN wrap-up)
 *   end   456.88s
 *
 * Slice grouping: intro+bad-example (slice 1) → explanation+good-example×3 (slices 2-4)
 * → N coaching (slice 5) → CHAIN summary (slice 6).
 * In slices 1-4 the exchange CLOSES the slice (exchange is the cliffhanger).
 * Exchange captions use Whisper word timestamps via buildExchangeCaptions() —
 * t/end values below are fallbacks only (used when Whisper match fails).
 *
 * Usage:
 *   node scripts/lesson-slice-template.js manifests/lesson4.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  obsFile:     path.join(ROOT, 'content', 'lesson4', 'lesson4-raw.mp4'),
  lessonNum:   4,
  totalSlices: 6,
  outputDir:   path.join(ROOT, 'content', 'lesson4', 'slices'),

  // Same OBS setup as Lessons 2 and 3 — Chromium window at identical position.
  crop:           { x: 451, y: 68, w: 367, h: 652 },
  drawboxY:       1380,
  captionMarginV: 1440,

  slices: [

    // ── Slice 1/6 — seg00+seg01: Welcome + Threading Fail ────────────────────
    // Ryan: "Lesson 4. If you've done the first three..." → "Watch what that
    // looks like when someone gets it wrong first."
    // Exchange: Sofia opens with friend-in-Amsterdam story; Alex picks obvious
    // thread (do you miss this bar?), uses it up, topic-hops — bad threading.
    // Duration: 0.0s → 77.0s
    {
      num:      1,
      obsStart: 0.0,
      dur:      77.0,
      badge:    'Lesson 4 (1/6)',
      hook:     "She handed him four threads to pull. He picked the most obvious one.",
      cliffhanger: "Every time he answered, the conversation got shorter. C — Catch.",

      exchange: {
        offsetSec: 51.70,
        lines: [
          { t:  0.00, end:  9.02, voice: 'sofia', text: "I haven't been here in ages, actually. My friend used to work here — she moved to Amsterdam. Got this job she'd been going after for three years." },
          { t:  9.02, end: 11.62, voice: 'alex',  text: "Oh — do you miss coming here?" },
          { t: 11.62, end: 14.42, voice: 'sofia', text: "A bit. It's a good spot." },
          { t: 14.42, end: 16.62, voice: 'alex',  text: "When did she move?" },
          { t: 16.62, end: 18.68, voice: 'sofia', text: "Last autumn." },
          { t: 18.68, end: 21.22, voice: 'alex',  text: "So what do you do yourself?" },
          { t: 21.22, end: 23.50, voice: 'sofia', text: "I work in research. What about you?" },
        ],
      },
    },

    // ── Slice 2/6 — seg02+seg03: Explanation + C and H (good example) ────────
    // Ryan: "Let's go back. Sofia said one sentence. I want you to count what
    // she put in it..." → explains threading failure, introduces C and H.
    // Exchange: same Sofia opener; Alex picks richest thread ("3 years going
    // after the same thing"), hooks it, goes one layer deeper — good C+H.
    // Duration: 77.0s → 165.0s (88s)
    {
      num:      2,
      obsStart: 77.0,
      dur:      88.0,
      badge:    'Lesson 4 (2/6)',
      hook:     "She said the same line. This time he heard something different.",
      cliffhanger: "The richest thread is usually the one she almost didn't include. H — Hook.",

      exchange: {
        offsetSec: 53.78,
        lines: [
          { t:  0.00, end:  9.52, voice: 'sofia', text: "I haven't been here in ages, actually. My friend used to work here — she moved to Amsterdam. Got this job she'd been going after for three years." },
          { t:  9.52, end: 15.52, voice: 'alex',  text: "Three years going after the same thing. What made her stick with it that long?" },
          { t: 15.52, end: 20.38, voice: 'sofia', text: "She just really wanted it. More than most people want things, I think." },
          { t: 20.38, end: 25.34, voice: 'alex',  text: "What does that actually look like — wanting something that much?" },
          { t: 25.34, end: 30.98, voice: 'sofia', text: "She applied four times. Got rejected every time. Just kept going back." },
          { t: 30.98, end: 32.42, voice: 'alex',  text: "That takes something." },
        ],
      },
    },

    // ── Slice 3/6 — seg04+seg05: C+H coaching + A and I (good example) ───────
    // Ryan: "C and H happen before you speak..." → coaches Catch and Hook.
    // Exchange: continuation of conversation — Alex asks deeper on Sofia's
    // friend leaving, then injects his own Berlin story (A + I in action).
    // Duration: 165.0s → 256.0s (91s)
    {
      num:      3,
      obsStart: 165.0,
      dur:      91.0,
      badge:    'Lesson 4 (3/6)',
      hook:     "He didn't ask a new question. He went one layer deeper into the same one.",
      cliffhanger: "One question deeper, she started explaining herself to him. A — Ask.",

      exchange: {
        offsetSec: 46.78,
        lines: [
          { t:  0.00, end:  5.14, voice: 'sofia', text: "She didn't even know if she'd like it there. She just knew she had to find out." },
          { t:  5.14, end:  9.32, voice: 'alex',  text: "What was it like when she left?" },
          { t:  9.32, end: 16.08, voice: 'sofia', text: "Weird. Good for her, obviously. We'd just been in the same city for so long. You get used to someone being around." },
          { t: 16.08, end: 27.20, voice: 'alex',  text: "I had someone go to Berlin two years ago. Different situation. But I know that feeling — you don't realize how much of your life is built around someone being in a specific place." },
          { t: 27.20, end: 32.06, voice: 'sofia', text: "Exactly. You don't notice it until it's gone." },
          { t: 32.06, end: 37.46, voice: 'alex',  text: "What do you miss most? Not about her — about how things were when she was here." },
          { t: 37.46, end: 43.82, voice: 'sofia', text: "Having someone nearby who already knows the context. You don't have to explain everything." },
        ],
      },
    },

    // ── Slice 4/6 — seg06+seg07: A+I coaching + N (good example) ────────────
    // Ryan: "He stayed on the same thread..." → coaches Ask and Inject.
    // Exchange: Sofia mentions an aside ("should probably find somewhere else to
    // drink"); Alex files it, returns to it later mid-conversation — good N.
    // Duration: 256.0s → 343.0s (87s)
    {
      num:      4,
      obsStart: 256.0,
      dur:      87.0,
      badge:    'Lesson 4 (4/6)',
      hook:     "She mentioned it as an aside. He filed it away.",
      cliffhanger: "He came back to the thing she'd already moved past. N — Never Abandon.",

      exchange: {
        offsetSec: 47.50,
        lines: [
          { t:  0.00, end:  4.42, voice: 'sofia', text: "I should probably find somewhere else to drink." },
          { t:  4.42, end:  6.10, voice: 'alex',  text: "What makes you say that?" },
          { t:  6.10, end: 11.06, voice: 'sofia', text: "I don't know. Anyway, have you been in this area long?" },
          { t: 11.06, end: 16.22, voice: 'alex',  text: "About three years. Came for work, stayed because it was easier." },
          { t: 16.22, end: 19.36, voice: 'sofia', text: "That's usually how it goes." },
          { t: 19.36, end: 25.98, voice: 'alex',  text: "You said something a few minutes ago. That you should probably find somewhere else to drink." },
          { t: 25.98, end: 26.54, voice: 'sofia', text: "Did I?" },
          { t: 26.54, end: 28.38, voice: 'alex',  text: "What did you mean?" },
          { t: 28.38, end: 32.32, voice: 'sofia', text: "I come here too much, I think. It's just easy." },
          { t: 32.32, end: 36.22, voice: 'alex',  text: "What's wrong with easy?" },
          { t: 36.22, end: 39.50, voice: 'sofia', text: "I don't know. Sometimes easy starts to feel like stuck." },
        ],
      },
    },

    // ── Slice 5/6 — seg08: N — Never Abandon coaching ────────────────────────
    // Ryan: "She said one thing — almost as an aside..." → coaches Never Abandon.
    // Pure coaching slice, no exchange.
    // Duration: 343.0s → 388.0s (45s)
    {
      num:      5,
      obsStart: 343.0,
      dur:      45.0,
      badge:    'Lesson 4 (5/6)',
      hook:     "Most men track themselves in a conversation.",
      cliffhanger: "She'll know the difference between being heard and being listened to.",
    },

    // ── Slice 6/6 — seg09: CHAIN wrap-up ─────────────────────────────────────
    // Ryan: "That's CHAIN. One more time..." → recaps all five moves → CTA.
    // Duration: 388.0s → 456.9s (68.9s)
    {
      num:      6,
      obsStart: 388.0,
      dur:      68.9,
      badge:    'Lesson 4 (6/6)',
      hook:     "Five moves. All of them start with the same thing.",
      cliffhanger: "Try it yourself. Your first two sessions are free at ozmeva.com.",
    },

  ],
};
