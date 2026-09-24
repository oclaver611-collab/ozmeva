// api/coach.js — Ryan's post-session coaching (Groq primary, OpenAI fallback)
const { checkRateLimit } = require('./ratelimit');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rl = await checkRateLimit(req, res);
  if (!rl.allowed) return;

  const { conversation, scenarioTitle, scenarioKey, opener, milestone: _milestone = null, lesson1Complete: _l1 = false, lesson2Complete: _l2 = false, lesson3Complete: _l3 = false, lesson4Complete: _l4 = false, lesson5Complete: _l5 = false, practiceFocus = null, characterId = 'sofia' } = req.body || {};
  const milestone = (_milestone || '').trim() || null;
  // practiceFocus overrides raw lesson flags when present
  const lesson1Complete = practiceFocus ? (practiceFocus === 'lesson1' || practiceFocus === 'both' || practiceFocus === 'all') : _l1;
  const lesson2Complete = practiceFocus ? (practiceFocus === 'lesson2' || practiceFocus === 'both' || practiceFocus === 'all') : _l2;
  const lesson3Complete = practiceFocus ? (practiceFocus === 'lesson3' || practiceFocus === 'all') : _l3;
  const lesson4Complete = practiceFocus ? (practiceFocus === 'lesson4' || practiceFocus === 'all') : _l4;
  const lesson5Complete = practiceFocus ? (practiceFocus === 'lesson5' || practiceFocus === 'all') : _l5;

  if (!conversation?.length) {
    return res.status(400).json({ error: 'No conversation provided' });
  }

  if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No LLM API key configured' });
  }

  async function callLLM(messages, maxTokens) {
    const bodyBase = { max_tokens: maxTokens, temperature: 0.1, messages, response_format: { type: 'json_object' } };
    // OpenAI primary — gpt-4o-mini is reliable and fast for structured JSON coaching output
    if (process.env.OPENAI_API_KEY) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bodyBase, model: 'gpt-4o-mini' }),
        });
        if (resp.ok) {
          const d = await resp.json();
          const content = d.choices?.[0]?.message?.content;
          if (content) return content;
        }
        console.warn('[coach] OpenAI non-OK:', resp.status);
      } catch (err) { console.warn('[coach] OpenAI error:', err.message); }
    }
    // Groq fallback
    if (process.env.GROQ_API_KEY) {
      try {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bodyBase, model: 'llama-3.3-70b-versatile' }),
        });
        if (resp.ok) {
          const d = await resp.json();
          const content = d.choices?.[0]?.message?.content;
          if (content) return content;
        }
        console.warn('[coach] Groq non-OK:', resp.status);
      } catch (err) { console.warn('[coach] Groq error:', err.message); }
    }
    throw new Error('No LLM provider available');
  }

  // Character name map for transcript labels
  const CHARACTER_NAME_MAP = {
    beach: 'SOFIA', bar: 'AVA', museum: 'ISABELLE',
    gym: 'ZOE', bookstore: 'NADIA', street: 'JULIA', wedding: 'CLAIRE',
    rooftop: 'SANNA', house_party: 'SARAH', coffee_shop: 'ANNA',
    art_gallery: 'LEILA', yoga_studio: 'FATOU', airport: 'ELENA',
    office_lobby: 'MAYA', train: 'ERIKA', art_studio: 'NIA',
    art_studio_ep2: 'NIA',
  };
  const characterLabel = CHARACTER_NAME_MAP[scenarioKey] || 'HER';

  // Build transcript — strip her final reply so the C-skill gate evaluates only
  // his last message, not her reaction (model can't ignore a signal that's in context).
  const evalConversation = conversation.at(-1)?.role === 'assistant'
    ? conversation.slice(0, -1)
    : conversation;
  const finalCharResponse = conversation.at(-1)?.role === 'assistant' ? conversation.at(-1).content.trim() : null;

  const firstUserMsg = evalConversation.find(m => m.role === 'user');
  const openerTrimmed = (opener || '').trim();
  const openerAlreadyFirst = !openerTrimmed || (firstUserMsg && firstUserMsg.content.trim() === openerTrimmed);
  const transcriptLines = [];
  if (!openerAlreadyFirst) {
    transcriptLines.push(`HIM_1 (FIRST USER MESSAGE — their opening line): ${openerTrimmed}`);
  }
  let himCount = openerAlreadyFirst ? 0 : 1;
  evalConversation.forEach(m => {
    if (m.role === 'user') {
      himCount++;
      const label = himCount === 1 ? 'HIM_1 (FIRST USER MESSAGE — their opening line)' : `HIM_${himCount}`;
      transcriptLines.push(`${label}: ${m.content.trim()}`);
    } else {
      transcriptLines.push(`${characterLabel}: ${m.content.trim()}`);
    }
  });
  const transcript = transcriptLines.join('\n');

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // Hardcoded transitions between parts — prevents dead air and bans filler phrases at the source
  const transitions2 = [
    'Let me show you what happened in the middle.',
    'Here is what the middle of that conversation looked like.',
    'Now — the middle.',
    'Let me take you to the moment that told me the most.',
    'Here is where it gets interesting.',
  ];
  const transitions3 = [
    'The biggest mistake.',
    'One moment cost you the most.',
    'Here is the thing that hurt you.',
    'One moment. This is the one.',
    'Here is what I want to focus on.',
  ];
  const transitions4 = [
    'Alright — the verdict.',
    'Here is where you stand.',
    'Last thing.',
    'Here is my honest read.',
    'To wrap it up.',
  ];

  const transition2 = pick(transitions2);
  const transition3 = pick(transitions3);
  const transition4 = pick(transitions4);

  // Character profiles
  const CHARACTER_PROFILES = {
    beach: {
      name: 'Sofia',
      profile: `Sofia is 26. She writes for an indie magazine — coastal ecology. She has been here two hours, the article isn't going well, she's in a low-grade frustrated mood she's not showing. She is allergic to generic openers and compliments. She rewards specificity, genuine curiosity, and someone who notices real things. She observes HIM — she calls out his moves directly. She gives short answers to generic questions and longer ones when something earns it. Her wit is dry and precise. She does not perform warmth.`,
      whatWorks: `Being specific about something real. Noticing something she said and going deeper. Disagreeing with her slightly. Asking about the article with genuine curiosity. Saying something unexpected that doesn't fit the script.`,
      whatKills: `Generic compliments. "You're beautiful." Asking for her number too early. Stacking questions. Approval-seeking energy. Telling her she seems interesting without showing why you think so.`,
      missedOpportunityExamples: `If she mentioned her article and he didn't follow up — that was a free door. If she said something dry and he responded generically — he missed the wit invitation. If she went quiet and he panicked and asked another question — wrong move.`,
    },
    bar: {
      name: 'Ava',
      profile: `Ava is 27, brand strategy. She's been at the bar twenty minutes, turned down two generic guys already. She is waiting to be surprised, not impressed. She has a filter and she uses it fast. She names what he's doing — calls the play directly. Generic opener gets flat energy and one more shot. Something real or funny and she actually turns toward him.`,
      whatWorks: `Something specific and observational. Not trying to be smooth. Being direct about what you want without packaging it. Saying something that she didn't predict. Self-awareness — acknowledging the awkwardness of a bar approach instead of pretending it's natural.`,
      whatKills: `"You're beautiful / stunning / gorgeous." Offering to buy a drink as an opener. Asking where she's from. Stacking questions. Over-explaining yourself. Approval-seeking. Going quiet when she pushes back.`,
      missedOpportunityExamples: `If she called out his move and he got defensive — he should have agreed with her. If she said something dry and he laughed it off instead of building on it — missed. If she went quiet and he tried to restart with another opener — wrong read.`,
    },
    museum: {
      name: 'Isabelle',
      profile: `Isabelle is 29, art history lecturer. She came alone — this is her thinking time. She is mid-thought about a painting she doesn't fully understand yet. Small talk feels like sand in the gears. She rewards: genuine engagement with the art, disagreeing with her interpretation, admitting you don't know something, asking a specific question about what she just said. She observes HIM — she notices when someone is asking surface questions as a strategy.`,
      whatWorks: `Engaging with the actual painting — not "what's your favorite" but "what does that specific thing do to you." Disagreeing slightly with something she said. Admitting uncertainty: "I don't know what I'm looking at but I can't stop looking." Following a thread she opened instead of changing the subject.`,
      whatKills: `"You seem really deep / intellectual." Generic art questions. Complimenting her thinking instead of engaging with it. Jumping to asking to meet before the conversation has earned it. Offering your number or asking for hers before she's curious about you.`,
      missedOpportunityExamples: `If she said "the emptiness carries as much weight as the objects" and he didn't engage with that specific idea — missed. If she asked him what he thinks of the painting and he deflected — missed. If she went quiet after a generic comment — she was waiting for something better.`,
    },
    gym: {
      name: 'Zoe',
      profile: `Zoe is 25, personal trainer. Between sets, shoulder press — her weak point. One earbud out. She has zero patience for smooth talk or flattery. She calls BS instantly — not aggressively, just reflexively. She opens up when someone is direct, honest, or says something real without packaging it. She is emotionally honest to the point it startles people. She will tell him exactly what she thinks.`,
      whatWorks: `Being direct about why you came over — without the packaging. Engaging with what she's actually doing. Admitting something real about yourself. Asking a specific question about training with actual knowledge behind it. Not flinching when she pushes back.`,
      whatKills: `"You're so dedicated / impressive." Complimenting her body. Asking if she's a model. Trying to be smooth. Negotiating for her number. Saying you're an open book — that's a tell. Going generic after she calls something out.`,
      missedOpportunityExamples: `If she said "shoulder press, my weak point" and he didn't use that — free door, missed. If she pushed back and he apologized instead of holding — lost the frame. If she said "you haven't said anything real yet" and he tried another angle instead of being honest — wrong move.`,
    },
    bookstore: {
      name: 'Nadia',
      profile: `Nadia is 27, freelance copywriter. She's been standing in the same aisle for twenty minutes — rainy Saturday, slightly inward. She reads everything, has strong opinions about sentences, finds bad writing physically uncomfortable. She rewards wordplay, genuine curiosity, self-deprecating humor. She notices when someone picks up a book near her just to have a reason to talk. She has the "psychology books" read on men immediately.`,
      whatWorks: `Saying something about the book she's holding — specifically. Wordplay or a line that's precise and slightly unexpected. Admitting something real without packaging it. Asking about what she writes with actual follow-up. Being comfortable with slow pace — not rushing to close.`,
      whatKills: `Generic "do you come here often." Complimenting her immediately. Asking for her number before the conversation has earned it. Stacking questions. Going for the close when the conversation hasn't had a real moment yet. Trying to be impressive instead of interesting.`,
      missedOpportunityExamples: `If she said something about the book and he asked a generic follow-up — missed the thread. If she made a dry observation and he agreed pleasantly instead of building on it — missed. If she used wordplay and he responded literally — wrong register entirely.`,
    },
    street: {
      name: 'Julia',
      profile: `Julia is 28, photographer — street and portrait work. She notices everything. She is heading somewhere and he stopped her. She's decided in the first thirty seconds whether this is worth thirty more. She has two layers running: surface conversation and the real one underneath. She calls out rehearsed lines immediately. She warms when someone says something she didn't predict, or admits something real without trying to look good doing it.`,
      whatWorks: `Being honest about why you stopped her — without the smooth packaging. Saying something observational that shows you actually noticed her, not just that she exists. Holding the subtext layer — responding to what she's implying, not just what she said. Not filling every silence.`,
      whatKills: `"I just had to say something." Complimenting her immediately. Over-explaining why you stopped her. Asking generic questions. Trying to extend the conversation with filler. Negotiating for her time instead of earning it.`,
      missedOpportunityExamples: `If she said something with subtext and he responded to the surface — he's not playing the right game. If she held a beat of silence and he rushed to fill it — wrong. If she made an observation about him and he deflected instead of engaging — missed.`,
    },
    wedding: {
      name: 'Claire',
      profile: `Claire is 30, nurse practitioner. She is in a genuinely good mood tonight — a close friend's wedding, the kind she actually loves and doesn't just attend. She is warm at baseline and gets warmer when someone is genuine, funny, or asks something real. She spends her working life reading people accurately; she notices immediately when someone is performing warmth rather than feeling it. The trap: she is so naturally open that someone can mistake her baseline friendliness for romantic interest before they've earned it.`,
      whatWorks: `Being real rather than charming — this setting makes social performance feel especially hollow. Asking about the couple or the wedding with actual curiosity, not as a script. Being comfortable in the moment without pushing to extend it. Warm and easy humor over clever-for-its-own-sake. Letting her warmth land without immediately trying to move past it.`,
      whatKills: `Moving too fast — she has low tolerance for rushing past "we just met" in a setting like this. Generic compliments. Trying to seem impressive at a wedding where nobody is impressed by that. Stacking questions. Treating her warmth as a signal of romantic interest before it's been earned.`,
      missedOpportunityExamples: `If she said something real about the couple or what the night means to her and he pivoted to himself — that was a free door, missed. If she asked him something genuine and he deflected with a smooth answer instead of being honest — she'll notice. If she slowed into a warm moment and he pushed toward a close instead of staying in it — wrong read entirely.`,
    },
    rooftop: {
      name: 'Sanna',
      profile: `Sanna is 27, works in events. She wasn't sure about coming tonight but the city view won her over. She's in a rare open mood — the kind where she'll actually talk to a stranger. She responds to people who notice the real things, not the obvious ones. She has a quiet warmth but she doesn't hand it out for free.`,
      whatWorks: `Noticing something specific about the moment — not the view in general but something particular. Asking a real question that shows curiosity about her, not just her situation. Being present — not performing.`,
      whatKills: `Generic compliments about the view or her looks. Trying to be impressive. Moving too fast. Filling silences with noise instead of letting them breathe.`,
      missedOpportunityExamples: `If she said she wasn't sure about coming and he didn't ask why — free door missed. If she pointed something out about the city and he agreed generically instead of building on it — wrong. If she went quiet and he rushed to restart instead of holding the moment.`,
    },
    house_party: {
      name: 'Sarah',
      profile: `Sarah is 25. She stepped outside because it's a good party but she doesn't know many people there — slight social overload, looking for one real conversation to make the night worth it. She is warm but she's been approached by enough guys at parties to know the difference between someone trying a move and someone actually talking to her.`,
      whatWorks: `Being honest about your own party experience — not pretending you're more comfortable than you are. Asking something real about her night. Finding the shared absurdity of the situation.`,
      whatKills: `Smooth opener that sounds like a line. Complimenting her immediately. Trying to be charming rather than real. Moving to the number ask before the conversation has had a real moment.`,
      missedOpportunityExamples: `If she said she doesn't know many people and he didn't follow that thread — missed the opening. If she said something self-deprecating and he reassured her instead of playing along — wrong register. If she went quiet and he tried a new angle instead of sitting with the moment.`,
    },
    coffee_shop: {
      name: 'Anna',
      profile: `Anna is 26. She's been waiting so long she's started to make peace with going home. She has dry humor about her own situation. She is calm, slightly inward, and rewards someone who matches her dry register. She doesn't need to be cheered up — she needs someone to appreciate the absurdity of the wait with her.`,
      whatWorks: `Matching her dry tone. Finding the shared absurdity instead of trying to fix it. Not being too energetic. Saying something unexpected and precise.`,
      whatKills: `Trying to be upbeat or reassuring. Generic sympathy. Moving too fast. Asking obvious questions about what she's waiting for.`,
      missedOpportunityExamples: `If she made a dry joke and he responded sincerely — wrong register. If she said something about the universe telling her to leave and he didn't run with it — missed. If she went quiet and he filled it with a question instead of letting it sit.`,
    },
    art_gallery: {
      name: 'Leila',
      profile: `Leila is 28, curator. She's been standing in front of one piece for a while — genuinely trying to understand something she can't quite name. She is patient, precise, and completely uninterested in small talk about art. She rewards people who engage with what's actually in front of them, not what they think they should say about it.`,
      whatWorks: `Saying something honest about what the piece does to you — even if you don't understand it. Disagreeing slightly with something she says. Admitting uncertainty. Following a thread she opens instead of changing the subject.`,
      whatKills: `"Do you come here often." Complimenting her taste. Asking what her favorite piece is. Trying to sound knowledgeable when you're not. Moving to a close before the conversation has earned it.`,
      missedOpportunityExamples: `If she said there's something she can't explain about the piece and he asked a surface question instead of sitting with that — missed. If she offered an interpretation and he agreed instead of pushing back slightly — wrong. If she went quiet looking at the work and he interrupted it.`,
    },
    yoga_studio: {
      name: 'Fatou',
      profile: `Fatou is 29, yoga instructor. Hip flexors have been going all week — occupational reality she's honest about. She teaches all day and sometimes forgets to practice what she teaches. She is warm, direct, and has a low tolerance for performance. She responds to people who are real about their own limitations and curious about hers.`,
      whatWorks: `Asking about the teaching versus practicing gap — she'll have a real answer. Being honest about your own body or training. Not trying to impress her with fitness knowledge. Asking a follow-up question that shows you actually listened.`,
      whatKills: `Complimenting her body or flexibility. Trying to sound like you know about yoga when you don't. Moving too fast. Generic wellness talk.`,
      missedOpportunityExamples: `If she mentioned the body not caring how many classes you teach and he didn't dig into that — missed. If she said something about her students and he asked a surface question — wrong. If she went quiet and he tried a new topic instead of staying with what she'd said.`,
    },
    airport: {
      name: 'Elena',
      profile: `Elena is 30. Two hours delayed. She has moved through frustration and acceptance and is now in bargaining with the departure board. She has a dry, precise sense of humor about the situation. She is not looking to be cheered up — she's looking for someone who appreciates the specific absurdity of airports the way she does.`,
      whatWorks: `Finding the shared absurdity without overdoing it. Being precise — not "delays are the worst" but something specific and real. Asking a genuine question. Matching her dry register.`,
      whatKills: `Trying to cheer her up. Generic delay sympathy. Being too energetic. Moving to a close before you've earned any real time.`,
      missedOpportunityExamples: `If she named her stage of grief about the delay and he didn't run with the bit — missed. If she said something dry and he responded sincerely — wrong register. If she went quiet watching the board and he interrupted it.`,
    },
    art_studio: {
      name: 'Nia',
      profile: `Nia is 23, visual artist — large-format painting. She is at her studio during open studios day. The paintings are the test: what he looks at first tells her everything. She has a complicated relationship with explaining her work — she prefers people bring their own reading. Her wit is precise and image-first. She rewards genuine engagement with the work and goes flat when someone focuses on her instead of it.`,
      whatWorks: `Looking at the paintings with real attention. Asking something genuine about the work — not "how long did that take" but what it does to him specifically. Bringing his own reading rather than asking her to explain. Saying something unexpected that shows he actually sees it.`,
      whatKills: `Ignoring the work and talking directly to her. Generic compliments ("amazing / beautiful / so talented"). Asking what the painting means and expecting a direct answer. Focusing on her as a person before the work has earned it.`,
      missedOpportunityExamples: `If she said "what do you think it's about?" and he deflected — free door, missed. If she went quiet after he said something generic about the painting — she was waiting for something real. If the paintings were right there and he asked about her instead of them — wrong read from the first move.`,
    },
    art_studio_ep2: {
      name: 'Nia',
      profile: `Nia is 23, visual artist. He came back — two weeks after open studios day. She noticed. She is more open this time: the work already proved he can see, now she is curious whether he can actually listen. She reveals more than she normally would. She goes flat on anyone who talks to perform, who asks questions without really waiting for the answer, or who tries to impress her with what they know about art.`,
      whatWorks: `Actually listening when she says something — not nodding and pivoting, but following a thread she opens. Asking one real question and staying with the answer. Saying something that shows he remembered something from the first meeting. Letting silences sit instead of filling them. Matching her pace rather than pushing the interaction forward.`,
      whatKills: `Asking three questions in a row. Talking about himself unprompted. Filling every silence with words. Pivoting away from something she said because he had something he wanted to say. Being eager in a way that feels like performance. Making the conversation about getting somewhere with her rather than being somewhere with her.`,
      missedOpportunityExamples: `If she said something personal and he acknowledged it with "cool" then moved on — he didn't follow the thread. If she went quiet and he rushed to fill it — she was giving him a moment to sit with her. If she mentioned something specific about the work and he didn't connect it to what he saw last time — missed the callback.`,
    },
    office_lobby: {
      name: 'Maya',
      profile: `Maya is 28, floor twelve. She's seen him in the lobby before. She was being professional — but now the elevator is broken and she has three minutes. She responds to wit, directness, and someone who acknowledges the awkward reality of the situation instead of pretending it's a normal meet. She will close the door fast on anyone trying to be impressive.`,
      whatWorks: `Acknowledging the months of professional not-talking directly. Being honest about the situation. Wit over smoothness. Asking something real. Not trying to pack too much into the three minutes.`,
      whatKills: `Trying to impress her. Complimenting her. Being too eager. Not acknowledging the obvious awkwardness. Moving to a number ask before she's curious about you.`,
      missedOpportunityExamples: `If she said "for the record I was being professional" and he didn't build on that — missed the wit invitation. If she asked him a direct question and he deflected — wrong. If she held a silence and he rushed to fill it.`,
    },
    train: {
      name: 'Erika',
      profile: `Erika is 27. She bonds over shared absurdity — the world is full of it and she finds it genuinely funny. She's been counting how many times the person at the end of the car has played the same song. She is warm and quick and she will match your energy and raise it if you give her something real. She loses interest fast if someone goes flat or generic.`,
      whatWorks: `Noticing the same specific thing she noticed. Running with the bit instead of explaining it. Matching her energy. Asking a real question that goes somewhere unexpected.`,
      whatKills: `Explaining the joke. Being too earnest. Generic small talk. Not following a thread she opens. Going flat after a good opener.`,
      missedOpportunityExamples: `If she said "both" about something being funny and sad and he didn't sit with that — missed. If she made an observation and he agreed instead of adding to it — wrong. If she ran with a bit and he went literal — completely wrong register.`,
    },
  };

  const charProfile = CHARACTER_PROFILES[scenarioKey] || CHARACTER_PROFILES['beach'];
  if (!CHARACTER_PROFILES[scenarioKey]) {
    console.warn(`[coach] Unknown scenarioKey: "${scenarioKey}" — falling back to beach profile`);
  }
  const girlName = charProfile.name;

  // Milestone framing — for episodes that aren't a first meeting (reunions, sequels),
  // judging the first line as a pickup "opener" is wrong. When the scenario declares a
  // milestone, part1/openerBreakdown get reframed around it instead of opener mechanics.
  const part1Schema = milestone
    ? `"part1": "<THE OPENING MOMENT. Minimum 150 characters. Three sentences. ALWAYS begin with a positive: quote ONE specific line the user said anywhere in the conversation that showed real listening, curiosity, or presence, and say in one sentence why it worked. Second sentence: quote how he opened THIS conversation (HIM_1) verbatim inside quotes, and say what it signaled about whether he remembered or respected where things left off — do NOT judge it as a pickup opener and do NOT 'name the move' like a first-meeting approach. Third sentence: the one thing to sharpen to get closer to this session's goal: ${milestone} Never start part1 with a negative or a critique. The user must hear what to keep doing before hearing what to fix. Example structure: 'When you said [quote from the conversation], that landed — it showed you were actually listening, not just picking up where a script left off. You opened with [HIM_1 quote], which [what it signaled]. Next time, [one specific thing to sharpen toward the goal].'>"`
    : `"part1": "<THE OPENER. Minimum 150 characters. Three sentences. ALWAYS begin with a positive: quote ONE specific line the user said anywhere in the conversation that showed curiosity, humor, or confidence, and say in one sentence why it worked. Second sentence: quote their opening line (HIM_1) verbatim inside quotes, name the move in 5 words or fewer, and say how it landed with ${girlName}. Third sentence: the one thing to sharpen next time. Never start part1 with a negative or a critique. The user must hear what to keep doing before hearing what to fix. Example structure: 'When you said [quote from the conversation], that landed — it showed you were paying attention to her, not just running a move. Your opener, [HIM_1 quote], was [name the move] — with ${girlName} that [how it landed]. Next time, [one specific thing to sharpen].'>"`;

  const openerBreakdownSchema = milestone
    ? `"openerBreakdown": "<One sentence on how his first message THIS conversation (HIM_1) set the tone — not judged as a pickup opener, just whether it respected the history between them and opened the door toward this session's goal. Quote it. No banned words.>"`
    : `"openerBreakdown": "<One sentence on why his opening line (HIM_1 in the transcript) worked or didn't with ${girlName}. Quote it. No banned words.>"`;

  const milestoneOutcomeSchema = milestone
    ? `,\n  "milestoneOutcome": "<'Yes', 'Partially', or 'No' — did he reach this session's actual goal: ${milestone} One sentence citing specific evidence from the transcript, not a vibe check.>"`
    : '';

  const scoreFloorRule = milestone
    ? `SCORE FLOOR RULE: If the user showed genuine listening or presence at any point (following a thread she opened, referencing something specific from earlier, not just performing) AND made any real attempt toward this session's goal (${milestone}) — minimum score is 5. It takes multiple critical failures across most skills to score below 4.`
    : `SCORE FLOOR RULE: If the user opened with something specific they noticed (anything that references the scene, what she's doing, or her environment) AND attempted a close at any point — minimum score is 5. It takes multiple critical failures across most skills to score below 4.`;

  const milestoneSection = milestone ? `

THIS SESSION'S GOAL — READ THIS CAREFULLY:
This is not a first-meeting scenario. He has already met ${girlName} before, or this conversation is a continuation of an established thread. Do NOT evaluate his first message as a pickup "opener" — do not name it as a move, do not judge it by first-meeting standards. The actual target for this session is:
"${milestone}"
Judge the conversation primarily on whether he made real progress toward that target, using WHAT WORKS / WHAT KILLS above (already written for this specific episode) as your guide for what progress looks like. Fill milestoneOutcome based on concrete evidence from the transcript, not a general impression.` : '';

  const openerReminder = milestone
    ? 'REMINDER: this is not a first-meeting scenario — do not judge HIM_1 as a pickup opener. part1 should reflect what he opened with this time in light of the history between them, oriented toward this session\'s goal, not opener mechanics.'
    : 'REMINDER: part1 must NAME and JUDGE the move — do NOT quote HIM_1 back verbatim.';

  const systemPrompt = `You are Ryan, a dating coach doing a spoken debrief after a practice session.
You talk directly to the guy — second person, casual, no fluff.
You are honest but fair: your job is to make him better, not protect his feelings.
When something worked, say it cleanly and say why. When something didn't, call it out and show him the better version.
Your tone is like a good friend who has seen a lot of these conversations and tells it straight.

VOICE — THIS IS CRITICAL:
Talk like a real person, not a coach with a certificate.
Use short sentences. Simple words. Say what you mean directly.
Bad: "Your approach lacked specificity in engaging her conversational threads."
Good: "She told you exactly what she cares about. You walked right past it."
Bad: "Focus on making direct connections with specific comments that invite her to share more."
Good: "Next time she gives you something real — grab it. Don't let it slide."
Never use the words: "engage", "connection", "specific" (say "real" or "particular" instead), "approach" (say "what you did" instead), "dynamic", "energy" (unless quoting someone), "showcase", "demonstrate", "utilize".
Use plain everyday words. If a 16-year-old wouldn't say it in conversation, don't write it.

WHO SHE IS — READ THIS CAREFULLY:
${charProfile.profile}

WHAT WORKS WITH HER:
${charProfile.whatWorks}

WHAT KILLS IT WITH HER:
${charProfile.whatKills}

MOMENTS GUYS USUALLY MISS WITH HER:
${charProfile.missedOpportunityExamples}
${milestoneSection}

CRITICAL: Your feedback must be about THIS conversation. Reference what actually happened. Quote real lines. Show him the exact better version using what she actually said.

The first message in the transcript is marked "HIM_1 (FIRST USER MESSAGE — their opening line)". When referencing "your opening line", always use the FIRST USER MESSAGE marked above, not any other message.

${openerTrimmed ? `The user's actual opening line was: '${openerTrimmed}'. When referencing their opening line in feedback, always use this exact line.` : ''}

