// ============================================================
// Ozmeva — Netflix-style row renderer
// Reads window.SCENARIOS, groups by category, builds rows.
// Loads AFTER scenarios.js, scenarios_extended.js, and player.js
// ============================================================

(function () {
  'use strict';

  // Category metadata: display name, emoji, sort order, fallback gradient
  const CATEGORIES = {
    dating: {
      label: 'Dating & Social',
      emoji: '💬',
      order: 1,
      gradient: 'linear-gradient(135deg, #ff6b9d 0%, #c44569 100%)'
    },
    interview: {
      label: 'Job Interview',
      emoji: '💼',
      order: 2,
      gradient: 'linear-gradient(135deg, #5b8def 0%, #2d5ab8 100%)'
    },
    dark_psychology: {
      label: 'Dark Psychology & Manipulation Defense',
      emoji: '🧠',
      order: 3,
      gradient: 'linear-gradient(135deg, #e74c3c 0%, #8e3022 100%)'
    }
  };

  // Default category when a scenario has no category field (legacy scenarios)
  const DEFAULT_CATEGORY = 'dating';

  // Scenarios flagged as NEW (the 10 we just added)
  const NEW_SCENARIO_KEYS = new Set([
    'interview_behavioral',
    'interview_salary',
    'interview_stress',
    'interview_weakness',
    'interview_counter',
    'darkpsych_gaslight',
    'darkpsych_darvo',
    'darkpsych_narc_boss',
    'darkpsych_lovebomb',
    'darkpsych_guilt'
  ]);

  function difficultyStars(level) {
    const n = Math.max(1, Math.min(5, level || 2));
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<div class="nf-star${i <= n ? ' filled' : ''}"></div>`;
    }
    return html;
  }

  // Character metadata per scenario key
  const CHARACTER_META = {
    'street_intro':         { name: 'Sofia',    vibe: 'Warm & curious' },
    'beach':                { name: 'Sofia',    vibe: 'Guarded but open' },
    'bar':                  { name: 'Maya',     vibe: 'Sarcastic, tests you' },
    'museum':               { name: 'Isabelle', vibe: 'Intellectual, easily bored' },
    'wedding':              { name: 'Claire',   vibe: 'Sophisticated, high standards' },
    'bookstore_extended':   { name: 'Léa',      vibe: 'Quirky, bookish' },
    'gym_sparks':           { name: 'Zoe',      vibe: 'Focused, hard to reach' },
    'interview_behavioral': { name: 'Marcus',   vibe: 'By the book, firm' },
    'interview_salary':     { name: 'Diana',    vibe: 'Strategic, poker face' },
    'interview_stress':     { name: 'Victor',   vibe: 'Hostile on purpose' },
    'interview_weakness':   { name: 'Priya',    vibe: 'Sharp, reads between lines' },
    'interview_counter':    { name: 'James',    vibe: "Calculated, won't budge" },
    'darkpsych_gaslight':   { name: 'Alex',     vibe: 'Twists your reality' },
    'darkpsych_darvo':      { name: 'Rachel',   vibe: 'Flips the script fast' },
    'darkpsych_narc_boss':  { name: 'Derek',    vibe: 'Power hungry, unfair' },
    'darkpsych_lovebomb':   { name: 'Mia',      vibe: 'Intense, too fast' },
    'darkpsych_guilt':      { name: 'Carol',    vibe: 'Weaponizes family' },
    'art_studio_ep2':       { name: 'Nia',      vibe: 'More open. Still testing.' },
    'art_studio_ep3':       { name: 'Nia',      vibe: 'Coffee. No paintings to hide behind.' },
  };

  // Skill trained per scenario
  const SKILL_META = {
    'street_intro':         'Cold approach',
    'beach':                'Cold open + date close',
    'bar':                  'Hold interest under pressure',
    'museum':               'Intellectual conversation',
    'wedding':              'High-value social skills',
    'bookstore_extended':   'Shared interest connection',
    'gym_sparks':           'Approach without disrupting',
    'interview_behavioral': 'STAR method storytelling',
    'interview_salary':     'Anchor high, stay calm',
    'interview_stress':     'Composure under fire',
    'interview_weakness':   'Reframe without lying',
    'interview_counter':    'Hold your value',
    'darkpsych_gaslight':   'Trust your perception',
    'darkpsych_darvo':      'Spot script-flipping',
    'darkpsych_narc_boss':  'Navigate unfair authority',
    'darkpsych_lovebomb':   'Slow down safely',
    'darkpsych_guilt':      'Hold boundaries with family',
    'art_studio_ep2':       'Listening under lower guard',
    'art_studio_ep3':       'Staying curious about her, not about yourself',
  };

  function groupScenariosByCategory() {
    const scenarios = window.SCENARIOS || {};
    const grouped = {};

    Object.keys(scenarios).forEach((key) => {
      const sc = scenarios[key];
      if (sc.hidden) return;
      const cat = sc.category || DEFAULT_CATEGORY;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ key, data: sc });
    });

    return grouped;
  }

  function buildCard(key, sc) {
    const card = document.createElement('div');
    card.className = 'nf-card';
    card.setAttribute('data-key', key);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const cat = sc.category || DEFAULT_CATEGORY;
    const gradient = (CATEGORIES[cat] || CATEGORIES[DEFAULT_CATEGORY]).gradient;
    const emoji = (CATEGORIES[cat] || CATEGORIES[DEFAULT_CATEGORY]).emoji;
    const char = CHARACTER_META[key] || { name: '', vibe: '' };
    const skill = SKILL_META[key] || '';
    const difficulty = sc.difficulty || 2;
    const duration = sc.duration_min || 10;
    const isNew = NEW_SCENARIO_KEYS.has(key);

    // Episode lock: check if an unlock key is required and not yet set
    const isLocked = sc.unlockKey
      ? (localStorage.getItem(sc.unlockKey) !== 'true')
      : false;
    // Derived from scenario data so this works for any episode chain, not just ep2 --
    // previously hardcoded to "EP 2" / "Complete Open Studios Day", which would have
    // shown wrong text on ep3's (or any future episode's) locked card.
    const prevEpisode = sc.unlockAfter ? (window.SCENARIOS || {})[sc.unlockAfter] : null;
    const lockBadgeText = sc.episodeLabel || 'LOCKED';
    const lockMessageText = `Complete ${prevEpisode?.title || 'the previous episode'} to unlock`;

    const thumbUrl = sc.thumb || '';
    const thumbInner = thumbUrl
      ? `<img class="nf-card-thumb" src="${thumbUrl}" alt="" onerror="this.style.display='none'">`
      : `<div class="nf-card-thumb-fallback" style="background:${gradient}">${emoji}</div>`;

    card.innerHTML = `
      <div class="nf-card-thumb-wrap">
        ${thumbInner}
        <div class="nf-card-thumb-overlay"></div>
        ${isLocked ? `<div class="nf-card-new-badge" style="background:#555;color:#aaa">${lockBadgeText}</div>` : ''}
        ${!isLocked && isNew ? '<div class="nf-card-new-badge">NEW</div>' : ''}
        ${isLocked ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-size:28px;">🔒</div>' : ''}
        <div class="nf-card-character">
          ${char.name ? `<div class="nf-card-char-name">${char.name}</div>` : ''}
          ${char.vibe ? `<div class="nf-card-char-vibe">${char.vibe}</div>` : ''}
        </div>
      </div>
      <div class="nf-card-body">
        <div class="nf-card-title">${sc.title || key}</div>
        ${isLocked ? `<div class="nf-card-skill" style="color:#888">${lockMessageText}</div>` : (skill ? `<div class="nf-card-skill">${skill}</div>` : '')}
        <div class="nf-card-stars">${difficultyStars(difficulty)}</div>
        <div class="nf-card-meta">
          <span class="nf-badge nf-badge-duration">⏱ ${duration} min</span>
        </div>
        <div style="margin-top:6px;"><span class="ek-cert-chip" data-cert-char="" style="display:none;"></span></div>
      </div>
    `;

    // Cert badge — set character ID so refreshCertBadges() can update it
    const certChip = card.querySelector('.ek-cert-chip');
    if (certChip) {
      const charId = (window.SCENARIO_CHARACTER_MAP || {})[key] || '';
      if (charId) {
        certChip.setAttribute('data-cert-char', charId);
        if (window.refreshCertBadges) window.refreshCertBadges();
      }
    }

    // Click handler: show practice focus modal (or start directly if function unavailable)
    const selectScenario = () => {
      if (isLocked) {
        alert('Complete "Open Studios Day — Saturday" first to unlock this episode.');
        return;
      }
      if (typeof window.showPracticeFocusModal === 'function') {
        window.showPracticeFocusModal(key);
      } else {
        const select = document.getElementById('scenarioSelect');
        if (!select) return;
        select.value = key;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    card.addEventListener('click', selectScenario);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectScenario();
      }
    });

    return card;
  }

  function buildRow(categoryKey, scenarios) {
    const meta = CATEGORIES[categoryKey] || {
      label: categoryKey,
      emoji: '📂',
      order: 99
    };

    const row = document.createElement('section');
    row.className = 'nf-row';
    row.setAttribute('data-category', categoryKey);

    const header = document.createElement('div');
    header.className = 'nf-row-header';
    header.innerHTML = `
      <h2 class="nf-row-title">${meta.label}</h2>
      <span class="nf-row-count">${scenarios.length} ${scenarios.length === 1 ? 'scenario' : 'scenarios'}</span>
    `;

    const strip = document.createElement('div');
    strip.className = 'nf-strip';

    // Sort scenarios: NEW ones first, then by difficulty ascending
    scenarios.sort((a, b) => {
      const aNew = NEW_SCENARIO_KEYS.has(a.key) ? 0 : 1;
      const bNew = NEW_SCENARIO_KEYS.has(b.key) ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew;
      return (a.data.difficulty || 2) - (b.data.difficulty || 2);
    });

    scenarios.forEach(({ key, data }) => {
      strip.appendChild(buildCard(key, data));
    });

    row.appendChild(header);
    row.appendChild(strip);

    return row;
  }

  function renderNetflixLayout() {
    const wrap = document.querySelector('.wrap');
    if (!wrap) {
      console.warn('[Netflix] .wrap container not found');
      return;
    }

    // Enable netflix mode on the wrap
    wrap.classList.add('netflix-mode');

    // Remove any existing netflix container (in case of re-render)
    const existing = document.querySelector('.nf-container');
    if (existing) existing.remove();

    // Build the container
    const container = document.createElement('div');
    container.className = 'nf-container';

    // Group and render
    const grouped = groupScenariosByCategory();
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
      const aOrder = (CATEGORIES[a] || { order: 99 }).order;
      const bOrder = (CATEGORIES[b] || { order: 99 }).order;
      return aOrder - bOrder;
    });

    sortedCategories.forEach((catKey) => {
      container.appendChild(buildRow(catKey, grouped[catKey]));
    });

    // Insert after .stage (which is inside .wrap)
    wrap.appendChild(container);
  }

  // Wait for DOM + scenarios to be ready
  function init() {
    if (!window.SCENARIOS || Object.keys(window.SCENARIOS).length === 0) {
      // Scenarios not loaded yet, retry shortly
      setTimeout(init, 100);
      return;
    }
    renderNetflixLayout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposed so other modules (e.g. player.js after an episode's unlock flag
  // changes) can refresh the card grid without a full page reload.
  // renderNetflixLayout() already removes/rebuilds .nf-container, so this is safe.
  window.refreshScenarioCards = renderNetflixLayout;
})();
