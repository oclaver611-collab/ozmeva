'use strict';
/**
 * manifests/lesson2.js
 * 7-slice manifest for Lesson 2 (FRAME).
 *
 * Timestamps derived from Whisper word-level transcription of lesson2-raw.mp4
 * (trimmed OBS recording, Ryan's first word at t=0.36s).
 *
 * Usage:
 *   node scripts/lesson-slice-template.js manifests/lesson2.js
 *
 * NOTE ON CROP: lesson2-raw.mp4 was recorded with a visible Chromium browser
 * window (tabs + address bar visible). lesson-slice-template.js has CROP/DRAWBOX
 * constants calibrated for Lesson 1's frameless layout. Before running all 7
 * slices, do a test render of slice 1 and verify the crop visually. If the
 * browser chrome is visible at the top of the output, update the LOCKED VISUAL
 * CONSTANTS in lesson-slice-template.js:
 *
 *   const CROP        = { x: 451, y: 68, w: 367, h: 652 };   // Lesson 2
 *   const DRAWBOX_Y   = 1380;                                  // Lesson 2
 *   const CAPTION_MARGIN_V = 1440;                             // Lesson 2
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  obsFile:     path.join(ROOT, 'content', 'lesson2', 'lesson2-raw.mp4'),
  lessonNum:   2,
  totalSlices: 7,
  outputDir:   path.join(ROOT, 'content', 'lesson2', 'slices'),

  // Lesson 2 crop — raw recording captured full Chromium chrome (tabs + address bar).
  // Verified correct by test render of slice 1 on 2026-09-13.
  crop:           { x: 451, y: 68, w: 367, h: 652 },
  drawboxY:       1380,
  captionMarginV: 1440,

  slices: [

    // ── Slice 1/7 — seg00+seg01: Welcome + What FRAME Is ──────────────────
    // Ryan intro (testing, attraction) → FRAME acronym reveal → "Watch Alex now"
    // Duration: 0.0s → 80.0s (80s)
    {
      num:      1,
      obsStart: 0.0,
      dur:      80.0,
      badge:    'Lesson 2 (1/7)',
      hook:     'She\'s going to test you.',
      cliffhanger: 'Watch what happens when she pushes back. It\'s not what most men do.',
    },

    // ── Slice 2/7 — seg02+seg03+seg04: Setup → The Test → F (Feel Nothing) ─
    // Ryan sets up the scenario → Alex/Sofia 10-line exchange → Ryan explains F
    // Duration: 79.5s → 181.0s (101.5s)
    {
      num:      2,
      obsStart: 79.5,
      dur:      101.5,
      badge:    'Lesson 2 (2/7)',
      hook:     'Most men fail this test instantly.',
      cliffhanger: 'She\'s about to call the whole thing strange. Watch how he turns it around.',

      // seg03 exchange: starts at 102.2s in trimmed file → 22.7s into this slice
      exchange: {
        offsetSec: 22.7,
        lines: [
          { t:  0.00, end:  1.38, voice: 'alex',  text: 'What are you working on?' },
          { t:  2.62, end:  4.66, voice: 'sofia', text: 'Something you probably wouldn\'t understand.' },
          { t:  5.64, end:  7.24, voice: 'alex',  text: 'Probably not. What is it anyway?' },
          { t:  8.40, end: 10.06, voice: 'sofia', text: 'A piece on coastal erosion.' },
          { t: 11.26, end: 14.80, voice: 'alex',  text: 'So, not what I expected. What made you start writing about that?' },
          { t: 15.84, end: 19.16, voice: 'sofia', text: 'I grew up here. You notice things when you grow up somewhere.' },
          { t: 20.08, end: 21.50, voice: 'alex',  text: 'Yeah, that makes sense.' },
          { t: 22.30, end: 25.84, voice: 'sofia', text: 'You\'re not going to pretend you find coastal erosion interesting, are you?' },
          { t: 25.84, end: 28.82, voice: 'alex',  text: 'No, but I\'m interested in why you do.' },
          { t: 30.18, end: 30.44, voice: 'sofia', text: 'Hmm.' },
        ],
      },
    },

    // ── Slice 3/7 — seg05+seg06: The Reframe → R (Reframe) ───────────────
    // Alex/Sofia 9-line exchange → Ryan explains R
    // Duration: 181.0s → 258.0s (77.0s)
    {
      num:      3,
      obsStart: 181.0,
      dur:      77.0,
      badge:    'Lesson 2 (3/7)',
      hook:     'She said she doesn\'t talk to strangers.',
      cliffhanger: 'She tells him he\'s too sure of himself. Watch what he does with it.',

      // seg05 exchange: starts at 181.3s in trimmed file → 0.3s into this slice
      exchange: {
        offsetSec: 0.3,
        lines: [
          { t:  0.00, end:  1.90, voice: 'sofia', text: 'I don\'t usually talk to strangers.' },
          { t:  2.84, end:  4.88, voice: 'alex',  text: 'That\'s interesting. You\'re talking to me.' },
          { t:  6.18, end:  7.88, voice: 'sofia', text: 'You caught me in a weak moment.' },
          { t:  8.64, end: 11.40, voice: 'alex',  text: 'Or a strong one. Depends how you look at it.' },
          { t: 12.36, end: 14.06, voice: 'sofia', text: 'That\'s a convenient interpretation.' },
          { t: 15.16, end: 16.80, voice: 'alex',  text: 'Most of the useful ones are.' },
          { t: 17.62, end: 21.00, voice: 'sofia', text: 'You do that a lot, don\'t you? Flip things.' },
          { t: 21.90, end: 24.24, voice: 'alex',  text: 'Only when the original framing doesn\'t hold.' },
          { t: 25.46, end: 26.98, voice: 'sofia', text: 'And you think mine didn\'t?' },
        ],
      },
    },

    // ── Slice 4/7 — seg07+seg08: The Humor → A (Add Humor) ───────────────
    // Alex/Sofia 11-line exchange → Ryan explains A
    // Duration: 257.0s → 328.0s (71.0s)
    {
      num:      4,
      obsStart: 257.0,
      dur:      71.0,
      badge:    'Lesson 2 (4/7)',
      hook:     'She called him out.',
      cliffhanger: 'Now she digs deeper. Watch how he keeps her engaged without chasing.',

      // seg07 exchange: "Done." ends Ryan's seg06 coaching, exchange begins at ~4:20 = 260.0s
      // offsetSec = 260.0 - 257.0 = 3.0
      exchange: {
        offsetSec: 3.0,
        lines: [
          { t:  0.00, end:  1.50, voice: 'sofia', text: 'You\'re very sure of yourself.' },
          { t:  2.50, end:  4.50, voice: 'alex',  text: 'It\'s got me into trouble before.' },
          { t:  5.50, end:  6.50, voice: 'sofia', text: 'I bet it has.' },
          { t:  7.00, end:  8.00, voice: 'alex',  text: 'Worth it though.' },
          { t:  7.66, end:  9.56, voice: 'sofia', text: 'How do you figure?' },
          { t: 10.72, end: 11.68, voice: 'alex',  text: 'Still here, aren\'t I?' },
          { t: 12.92, end: 13.48, voice: 'sofia', text: 'Barely.' },
          { t: 14.52, end: 15.22, voice: 'alex',  text: 'I\'ll take it.' },
          { t: 16.22, end: 17.08, voice: 'sofia', text: 'You\'re strange.' },
          { t: 17.94, end: 20.66, voice: 'alex',  text: 'That\'s the nicest thing anyone\'s said to me all week.' },
          { t: 22.36, end: 23.26, voice: 'sofia', text: 'Oh God.' },
        ],
      },
    },

    // ── Slice 5/7 — seg09+seg10: The Qualification → M (Make Her Qualify) ─
    // Alex/Sofia 12-line exchange → Ryan explains M
    // Duration: 327.5s → 414.0s (86.5s)
    {
      num:      5,
      obsStart: 327.5,
      dur:      86.5,
      badge:    'Lesson 2 (5/7)',
      hook:     'Make her explain herself to you.',
      cliffhanger: 'He\'s about to end the conversation — before she\'s ready for it.',

      // seg09 exchange: starts at 328.78s in trimmed file → 1.28s into this slice
      exchange: {
        offsetSec: 1.28,
        lines: [
          { t:  0.00, end:  1.88, voice: 'alex',  text: 'So what made you come to this beach specifically?' },
          { t:  3.76, end:  4.88, voice: 'sofia', text: 'It\'s quiet here.' },
          { t:  5.74, end:  7.68, voice: 'alex',  text: 'Half the beach is quiet. What else?' },
          { t:  8.72, end: 10.96, voice: 'sofia', text: 'I don\'t know. I just like it.' },
          { t: 11.70, end: 12.90, voice: 'alex',  text: 'What do you like about it?' },
          { t: 14.18, end: 17.02, voice: 'sofia', text: 'The tide line is always different. It changes.' },
          { t: 18.04, end: 20.34, voice: 'alex',  text: 'That matters to you? Things that change?' },
          { t: 21.76, end: 25.76, voice: 'sofia', text: 'I guess yeah. Things that stay exactly the same start to feel dead.' },
          { t: 26.88, end: 27.18, voice: 'alex',  text: 'Hmm.' },
          { t: 28.28, end: 28.76, voice: 'sofia', text: 'What?' },
          { t: 29.50, end: 33.60, voice: 'alex',  text: 'That\'s a real answer. Most people would have just said I grew up nearby.' },
          { t: 34.80, end: 35.96, voice: 'sofia', text: 'I almost did.' },
        ],
      },
    },

    // ── Slice 6/7 — seg11+seg12: The Exit → E (Exit) ──────────────────────
    // Alex/Sofia 18-line exchange → Ryan explains E
    // Duration: 413.5s → 507.0s (93.5s)
    {
      num:      6,
      obsStart: 413.5,
      dur:      93.5,
      badge:    'Lesson 2 (6/7)',
      hook:     'He left first. She stayed.',
      cliffhanger: 'Five principles. One word to hold them. Let\'s run through it.',

      // seg11 exchange: starts at 414.04s in trimmed file → 0.54s into this slice
      exchange: {
        offsetSec: 0.54,
        lines: [
          { t:  0.00, end:  2.12, voice: 'alex',  text: 'I should probably let you get back to it.' },
          { t:  3.12, end:  4.26, voice: 'sofia', text: 'You don\'t have to.' },
          { t:  5.16, end:  6.06, voice: 'alex',  text: 'You were working.' },
          { t:  7.04, end:  8.32, voice: 'sofia', text: 'I can take a break.' },
          { t:  9.10, end: 10.38, voice: 'alex',  text: 'One question first.' },
          { t: 11.10, end: 12.62, voice: 'alex',  text: 'What\'s the piece actually about?' },
          { t: 12.76, end: 13.84, voice: 'alex',  text: 'The real one.' },
          { t: 14.10, end: 15.40, voice: 'alex',  text: 'Not the one you\'d tell a stranger.' },
          { t: 16.98, end: 17.46, voice: 'sofia', text: 'Disappearance.' },
          { t: 18.02, end: 18.88, voice: 'sofia', text: 'How things go.' },
          { t: 19.52, end: 19.86, voice: 'sofia', text: 'Slowly.' },
          { t: 20.42, end: 21.94, voice: 'sofia', text: 'And you don\'t notice until they\'re gone.' },
          { t: 22.96, end: 24.62, voice: 'alex',  text: 'Okay, that\'s a much better pitch.' },
          { t: 25.86, end: 27.28, voice: 'sofia', text: 'It\'s not really a pitch.' },
          { t: 28.22, end: 29.00, voice: 'alex',  text: 'Even better.' },
          { t: 29.68, end: 31.88, voice: 'alex',  text: 'Alright, I really should go, but give me your number.' },
          { t: 32.10, end: 33.14, voice: 'alex',  text: 'I want to hear how it ends.' },
          { t: 34.44, end: 34.92, voice: 'sofia', text: 'Okay.' },
        ],
      },
    },

    // ── Slice 7/7 — seg13: Full FRAME Wrap-up ──────────────────────────────
    // Ryan's final recap: F-R-A-M-E one more time → "go find out"
    // Duration: 505.5s → 570.0s (64.5s)
    {
      num:      7,
      obsStart: 505.5,
      dur:      64.5,
      badge:    'Lesson 2 (7/7)',
      hook:     'Five principles. One word.',
      cliffhanger: 'Try it yourself. Your first two sessions are free at ozmeva.com.',
    },

  ],
};