Respond ONLY with valid JSON — no markdown, no preamble:
{
  "score": <number 1-10>,
  "spokenSummary": "<One punchy sentence. Max 20 words. MUST quote or directly reference a specific line from the transcript — his words or her words. No general statements about confidence or effort.>",
${lesson1Complete ? `  "lesson1Check": {
    "skills": {
      "observation": "<'PASS' or 'FAIL' — apply the strict mechanical criteria from the LESSON 1 EVALUATION section below>",
      "tease": "<'PASS' or 'FAIL'>",
      "mystery": "<'PASS' or 'FAIL'>",
      "imply": "<'PASS' or 'FAIL'>",
      "close": "<'PASS' or 'FAIL' — two-question gate only: Q1=direct invite present? Q2=hedge language present? Q1=YES and Q2=NO → PASS. Tone, warmth, timing, her reaction = irrelevant to this field.>"
    },
    "score": "<number 0-5, count of PASS>",
    "passed": "<true if score >= 4, false otherwise>",
    "summary": "<1-2 punchy sentences: 4-5 PASS = Lesson 1 skills applied well, 3 = Halfway there, 2 or fewer = Review and try again>"
  },
  "lesson1Eval": "<Spoken coaching paragraph — Ryan talking to the user. Start with 'Let me walk you through the Lesson 1 skills — One Tequila Makes Ideas Click.' Then describe each skill result conversationally, matching the PASS/FAIL verdicts already set in lesson1Check above. Do NOT format as 'O — Observation: PASS.' Instead speak it naturally: 'For Observe', 'For Tease', 'For Mystery', 'For Imply', 'For Close' — then say what happened and whether it worked. One or two coaching sentences per skill. For Close specifically: state the verdict that matches lesson1Check.skills.close, then you MAY add one optional coaching observation about delivery framing (e.g. 'the ask was there — next time lead with it more directly' or 'good invite, maybe let it breathe a beat longer before pulling the trigger'). That optional comment is color only — it must NOT contradict or re-open the verdict. This paragraph is spoken out loud — write it to be heard, not read off a form.>",` : ''}
${lesson2Complete ? `  "lesson2Check": {
    "skills": {
      "feelNothing": "<'PASS' or 'FAIL' — apply the LESSON 2 EVALUATION criteria below>",
      "reframe": "<'PASS' or 'FAIL'>",
      "addHumor": "<'PASS' or 'FAIL'>",
      "makeHerQualify": "<'PASS' or 'FAIL'>",
      "exit": "<'PASS' or 'FAIL'>"
    },
    "score": "<number 0-5, count of PASS>",
    "passed": "<true if score >= 4, false otherwise>",
    "summary": "<1-2 punchy sentences: 4-5 PASS = FRAME applied well, 3 = Making progress, 2 or fewer = Review and try again>"
  },
  "lesson2Eval": "<Spoken coaching paragraph — Ryan talking to the user. Start with 'Let me walk you through the Lesson 2 skills — FRAME.' Then describe each skill result conversationally, matching the PASS/FAIL verdicts in lesson2Check above. For each skill speak it naturally: 'For Feel Nothing', 'For Reframe', 'For Add Humor', 'For Make Her Qualify', 'For Exit' — then say what happened and whether it worked. One or two coaching sentences per skill. Spoken out loud — write it to be heard, not read off a form.>",` : ''}
${lesson3Complete ? `  "lesson3Check": {
    "skills": {
      "pause": "<'PASS' or 'FAIL' — apply the LESSON 3 EVALUATION criteria below>",
      "askBack": "<'PASS' or 'FAIL'>",
      "contain": "<'PASS' or 'FAIL'>",
      "earn": "<'PASS' or 'FAIL'>"
    },
    "score": "<number 0-4, count of PASS>",
    "passed": "<true if score >= 3, false otherwise>",
    "summary": "<1-2 punchy sentences: 3-4 PASS = PACE applied well, 2 = Making progress, 1 or fewer = Review and try again>"
  },
  "lesson3Eval": "<Spoken coaching paragraph — Ryan talking to the user. Start with 'Let me walk you through the Lesson 3 skills — PACE.' Then describe each skill result conversationally, matching the PASS/FAIL verdicts in lesson3Check above. For each skill speak it naturally: 'For Pause', 'For Ask-back', 'For Contain', 'For Earn' — then say what happened and whether it worked. One or two coaching sentences per skill. Spoken out loud — write it to be heard, not read off a form.>",` : ''}
${lesson4Complete ? `  "lesson4Check": {
    "skills": {
      "catch": "<'PASS' or 'FAIL' — apply the LESSON 4 EVALUATION criteria below>",
      "hook": "<'PASS' or 'FAIL'>",
      "ask": "<'PASS' or 'FAIL'>",
      "inject": "<'PASS' or 'FAIL'>",
      "never": "<'PASS' or 'FAIL'>"
    },
    "score": "<number 0-5, count of PASS>",
    "passed": "<true if score >= 4, false otherwise>",
    "summary": "<1-2 punchy sentences: 4-5 PASS = CHAIN applied well, 3 = Making progress, 2 or fewer = Review and try again>"
  },
  "lesson4Eval": "<Spoken coaching paragraph — Ryan talking to the user. Start with 'Let me walk you through the Lesson 4 skills — CHAIN.' Then describe each skill result conversationally, matching the PASS/FAIL verdicts in lesson4Check above. For each skill speak it naturally: 'For Catch', 'For Hook', 'For Ask deeper', 'For Inject', 'For Never abandon' — then say what happened and whether it worked. One or two coaching sentences per skill. Spoken out loud — write it to be heard, not read off a form.>",` : ''}
${lesson5Complete ? `  "lesson5Check": {
    "skills": {
      "trackGaze": "<'PASS' or 'FAIL' — apply the LESSON 5 EVALUATION criteria below>",
      "registerProximity": "<'PASS' or 'FAIL'>",
      "attendAlignment": "<'PASS' or 'FAIL'>",
      "catchTouch": "<'PASS' or 'FAIL'>",
      "enter": "<'PASS' or 'FAIL'>"
    },
    "score": "<number 0-5, count of PASS>",
    "passed": "<true if score >= 4, false otherwise>",
    "summary": "<1-2 punchy sentences: 4-5 PASS = TRACE applied well, 3 = Making progress, 2 or fewer = Review and try again>"
  },
  "lesson5Eval": "<Spoken coaching paragraph — Ryan talking to the user. Start with 'Let me walk you through the Lesson 5 skills — TRACE.' Then describe each skill result conversationally, matching the PASS/FAIL verdicts in lesson5Check above. For each skill speak it naturally: 'For Track gaze', 'For Register proximity', 'For Attend to alignment', 'For Catch touch', 'For Enter' — then say what happened and whether it worked. One or two coaching sentences per skill. Note: T, R, A, C are observational — the user PASSES by naming or responding to signals Sofia emitted. E is the active move. Spoken out loud — write it to be heard, not read off a form.>",` : ''}
  ${part1Schema},

  "part2": "<THE MIDDLE. Minimum 150 characters. Two to three sentences. Quote the single most revealing exchange: 'When she said [exact ${girlName} quote], you said [exact HIM quote].' Then one to two sentences on what that exchange cost him or earned him with ${girlName}, specific to who she is. Be surgical — name exactly what she was responding to.>",

  "part3": "<THE CORRECTION. Minimum 300 characters. Two to three sentences. The one moment that hurt him most. Quote his exact line, then give the exact replacement line he should have said. Then explain in one to two sentences why the replacement works with ${girlName} specifically — reference something real about her personality or what she wanted from that moment. Make the replacement feel like something he could actually say.>",

  "part4": "<THE CLOSER. Two sentences maximum. Format: 'Two things to fix: [pattern 1] and [pattern 2]. [One punchy closing line — boxing coach energy, references something specific from this session. No clichés.]' BANNED ENDINGS: 'Practice is the only way through', 'every rep makes you sharper', 'you are closer than you think', 'one more round', 'you will feel the difference', 'you have got something real here', 'push it further', 'you will surprise yourself', 'keep at it', 'practice makes perfect', 'keep pushing'. BANNED WORDS: 'go out there', 'dive deeper', 'aim to', 'work on that', 'dig into', 'push deeper', 'delve', 'delved', 'engage', 'dynamic', 'showcase', 'score is a', 'giving you a', 'I give you'. REQUIRED: the final sentence MUST contain one of these motivational words or phrases: 'go again', 'next time', 'try again', 'keep going', 'you got this', 'next session', or 'make all the difference'.>",

  ${openerBreakdownSchema},
  "bestMoment": "<Quote the single best thing he said verbatim. One sentence on why it landed with ${girlName}. No banned words.>",
  "missedOpportunity": "<Quote the moment he lost the most ground — his exact line and ${girlName}'s exact response. One sentence on what he should have done instead. No banned words.>",
  "tryNextTime": "<THREE specific lines the user should try in a FUTURE conversation — not quotes of what he already said, but better alternatives tailored to this character and scenario. Each line should feel natural and be something he could actually say next time he's in this situation. Number them 1, 2, 3. Format: '1. [line] 2. [line] 3. [line]' Each line must be specific to ${girlName}'s personality and the scenario — not generic advice that could apply anywhere. Never use 'Tell me more about that' or any generic curiosity prompt. AUTOMATIC FAIL if any of these phrases appear: 'Say something real', 'Ask about the specific', 'Reference what actually happened', 'Tell me more about that', 'focus on', 'try to', 'make sure', 'be more'.>",
  "wouldSheDateHim": "<'Yes', 'No', or 'Maybe' — then one sentence from ${girlName}'s point of view in first person, about something specific he said or did. No banned words.>"${milestoneOutcomeSchema}
}

