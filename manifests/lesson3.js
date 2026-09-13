'use strict';
/**
 * manifests/lesson3.js
 * 6-slice manifest for Lesson 3 (PACE — The Long Game).
 *
 * Timestamps derived from Whisper word-level transcription of lesson3-raw.mp4
 * (trimmed OBS recording, Ryan's first word "Lessons" at t=0.20s).
 *
 * Segment boundaries (absolute in trimmed file):
 *   seg00  0.20s  Welcome
 *   seg01 42.16s  What PACE Is
 *   seg02 89.08s  Exchange — Watch: The Pause      (bad example)
 *   seg03 115.10s P — Pause coaching
 *   seg04 164.04s Exchange — Watch: The Ask-back   (bad example)
 *   seg05 189.24s A — Ask-back coaching
 *   seg06 238.16s Exchange — Watch: Contain        (bad example)
 *   seg07 259.48s C — Contain coaching
 *   seg08 305.32s Exchange — Watch: Earn           (bad example)
 *   seg09 325.34s E — Earn coaching
 *   seg10 368.48s Your Four Steps (wrap-up)
 *   end   425.60s
 *
 * Slice grouping: coaching pair intro (slice 1) → exchange+coaching × 4 (slices 2-5) → wrap-up (slice 6).
 * In slices 2-5 the exchange opens the slice (offsetSec=0); Ryan's post-exchange coaching
 * is heard but not auto-captioned — consistent with the lesson-slice-template design.
 *
 * Usage:
 *   node scripts/lesson-slice-template.js manifests/lesson3.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  obsFile:     path.join(ROOT, 'content', 'lesson3', 'lesson3-raw.mp4'),
  lessonNum:   3,
  totalSlices: 6,
  outputDir:   path.join(ROOT, 'content', 'lesson3', 'slices'),

  // Same OBS setup as Lesson 2 — Chromium window captured at identical position.
  crop:           { x: 451, y: 68, w: 367, h: 652 },
  drawboxY:       1380,
  captionMarginV: 1440,

  slices: [

    // ── Slice 1/6 — seg00+seg01: Welcome + What PACE Is ──────────────────────
    // Ryan: "Lessons 1 and 2 covered..." → PACE acronym reveal → "Watch Alex now."
    // Duration: 0.0s → 89.0s (89s)
    {
      num:      1,
      obsStart: 0.0,
      dur:      89.0,
      badge:    'Lesson 3 (1/6)',
      hook:     'The moment things go well is when most men lose it.',
      cliffhanger: 'Watch what he does the second she asks him how he feels about her.',
    },

    // ── Slice 2/6 — seg02+seg03: Exchange (Watch Pause) + P — Pause ──────────
    // Exchange opens: Sofia asks "do you actually like me?" — Alex answers fully (bad).
    // Ryan follows: "Stop. Did you hear that?..." → explains Pause
    // Duration: 89.0s → 164.0s (75s)
    {
      num:      2,
      obsStart: 89.0,
      dur:      75.0,
      badge:    'Lesson 3 (2/6)',
      hook:     'She asked him directly.',
      cliffhanger: 'The moment he answered completely, the pull was gone. P — Pause.',

      // Exchange is the opening of this slice (offsetSec=0 → no pre-exchange narration)
      exchange: {
        offsetSec: 0.0,
        lines: [
          { t:  0.00, end:  1.36, voice: 'sofia', text: "Can I ask you something?" },
          { t:  2.06, end:  2.56, voice: 'alex',  text: "Go ahead." },
          { t:  3.26, end:  7.96, voice: 'sofia', text: "Do you actually like me? Or is this just something to do?" },
          { t:  8.66, end: 13.08, voice: 'alex',  text: "Yeah. I like you. I've been thinking about you since the beach, honestly." },
          { t: 13.78, end: 14.30, voice: 'sofia', text: "Oh." },
          { t: 15.00, end: 16.23, voice: 'alex',  text: "Is that weird to say?" },
          { t: 16.93, end: 20.71, voice: 'sofia', text: "No, it's fine. I just wasn't expecting that." },
          { t: 21.41, end: 22.95, voice: 'alex',  text: "I figured I'd just say it." },
        ],
      },
    },

    // ── Slice 3/6 — seg04+seg05: Exchange (Watch Ask-back) + A — Ask-back ────
    // Exchange: Sofia asks what Alex does — he answers fully, no redirect (bad).
    // Ryan follows: "Notice what just happened..." → explains Ask-back
    // Duration: 164.0s → 238.0s (74s)
    {
      num:      3,
      obsStart: 164.0,
      dur:      74.0,
      badge:    'Lesson 3 (3/6)',
      hook:     'He answered. Then stopped.',
      cliffhanger: 'The moment she explains herself to you, she\'s more invested than 30 seconds ago. A — Ask-back.',

      exchange: {
        offsetSec: 0.0,
        lines: [
          { t:  0.00, end:  3.08, voice: 'sofia', text: "What do you actually do? Like, day to day." },
          { t:  3.78, end: 12.90, voice: 'alex',  text: "Product design — UX, mostly. I've been doing it about five years. Started freelance, now I'm at a small studio." },
          { t: 13.60, end: 14.18, voice: 'sofia', text: "Hm." },
          { t: 14.88, end: 17.68, voice: 'alex',  text: "Probably sounds more interesting than it is." },
          { t: 18.38, end: 21.36, voice: 'sofia', text: "Maybe. I don't know enough about it to say." },
          { t: 22.06, end: 22.59, voice: 'alex',  text: "Fair." },
        ],
      },
    },

    // ── Slice 4/6 — seg06+seg07: Exchange (Watch Contain) + C — Contain ──────
    // Exchange: Sofia laughs — Alex stacks compliments (bad).
    // Ryan follows: "She laughed. Real warmth." → explains Contain
    // Duration: 238.0s → 305.0s (67s)
    {
      num:      4,
      obsStart: 238.0,
      dur:      67.0,
      badge:    'Lesson 3 (4/6)',
      hook:     'She laughed. He couldn\'t hold it.',
      cliffhanger: 'What you notice and don\'t say has more weight than anything you could say out loud. C — Contain.',

      exchange: {
        offsetSec: 0.0,
        lines: [
          { t:  0.00, end:  2.30, voice: 'sofia', text: "Okay, that's actually really funny." },
          { t:  3.00, end:  4.32, voice: 'alex',  text: "You have a great laugh." },
          { t:  5.02, end:  5.78, voice: 'sofia', text: "Thanks." },
          { t:  6.48, end: 12.60, voice: 'alex',  text: "No, I mean it — you're beautiful. I've been thinking that since the beach and I keep not saying it." },
          { t: 13.30, end: 14.24, voice: 'sofia', text: "That's sweet." },
          { t: 14.94, end: 17.34, voice: 'alex',  text: "I mean it. I've thought about you a lot." },
          { t: 18.04, end: 18.61, voice: 'sofia', text: "Yeah." },
        ],
      },
    },

    // ── Slice 5/6 — seg08+seg09: Exchange (Watch Earn) + E — Earn ────────────
    // Exchange: Sofia shows warmth — Alex declares immediately (bad).
    // Ryan follows: "He said it on the third exchange..." → explains Earn
    // Duration: 305.0s → 368.5s (63.5s)
    {
      num:      5,
      obsStart: 305.0,
      dur:      63.5,
      badge:    'Lesson 3 (5/6)',
      hook:     'She showed real warmth. He showed his cards.',
      cliffhanger: 'Declarations land when she\'s earned them. Not before. E — Earn.',

      exchange: {
        offsetSec: 0.0,
        lines: [
          { t:  0.00, end:  1.93, voice: 'sofia', text: "I've actually really enjoyed this." },
          { t:  2.63, end:  6.74, voice: 'alex',  text: "Same. Honestly — I haven't felt this easy with someone in a while." },
          { t:  7.44, end:  8.01, voice: 'sofia', text: "Yeah?" },
          { t:  8.71, end: 12.60, voice: 'alex',  text: "I'd like to see you again. Like, properly. Take you out somewhere." },
          { t: 13.30, end: 14.53, voice: 'sofia', text: "That's really sweet." },
          { t: 15.23, end: 15.88, voice: 'alex',  text: "I mean it." },
          { t: 16.58, end: 17.28, voice: 'sofia', text: "Okay." },
        ],
      },
    },

    // ── Slice 6/6 — seg10: Your Four Steps (PACE wrap-up) ────────────────────
    // Ryan: "That's PACE. Let me give you the four one more time..." → "She's waiting. Go find out."
    // Duration: 368.5s → 425.6s (57.1s)
    {
      num:      6,
      obsStart: 368.5,
      dur:      57.0,
      badge:    'Lesson 3 (6/6)',
      hook:     'Four moves. One word.',
      cliffhanger: 'Try it yourself. Your first two sessions are free at ozmeva.com.',
    },

  ],
};
