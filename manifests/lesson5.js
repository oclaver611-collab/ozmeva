'use strict';
/**
 * manifests/lesson5.js
 * 5-slice manifest for Lesson 5 (TRACE — The Read).
 *
 * Timestamps derived from Whisper word-level transcription of lesson5-raw.mp4
 * (trimmed OBS recording, Ryan's first word "Lesson" at t=0.00s).
 *
 * Segment boundaries (absolute in trimmed file):
 *   seg00   0.00s  Welcome
 *   seg01  ~53.90s  Why Men Miss It (coaching — same block as seg00 for slicing)
 *   seg02 130.96s  Exchange — Watch: The Missed Read  (bad example, 11 lines)
 *   seg03 163.72s  T — Track · R — Register (coaching)
 *   seg04 218.98s  Exchange — Watch: Catching T and R (9 lines)
 *   seg05 246.98s  A — Align · C — Catch (coaching)
 *   seg06 316.06s  Exchange — Watch: The Full Cluster (6 lines)
 *   seg07 336.22s  E — Enter (coaching)
 *   seg08 400.54s  Exchange — Watch: The Window (7 lines, unusual)
 *   seg09 ~419.16s Your Five Steps / TRACE wrap-up
 *   end   495.00s
 *
 * Slice grouping: intro+bad-example (slice 1), then coaching+exchange×3
 * (slices 2-4), then TRACE summary (slice 5).
 * In slices 1-4 the exchange CLOSES the slice (exchange is the cliffhanger).
 *
 * Note on seg08 (slice 4 exchange): unusual structure — two consecutive
 * Sofia lines (s08_03 "Okay." then s08_04 "Done.") before Alex's final
 * "Good." The exchange ends on Alex, unlike the others.
 *
 * Exchange captions use Whisper word timestamps via buildExchangeCaptions() —
 * t/end values below are fallbacks only (used when Whisper match fails).
 *
 * Usage:
 *   node scripts/lesson-slice-template.js manifests/lesson5.js
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

module.exports = {
  obsFile:     path.join(ROOT, 'content', 'lesson5', 'lesson5-raw.mp4'),
  lessonNum:   5,
  totalSlices: 5,
  outputDir:   path.join(ROOT, 'content', 'lesson5', 'slices'),

  // Same OBS setup as Lessons 2-4 — Chromium window at identical position.
  crop:           { x: 451, y: 68, w: 367, h: 652 },
  drawboxY:       1380,
  captionMarginV: 1440,

  slices: [

    // ── Slice 1/5 — seg00+seg01+seg02: Welcome + Why Men Miss It + Missed Read ─
    // Ryan: "Lesson 5. If you've done the first four..." → "She has been
    // sending them your entire life. You just weren't taught what they look
    // like." → introduces the bookshop scene.
    // Exchange: Sofia makes an observation about a book; Alex gives flat
    // responses and lets the conversation die — bad example.
    // Duration: 0.0s → 163.72s
    {
      num:      1,
      obsStart: 0.000,
      dur:      163.720,
      badge:    'Lesson 5 (1/5)',
      hook:     "She spoke. He listened. Neither of them knew the difference.",
      cliffhanger: "He heard the words. He missed what they meant. T — Track.",

      exchange: {
        offsetSec: 124.177,
        lines: [
          { t:  0.00, end:  3.44, voice: 'sofia', text: "I like how he builds silence into the sentences." },
          { t:  3.44, end:  7.30, voice: 'alex',  text: "That's a specific thing to notice about a writer." },
          { t:  7.30, end:  9.92, voice: 'sofia', text: "I notice specific things." },
          { t:  9.92, end: 12.70, voice: 'alex',  text: "What kind of work are you in?" },
          { t: 12.70, end: 13.06, voice: 'sofia', text: "Architecture." },
          { t: 13.06, end: 16.42, voice: 'alex',  text: "What made you pick that one up?" },
          { t: 16.42, end: 20.20, voice: 'sofia', text: "It was next to something I was actually looking for." },
          { t: 20.20, end: 22.78, voice: 'alex',  text: "That's how you find the good ones." },
          { t: 22.78, end: 23.60, voice: 'sofia', text: "Yeah." },
          { t: 23.60, end: 27.62, voice: 'alex',  text: "Probably I should make a decision before the shop closes." },
          { t: 27.62, end: 31.16, voice: 'sofia', text: "Right. Good to talk to you." },
        ],
      },
    },

    // ── Slice 2/5 — seg03+seg04: T/R coaching + Catching T and R ─────────────
    // Ryan: "Let's go back through that. From the moment they were talking..."
    // → coaches Track and Register → "Watch what changes when he does."
    // Exchange: same bookshop opener; this time Alex notices Sofia's signals,
    // keeps conversation going — adds "What are you in here for?" to continue.
    // Duration: 163.72s → 246.98s (83.26s)
    {
      num:      2,
      obsStart: 163.720,
      dur:      83.260,
      badge:    'Lesson 5 (2/5)',
      hook:     "Same conversation. He knew what to look for this time.",
      cliffhanger: "She came in for something specific. So did he. R — Register.",

      exchange: {
        offsetSec: 55.260,
        lines: [
          { t:  0.00, end:  3.44, voice: 'sofia', text: "I like how he builds silence into the sentences." },
          { t:  3.44, end:  7.18, voice: 'alex',  text: "That's a specific thing to notice about a writer." },
          { t:  7.18, end:  9.76, voice: 'sofia', text: "I notice specific things." },
          { t:  9.76, end: 12.42, voice: 'alex',  text: "What kind of work are you in?" },
          { t: 12.42, end: 13.76, voice: 'sofia', text: "Architecture." },
          { t: 13.76, end: 16.12, voice: 'alex',  text: "What made you pick that one up?" },
          { t: 16.12, end: 20.04, voice: 'sofia', text: "It was next to something I was actually looking for." },
          { t: 20.04, end: 25.04, voice: 'alex',  text: "That's how you find the good ones. What are you in here for?" },
          { t: 25.04, end: 27.30, voice: 'sofia', text: "Something I've probably already read." },
        ],
      },
    },

    // ── Slice 3/5 — seg05+seg06: A/C coaching + The Full Cluster ─────────────
    // Ryan: "Watch what happens over the next few minutes..." → explains the
    // Chameleon Effect, mirroring, proximal touch → identifies the full cluster.
    // Exchange: continuation — Alex draws Sofia out on architecture, Sofia
    // opens up; all four TRACE signals present. A — Align + C — Catch.
    // Duration: 246.98s → 336.22s (89.24s)
    {
      num:      3,
      obsStart: 246.979,
      dur:      89.240,
      badge:    'Lesson 5 (3/5)',
      hook:     "She'd been mirroring him for five minutes. She didn't know it either.",
      cliffhanger: "One 15-minute conversation. Four signals. That is a cluster. E — Enter.",

      exchange: {
        offsetSec: 69.080,
        lines: [
          { t:  0.00, end:  4.90, voice: 'sofia', text: "It's the kind of decision where if you have to keep asking, you already know the answer." },
          { t:  4.90, end:  7.60, voice: 'alex',  text: "You always know before you ask." },
          { t:  7.60, end:  9.22, voice: 'sofia', text: "Usually." },
          { t:  9.22, end: 13.98, voice: 'alex',  text: "What made you want to work in architecture in the first place?" },
          { t: 13.98, end: 17.72, voice: 'sofia', text: "I wanted to make things that didn't apologize for existing." },
          { t: 17.72, end: 20.16, voice: 'alex',  text: "That's a good reason." },
        ],
      },
    },

    // ── Slice 4/5 — seg07+seg08: E coaching + The Window ─────────────────────
    // Ryan: "That was enter on the cluster. And notice what it wasn't..." →
    // coaches Enter — one direct, unhurried move, statement not question.
    // Exchange: Alex acts on the cluster. Sofia floats an exit line; Alex
    // asks for her number. Two consecutive Sofia lines ("Okay." then "Done.")
    // before Alex's "Good." — exchange ends on Alex.
    // Duration: 336.22s → 419.16s (82.94s)
    {
      num:      4,
      obsStart: 336.219,
      dur:      82.940,
      badge:    'Lesson 5 (4/5)',
      hook:     "The window opened. He wasn't guessing anymore.",
      cliffhanger: "He'd been deciding for a few minutes. She said okay. TRACE.",

      exchange: {
        offsetSec: 64.318,
        lines: [
          { t:  0.00, end:  3.68, voice: 'sofia', text: "I should probably go find what I actually came in for." },
          { t:  3.68, end:  7.60, voice: 'alex',  text: "I want to keep talking to you. What's your number?" },
          { t:  7.60, end:  9.54, voice: 'sofia', text: "That was fast." },
          { t:  9.54, end: 13.50, voice: 'alex',  text: "It wasn't. I've been deciding for a few minutes." },
          { t: 13.50, end: 14.64, voice: 'sofia', text: "Okay." },
          { t: 14.64, end: 16.52, voice: 'sofia', text: "Done." },
          { t: 16.52, end: 18.46, voice: 'alex',  text: "Good." },
        ],
      },
    },

    // ── Slice 5/5 — seg09: TRACE wrap-up ──────────────────────────────────────
    // Ryan: "the angle, the chameleon effect only operates toward people
    // she's drawn to. C — Catch... E — Enter once you see the cluster..."
    // → recaps all five TRACE moves → "She's already in there." → CTA.
    // Duration: 419.16s → 495.00s (75.84s)
    {
      num:      5,
      obsStart: 419.159,
      dur:      75.841,
      badge:    'Lesson 5 (5/5)',
      hook:     "She's been doing this the whole time. Every conversation you walked away from.",
      cliffhanger: "Try it yourself. Your first two sessions are free at ozmeva.com.",
    },

  ],
};