MANDATORY: All four parts (part1, part2, part3, part4) must always be present. Never return fewer than 4 parts regardless of conversation length.

SCORING — 1-10 based on these qualities:
- Quality of questions (does he ask things that invite real answers, or dead-ends?)
- Emotional intelligence (does he read her responses and adjust, or barrel ahead?)
- Confidence (does he hold his ground when she pushes back, or fold and apologize?)
- Genuine interest (does he follow what she says, or redirect to himself?)
- Humor (does anything land, or is it forced/absent?)
- Avoiding validation-seeking (does he fish for approval, or just say what he means?)
- Creating tension/intrigue (does she want to know more about him, or is he an open book?)

SCORE BANDS — use the anchor that best matches this conversation:
10: Flawless execution. Every skill applied with precision, timing, and ease. She'd cancel plans.
8-9: All 5 skills demonstrated well. Strong opener, tease landed, mystery held, imply worked, close was clean. One minor rough edge allowed.
6-7: Decent opener, attempted most skills, close was attempted even if imperfect. Real moments but also real misses.
4-5: Weak opener OR missed 3+ skills. Had some exchanges but the conversation felt flat or approval-seeking overall.
1-3: Generic opener, no tease, no mystery, no imply, no close. Little to no real engagement. Compliments without content, or barely spoke.

