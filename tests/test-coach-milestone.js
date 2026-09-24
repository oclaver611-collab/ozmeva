// tests/test-coach-milestone.js
// Direct API tests for the per-episode milestone framing (art_studio_ep2 gap fix).
//
// TEST M1: reunion-style art_studio_ep2 transcript, real listening throughout.
//   Expected: milestoneOutcome present (Yes/Partially/No + evidence), and
//   part1/openerBreakdown do NOT frame HIM_1 as a pickup "opener" — this was
//   the bug: Ryan judged a reunion's first line like a first-meeting approach.
//
// TEST M2: regression guard — 'beach' (no milestone field on that scenario)
//   must behave exactly as before: no milestoneOutcome field, opener framing intact.
//
// Run against a preview deploy (milestone only exists on episode-pilot, not main):
//   node tests/test-coach-milestone.js --base=https://<preview>.vercel.app

const BASE = process.argv.find(a => a.startsWith('--base='))?.slice(7) || 'http://localhost:3000';

// TEST M1 — art_studio_ep2 reunion, user listens well and reaches the milestone
const CONV_REUNION = [
  { role: 'user',      content: "You went back to the blue one. Did you figure out what it's about, or you still deciding?" },
  { role: 'assistant', content: "Still deciding. It's the only one I haven't sold and I don't fully know why." },
  { role: 'user',      content: "That's interesting — is it always like that, or did this one just refuse to resolve?" },
  { role: 'assistant', content: "This one specifically. Most of them I finish and I know exactly what they're about." },
  { role: 'user',      content: "So it's not a technique thing, it's just this piece." },
  { role: 'assistant', content: "Right. My teacher used to say if a painting won't tell you what it wants, you're not done living the thing it's about yet." },
  { role: 'user',      content: "That's a strange thing to carry around, waiting to be done living something." },
  { role: 'assistant', content: "It is. Nobody's ever put it that way back to me before." },
  { role: 'user',      content: "I've got a table by the window Thursday, if you wanted to keep telling me about it over coffee." },
  { role: 'assistant', content: "Yeah. I'd like that." },
];

// TEST M2 — no milestone on this scenario (beach); pure regression guard
const CONV_BEACH = [
  { role: 'user',      content: "I noticed you've been staring at that same sentence for a while — writing or overthinking it?" },
  { role: 'assistant', content: "Bit of both, honestly." },
  { role: 'user',      content: "Come sit for a second. Tell me what it's supposed to be about before you decide it's wrong." },
  { role: 'assistant', content: "Okay, that's fair. I can do that." },
];

async function callCoach(conversation, { scenarioTitle, scenarioKey, milestone }, label) {
  console.log(`\n[${label}] Calling /api/coach (scenarioKey=${scenarioKey}, milestone=${milestone ? 'yes' : 'none'})...`);
  const res = await fetch(`${BASE}/api/coach`, {
    method: 'POST',
    // x-dev-key bypasses the server-side session-limit gate (checkRateLimit ->
    // isDevBypass) so this test doesn't get 402'd by the shared test IP's real
    // session count — same key the other test scripts use via the browser.
    headers: { 'Content-Type': 'application/json', 'x-dev-key': 'ek_dev_2026' },
    body: JSON.stringify({
      conversation,
      scenarioTitle,
      scenarioKey,
      milestone: milestone || null,
      opener: conversation.find(m => m.role === 'user')?.content || '',
      lesson1Complete: false,
      lesson2Complete: false,
      characterId: 'nia',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[${label}] HTTP ${res.status}: ${text}`);
    return null;
  }
  return res.json();
}

async function run() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  COACH MILESTONE FRAMING TEST');
  console.log(`  Target: ${BASE}`);
  console.log('══════════════════════════════════════════════════════════════');

  let allPass = true;

  // ── TEST M1 — reunion scenario with milestone ──────────────────────────────
  const fm = await callCoach(CONV_REUNION, {
    scenarioTitle: 'Her Studio — Two Weeks Later',
    scenarioKey: 'art_studio_ep2',
    milestone: "Get her number, or get her to agree to a specific plan to meet again — earned by listening, not performing.",
  }, 'TEST-M1');
  if (!fm) {
    console.error('[TEST-M1] FAIL — no response');
    process.exit(1);
  }

  console.log(`\n[TEST-M1] score: ${fm.score}/10`);
  console.log(`[TEST-M1] part1: ${fm.part1}`);
  console.log(`[TEST-M1] openerBreakdown: ${fm.openerBreakdown}`);
  console.log(`[TEST-M1] milestoneOutcome: ${fm.milestoneOutcome}`);

  const m1HasMilestoneOutcome = !!fm.milestoneOutcome && fm.milestoneOutcome.length > 5;
  const m1OutcomeShapeOk = /^(yes|partially|no)/i.test((fm.milestoneOutcome || '').trim());
  const openerLanguage = /\bopener\b|\bpickup\b|\bpick-up\b|\bname the move\b/i;
  const part1NoOpenerTalk = !openerLanguage.test(fm.part1 || '');
  const breakdownNoOpenerTalk = !openerLanguage.test(fm.openerBreakdown || '');

  console.log(`\n[TEST-M1] milestoneOutcome present:        ${m1HasMilestoneOutcome ? '✅' : '❌'}`);
  console.log(`[TEST-M1] milestoneOutcome starts Yes/Partially/No: ${m1OutcomeShapeOk ? '✅' : '❌'} (got "${fm.milestoneOutcome}")`);
  console.log(`[TEST-M1] part1 does NOT talk about "opener":        ${part1NoOpenerTalk ? '✅' : '❌'}`);
  console.log(`[TEST-M1] openerBreakdown does NOT talk about "opener": ${breakdownNoOpenerTalk ? '✅' : '❌'}`);
  if (!m1HasMilestoneOutcome || !m1OutcomeShapeOk || !part1NoOpenerTalk || !breakdownNoOpenerTalk) allPass = false;

  // ── TEST M2 — regression guard, no milestone (beach) ────────────────────────
  const fb = await callCoach(CONV_BEACH, {
    scenarioTitle: 'Beach — Sofia',
    scenarioKey: 'beach',
    milestone: null,
  }, 'TEST-M2');
  if (!fb) {
    console.error('[TEST-M2] FAIL — no response');
    process.exit(1);
  }

  console.log(`\n[TEST-M2] score: ${fb.score}/10`);
  console.log(`[TEST-M2] part1: ${fb.part1}`);
  console.log(`[TEST-M2] milestoneOutcome: ${fb.milestoneOutcome}`);

  const m2NoMilestoneOutcome = fb.milestoneOutcome === undefined;
  console.log(`\n[TEST-M2] milestoneOutcome absent (no milestone scenario): ${m2NoMilestoneOutcome ? '✅' : '❌'}`);
  if (!m2NoMilestoneOutcome) allPass = false;

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  if (allPass) {
    console.log('  ALL TESTS PASSED ✅');
  } else {
    console.log('  SOME TESTS FAILED ❌');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error('\n[TEST] CRASHED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