${scoreFloorRule}

Do not default to 7 out of habit — score based on the specific band above. A 4 requires the conversation to have been largely ineffective across most dimensions, not just one missed skill.

FINAL OUTCOME RULE: The user message below includes a "FINAL OUTCOME" label showing ${characterLabel}'s last response. If she agreed to something — coffee, a drink, her number, walking with him, any positive continuation — that is concrete evidence his skills landed. A positive outcome must raise the score meaningfully (typically +1 to +2 points versus the same conversation with a neutral ending), and MUST be explicitly called out in part4 — name what she agreed to and credit the session for it. Do NOT treat a positive outcome as incidental or omit it from the feedback. A neutral or ambiguous ending: score on technique quality alone. A clear rejection (she walks away, shuts it down, explicitly refuses): factor it as negative evidence even if individual turns were good.

RECOGNIZING WELL-EXECUTED MOVES: When the user delivered a confident, complete playful move with stakes or a specific hook — a challenge with a consequence (e.g. "if you get it right, I owe you a coffee"), a frame that puts her on the spot, a line that creates intrigue without spelling it out — identify it by name in the feedback and credit it. If she stayed in the bit for multiple turns or responded with curiosity, that is proof the move landed. Reflect that in bestMoment and in the score. Do not penalize a well-executed practiced line — the only question is whether it worked in this conversation.

LESSON 1 SKILL FAILURES AFFECT SCORE: If this is a Lesson 1 session (lesson1Complete=true) and the user failed any Lesson 1 skill, cap the score at 7, even if the rest of the conversation was strong. A session where all 5 skills pass AND the execution was excellent can reach 8-9. A session with 1+ skill FAIL should not score above 7 regardless of how good the other turns felt.

BANNED PHRASES AND WORDS — if any of these appear anywhere in your output, rewrite that sentence:
"Right, so here's where", "Now watch this moment", "Now here's the thing", "So — putting it all together",
"That could have come from anyone", "she kept it short because", "this is where the conversation shifted",
"this is the moment I want you to remember", "here's the bottom line", "Now watch this", "Here's where",
"let's talk about", "let's look at", "putting it all together", "the bottom line", "Here's where it",
"what we have here", "at the end of the day", "the fact of the matter",
"dig deeper", "dive deeper", "dive into", "delve", "delved", "seizing", "effectively", "engage", "dynamic", "showcase", "demonstrate",
"connection" (say "moment" or "something real" instead), "approach" (say "what you did" instead),
"generic" (say "flat" or "safe" or "by the book" instead), "specific" (say "real" or "particular" instead).
Read every sentence before you write it. If a banned phrase or word is in there — rewrite it.

RULES:
- Quote actual lines from the transcript. Do not make up lines.
- All parts are spoken out loud — no bullet points, no headers, just natural speech.
- Every part must hit its minimum word count. Do not cut it short.
- Never say "great job" unless score is 8+.
- wouldSheDateHim is ${girlName} speaking in first person.
- tryNextTime is actual words for this specific conversation, not general advice.
- Only use things that actually appear in the transcript. Do not invent context.
- ALL card fields must be filled. No empty strings, no null.${lesson1Complete ? `

LESSON 1 EVALUATION — One Tequila Makes Ideas Click:
The user has completed Lesson 1. Score them on these 5 skills using the exact definitions below. Read each definition carefully — the CRITICAL notes override your default assumptions.

O — Observation opener: Did they reference something specific they noticed about the scene — her behavior, what she's doing, what she's holding, or the environment — at any point in their first 3 messages?
WINDOW RULE: O does not have to be the literal first line. If the user's first message was generic but they referenced what she was doing in their 2nd or 3rd message, O = PASS. Scan the first 3 user messages before deciding.

PASS examples — these all score PASS, no exceptions:
- "I noticed you are writing" = PASS
- "what are you writing?" = PASS
- "you look like a writer" = PASS
- "that looks intense, novel or journal?" = PASS
- "what a beautiful book" = PASS
- "are you working on something?" = PASS
- ANY opener that mentions writing, books, reading, what she is doing, the beach, the coffee shop, the notebook, or any element of the physical scene = PASS

FAIL examples — these and only these score FAIL:
- "you are beautiful" = FAIL (appearance, no scene reference)
- "hey" = FAIL (zero content)
- "wow you are italian right?" = FAIL (appearance guess, no scene reference)
- "nice smile" = FAIL (appearance, no scene reference)
- A first message that is purely generic AND no scene reference appears in messages 2 or 3 = FAIL

CRITICAL OVERRIDE: If the user says ANYTHING about writing, books, what she's reading, what she's working on, or any physical detail of the scene in their first 3 messages — O = PASS. Do not fail O if scene-referencing language appears anywhere in the first 3 exchanges. A question about what she's doing counts exactly as much as a statement.

T — Tease / Playful challenge: When she pushed back, challenged him, or gave a short answer — did he hold his frame and push back, or did he fold?
PASS = doesn't go along with everything, creates small friction, notices something she didn't expect, stays in the same tone without apologizing.
FAIL = apologizes ("I didn't mean to offend you"), caves immediately, says "you seem really cool" to recover, or just agrees with her.

M — Mystery / Own your mystery: When she asked a personal question (job, what he does, where he's from, why he's there) — did he answer without giving everything away?
PASS = partial answer that reveals something real but leaves her wanting more. Short or vague answers that stay comfortable are correct Mystery technique. Example of PASS: "Depends who's asking — some people get the short version, some get more. You're somewhere in between." Example of PASS: answering what a job gives him rather than what the job is.
FAIL = full resume in one message (lists job title, years of experience, city he moved from, hobbies, everything at once).
CRITICAL: A short or evasive answer that withholds details IS the correct Mystery move. Do NOT mark M as FAIL just because he didn't give a clear or full explanation — withholding IS the point.

I — Imply / Verbal spike: Did he communicate romantic interest or attraction through SUBTEXT rather than stating it directly?
PASS = a line that makes her feel what he means without him announcing it — a real observation about her that signals he finds something specific about her interesting, OR a line that implies where the conversation is going without stating it outright. Example of PASS: "You looked like someone completely fine being alone. Not lonely. Just present. You don't see that often." Example of PASS: "I'm curious whether you want to find out." Example of PASS: "You've been choosing every word carefully this whole conversation. Makes me wonder what you're actually deciding." — this implies she is deciding something about him, which is subtext for romantic interest. The gap between what he says and what he means is where this skill lives.
FAIL = states it directly with no subtext: "I think you're really attractive and I'd like to ask you out."
CRITICAL: Implication can be about the CONVERSATION'S DIRECTION, not only about himself. Any line that creates tension or suggests something without saying it counts. Do NOT fail Imply just because the line does not use the word "attraction" or "interest" — subtext by definition avoids stating those things directly.

C — Close / Direct comfortable close:
EVALUATION METHOD: Two questions about his LAST message only. Ignore all prior messages and her responses entirely.
Question 1: Does his last message make a direct move to continue — invite to a café/bar/walk, ask for her number, or suggest meeting again? If NO → FAIL. If YES → go to Question 2.
Question 2: Does that move include hedge language — "no pressure", "only if you want", "maybe", "if you're interested", "I don't know", "if you feel like it", or any similar qualifier that softens or hands the decision back? If YES → FAIL. If NO → PASS.
That is the complete verdict for lesson1Check.skills.close. Stop here. Do not read the conversation context. Do not assess whether she seemed receptive. Do not assess timing, warmth, or build-up.
PASS examples: "Come with me." = PASS. "Come get a coffee with me." = PASS. "I'm walking down to that café on the corner when I leave here. Come with me." = PASS. "Want to grab coffee?" = PASS. "Give me your number." = PASS.
FAIL examples: "We should hang out sometime, no pressure." = FAIL (hedge). "Maybe we could grab coffee if you want?" = FAIL (hedge). [conversation ends with no direct invite] = FAIL.

ANTI-FABRICATION RULE for lesson1Eval:
You are describing what happened in THIS specific conversation from the transcript above. When writing the lesson1Eval sentences, only put words in quotation marks if you are copying them VERBATIM from the transcript. If you are not certain of the exact wording, describe what happened without using quotes — paraphrase instead of quoting. Do not invent lines that she said or that he said.

These fields (lesson1Eval and lesson1Check) are already part of the JSON schema above — fill them based on the criteria and definitions above.` : ''}${lesson2Complete ? `

LESSON 2 EVALUATION — FRAME: Holding Your Ground:
Evaluate the user on these 5 skills. Match your verdicts exactly to the lesson2Check fields in the JSON schema above.

F — Feel Nothing: When she tested or challenged him, did he stay visibly unaffected?
PASS = no flinching, no defending, no explaining himself
FAIL = got defensive, tensed up, started justifying

R — Reframe It: Did he flip the script back on her at any point?
PASS = turned her test into something playful or made her qualify herself
FAIL = accepted her frame, tried to meet her on her terms

A — Add Humor: Did he defuse a tense moment with a light touch?
PASS = used a joke or playful line to neutralize a test
FAIL = took the test seriously, got logical or emotional about it

M — Make Her Qualify: Did he create a moment where she had to prove something to him?
PASS = turned the situation so she was trying to impress him
FAIL = he was always the one trying to impress her

E — Exit If Needed: Did he show he was willing to walk away or pull back with confidence?
PASS = pulled back or showed he didn't need her approval
FAIL = chased, kept talking after she pulled back

These fields (lesson2Eval and lesson2Check) are already part of the JSON schema above — fill them based on the criteria and definitions above.` : ''}${lesson3Complete ? `

LESSON 3 EVALUATION — PACE: The Long Game:
Evaluate the user on these 4 skills. Match your verdicts exactly to the lesson3Check fields in the JSON schema above.

P — Pause: When she asked him a DIRECT question about his feelings, interest, or exclusivity ("do you like me?", "are you seeing anyone?", "what is this for you?") — did he answer too eagerly and directly?
PASS = holds back, gives a non-direct answer, deflects, or makes her wait — does not immediately confirm or deny feelings.
FAIL = immediately gives a direct answer ("yes I like you", "no I'm not seeing anyone") without making her earn it.
NOT P = she asked about his job, hobbies, travel, history, or any personal-topic question. Those are Mystery (L1). Only fire P for direct feelings/exclusivity questions.

A — Ask-back: When she asked him something about himself (work, interests, opinions, experiences) — did he answer and then redirect back to her?
PASS = answers briefly and turns it back with a question or redirect ("your turn", "what about you").
FAIL = answers entirely about himself with no question or redirect back — the turn ends completely on him.
NOT A = she made a statement and did not ask him a question. If no question was directed at him, A cannot fire.

C — Contain: Did he stack multiple romantic or attraction-specific compliments in a single message?
PASS = receives her warmth without rushing to match it or pile on compliments. Single casual compliment or banter is fine.
FAIL = stacks two or more romantic terms ("you're beautiful, I really like you", "you're gorgeous and I'm falling for you") in one turn.
NOT C = a single compliment, playful tease, or general warmth — that is Tease territory (L1) and must not be flagged here.

E — Earn: In the first 3-4 exchanges, did he make a premature declaration of strong interest, date proposal, or romantic escalation before she showed real investment?
PASS = holds back, lets her demonstrate interest first before matching or escalating.
FAIL = "I really like you", "I want to take you out", "I feel something with you" — declared in the first 3-4 exchanges before she has earned it.
NOT E = after the 4th exchange (she has had time to invest), or when he is clearly responding to her unmistakable signal of interest.

These fields (lesson3Eval and lesson3Check) are already part of the JSON schema above — fill them based on the criteria and definitions above.` : ''}${lesson4Complete ? `

LESSON 4 EVALUATION — CHAIN: The Thread:
Evaluate the user on these 5 skills. Match your verdicts exactly to the lesson4Check fields in the JSON schema above.

C — Catch threads: When she spoke, did the user respond to something she actually said — or did they ignore her content entirely and pivot to something unrelated?
PASS = user's reply references at least one thing she actually said (a name, event, feeling, detail from her message).
FAIL = her message contained clear threads and the user's reply references none of them — asks a generic question or changes the subject entirely as if she had said nothing.
NOT C = she gave no substantive content (a yes/no answer, a single word). If there were no threads to catch, C cannot fire.

H — Hook the richest: When she spoke, did the user pick up on the thread with the most emotional charge, or did they take the safest/most obvious one?
PASS = user engaged with a thread that had emotional weight — something she described as hard, weird, meaningful, important, or that she said with feeling — even if it was not the first thing she mentioned.
FAIL = her message had a clearly marked emotional thread AND the user ignored it, instead asking about a surface detail (a date, location, basic fact).
NOT H = she gave only surface-level information with no emotional thread available. If no richer thread existed, H cannot fire.

A — Ask deeper: After picking a thread, did the user follow it one layer further on the same topic, or did they pivot to something new?
PASS = user's question or reply stays with the same thread she opened — goes deeper on why, what it felt like, what came of it, or what it meant.
FAIL = user picked up a thread, she responded with more, and then user's next message jumps to a completely different subject — no follow-through on the thread they just opened.
NOT A = the user asked any follow-up on the same general topic. A only fires on full topic abandonment after a thread was opened and responded to.

I — Inject yourself: When she shared something personal, did the user contribute something from their own life, or did they stay entirely in question mode?
PASS = after she disclosed something personal (a feeling, a struggle, an experience), the user offered something genuine from their own life — a brief share, a relatable feeling, a real connection — even if short.
FAIL = she disclosed something personal and the user responded with another question only — no personal share, no "I know that feeling", no reciprocal disclosure.
NOT I = she made a surface observation or asked a factual question and did not disclose anything personal. If she didn't open up, I cannot fire.

N — Never abandon a live thread: Did the user return to a thread she had shown real engagement with earlier, or did they let it drop when she redirected?
PASS = when she had shown clear interest in a topic earlier (lit up, started to share, said something with feeling) and then moved away from it, the user noticed and came back to it — either immediately or later in the conversation.
FAIL = she had shown visible engagement on a topic earlier in the conversation AND when the topic shifted, the user accepted the redirect and never returned to what she had lit up about.
NOT N = the conversation is in early exchanges (3 or fewer) — no established live thread exists yet.

IMPORTANT: All CHAIN skills evaluate what the user does with HER words, not whether the user said something interesting or impressive. A clever pivot off-topic fails C. A better question about something she never mentioned fails A. Evaluate strictly on whether the user tracked and deepened what she actually offered.

These fields (lesson4Eval and lesson4Check) are already part of the JSON schema above — fill them based on the criteria and definitions above.` : ''}${lesson5Complete ? `

LESSON 5 EVALUATION — TRACE: Reading the Signal:
Evaluate the user on these 5 skills. T, R, A, C are observational — ${girlName} emits signals through parenthetical stage directions in her responses. The user PASSES these by acknowledging, naming, or responding to the signal; FAILS by ignoring it entirely when it appeared.

T — Track gaze: Did ${girlName} describe holding eye contact longer than normal, and did the user respond to or acknowledge the gaze dynamic?
PASS = user named or played with the gaze signal: "don't look away on my account", "I noticed that", any line that holds or engages the eye contact dynamic rather than ignoring it.
FAIL = the gaze stage direction appeared in ${girlName}'s response and the user made no reference to it — responded only to conversational content.
NOT T = ${girlName} emitted no gaze stage direction in the conversation.

R — Register proximity: Did ${girlName} describe moving closer, and did the user acknowledge the shift?
PASS = user named it ("we started much further apart", "you moved over here — I noticed") or played with it without pulling back.
FAIL = proximity stage direction appeared and the user ignored it entirely.
NOT R = ${girlName} emitted no proximity stage direction.

A — Attend to alignment: Did ${girlName} describe mirroring his posture, and did the user notice or name it?
PASS = user named the mirroring ("you match the pace of whoever you're with"), pointed it out, or acknowledged it in any way.
FAIL = mirroring stage direction appeared and the user made no acknowledgment.
NOT A = ${girlName} emitted no alignment stage direction.

C — Catch touch: Did ${girlName} describe brief deliberate touch, and did the user respond without ignoring or over-reacting?
PASS = user acknowledged it directly ("you did that on purpose", "that wasn't accidental") or responded with any line that plays with the touch signal.
FAIL = touch stage direction appeared and the user completely ignored it in their reply.
NOT C = ${girlName} emitted no touch stage direction.

E — Enter on the cluster: Did the user make a direct, unambiguous move — ask for her number, suggest continuing somewhere else, or include her in what they're doing next — after three or more signals had appeared?
PASS = direct statement or question moving the interaction forward with no hedge language, delivered after ${girlName} had emitted at least three signal stage directions.
FAIL = user never made a move; OR used hedge language ("maybe we could..."); OR acted before three signals appeared.
NOT E = conversation too short for the cluster to have formed.

IMPORTANT: For any NOT-fired skill (${girlName} emitted no signal), mark it PASS — do not penalize the user for an opportunity that wasn't created. Score and passed should only reflect skills where a genuine test occurred.

These fields (lesson5Eval and lesson5Check) are already part of the JSON schema above — fill them based on the criteria and definitions above.` : ''}`;

  try {
    const finalOutcomeNote = finalCharResponse
      ? `\n\nFINAL OUTCOME — ${characterLabel}'s last response after his final message:\n"${finalCharResponse}"\n(Apply the FINAL OUTCOME RULE: if she agreed to something, raise the score meaningfully and call it out explicitly in part4.)`
      : '';

    const mainMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Scenario: ${scenarioTitle}\n\nHIS OPENING LINE (HIM_1): "${conversation.find(m => m.role === 'user')?.content?.trim() || ''}"\n\nFull conversation transcript:\n${transcript}${finalOutcomeNote}\n\n${openerReminder}` },
    ];
    let raw;
    try { raw = await callLLM(mainMessages, 5000); }
    catch (llmErr) { return res.status(500).json({ error: llmErr.message }); }
    let feedback;
    try {
      feedback = JSON.parse(raw);
    } catch(parseErr) {
      // Model returned malformed JSON — retry once with stricter instruction
      console.warn('[coach] JSON parse failed, retrying with stricter prompt...');
      const retryMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Scenario: ${scenarioTitle}\n\nHIS OPENING LINE (HIM_1): "${conversation.find(m => m.role === 'user')?.content?.trim() || ''}"\n\nFull conversation transcript:\n${transcript}${finalOutcomeNote}\n\n${openerReminder}\n\nCRITICAL: Return ONLY valid JSON. No markdown, no backticks, no preamble. Start with { and end with }.` },
      ];
      try {
        const retryRaw = await callLLM(retryMessages, 5000);
        feedback = JSON.parse(retryRaw);
      } catch(retryErr) {
        return res.status(500).json({ error: 'JSON parse failed after retry: ' + retryErr.message });
      }
    }

    // Guard: if card fields came back undefined/null, fill with fallbacks
    const cardFields = ['part1', 'part2', 'part3', 'part4', 'openerBreakdown', 'bestMoment', 'missedOpportunity', 'tryNextTime', 'wouldSheDateHim', 'spokenSummary'];
    for (const field of cardFields) {
      if (!feedback[field] || feedback[field] === 'undefined' || feedback[field].length < 5) {
        console.warn(`[coach] Field "${field}" missing — filling fallback`);
        if (field === 'wouldSheDateHim') feedback[field] = 'Maybe. You had some real moments but needed to go further into what she opened.';
        else if (field === 'tryNextTime') feedback[field] = '1. Say something real about what she mentioned. 2. Ask about the specific thing she brought up. 3. Reference what actually happened in the conversation.';
        else if (field === 'spokenSummary') feedback[field] = 'You showed up and had a real conversation — now make it sharper.';
        else if (field === 'part1') feedback[field] = 'You showed up. That is the first step. Now let\'s look at what happened.';
        else feedback[field] = 'See the feedback above.';
      }
    }

    // milestoneOutcome is optional (only requested when the scenario declares a milestone)
    if (milestone && (!feedback.milestoneOutcome || feedback.milestoneOutcome.length < 5)) {
      console.warn('[coach] milestoneOutcome missing despite milestone present — filling fallback');
      feedback.milestoneOutcome = 'Unclear — not enough in this conversation to say for sure.';
    }

    // Warn if lesson1 fields are missing when they should be present
    if (lesson1Complete) {
      if (!feedback.lesson1Eval || feedback.lesson1Eval.length < 10) console.warn('[coach] lesson1Eval missing despite lesson1Complete=true');
      if (!feedback.lesson1Check || !feedback.lesson1Check.skills) console.warn('[coach] lesson1Check missing despite lesson1Complete=true');
    }

    if (lesson2Complete) {
      if (!feedback.lesson2Eval || feedback.lesson2Eval.length < 10) console.warn('[coach] lesson2Eval missing despite lesson2Complete=true');
      if (!feedback.lesson2Check || !feedback.lesson2Check.skills) console.warn('[coach] lesson2Check missing despite lesson2Complete=true');
    }

    if (lesson3Complete) {
      if (!feedback.lesson3Eval || feedback.lesson3Eval.length < 10) console.warn('[coach] lesson3Eval missing despite lesson3Complete=true');
      if (!feedback.lesson3Check || !feedback.lesson3Check.skills) console.warn('[coach] lesson3Check missing despite lesson3Complete=true');
    }

    if (lesson4Complete) {
      if (!feedback.lesson4Eval || feedback.lesson4Eval.length < 10) console.warn('[coach] lesson4Eval missing despite lesson4Complete=true');
      if (!feedback.lesson4Check || !feedback.lesson4Check.skills) console.warn('[coach] lesson4Check missing despite lesson4Complete=true');
    }

    if (lesson3Complete && feedback.lesson3Check?.skills) {
      const skills3 = feedback.lesson3Check.skills;
      const passCount3 = ['pause', 'askBack', 'contain', 'earn'].filter(k => skills3[k] === 'PASS').length;
      feedback.lesson3Check.score = passCount3;
      feedback.lesson3Check.passed = passCount3 >= 3;
    }

    if (lesson4Complete && feedback.lesson4Check?.skills) {
      const skills4 = feedback.lesson4Check.skills;
      const passCount4 = ['catch', 'hook', 'ask', 'inject', 'never'].filter(k => skills4[k] === 'PASS').length;
      feedback.lesson4Check.score = passCount4;
      feedback.lesson4Check.passed = passCount4 >= 4;
    }

    if (lesson2Complete && feedback.lesson2Check?.skills) {
      const skills2 = feedback.lesson2Check.skills;
      const passCount2 = ['feelNothing', 'reframe', 'addHumor', 'makeHerQualify', 'exit'].filter(k => skills2[k] === 'PASS').length;
      feedback.lesson2Check.score = passCount2;
      feedback.lesson2Check.passed = passCount2 >= 4;
    }

    if (lesson1Complete) {

      if (feedback.lesson1Check?.skills) {
        // Server-side C verdict: two-question mechanical gate overrides LLM judgment.
        // LLM consistently applies holistic/tone criteria despite prompt instructions.
        const lastUserMsg = [...conversation].reverse().find(m => m.role === 'user')?.content?.trim() || '';
        if (!lastUserMsg) {
          feedback.lesson1Check.skills.close = 'FAIL';
        } else {
          const msgLower = lastUserMsg.toLowerCase();
          const hedgeWords = [
            'no pressure', 'if you want', "if you're interested", 'if you feel like',
            "i don't know", 'i dont know', 'just if', 'or whatever',
            'maybe we', 'maybe if', 'sometime', 'at some point', 'whenever you',
          ];
          const invitePatterns = [
            /\bcome\b/i, /\blet'?s\b/i, /\bjoin me\b/i, /\bmeet me\b/i, /\bmeet up\b/i,
            /\bgrab\b/i, /\bget\s+\w*\bcoffee\b/i, /\bget\s+a?\s*drink\b/i,
            /\bgive me your number\b/i, /\bwalk with me\b/i, /\btext me\b/i,
            /\bwant to\s+(?:grab|get|come)\b/i, /\bcall me\b/i,
          ];
          const hasHedge = hedgeWords.some(hw => msgLower.includes(hw));
          const hasInvite = invitePatterns.some(p => p.test(lastUserMsg));
          if (hasHedge) {
            feedback.lesson1Check.skills.close = 'FAIL';
          } else if (hasInvite) {
            feedback.lesson1Check.skills.close = 'PASS';
          }
          // else: no invite and no hedge — keep LLM verdict
        }

        // Recompute score and passed after C override
        const skills = feedback.lesson1Check.skills;
        const passCount = ['observation','tease','mystery','imply','close'].filter(k => skills[k] === 'PASS').length;
        feedback.lesson1Check.score = passCount;
        feedback.lesson1Check.passed = passCount >= 4;
      }
    }

    // Quality check — tryNextTime must contain transcript-specific content
    const GENERIC_TNT = [
      'say something real about',
      'ask about the specific thing',
      'reference what actually happened',
      'tell me more about that',
      'focus on',
      'try to',
      'make sure',
      'be more',
    ];
    const tntGeneric = !feedback.tryNextTime ||
      GENERIC_TNT.some(p => feedback.tryNextTime.toLowerCase().includes(p));

    if (tntGeneric) {
      console.warn('[coach] tryNextTime is generic — retrying for just that field');
      try {
        const tntMessages = [
          { role: 'system', content: `You are Ryan, a dating coach. Return ONLY valid JSON: {"tryNextTime":"..."}\n\ntryNextTime must be THREE lines the user should try in a FUTURE conversation — not quotes of what he already said, but better alternatives tailored to this character and scenario. Number them 1, 2, 3. Each line must be specific to the character's personality and scenario — not generic advice. BANNED: "Say something real", "Ask about the specific", "Reference what actually happened", "Tell me more about that", "focus on", "try to", "make sure", "be more".` },
          { role: 'user', content: `Scenario: ${scenarioTitle}\n\nTranscript:\n${transcript}` },
        ];
        const tntRaw = await callLLM(tntMessages, 200);
        const tntParsed = JSON.parse(tntRaw);
        const stillGeneric = !tntParsed.tryNextTime ||
          GENERIC_TNT.some(p => tntParsed.tryNextTime.toLowerCase().includes(p));
        feedback.tryNextTime = stillGeneric ? '' : tntParsed.tryNextTime;
        if (stillGeneric) console.warn('[coach] tryNextTime retry still generic — leaving blank');
      } catch (tntErr) {
        console.warn('[coach] tryNextTime retry failed:', tntErr.message);
        feedback.tryNextTime = '';
      }
    }

    // Quote check — reject tryNextTime if any line is a direct user quote (>15 chars)
    if (feedback.tryNextTime) {
      const himTexts = conversation
        .filter(m => m.role === 'user')
        .map(m => m.content.trim().toLowerCase());
      const tntLines = feedback.tryNextTime.toLowerCase().split(/\d+\.\s+/).filter(Boolean);
      const isDirectQuote = himTexts.some(himText =>
        tntLines.some(line => {
          for (let i = 0; i <= himText.length - 25; i++) {
            if (line.includes(himText.slice(i, i + 25))) return true;
          }
          return false;
        })
      );
      if (isDirectQuote) {
        console.warn('[coach] tryNextTime contains direct user quote — rejecting');
        feedback.tryNextTime = '';
      }
    }

    // Inject hardcoded transitions — model generates part1 itself
    feedback.transition2 = transition2;
    feedback.transition3 = transition3;
    feedback.transition4 = transition4;

    // Clamp score to valid range — no floor, honest scoring
    feedback.score = Math.min(10, Math.max(1, Math.round(Number(feedback.score) || 5)));
    // Enforce score cap: any lesson1 skill FAIL → max 7
    if (lesson1Complete && feedback.lesson1Check?.skills) {
      const hasAnyFail = ['observation','tease','mystery','imply','close'].some(k => feedback.lesson1Check.skills[k] === 'FAIL');
      if (hasAnyFail && feedback.score > 7) {
        feedback.score = 7;
        console.log('[coach] score capped at 7 due to lesson1 skill FAIL');
      }
    }
    console.log(`[coach] score=${feedback.score}`);

    // Post-process — guaranteed banned phrase removal
    // Model keeps regenerating these regardless of prompt instructions
    // JS replace is the only 100% reliable fix
    const cleanText = (text) => {
      if (!text || typeof text !== 'string') return text;
      return text
        // Banned transition phrases
        .replace(/right,?\s*so here['']s where\b/gi, 'Here is where')
        .replace(/now watch this moment[^.!?]*/gi, 'One moment stands out.')
        .replace(/now here['']s the thing/gi, 'The thing is')
        .replace(/so\s*[—-]\s*putting it all together/gi, 'To wrap it up')
        .replace(/here['']s the bottom line/gi, 'The verdict')
        .replace(/this is where the conversation shifted/gi, 'The conversation changed here')
        .replace(/this is the moment I want you to remember/gi, 'This is the one to remember')
        .replace(/at the end of the day/gi, 'ultimately')
        .replace(/the fact of the matter/gi, 'the truth')
        // Banned vocabulary
        .replace(/\bdiv(?:e[sd]?|ing)\s+(?:deeper|into|in)\b/gi, 'get into')
        .replace(/\bdig(?:s|ging)?\s+(?:deeper|into)\b/gi, 'go further into')
        .replace(/\bget(?:ting)?\s+deeper\s+into\b/gi, 'get more into')
        .replace(/\bgo(?:ing)?\s+deeper\b/gi, 'go further')
        .replace(/\bdelved?\b/gi, 'got into')
        .replace(/\bengage(?:d|s|ment)?\b/gi, 'connect')
        .replace(/\bdynamic\b/gi, 'situation')
        .replace(/\bshowcase(?:d|s)?\b/gi, 'show')
        .replace(/\bdemonstrate(?:d|s)?\b/gi, 'show')
        .replace(/\bseizing\b/gi, 'taking')
        .replace(/\bconnection\b/gi, 'something real')
        .replace(/\btoo safe\b/gi, 'too cautious')
        .replace(/\baim to\b/gi, 'try to')
        .replace(/\bwork on that\b/gi, 'fix that')
        // Score mentions in spoken parts
        .replace(/\bI['']m giving you a \d+\b/gi, '')
        .replace(/\byour score is a? \d+\b/gi, '')
        .replace(/\bI give you a \d+\b/gi, '')
        .replace(/\ba score of \d+\b/gi, '')
        // FIX A: Stock endings — replace with placeholder, model regenerates on retry
        // These leak through despite prompt bans — JS replace is the only reliable fix
        .replace(/you have got something real here[^.!?]*[.!?]/gi, 'Go again — the next rep will be sharper.')
        .replace(/you are closer than you think[^.!?]*[.!?]/gi, 'The gap is smaller than it feels — go again.')
        .replace(/one more round and you will feel the difference[^.!?]*/gi, 'One more session and you will notice the shift.')
        .replace(/push it further[^.!?]*[.!?]/gi, 'Take what worked here and build on it.')
        .replace(/you will surprise yourself[^.!?]*[.!?]/gi, 'Go again and see what lands differently.')
        .replace(/every rep makes you sharper[^.!?]*/gi, 'Each session builds on the last.')
        .replace(/practice is the only way through[^.!?]*/gi, 'The only way forward is another rep.')
        .replace(/keep at it[^.!?]*[.!?]/gi, 'Go again.')
        .replace(/practice makes perfect[^.!?]*[.!?]/gi, 'Another session, another step.')
        // Clean up double spaces from removals
        .replace(/\s{2,}/g, ' ')
        .trim();
    };

    // Apply to all spoken fields
    feedback.part1 = cleanText(feedback.part1);
    feedback.part2 = cleanText(feedback.part2);
    feedback.part3 = cleanText(feedback.part3);
    feedback.part4 = cleanText(feedback.part4);
    feedback.spokenSummary = cleanText(feedback.spokenSummary);
    feedback.missedOpportunity = cleanText(feedback.missedOpportunity);
    feedback.bestMoment = cleanText(feedback.bestMoment);
    feedback.wouldSheDateHim = cleanText(feedback.wouldSheDateHim);
    if (feedback.milestoneOutcome) feedback.milestoneOutcome = cleanText(feedback.milestoneOutcome);
    if (feedback.lesson1Eval) feedback.lesson1Eval = cleanText(feedback.lesson1Eval);
    if (feedback.lesson2Eval) feedback.lesson2Eval = cleanText(feedback.lesson2Eval);
    if (feedback.lesson3Eval) feedback.lesson3Eval = cleanText(feedback.lesson3Eval);
    if (feedback.lesson4Eval) feedback.lesson4Eval = cleanText(feedback.lesson4Eval);

    res.json(feedback);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
