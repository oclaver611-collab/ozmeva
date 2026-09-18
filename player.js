/* ===== Global state ===== */
let currentScenarioKey = null;
let currentUserStyle = null;
let currentCharacterId = "sofia"; // active character — changes when user picks avatar
let pickerHasOverride = false;   // true once user explicitly picks an avatar

// Default character per scenario — overrideable by avatar picker
const SCENARIO_CHARACTER_MAP = {
  beach:        'sofia',
  bar:          'ava',
  museum:       'isabelle',
  gym:          'zoe',
  bookstore:    'nadia',
  street:       'julia',
  wedding:      'claire',
  // Wave 2 — May 2026
  rooftop:      'sanna',
  house_party:  'sarah',
  coffee_shop:  'anna',
  art_gallery:  'leila',
  yoga_studio:  'fatou',
  airport:      'elena',
  supermarket:  'eden',
  office_lobby: 'maya_office',
  train:        'erika',
  // ── Wave 3 — June 2026 ──
  farmers_market:       'camille',
  rooftop_pool:         'priya',
  wine_bar:             'valentina',
  night_market:         'mei',
  dance_studio:         'amara',
  running_trail:        'ingrid',
  jazz_bar:             'solene',
  cherry_blossom_park:  'keiko',
  rooftop_terrace:      'rania',
  pool_party:           'bianca',
  university_library:   'chloe',
  spice_market:         'nour',
  climbing_wall:        'astrid',
  sunday_brunch:        'layla',
  photography_exhibit:  'ines',
  skate_park:           'zara',
  cooking_class:        'talia',
  book_fair:            'miriam',
  flower_shop:          'suki',
  dog_park:             'cara',
  hammam_lobby:         'elif',
  community_garden:     'aisha',
  record_shop:          'fiona',
  observatory_deck:     'celeste',
  jazz_club:            'naomi',
  rooftop_filmmaker:    'zola',
  open_mic:             'imani',
  art_studio:           'nia',
  beachside_cafe:       'cleo',
  independent_bookshop: 'sage',
  airport_gate:         'kaia',
};

function getCharacterDisplayName(id) {
  const set = AVATAR_SETS.find(s => s.id === id);
  if (set) return set.label;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

let currentScript = null;
let isPractice = false;
let stepIndex = 0;
let rec = null;
let listenTimer = null;
let watchdogInterval = null;
let session = 0;
let _lastInputMode = 'voice'; // tracks whether the most recent listenForUser call used voice or type
const _seenScenarioIntros = new Set(); // tracks which scenario intros have played this session

// ── Coached Practice state ──────────────────────────────────────────────────
const _pauseState = { active: false, resolve: null };
let _momentCheckPromise = null;  // promise for current in-flight moment check
let _momentCheckGen     = 0;     // increments to invalidate a check that missed its window
let _turnSnapshot      = null;   // { history: [...], exchangeCount: N } — taken before each listen
let _interruptCount    = 0;      // resets per freeConversation; capped at MAX_INTERRUPTS
const MAX_INTERRUPTS   = 2;      // max coaching interruptions per session

const els = {
  select:         document.getElementById('scenarioSelect'),
  chooseBtn:      document.getElementById('chooseAvatarBtn'),
  media:          document.getElementById('media'),
  name:           document.getElementById('speakerName'),
  text:           document.getElementById('lineText'),
  shelf:          document.getElementById('shelfList'),
  showMore:       document.getElementById('showMore'),
  listenPill:     document.getElementById('listenPill'),
  pickerBackdrop: document.getElementById('avatarPicker'),
  pickerGrid:     document.getElementById('pickerGrid'),
  likeBtn:        document.getElementById('likeBtn'),
  likeCount:      document.getElementById('likeCount'),
  viewCount:      document.getElementById('viewCount'),
  sceneBg:        document.getElementById('sceneBg'),
  stageFrame:     document.getElementById('stageFrame'),
};

/* ===== Metrics ===== */
const Metrics = (() => {
  const KEY = 'ek-metrics-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {scenarios:{}}; } catch { return {scenarios:{}}; } };
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));
  const ensure = (s,id) => {
    if (!s.scenarios[id]) {
      const sc = (window.SCENARIOS||{})[id] || {};
      s.scenarios[id] = { views: sc.seedViews||0, likes: sc.seedLikes||0, youLiked:false, lastViewAt:0 };
    }
  };
  const get = id => { const s=load(); ensure(s,id); return s.scenarios[id]; };
  const bumpView = id => {
    if (!id) return;
    const s=load(); ensure(s,id);
    const m=s.scenarios[id], now=Date.now();
    if (now-(m.lastViewAt||0)>30000) { m.views++; m.lastViewAt=now; save(s); }
  };
  const toggleLike = id => {
    if (!id) return;
    const s=load(); ensure(s,id);
    const m=s.scenarios[id];
    m.youLiked ? (m.likes=Math.max(0,m.likes-1), m.youLiked=false) : (m.likes++, m.youLiked=true);
    save(s); return m;
  };
  const refreshUI = id => {
    if (!id) return;
    const m=get(id);
    if (els.viewCount) els.viewCount.textContent = m.views;
    if (els.likeCount) els.likeCount.textContent = m.likes;
    if (els.likeBtn) els.likeBtn.classList.toggle('btn-primary', !!m.youLiked);
  };
  const bindLikeButton = () => {
    if (!els.likeBtn) return;
    els.likeBtn.onclick = () => { if (!currentScenarioKey) return; toggleLike(currentScenarioKey); refreshUI(currentScenarioKey); };
  };
  return { bumpView, refreshUI, bindLikeButton, get };
})();

/* ===== Progress ===== */
// Tracks score history, streak, and session count in localStorage.
// Shows a thin stat bar on the main screen and a history row on the feedback card.
const Progress = (() => {
  const KEY = 'ek-progress-v1';

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { sessions: [], lastSessionDate: null }; }
    catch { return { sessions: [], lastSessionDate: null }; }
  };

  const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };

  const recordSession = (score, scenarioKey, characterId) => {
    const d = load();
    const today = new Date().toDateString();
    d.sessions.push({ score, scenarioKey, characterId: characterId || 'sofia', date: today, ts: Date.now() });
    if (d.sessions.length > 50) d.sessions = d.sessions.slice(-50); // keep last 50
    d.lastSessionDate = today;
    save(d);
    refreshStatBar();
  };

  const getStreak = () => {
    const d = load();
    if (!d.sessions.length) return 0;
    const days = [...new Set(d.sessions.map(s => s.date))].sort().reverse();
    let streak = 0;
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (days[0] !== today && days[0] !== yesterday) return 0;
    let check = days[0] === today ? new Date() : new Date(Date.now() - 86400000);
    for (const day of days) {
      if (day === check.toDateString()) { streak++; check = new Date(check - 86400000); }
      else break;
    }
    return streak;
  };

  const getBest = () => {
    const d = load();
    if (!d.sessions.length) return null;
    return Math.max(...d.sessions.map(s => s.score));
  };

  const getTotal = () => load().sessions.length;

  const getLast = (n = 5) => {
    const d = load();
    return d.sessions.slice(-n).map(s => s.score);
  };

  const getImprovement = () => {
    const d = load();
    if (d.sessions.length < 2) return null;
    const first = d.sessions[0].score;
    const last = d.sessions[d.sessions.length - 1].score;
    return last - first;
  };

  const refreshStreakBadge = () => {
    const badge = document.getElementById('ek-streak-badge');
    if (!badge) return;
    const streak = getStreak();
    if (streak < 1) {
      badge.style.display = 'none';
      return;
    }
    // Scale up visual weight for milestone streaks
    const isHot  = streak >= 7;
    const isMid  = streak >= 3;
    badge.style.display      = 'flex';
    badge.style.background   = isHot ? '#2b1a00' : '#1e1a0e';
    badge.style.borderColor  = isHot ? '#ff8c00' : '#7a5500';
    badge.style.color        = isHot ? '#ffd06a' : '#ffb300';
    badge.style.fontSize     = isHot ? '15px' : isMid ? '14px' : '13px';
    badge.innerHTML = '&#128293; ' + streak + (streak === 1 ? '-day streak' : '-day streak');
    badge.onclick = showDashboard;
  };

  const refreshStatBar = () => {
    const bar = document.getElementById('ek-stat-bar');
    refreshStreakBadge();
    if (!bar) return;
    const streak = getStreak();
    const best = getBest();
    const total = getTotal();
    if (!total) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.style.cursor = 'pointer';
    bar.title = 'View progress dashboard';
    bar.innerHTML =
      (streak > 0 ? '<span>&#128293; ' + streak + '-day streak</span><span style="color:#2b2e36">•</span>' : '') +
      (best !== null ? '<span>&#127942; Best: ' + best + '/10</span><span style="color:#2b2e36">•</span>' : '') +
      '<span>&#127919; Sessions: ' + total + '</span>';
    bar.onclick = showDashboard;
  };

  const showDashboard = () => {
    const existing = document.getElementById('ek-dashboard-modal');
    if (existing) { existing.remove(); return; }

    const d = load();
    if (!d.sessions.length) return;

    const streak = getStreak();
    const best = getBest();
    const total = getTotal();

    // Last 10 sessions, chronological for chart, reversed for list
    const chartSessions = d.sessions.slice(-10);
    const listSessions  = d.sessions.slice(-10).reverse();

    // Bar chart
    const maxH = 52;
    const bars = chartSessions.map(s => {
      const h = Math.max(6, Math.round((s.score / 10) * maxH));
      const color = s.score >= 7 ? '#40c770' : s.score >= 5 ? '#ffb300' : '#ff6b6b';
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">' +
        '<div style="font-size:10px;color:#9aa4b2;font-weight:700">' + s.score + '</div>' +
        '<div style="width:100%;height:' + h + 'px;background:' + color + ';border-radius:3px 3px 0 0"></div>' +
        '</div>';
    }).join('');

    // Session rows
    const rows = listSessions.map(s => {
      const scoreColor = s.score >= 7 ? '#40c770' : s.score >= 5 ? '#ffb300' : '#ff6b6b';
      const charRaw = s.characterId || 'sofia';
      const charLabel = charRaw.charAt(0).toUpperCase() + charRaw.slice(1).replace(/_/g, ' ');
      const scLabel = (s.scenarioKey || 'session').replace(/_/g, ' ');
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #23252e">' +
        '<div style="background:' + scoreColor + ';color:#000;font-weight:800;font-size:14px;border-radius:7px;' +
        'width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + s.score + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;color:#e9ecf1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        charLabel + ' &mdash; ' + scLabel + '</div>' +
        '<div style="font-size:11px;color:#9aa4b2;margin-top:1px">' + (s.date || '') + '</div>' +
        '</div></div>';
    }).join('');

    // Stat chips
    const chips =
      (streak > 0 ? '<div style="flex:1;background:#1d2026;border:1px solid #2b2e36;border-radius:10px;padding:10px 6px;text-align:center">' +
        '<div style="font-size:18px">&#128293;</div><div style="font-size:17px;font-weight:800;color:#ffb300;margin:2px 0">' + streak + '</div>' +
        '<div style="font-size:10px;color:#9aa4b2;text-transform:uppercase">Day streak</div></div>' : '') +
      (best !== null ? '<div style="flex:1;background:#1d2026;border:1px solid #2b2e36;border-radius:10px;padding:10px 6px;text-align:center">' +
        '<div style="font-size:18px">&#127942;</div><div style="font-size:17px;font-weight:800;color:#40c770;margin:2px 0">' + best + '/10</div>' +
        '<div style="font-size:10px;color:#9aa4b2;text-transform:uppercase">Best</div></div>' : '') +
      '<div style="flex:1;background:#1d2026;border:1px solid #2b2e36;border-radius:10px;padding:10px 6px;text-align:center">' +
      '<div style="font-size:18px">&#127919;</div><div style="font-size:17px;font-weight:800;color:#9ec1ff;margin:2px 0">' + total + '</div>' +
      '<div style="font-size:10px;color:#9aa4b2;text-transform:uppercase">Sessions</div></div>';

    const modal = document.createElement('div');
    modal.id = 'ek-dashboard-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML =
      '<div style="background:#1a1c22;border:1px solid #2b2e36;border-radius:16px;width:100%;max-width:420px;max-height:88vh;overflow-y:auto;padding:20px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<div style="font-size:18px;font-weight:800;color:#e9ecf1">Your Progress</div>' +
          '<button id="ek-dash-close" style="background:none;border:none;color:#9aa4b2;font-size:22px;cursor:pointer;padding:0;line-height:1">&times;</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:20px">' + chips + '</div>' +
        (chartSessions.length >= 2 ?
          '<div style="margin-bottom:20px">' +
            '<div style="font-size:11px;color:#9aa4b2;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">' +
            'Last ' + chartSessions.length + ' sessions</div>' +
            '<div style="display:flex;align-items:flex-end;gap:5px;height:72px;border-bottom:2px solid #2b2e36;padding-bottom:0">' + bars + '</div>' +
          '</div>' : '') +
        '<div>' +
          '<div style="font-size:11px;color:#9aa4b2;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Recent sessions</div>' +
          rows +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.getElementById('ek-dash-close').addEventListener('click', () => modal.remove());
  };

  const getHistoryHTML = () => {
    const scores = getLast(5);
    if (!scores.length) return '';
    const improvement = getImprovement();
    const bars = scores.map(s => {
      const h = Math.round(4 + (s / 10) * 16);
      const color = s >= 7 ? '#40c770' : s >= 5 ? '#ffb300' : '#ff6b6b';
      return '<div style="width:8px;height:' + h + 'px;background:' + color + ';border-radius:2px;align-self:flex-end"></div>';
    }).join('');
    const scoreList = scores.join(' → ');
    const improvText = improvement !== null && improvement !== 0
      ? '<span style="color:' + (improvement > 0 ? '#40c770' : '#ff6b6b') + ';font-weight:700">' +
        (improvement > 0 ? '+' : '') + improvement + ' since you started</span>'
      : '';
    return '<div style="background:#161820;border:1px solid #2b2e3a;border-radius:10px;padding:12px;margin-bottom:10px">' +
      '<div style="color:#9aa4b2;font-size:11px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Your progress</div>' +
      '<div style="display:flex;align-items:flex-end;gap:4px;margin-bottom:6px">' + bars + '</div>' +
      '<div style="color:#cfd6e4;font-size:12px">' + scoreList +
      (improvText ? ' &nbsp;' + improvText : '') + '</div>' +
      '</div>';
  };

  return { recordSession, refreshStatBar, refreshStreakBadge, getHistoryHTML, getStreak, getBest, getTotal, showDashboard };
})();

/* ===== Certification ===== */
// Tiers are computed on-the-fly from existing ek-progress-v1 data (no new storage key).
// To adjust thresholds, edit the TIERS array — everything else derives from it.
const Certification = (() => {
  const TIERS = [
    { id: 'master', minSessions: 7, minAvg: 8.5, label: 'Master', emoji: '👑', color: '#e8c84a' },
    { id: 'gold',   minSessions: 5, minAvg: 7.5, label: 'Gold',   emoji: '🥇', color: '#ffb300' },
    { id: 'silver', minSessions: 5, minAvg: 6.5, label: 'Silver', emoji: '🥈', color: '#9aa4b2' },
    { id: 'bronze', minSessions: 3, minAvg: 5.0, label: 'Bronze', emoji: '🥉', color: '#c97b40' },
  ];
  const BRONZE = TIERS[TIERS.length - 1];

  function getSessionsFor(characterId) {
    try {
      const d = JSON.parse(localStorage.getItem('ek-progress-v1')) || {};
      return ((d.sessions || []).filter(s => (s.characterId || 'sofia') === characterId));
    } catch { return []; }
  }

  // Returns the highest earned tier object, or null.
  function getTier(characterId) {
    const all = getSessionsFor(characterId);
    if (!all.length) return null;
    for (const t of TIERS) {
      if (all.length < t.minSessions) continue;
      const recent = all.slice(-t.minSessions);
      const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
      if (avg >= t.minAvg) return t;
    }
    return null;
  }

  // Small colored pill for the avatar picker — empty string if no tier yet.
  function getBadgeHTML(characterId) {
    const t = getTier(characterId);
    if (!t) return '';
    return `<div style="display:inline-flex;align-items:center;gap:3px;background:rgba(0,0,0,0.45);` +
      `border:1px solid ${t.color}55;border-radius:999px;padding:2px 8px;` +
      `font-size:11px;font-weight:700;color:${t.color};margin-top:5px;letter-spacing:.03em">` +
      `${t.emoji} ${t.label}</div>`;
  }

  // One-line status for the feedback card — shows tier earned or nudge toward Bronze.
  function getProgressHTML(characterId) {
    const all = getSessionsFor(characterId);
    const t = getTier(characterId);
    const name = characterId.charAt(0).toUpperCase() + characterId.slice(1).replace(/_/g, ' ').replace('office', '').trim();

    if (t) {
      return `<div style="background:#161820;border:1px solid ${t.color}33;border-radius:8px;` +
        `padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px">` +
        `<span style="font-size:18px">${t.emoji}</span>` +
        `<div><div style="font-size:12px;font-weight:700;color:${t.color};letter-spacing:.03em">${t.label} — ${name}</div>` +
        `<div style="font-size:11px;color:#9aa4b2;margin-top:1px">${all.length} session${all.length===1?'':'s'} · avg ${(all.slice(-t.minSessions).reduce((s,r)=>s+r.score,0)/t.minSessions).toFixed(1)}/10</div>` +
        `</div></div>`;
    }

    // Progress toward Bronze
    const needed = BRONZE.minSessions - all.length;
    if (needed > 0) {
      return `<div style="font-size:12px;color:#9aa4b2;margin-bottom:10px;padding:0 2px">` +
        `🥉 ${needed} more session${needed===1?'':'s'} with ${name} to reach Bronze</div>`;
    }
    const recent = all.slice(-BRONZE.minSessions);
    const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
    if (avg < BRONZE.minAvg) {
      return `<div style="font-size:12px;color:#9aa4b2;margin-bottom:10px;padding:0 2px">` +
        `🥉 Bronze needs avg ${BRONZE.minAvg} over ${BRONZE.minSessions} sessions — current avg: ${avg.toFixed(1)}</div>`;
    }
    return '';
  }

  return { getTier, getBadgeHTML, getProgressHTML };
})();


/* ===== Daily Session Limit ===== */
// Three-layer gate: localStorage + FingerprintJS + server-side IP (in api/character.js + api/tts.js)
// Dev bypass: visit ?dev=YOUR_SECRET once — sets a 1-year cookie, unlimited on that device forever
// Reset dev cookie: visit ?resetdev=true

const DailyLimit = (() => {
  const LIMIT = 3;
  const KEY = 'ek-daily-v1';
  const DEV_COOKIE = 'ek_dev_bypass';
  const DEV_KEY_STORAGE = 'ek-dev-key';
  const STRIPE_CUS_KEY = 'ek-stripe-cus';

  // ── Cookie helpers ──────────────────────────────────────────────────────
  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/;SameSite=Strict';
  }
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\s*' + name + '\s*=\s*([^;]+)');
    return v ? v.pop() : null;
  }
  function deleteCookie(name) {
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
  }

  // ── Handle ?dev=SECRET, ?resetdev=true, ?stripe_session=xxx in URL ────────
  async function handleURLParams() {
    const params = new URLSearchParams(window.location.search);
    const devKey = params.get('dev');
    const reset = params.get('resetdev');
    const stripeSession = params.get('stripe_session');

    if (reset === 'true') {
      deleteCookie(DEV_COOKIE);
      localStorage.removeItem(DEV_KEY_STORAGE);
      console.log('[DailyLimit] Dev bypass cleared.');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (devKey) {
      setCookie(DEV_COOKIE, devKey, 365);
      localStorage.setItem(DEV_KEY_STORAGE, devKey);
      console.log('[DailyLimit] Dev bypass activated on this device.');
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (stripeSession && stripeSession.startsWith('cs_')) {
      window.history.replaceState({}, '', window.location.pathname);
      try {
        const r = await fetch(`/api/verify-payment?session_id=${stripeSession}`);
        const data = await r.json();
        if (data.active && data.customerId) {
          setStripeCustomer(data.customerId);
          console.log('[DailyLimit] Pro subscription activated:', data.customerId);
          if (window._ekTrack) _ekTrack('subscription_activated', { plan: new URLSearchParams(window.location.search).get('plan') || 'pro', ...(window._ekUtm ? _ekUtm() : {}) });
          const banner = document.createElement('div');
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ffb300;color:#000;text-align:center;padding:12px;font-weight:700;font-size:15px;z-index:99999;cursor:pointer';
          banner.textContent = 'Welcome to Ozmeva Pro! Unlimited sessions activated.';
          banner.onclick = () => banner.remove();
          document.body.prepend(banner);
          setTimeout(() => banner.remove(), 5000);
        }
      } catch (e) {
        console.error('[DailyLimit] Stripe verify error:', e.message);
      }
    }
  }

  // ── Check if dev bypass is active on this device ────────────────────────
  function isDevBypass() {
    return !!(getCookie(DEV_COOKIE) || localStorage.getItem(DEV_KEY_STORAGE));
  }

  // ── Get dev key for API header ───────────────────────────────────────────
  function getDevKey() {
    return getCookie(DEV_COOKIE) || localStorage.getItem(DEV_KEY_STORAGE) || null;
  }

  // ── Stripe customer helpers ──────────────────────────────────────────────
  function getStripeCustomer() {
    return localStorage.getItem(STRIPE_CUS_KEY) || null;
  }
  function setStripeCustomer(customerId) {
    if (customerId) localStorage.setItem(STRIPE_CUS_KEY, customerId);
  }
  function isProSubscriber() {
    return !!getStripeCustomer();
  }

  // ── localStorage session counter ─────────────────────────────────────────
  function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getLocalCount() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY)) || {};
      return d.date === getTodayKey() ? (d.count || 0) : 0;
    } catch { return 0; }
  }

  function incrementLocal() {
    try {
      const count = getLocalCount() + 1;
      localStorage.setItem(KEY, JSON.stringify({ date: getTodayKey(), count }));
      return count;
    } catch { return 1; }
  }

  // ── FingerprintJS check (async, best-effort) ─────────────────────────────
  async function getFingerprintCount() {
    try {
      if (typeof FingerprintJS === 'undefined') return 0;
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      const fpKey = 'ek-fp-' + getTodayKey() + '-' + result.visitorId;
      const count = parseInt(localStorage.getItem(fpKey) || '0', 10);
      localStorage.setItem(fpKey, String(count + 1));
      return count;
    } catch { return 0; }
  }

  // ── Show paywall overlay ──────────────────────────────────────────────────
  function showPaywall() {
    if (window._ekTrack) _ekTrack('paywall_seen', window._ekUtm ? _ekUtm() : {});
    const existing = document.getElementById('ek-paywall');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ek-paywall';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.93);z-index:99999',
      'display:flex;flex-direction:column;align-items:center;justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;text-align:center'
    ].join(';');

    overlay.innerHTML = `
      <svg width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:20px;display:block;margin-left:auto;margin-right:auto">
        <path d="M12 24V17C12 9.268 17.373 3 24 3C30.627 3 36 9.268 36 17V24" stroke="#ffb300" stroke-width="3" stroke-linecap="round"/>
        <rect x="4" y="24" width="40" height="29" rx="7" fill="rgba(255,179,0,0.1)" stroke="#ffb300" stroke-width="2"/>
        <circle cx="24" cy="37" r="4" fill="#ffb300"/>
        <path d="M24 41V47" stroke="#ffb300" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div style="color:#fff;font-size:24px;font-weight:800;margin-bottom:10px;letter-spacing:-0.5px">
        You've used your 2 free sessions
      </div>
      <div style="color:#9aa4b2;font-size:15px;max-width:360px;margin-bottom:28px;line-height:1.6">
        Come back tomorrow for 2 more — or unlock unlimited practice below.
      </div>
      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;justify-content:center">
        <div style="background:#1a1f2e;border:1px solid #2a3040;border-radius:16px;padding:20px 24px;min-width:200px;text-align:center">
          <div style="color:#ffb300;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Pro</div>
          <div style="color:#fff;font-size:22px;font-weight:800;margin-bottom:2px">$19.99<span style="font-size:13px;font-weight:400;color:#9aa4b2">/month</span></div>
          <div style="color:#9aa4b2;font-size:12px;margin-bottom:16px">60 sessions/month</div>
          <button class="ek-plan-btn" data-plan="pro"
            style="background:#ffb300;color:#000;font-size:14px;font-weight:800;border:none;
                   padding:11px 28px;border-radius:999px;cursor:pointer;width:100%;transition:opacity 0.2s">
            Choose Pro
          </button>
        </div>
        <div style="background:#1a1f2e;border:2px solid #ffb300;border-radius:16px;padding:20px 24px;min-width:200px;text-align:center;position:relative">
          <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#ffb300;color:#000;font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:0.5px">Best value</div>
          <div style="color:#ffb300;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Elite</div>
          <div style="color:#fff;font-size:22px;font-weight:800;margin-bottom:2px">$39.99<span style="font-size:13px;font-weight:400;color:#9aa4b2">/month</span></div>
          <div style="color:#9aa4b2;font-size:12px;margin-bottom:16px">200 sessions/month</div>
          <button class="ek-plan-btn" data-plan="elite"
            style="background:#ffb300;color:#000;font-size:14px;font-weight:800;border:none;
                   padding:11px 28px;border-radius:999px;cursor:pointer;width:100%;transition:opacity 0.2s">
            Choose Elite
          </button>
        </div>
      </div>
      <div style="color:#555;font-size:12px;margin-bottom:8px">No contract · Cancel anytime</div>
      <div style="color:#444;font-size:11px;margin-bottom:12px">By subscribing you agree to our <a href="/terms" style="color:#6b7685;text-decoration:underline" target="_blank">Terms of Service</a> and <a href="/privacy" style="color:#6b7685;text-decoration:underline" target="_blank">Privacy Policy</a></div>
      <div style="color:#666;font-size:13px;cursor:pointer;text-decoration:underline"
           onclick="document.getElementById('ek-paywall').remove()">
        Come back tomorrow
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.ek-plan-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const plan = this.dataset.plan;
        this.textContent = 'Loading...';
        this.style.opacity = '0.7';
        this.disabled = true;
        if (window._ekTrack) _ekTrack('checkout_started', { plan, ...(window._ekUtm ? _ekUtm() : {}) });
        try {
          const utm = window._ekUtm ? _ekUtm() : {};
          const r = await fetch('/api/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan, utm }),
          });
          const data = await r.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            throw new Error(data.error || 'No checkout URL returned');
          }
        } catch (e) {
          console.error('[Paywall] Checkout error:', e.message);
          this.textContent = plan === 'elite' ? 'Choose Elite' : 'Choose Pro';
          this.style.opacity = '1';
          this.disabled = false;
        }
      });
    });
  }

  // ── Main check — call before starting a practice session ─────────────────
  async function canPlay() {
    await handleURLParams();

    if (isDevBypass()) return true;

    try {
      const r = await fetch('/api/check-session');
      const data = await r.json();
      if (!data.allowed) {
        showPaywall();
        return false;
      }
    } catch {
      // network error — fail open
    }
    return true;
  }

  // ── Inject auth headers into all API fetch calls via monkey-patch ─────────
  // Adds x-dev-key (dev bypass), x-stripe-customer (paid subscriber), and
  // Authorization: Bearer <jwt> (test-account bypass — verified server-side via Supabase JWT).
  function patchFetch() {
    const _originalFetch = window.fetch;
    window.fetch = async function(url, options = {}) {
      if (typeof url === 'string' && (
        url.includes('/api/character') ||
        url.includes('/api/coach') ||
        url.includes('/api/drill-eval') ||
        url.includes('/api/tts') ||
        url.includes('/api/count-session') ||
        url.includes('/api/check-session')
      )) {
        const devKey    = getDevKey();
        const stripeCus = getStripeCustomer();
        const jwt = window.EkAuth?.getToken ? await window.EkAuth.getToken() : null;
        if (devKey || stripeCus || jwt) {
          options.headers = options.headers || {};
          const isHeadersObj = options.headers instanceof Headers;
          if (devKey) {
            if (isHeadersObj) options.headers.set('x-dev-key', devKey);
            else options.headers['x-dev-key'] = devKey;
          }
          if (stripeCus) {
            if (isHeadersObj) options.headers.set('x-stripe-customer', stripeCus);
            else options.headers['x-stripe-customer'] = stripeCus;
          }
          if (jwt) {
            if (isHeadersObj) options.headers.set('Authorization', `Bearer ${jwt}`);
            else options.headers['Authorization'] = `Bearer ${jwt}`;
          }
        }
      }
      return _originalFetch.call(this, url, options);
    };
  }

  async function countSession(exchangeCount) {
    if (isDevBypass()) return;
    try {
      await fetch('/api/count-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchangeCount }),
      });
    } catch {}
  }

  return { canPlay, isDevBypass, isProSubscriber, patchFetch, handleURLParams, countSession };
})();

// Patch fetch immediately so dev key is always sent
DailyLimit.patchFetch();
// Handle URL params on load
DailyLimit.handleURLParams();

/* ===== Caption Overlay ===== */
// When Sofia speaks: play speaking video + show caption bar over her mouth
// When user speaks: play idle video + hide caption bar
// This creates the illusion of natural conversation without lip sync

const Caption = (() => {
  let overlayEl = null;
  let hideTimer = null;

  function getOrCreateOverlay() {
    if (overlayEl) return overlayEl;
    const frame = document.getElementById('stageFrame');
    if (!frame) return null;

    const el = document.createElement('div');
    el.id = 'ek-caption';
    el.style.cssText = [
      'position:absolute',
      'bottom:0',
      'left:0',
      'right:0',
      'z-index:10',
      'width:100%',
      'box-sizing:border-box',
      'background:rgba(0,0,0,0.80)',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
      'border-top:1px solid rgba(255,200,0,0.18)',
      'padding:10px 20px 12px',
      'text-align:center',
      'color:#FFD700',
      'font-size:15px',
      'font-weight:700',
      'line-height:1.45',
      'letter-spacing:0.01em',
      'text-shadow:0 1px 4px rgba(0,0,0,0.9)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'opacity:0',
      'transition:opacity 0.2s ease',
      'pointer-events:none',
    ].join(';');

    frame.style.position = 'relative';
    frame.appendChild(el);
    overlayEl = el;
    return el;
  }

  function show(text) {
    const el = getOrCreateOverlay();
    if (!el) return;
    clearTimeout(hideTimer);
    el.textContent = text;
    el.style.opacity = '1';
  }

  function hide() {
    if (!overlayEl) return;
    overlayEl.style.opacity = '0';
    hideTimer = setTimeout(() => {
      if (overlayEl) overlayEl.textContent = '';
    }, 250);
  }

  return { show, hide };
})();


/* ===== TRACE Signal Cue Overlay ===== */
// Amber italic pill anchored top-center inside stageFrame.
// Only shown during lesson5 practice when Sofia emits a parenthetical stage direction.
// Separate from the caption (bottom) so dialogue and signal never occupy the same visual slot.
const TraceCue = (() => {
  let overlayEl = null;
  let fadeTimer = null;

  function getOrCreateOverlay() {
    if (overlayEl) return overlayEl;
    const frame = document.getElementById('stageFrame');
    if (!frame) return null;
    const el = document.createElement('div');
    el.id = 'ek-trace-cue';
    el.style.cssText = [
      'position:absolute',
      'bottom:80px',
      'left:50%',
      'transform:translateX(-50%) translateY(0)',
      'z-index:11',
      'max-width:calc(100% - 48px)',
      'text-align:center',
      'pointer-events:none',
      'opacity:0',
    ].join(';');
    frame.style.position = 'relative';
    frame.appendChild(el);
    overlayEl = el;
    return el;
  }

  function show(text) {
    const el = getOrCreateOverlay();
    if (!el) return;
    clearTimeout(fadeTimer);
    // Snap to hidden+shifted before setting innerHTML so there's no stale-text flash
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(10px)';
    el.innerHTML = '<span style="' + [
      'display:inline-block',
      'padding:10px 28px',
      'background:rgba(0,0,0,0.95)',
      'border:1px solid rgba(210,180,120,0.35)',
      'border-radius:8px',
      'box-shadow:0 0 20px rgba(210,180,120,0.12),0 4px 16px rgba(0,0,0,0.80)',
      'font-size:13.5px',
      'font-style:italic',
      'font-weight:300',
      'color:#d4b882',
      'letter-spacing:0.035em',
      'line-height:1.55',
    ].join(';') + '">' + text + '</span>';
    // Double RAF so transition fires after the browser paints with the new content
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    }));
    fadeTimer = setTimeout(() => {
      if (overlayEl) {
        overlayEl.style.transition = 'opacity 1.0s ease-in, transform 1.0s ease-in';
        overlayEl.style.opacity = '0';
        overlayEl.style.transform = 'translateX(-50%) translateY(6px)';
      }
    }, 4500);
  }

  function hide() {
    clearTimeout(fadeTimer);
    if (overlayEl) {
      overlayEl.style.transition = 'opacity 0.3s ease-in';
      overlayEl.style.opacity = '0';
    }
  }

  return { show, hide };
})();


/* ===== Ambient audio ===== */
const AmbientAudio = (() => {
  const R2 = 'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ambient/';
  const VOLUME = 0.08; // clearly subordinate to TTS and voice input

  // Explicit map for Wave 1+2 scenarios
  const CATEGORY_MAP = {
    beach:        'beach',
    bar:          'bar',
    museum:       'museum',
    gym:          'gym',
    bookstore:    'bookstore',
    street:       'street',
    wedding:      'wedding',
    rooftop:      'rooftop',
    house_party:  'party',
    coffee_shop:  'cafe',
    art_gallery:  'gallery',
    yoga_studio:  'yoga',
    airport:      'airport',
    supermarket:  'supermarket',
    office_lobby: 'office',
    train:        'train',
  };

  // Derive category for Wave 3 / future scenarios from key name
  function deriveCategory(key) {
    if (/beach|ocean|surf/.test(key))                  return 'beach';
    if (/bar|club|wine|jazz|pub|lounge/.test(key))     return 'bar';
    if (/cafe|coffee|brunch|bakery/.test(key))         return 'cafe';
    if (/park|garden|trail|outdoor/.test(key))         return 'park';
    if (/market/.test(key))                            return 'street';
    if (/gym|climb|yoga|dance|fitness/.test(key))      return 'gym';
    if (/museum|library|gallery|exhibit/.test(key))    return 'museum';
    if (/airport|gate|terminal/.test(key))             return 'airport';
    if (/train|station/.test(key))                     return 'train';
    if (/office|interview|work/.test(key))             return 'office';
    if (/party|pool_party/.test(key))                  return 'party';
    if (/book|shop|store/.test(key))                   return 'bookstore';
    if (/rooftop|terrace/.test(key))                   return 'rooftop';
    if (/street|skate/.test(key))                      return 'street';
    return 'cafe'; // neutral fallback
  }

  function play(scenarioKey) {
    const cat = CATEGORY_MAP[scenarioKey] || deriveCategory(scenarioKey);
    const el = document.createElement('audio');
    el.loop = true;
    el.volume = VOLUME;
    el.src = `${R2}${cat}.mp3`;
    // Silently absorb load errors — ambient is atmosphere, not a requirement
    el.onerror = () => { try { el.remove(); } catch {} };
    document.body.appendChild(el);
    el.play().catch(() => {}); // ignore autoplay policy rejections
  }

  return { play };
})();



/* ===== Avatar sets ===== */
const AVATAR_SETS = [
  { id:'sofia',       label:'Sofia',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sofia_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sofia_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sofia_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sofia_idle.mp4',    vibe:'Direct & self-contained',  scenario:'Beach' },
  { id:'isabelle',    label:'Isabelle', thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Isabelle_thumb.jpg', maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Isabelle_speaking.mp4', maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Isabelle_idle.mp4', danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Isabelle_idle.mp4', vibe:'Intellectual & curious',   scenario:'Museum' },
  { id:'ava',         label:'Ava',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Ava_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Ava_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Ava_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Ava_idle.mp4',      vibe:'Sharp & direct',           scenario:'Bar',  hidden: true },
  { id:'zoe',         label:'Zoe',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zoe_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zoe_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zoe_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zoe_idle.mp4',      vibe:'Direct & no-nonsense',     scenario:'Gym' },
  { id:'nadia',       label:'Nadia',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Nadia.jpg',          maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nadia_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nadia_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nadia_idle.mp4',    vibe:'Warm & bookish',           scenario:'Bookstore' },
  { id:'julia',       label:'Julia',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/julia_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/julia_mary.mp4',        maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/julia_daniel.mp4',  danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/julia_daniel.mp4',  vibe:'Mysterious & confident',   scenario:'Street' },
  // ── Wave 2 — May 2026 — replace _thumb.jpg/_speaking.mp4/_idle.mp4 with real R2 URLs after HeyGen ──
  { id:'sanna',       label:'Sanna',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Sanna_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sanna_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sanna_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sanna_idle.mp4',    vibe:'Sharp & composed',         scenario:'Rooftop' },
  { id:'sarah',       label:'Sarah',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Sarah_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sarah_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sarah_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sarah_idle.mp4',    vibe:'Warm & guarded',           scenario:'House Party' },
  { id:'anna',        label:'Anna',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Anna_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/anna_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/anna_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/anna_idle.mp4',     vibe:'Creative & deflects',      scenario:'Coffee Shop' },
  { id:'leila',       label:'Leila',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Leila_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/leila_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/leila_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/leila_idle.mp4',    vibe:'Quiet & present',          scenario:'Art Gallery' },
  { id:'fatou',       label:'Fatou',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Fatou_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fatou_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fatou_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fatou_idle.mp4',    vibe:'Direct & honest',          scenario:'Yoga Studio' },
  { id:'elena',       label:'Elena',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Elena_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elena_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elena_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elena_idle.mp4',    vibe:'Witty & bantery',          scenario:'Airport' },
  { id:'eden',        label:'Eden',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Eden_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/eden_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/eden_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/eden_idle.mp4',     vibe:'Warm & straight-talking',  scenario:'Supermarket' },
  { id:'maya_office', label:'Maya',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Maya_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/maya_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/maya_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/maya_idle.mp4',     vibe:'Grounded & sharp',         scenario:'Office Lobby' },
  { id:'erika',       label:'Erika',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/Erika_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/erika_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/erika_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/erika_idle.mp4',    vibe:'Chaotic & fun',            scenario:'Train' },
  // ── Wave 3 — June 2026 ──
  { id:'camille',  label:'Camille',   thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/camille_thumb.jpg',   maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/camille_speaking.mp4',   maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/camille_idle.mp4',   danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/camille_idle.mp4',   vibe:'Warm & sideways',          scenario:'Farmers Market' },
  { id:'priya',    label:'Priya',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/priya_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/priya_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/priya_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/priya_idle.mp4',     vibe:'Sharp & risk-aware',       scenario:'Rooftop Pool' },
  { id:'valentina',label:'Valentina', thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/valentina_thumb.jpg', maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/valentina_speaking.mp4', maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/valentina_idle.mp4', danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/valentina_idle.mp4', vibe:'Elegant & dangerous',      scenario:'Wine Bar' },
  { id:'mei',      label:'Mei',       thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/mei_thumb.jpg',       maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/mei_speaking.mp4',       maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/mei_idle.mp4',       danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/mei_idle.mp4',       vibe:'Playful & surgical',       scenario:'Night Market' },
  { id:'amara',    label:'Amara',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/amara_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/amara_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/amara_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/amara_idle.mp4',     vibe:'Still & charged',          scenario:'Dance Studio' },
  { id:'ingrid',   label:'Ingrid',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ingrid_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ingrid_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ingrid_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ingrid_idle.mp4',    vibe:'Dry & fast',               scenario:'Running Trail' },
  { id:'solene',   label:'Solène',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/solene_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/solene_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/solene_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/solene_idle.mp4',    vibe:'Romantic & testing',       scenario:'Jazz Bar' },
  { id:'keiko',    label:'Keiko',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/keiko_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/keiko_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/keiko_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/keiko_idle.mp4',     vibe:'Quiet & conserved',        scenario:'Cherry Blossoms' },
  { id:'rania',    label:'Rania',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/rania_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/rania_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/rania_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/rania_idle.mp4',     vibe:'Warm & relentless',        scenario:'Rooftop Terrace' },
  { id:'bianca',   label:'Bianca',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bianca_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bianca_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bianca_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bianca_idle.mp4',    vibe:'High-energy & real',       scenario:'Pool Party' },
  { id:'chloe',    label:'Chloe',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/chloe_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/chloe_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/chloe_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/chloe_idle.mp4',     vibe:'Intense & deadpan',        scenario:'University Library', hidden: true },
  { id:'nour',     label:'Nour',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nour_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nour_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nour_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nour_idle.mp4',      vibe:'Warm & principled',        scenario:'Spice Market' },
  { id:'astrid',   label:'Astrid',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/astrid_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/astrid_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/astrid_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/astrid_idle.mp4',    vibe:'Competence-first',         scenario:'Climbing Wall' },
  { id:'layla',    label:'Layla',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/layla_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/layla_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/layla_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/layla_idle.mp4',     vibe:'Warm & radar-sharp',       scenario:'Sunday Brunch' },
  { id:'ines',     label:'Inès',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ines_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ines_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ines_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ines_idle.mp4',      vibe:'Observes everything',      scenario:'Photo Exhibit' },
  { id:'zara',     label:'Zara',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zara_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zara_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zara_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zara_idle.mp4',      vibe:'Authentic & cool',         scenario:'Skate Park' },
  { id:'talia',    label:'Talia',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/talia_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/talia_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/talia_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/talia_idle.mp4',     vibe:'Grounded & direct',        scenario:'Cooking Class' },
  { id:'miriam',   label:'Miriam',    thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/miriam_thumb.jpg',    maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/miriam_speaking.mp4',    maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/miriam_idle.mp4',    danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/miriam_idle.mp4',    vibe:'Formidable & dry',         scenario:'Book Fair' },
  { id:'suki',     label:'Suki',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/suki_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/suki_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/suki_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/suki_idle.mp4',      vibe:'Still & unexpected',       scenario:'Flower Shop' },
  { id:'cara',     label:'Cara',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cara_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cara_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cara_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cara_idle.mp4',      vibe:'Direct & warm',            scenario:'Dog Park' },
  { id:'elif',     label:'Elif',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elif_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elif_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elif_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/elif_idle.mp4',      vibe:'Unhurried & present',      scenario:'Hammam Spa' },
  { id:'aisha',    label:'Aisha',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/aisha_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/aisha_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/aisha_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/aisha_idle.mp4',     vibe:'Purposeful & warm',        scenario:'Community Garden' },
  { id:'fiona',    label:'Fiona',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fiona_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fiona_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fiona_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/fiona_idle.mp4',     vibe:'Music-first & dry',        scenario:'Record Shop' },
  { id:'celeste',  label:'Celeste',   thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/celeste_thumb.jpg',   maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/celeste_speaking.mp4',   maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/celeste_idle.mp4',   danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/celeste_idle.mp4',   vibe:'Deep-time curious',        scenario:'Observatory' },
  { id:'naomi',    label:'Naomi',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/naomi_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/naomi_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/naomi_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/naomi_idle.mp4',     vibe:'Post-show & open',         scenario:'Jazz Club' },
  { id:'zola',     label:'Zola',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zola_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zola_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zola_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/zola_idle.mp4',      vibe:'Sees in frames',           scenario:'Rooftop Sunset' },
  { id:'imani',    label:'Imani',     thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/imani_thumb.jpg',     maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/imani_speaking.mp4',     maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/imani_idle.mp4',     danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/imani_idle.mp4',     vibe:'Poet & sharp',             scenario:'Open Mic' },
  { id:'nia',      label:'Nia',       thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nia_thumb.jpg',       maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nia_speaking.mp4',       maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nia_idle.mp4',       danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/nia_idle.mp4',       vibe:'Artist & watchful',        scenario:'Art Studio' },
  { id:'cleo',     label:'Cleo',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cleo_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cleo_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cleo_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/cleo_idle.mp4',      vibe:'Ocean-grounded',           scenario:'Beachside Cafe' },
  { id:'sage',     label:'Sage',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sage_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sage_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sage_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/sage_idle.mp4',      vibe:'Quiet & deep',             scenario:'Bookshop' },
  { id:'kaia',     label:'Kaia',      thumb:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/kaia_thumb.jpg',      maryVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/kaia_speaking.mp4',      maryIdleVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/kaia_idle.mp4',      danielVideo:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/kaia_idle.mp4',      vibe:'Always in motion',         scenario:'Airport Gate' },
];

const AVATARS = {
  Daniel:      { type:'video', src:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bella9.mp4' },
  Mary:        { type:'video', src:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bella1.mp4' },
  Ryan:        { type:'orb' },
  User_Prompt: { type:'video', src:'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/bella9.mp4' },
};

function applyAvatarSet(set) {
  if (!set) return;
  // Mary defaults to idle video — speaking video only loads during speech
  if (set.maryIdleVideo) AVATARS.Mary.src = set.maryIdleVideo;
  else if (set.maryVideo) AVATARS.Mary.src = set.maryVideo;
  if (set.danielVideo) { AVATARS.Daniel.src = set.danielVideo; AVATARS.User_Prompt.src = set.danielVideo; }
  // Store speaking video separately for use during speech
  AVATARS._marySpeakingVideo = set.maryVideo || null;
  AVATARS._maryIdleVideo = set.maryIdleVideo || set.danielVideo || null;

  // Preload speaking video in background to eliminate flicker on first speech
  if (set.maryVideo && set.maryVideo !== set.maryIdleVideo) {
    const preload = document.createElement('video');
    preload.src = set.maryVideo;
    preload.preload = 'auto';
    preload.muted = true;
    preload.style.display = 'none';
    preload.load();
    // Remove after preload to avoid memory leak
    preload.oncanplaythrough = () => { try { preload.remove(); } catch {} };
    document.body.appendChild(preload);
  }
  // Preload idle video — prevents 1-2s black screen on first speaking→idle transition
  // for avatars that have a separate maryIdleVideo (different from speaking video).
  const idleUrl = set.maryIdleVideo || set.danielVideo || null;
  if (idleUrl && idleUrl !== set.maryVideo) {
    const preloadIdle = document.createElement('video');
    preloadIdle.src = idleUrl;
    preloadIdle.preload = 'auto';
    preloadIdle.muted = true;
    preloadIdle.style.display = 'none';
    preloadIdle.load();
    preloadIdle.oncanplaythrough = () => { try { preloadIdle.remove(); } catch {} };
    document.body.appendChild(preloadIdle);
  }
}

/* ===== Stop everything ===== */
const __audioContexts = [];
if (typeof AudioContext !== 'undefined') {
  const Orig = AudioContext;
  window.AudioContext = function(...a) { const c=new Orig(...a); __audioContexts.push(c); return c; };
  window.AudioContext.prototype = Orig.prototype;
}

function stopEverything() {
  session++;
  try { document.querySelectorAll('audio').forEach(a=>{ try{a.muted=true;a.pause();a.src='';if(a.parentNode)a.parentNode.removeChild(a);}catch{} }); } catch {}
  try { if (typeof KokoroSpeech!=='undefined') KokoroSpeech.cancel(); } catch {}
  try { __audioContexts.forEach(c=>{ try{if(c.state==='running')c.suspend();}catch{} }); } catch {}
  if (rec) { try{rec.onresult=null;rec.onerror=null;rec.onend=null;rec.stop();}catch{}; rec=null; }
  if (listenTimer) { clearTimeout(listenTimer); listenTimer=null; }
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval=null; }
  hideMnemonicPill();
  // Coached Practice cleanup — dismiss any pending interrupt overlay and release pause gate
  try { document.getElementById('ek-coach-interrupt')?.remove(); } catch {}
  _pauseState.active = false;
  if (_pauseState.resolve) { _pauseState.resolve(); _pauseState.resolve = null; }
  _momentCheckGen++;       // invalidate any in-flight check so it can't fire after session ends
  _momentCheckPromise = null;
}

/* ===== Coached Practice helpers ===== */

function isCoachMode() {
  return localStorage.getItem('ozmeva_coached_mode') === '1';
}

// Waits for any in-flight moment check (already running during TTS), then blocks if an interrupt
// fired. Because the check is launched during character TTS playback, it should be resolved or
// nearly resolved by the time this runs — expected overhead is near-zero on production.
// Cap: if the check is still pending after 1200 ms, discard it via _momentCheckGen++ so it can
// never fire late on a future turn. NEVER touches the session counter.
async function waitIfPaused(mySession) {
  if (_momentCheckPromise) {
    const DISCARD_CAP_MS = 1200;
    const timedOut = await Promise.race([
      _momentCheckPromise.then(() => false),
      new Promise(r => setTimeout(() => r(true), DISCARD_CAP_MS)),
    ]);
    _momentCheckPromise = null;
    if (timedOut) _momentCheckGen++; // invalidate — the late-resolving check cannot fire
  }
  if (!_pauseState.active) return;
  await new Promise(resolve => {
    let id;
    const done = () => { clearInterval(id); resolve(); };
    _pauseState.resolve = done;
    id = setInterval(() => {
      if (mySession !== session) {
        _pauseState.active = false;
        _pauseState.resolve = null;
        done();
      }
    }, 50);
  });
}

// Fires the /api/coach-moment check. Launched during character TTS so it runs for free.
// Captures _momentCheckGen at call time — if the gen increments (waitIfPaused timed out or
// stopEverything ran) before the result arrives, the interrupt is discarded cleanly.
// Fails open on any error so the conversation always continues.
async function checkMoment(userSaid, charResponse, mySession) {
  const myGen = _momentCheckGen; // snapshot — checked again before firing interrupt
  const practiceFocus = localStorage.getItem('ozmeva_practice_focus') || 'free';
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    const r = await fetch('/api/coach-moment', {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userMessage:       userSaid,
        characterResponse: charResponse,
        practiceFocus,
        exchangeCount:     _exchangeCount,
        scenarioKey:       currentScenarioKey,
      }),
    });
    clearTimeout(t);
    if (!r.ok || mySession !== session || myGen !== _momentCheckGen) return;
    const data = await r.json();
    if (mySession !== session || myGen !== _momentCheckGen || !data.teachable) return;
    _interruptCount++;
    _pauseState.active = true;
    showCoachInterrupt(userSaid, charResponse, data);
  } catch { /* fail open — check timed out or errored; conversation continues */ }
}

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showCoachInterrupt(userLine, charLine, data) {
  document.getElementById('ek-coach-interrupt')?.remove();

  const ov = document.createElement('div');
  ov.id = 'ek-coach-interrupt';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(10,11,16,0.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box';

  ov.innerHTML = `
<div style="max-width:480px;width:100%;display:flex;flex-direction:column;gap:16px">
  <div style="display:flex;align-items:flex-start;gap:14px">
    <div style="width:44px;height:44px;border-radius:50%;background:#378ADD;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0">R</div>
    <div>
      <div style="color:#ffb300;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;margin-bottom:4px">Ryan — Coached Practice · ${_escHtml(data.skillName || data.skill)}</div>
      <div style="color:#e4e8f4;font-size:16px;font-weight:600;line-height:1.45">${_escHtml(data.coaching)}</div>
    </div>
  </div>

  <div style="background:#141620;border:1px solid #252836;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px">
    <div>
      <div style="color:#5a6280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">She reacted to your line</div>
      <div style="color:#7a849e;font-size:14px;font-style:italic">"${_escHtml(charLine.slice(0,160))}"</div>
    </div>
    <div style="border-top:1px solid #1e2132;padding-top:12px">
      <div style="color:#5a6280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Try this instead</div>
      <div style="color:#d4d9ec;font-size:15px;font-weight:600">"${_escHtml(data.betterLine)}"</div>
    </div>
  </div>

  <button id="ek-interrupt-retry" style="background:#ffb300;color:#000;border:none;border-radius:999px;padding:14px 32px;font-size:15px;font-weight:800;cursor:pointer;width:100%;transition:opacity .15s" onmouseover="this.style.opacity='.88'" onmouseout="this.style.opacity='1'">
    ↩ Try again from here
  </button>
  <button id="ek-interrupt-continue" style="background:transparent;color:#4a526e;border:none;font-size:13px;cursor:pointer;padding:4px;transition:color .15s" onmouseover="this.style.color='#8a93a8'" onmouseout="this.style.color='#4a526e'">
    Skip coaching — continue conversation
  </button>
</div>`;

  document.body.appendChild(ov);

  document.getElementById('ek-interrupt-retry').onclick    = () => resumeFromCoachInterrupt(true);
  document.getElementById('ek-interrupt-continue').onclick = () => resumeFromCoachInterrupt(false);
}

// doRewind=true: rolls back conversationHistory + exchangeCount to the snapshot taken before the bad turn.
// doRewind=false: continues from current state (coaching noted but not rewound).
function resumeFromCoachInterrupt(doRewind) {
  document.getElementById('ek-coach-interrupt')?.remove();
  if (doRewind && _turnSnapshot) {
    conversationHistory = _turnSnapshot.history.slice();
    _exchangeCount      = _turnSnapshot.exchangeCount;
  }
  _turnSnapshot = null;
  _pauseState.active = false;
  if (_pauseState.resolve) { _pauseState.resolve(); _pauseState.resolve = null; }
}

/* ===== Ryan orb ===== */
let _ryanOrbEl=null, _ryanOrbAnimFrame=null, _ryanOrbT=0;

function getRyanOrb() {
  if (_ryanOrbEl) return _ryanOrbEl;
  const div = document.createElement('div');
  div.id = 'ryan-orb';
  div.innerHTML = `
    <style>
      #ryan-orb{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:220px;gap:14px}
      #ryan-orb .ro-wrap{position:relative;width:140px;height:140px;display:flex;align-items:center;justify-content:center}
      #ryan-orb .ro-ring{position:absolute;border-radius:50%;border:1.5px solid #378ADD;opacity:0}
      #ryan-orb .ro-ring1{width:140px;height:140px} #ryan-orb .ro-ring2{width:165px;height:165px} #ryan-orb .ro-ring3{width:192px;height:192px}
      #ryan-orb .ro-orb{width:120px;height:120px;border-radius:50%;background:#378ADD;display:flex;align-items:center;justify-content:center;position:relative;z-index:2}
      #ryan-orb .ro-inner{width:82px;height:82px;border-radius:50%;background:#185FA5;display:flex;align-items:center;justify-content:center}
      #ryan-orb .ro-lbl{font-size:15px;font-weight:600;color:#B5D4F4;letter-spacing:.1em}
      #ryan-orb .ro-bars{display:flex;align-items:flex-end;gap:3px;height:32px}
      #ryan-orb .ro-bar{width:4px;background:#378ADD;border-radius:2px;min-height:4px}
    </style>
    <div class="ro-wrap">
      <div class="ro-ring ro-ring1" id="roR1"></div><div class="ro-ring ro-ring2" id="roR2"></div><div class="ro-ring ro-ring3" id="roR3"></div>
      <div class="ro-orb" id="roOrb"><div class="ro-inner"><span class="ro-lbl">R</span></div></div>
    </div>
    <div class="ro-bars" id="roBars"></div>`;
  const bars = div.querySelector('#roBars');
  for (let i=0;i<18;i++) { const b=document.createElement('div'); b.className='ro-bar'; b.style.height='4px'; bars.appendChild(b); }
  return div;
}

function ryanOrbSetState(state) {
  const orb=document.getElementById('ryan-orb'); if(!orb) return;
  cancelAnimationFrame(_ryanOrbAnimFrame); _ryanOrbT=0;
  const orbEl=orb.querySelector('#roOrb'), r1=orb.querySelector('#roR1'), r2=orb.querySelector('#roR2'), r3=orb.querySelector('#roR3'), bars=orb.querySelectorAll('.ro-bar');
  function tick() {
    _ryanOrbT+=0.08; const t=_ryanOrbT;
    if (state==='speaking') {
      const amp=0.5+0.5*Math.sin(t*1.2);
      bars.forEach((b,i)=>{ const w=Math.sin(t*2.5+i*0.5)*0.5+0.5; b.style.height=Math.round(6+w*22*amp)+'px'; b.style.background='#378ADD'; });
      orbEl.style.transform='scale('+(1+0.06*Math.sin(t*2.5)).toFixed(3)+')';
      r1.style.opacity=(0.25+0.25*Math.sin(t*1.8)).toFixed(3); r2.style.opacity=(0.15+0.15*Math.sin(t*1.8)).toFixed(3); r3.style.opacity=(0.08+0.08*Math.sin(t*1.8)).toFixed(3);
    } else if (state==='listening') {
      bars.forEach((b,i)=>{ b.style.height=Math.round(4+((Math.sin(t*1.2+i*0.4)*0.5+0.5))*9)+'px'; b.style.background='#9FE1CB'; });
      orbEl.style.transform='scale(1)'; r1.style.opacity='0.12'; r2.style.opacity='0'; r3.style.opacity='0';
    } else {
      bars.forEach(b=>{ b.style.height='4px'; b.style.background='#378ADD'; });
      orbEl.style.transform='scale(1)'; r1.style.opacity='0'; r2.style.opacity='0'; r3.style.opacity='0';
    }
    _ryanOrbAnimFrame=requestAnimationFrame(tick);
  }
  tick();
}

/* ===== Media ===== */
function setMediaForSpeaker(speaker) {
  const asset = AVATARS[speaker] || AVATARS.Ryan;
  const current = els.media;
  if (!current) return;

  if (asset.type==='orb') {
    if (current.id!=='ryan-orb') {
      if (current.tagName==='VIDEO') { try{current.pause();current.src='';}catch{} }
      const orbEl=getRyanOrb();
      current.replaceWith(orbEl);
      els.media=orbEl; _ryanOrbEl=orbEl;
    }
    ryanOrbSetState('silent');
    return;
  }

  if (_ryanOrbAnimFrame) { cancelAnimationFrame(_ryanOrbAnimFrame); _ryanOrbAnimFrame=null; }

  if (current.tagName!=='VIDEO') {
    const vid=document.createElement('video');
    vid.id='media'; vid.className=current.className||'media';
    vid.autoplay=true; vid.loop=true; vid.muted=true; vid.playsInline=true;
    vid.style.cssText='width:100%;height:440px;object-fit:cover;';
    vid.src=asset.src;
    current.replaceWith(vid); els.media=vid;
    vid.load(); try{vid.play().catch(()=>{});}catch{}
  } else {
    if ((current.getAttribute('src')||'')!==asset.src) { current.src=asset.src; current.load(); }
    try{current.play().catch(()=>{});}catch{}
  }
}

/* Ken Burns keyframes — injected once */
(function injectKenBurnsStyles() {
  if (document.getElementById('ek-kb-styles')) return;
  const style = document.createElement('style');
  style.id = 'ek-kb-styles';
  style.textContent = `
    @keyframes kenBurns1 { 0%{transform:scale(1)    translateX(0%)    translateY(0%)}    100%{transform:scale(1.12) translateX(-2%)   translateY(-1.5%)} }
    @keyframes kenBurns2 { 0%{transform:scale(1.08) translateX(-1.5%) translateY(-1%)}  100%{transform:scale(1)    translateX(1.5%)  translateY(1%)}    }
    @keyframes kenBurns3 { 0%{transform:scale(1)    translateX(1%)    translateY(0%)}    100%{transform:scale(1.1)  translateX(-1%)   translateY(-2%)}   }
    @keyframes kenBurns4 { 0%{transform:scale(1.06) translateX(0%)    translateY(-1.5%)} 100%{transform:scale(1)    translateX(-1.5%) translateY(1%)}    }
    .scene-bg {
      position:absolute;inset:0;width:100%;height:100%;
      object-fit:cover;z-index:0;
      transform-origin:center center;
      will-change:transform;
    }
    .scene-bg.kb-active {
      animation-duration:14s;
      animation-timing-function:ease-in-out;
      animation-iteration-count:infinite;
      animation-direction:alternate;
    }
  `;
  document.head.appendChild(style);
})();

const KB_ANIMS = ['kenBurns1','kenBurns2','kenBurns3','kenBurns4'];
let _kbIndex = 0;

function setSceneBackground(key) {
  const sc=(SCENARIOS[key])||{};
  const frameEl=els.stageFrame;
  if (!frameEl) return;
  const old=frameEl.querySelector('.scene-bg');
  if (old) { try{if(old.tagName==='VIDEO'){old.pause();old.src='';}}catch{} old.remove(); }
  if (!sc.bg) { frameEl.classList.remove('has-bg'); return; }
  const isVideo=/\.mp4$/i.test(sc.bg);
  const bgEl=document.createElement(isVideo?'video':'img');
  bgEl.className='scene-bg';
  if (isVideo) {
    bgEl.autoplay=true; bgEl.loop=true; bgEl.muted=true; bgEl.playsInline=true;
  } else {
    // Apply Ken Burns — pick next animation in rotation so each scenario feels different
    const anim = KB_ANIMS[_kbIndex % KB_ANIMS.length];
    _kbIndex++;
    bgEl.onload = () => {
      bgEl.classList.add('kb-active');
      bgEl.style.animationName = anim;
    };
  }
  bgEl.src=sc.bg;
  frameEl.insertBefore(bgEl, frameEl.firstChild);
  frameEl.classList.add('has-bg');
  els.sceneBg=bgEl;
  if (isVideo) { bgEl.load(); bgEl.play().catch(()=>{}); }
}

function renderLine(line) {
  setMediaForSpeaker(line.speaker);
  if (line.speaker==='User_Prompt') {
    els.name.textContent = 'Your Turn';
  } else if (line.speaker==='Mary') {
    els.name.textContent = getCharacterDisplayName(currentCharacterId);
  } else {
    els.name.textContent = line.speaker;
  }
  if (line.speaker==='User_Prompt') {
    els.text.innerHTML = `<div class="practice-prompt"><strong>READ THIS OUT LOUD:</strong><br><br>"${line.text.replace('Say: ','').replace(/'/g,'')}"</div><div class="user-response-area">🎤 Speak when ready…</div>`;
  } else {
    els.text.textContent = '';
    els.text.dataset.pendingText = line.text;
  }
}

/* ===== TTS ===== */

// ElevenLabs/OpenAI TTS for character voices — streaming playback for low latency
async function speakElevenLabs(text, onStart) {
  async function attempt(useElevenLabs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      const body = { text, voice: 'nova' };
      if (useElevenLabs) body.characterId = currentCharacterId;
      res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('TTS failed: ' + res.status);

    // Use MediaSource streaming — audio starts playing as first chunks arrive
    // Falls back to full buffer decode if MediaSource not supported
    if (false && window.MediaSource && MediaSource.isTypeSupported('audio/mpeg')) {
      return new Promise((resolve, reject) => {
        const mediaSource = new MediaSource();
        const audio = new Audio();
        audio.src = URL.createObjectURL(mediaSource);
        const sourceOpenTimer = setTimeout(() => reject(new Error('sourceopen timeout')), 8000);

        mediaSource.addEventListener('sourceopen', async () => {
          clearTimeout(sourceOpenTimer);
          const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
          sourceBuffer.addEventListener('updateerror', () => reject(new Error('sourceBuffer updateerror')));
          const reader = res.body.getReader();
          let started = false;

          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await Promise.race([
                  reader.read(),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('stream stall timeout')), 15000)),
                ]);
                if (done) {
                  const tryEnd = () => {
                    if (!sourceBuffer.updating) mediaSource.endOfStream();
                    else sourceBuffer.addEventListener('updateend', tryEnd, { once: true });
                  };
                  tryEnd();
                  break;
                }
                // Wait if buffer is updating
                if (sourceBuffer.updating) {
                  await new Promise((res, rej) => {
                    const t = setTimeout(() => rej(new Error('updateend timeout')), 10000);
                    sourceBuffer.addEventListener('updateend', () => { clearTimeout(t); res(); }, { once: true });
                  });
                }
                sourceBuffer.appendBuffer(value);
                // Start playing as soon as first chunk lands
                if (!started) {
                  started = true;
                  audio.volume = 1;
                  audio.muted = false;
                  try {
                    await audio.play();
                    onStart();
                  } catch (playErr) {
                    console.warn('[TTS] audio.play() blocked:', playErr.message);
                    onStart();
                  }
                }
              }
            } catch(e) { reject(e); }
          };
          pump();
        });

        const endTimeout = setTimeout(() => {
          console.log('[TTS] audio.onended timeout — force resolving');
          URL.revokeObjectURL(audio.src);
          resolve();
        }, 30000);
        const onDone = () => { clearTimeout(endTimeout); URL.revokeObjectURL(audio.src); resolve(); };
        audio.onended = onDone;
        mediaSource.onsourceended = onDone;
        audio.onerror = (e) => { console.error('[TTS] audio element error:', e); reject(new Error('Audio error: ' + JSON.stringify(e))); };
      });
    } else {
      // Fallback: full buffer (Safari / older browsers)
      const arrayBuf = await res.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // monkey-patch at line ~1022 auto-tracks this in __audioContexts — no manual push needed
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(audioCtx.destination);
      // AudioContext created async always starts suspended in Chrome — resume before scheduling
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch {} }
      onStart();
      return new Promise((resolve) => {
        source.onended = () => { audioCtx.close(); resolve(); };
        source.start(0);
      });
    }
  }

  try {
    await attempt(true);
  } catch (e) {
    console.warn('TTS failed, falling back to OpenAI...', e.message);
    try {
      await Promise.race([
        attempt(false),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fallback timeout')), 5000)),
      ]);
    } catch (e2) {
      console.warn('TTS fallback failed — skipping line silently', e2.message);
      onStart();
      await pause(500);
    }
  }
}

async function speak(text, speaker, onAudioReady, prefetchedUrl = null) {
  const mySession=session;
  // Test mode — skip audio, resolve immediately
  if (window.__OZMEVA_TEST_MODE) {
    if (els.text.dataset.pendingText) {
      els.text.textContent = els.text.dataset.pendingText;
      delete els.text.dataset.pendingText;
    } else {
      els.text.textContent = text;
    }
    if (onAudioReady) onAudioReady();
    await new Promise(r => setTimeout(r, 50));
    return;
  }
  try { __audioContexts.forEach(c=>{ try{if(c.state==='suspended')c.resume();}catch{} }); } catch {}
  // For Mary: start with idle video, switch to speaking only when audio actually starts
  if (speaker === 'Mary') {
    setMediaForSpeaker('User_Prompt'); // show idle while audio loads
  } else {
    setMediaForSpeaker(speaker);
  }
  if (speaker==='Ryan') {
    const orbEl=document.getElementById('ryan-orb'); if(orbEl) ryanOrbSetState('speaking');
  }
  if (mySession!==session) return;

  const switchToSpeaking=()=>{
    if(mySession!==session) return;
    if (speaker === 'Mary') {
      delete els.text.dataset.pendingText;
    } else if (els.text.dataset.pendingText) {
      els.text.textContent = els.text.dataset.pendingText;
      delete els.text.dataset.pendingText;
    }
    if (onAudioReady) onAudioReady();
    if (speaker === 'Mary') Caption.show(text);
    if (speaker === 'Mary') {
      if (AVATARS._marySpeakingVideo) {
        const el=els.media;
        if(el&&el.tagName==='VIDEO'&&(el.getAttribute('src')||'')!==AVATARS._marySpeakingVideo){
          el.src=AVATARS._marySpeakingVideo; try{el.play().catch(()=>{});}catch{}
        }
      } else { setMediaForSpeaker('Mary'); }
    } else {
      const el=els.media; if(el&&el.tagName==='VIDEO'){try{el.play().catch(()=>{});}catch{}}
    }
  };

  const switchToIdle=()=>{
    if (speaker === 'Mary') Caption.hide();
    const doneEl=els.media;
    if(doneEl&&doneEl.id==='ryan-orb') ryanOrbSetState('silent');
    if (speaker === 'Mary' && doneEl && doneEl.tagName === 'VIDEO') {
      try { doneEl.pause(); } catch {}
      const idleSrc = AVATARS._maryIdleVideo || AVATARS.User_Prompt.src;
      if(idleSrc && (doneEl.getAttribute('src')||'')!==idleSrc){
        doneEl.src=idleSrc; try{doneEl.play().catch(()=>{});}catch{}
      }
    }
  };

  try {
    await Promise.race([
      (async()=>{
        if (speaker === 'Mary') {
          // Use ElevenLabs for Sofia — richer, more human voice
          await speakElevenLabs(text, switchToSpeaking);
          switchToIdle();
        } else {
          // Ryan and others stay on Kokoro
          const voice=getKokoroVoice(speaker);
          let started=false;
          const poll=setInterval(()=>{ if(mySession!==session){clearInterval(poll);return;} if(__audioContexts.some(c=>c.state==='running')){clearInterval(poll);if(!started){started=true;switchToSpeaking();}} },30);
          setTimeout(()=>{clearInterval(poll);if(!started){started=true;switchToSpeaking();}},3000);
          await KokoroSpeech.speak(text, voice, prefetchedUrl);
          clearInterval(poll);
          switchToIdle();
        }
      })(),
      new Promise((_,rej)=>{
        const chk=setInterval(()=>{ if(mySession!==session){clearInterval(chk);rej(new Error('session_changed'));} },50);
        setTimeout(()=>clearInterval(chk),120000);
      })
    ]);
  } catch(e) { if(e.message!=='session_changed') console.warn('speak error:',e.message); }
  if (mySession!==session) return;
}


function getKokoroVoice(speaker) {
  if (speaker==='Mary') return 'af_nicole';
  if (speaker==='Ryan') return 'am_adam';
  return 'am_michael';
}

/* ===== Dynamic Mary ===== */
let conversationHistory=[];
let _exchangeCount = 0;
let _streaming = false; // true from turn start until history push completes — blocks Coach me
let firstUserOpener=null;
function resetConversation() { conversationHistory=[]; _exchangeCount = 0; _streaming = false; }

async function streamCharacterAndSpeak(userSaid, mySession, onTextReady = null) {
  // Block Coach me for the full duration of this turn — until history is pushed.
  _streaming = true;
  updateCoachBtnVisibility();

  // Show thinking state immediately
  els.name.textContent = getCharacterDisplayName(currentCharacterId);
  els.text.textContent = '...';

  // Switch to idle video while we wait for first audio
  setMediaForSpeaker('User_Prompt');

  let fullText = '';
  let usedFallback = false;
  let streamedCue = null;
  const sentenceQueue = [];
  let isPlayingAudio = false;
  let streamDone = false;
  let resolveStream;
  const streamPromise = new Promise(r => { resolveStream = r; });

  // Audio queue processor — plays sentences back-to-back
  async function processQueue() {
    if (isPlayingAudio) return;
    isPlayingAudio = true;

    while (true) {
      if (mySession !== session) { console.log('[FC] processQueue session mismatch — breaking', mySession, session); break; }

      if (sentenceQueue.length === 0) {
        if (streamDone) break;
        await pause(20);
        continue;
      }

      const sentence = sentenceQueue.shift();

      try {
        await speakElevenLabs(sentence, () => {
          if (mySession !== session) return;
          Caption.show(sentence);
          if (AVATARS._marySpeakingVideo) {
            const el = els.media;
            if (el && el.tagName === 'VIDEO' && (el.getAttribute('src') || '') !== AVATARS._marySpeakingVideo) {
              el.src = AVATARS._marySpeakingVideo;
              try { el.play().catch(() => {}); } catch {}
            }
          } else {
            setMediaForSpeaker('Mary');
          }
        });
      } catch (e) {
        if (e.message !== 'session_changed') console.warn('TTS error:', e.message);
      }

      if (mySession !== session) break;

      // Reset to idle between sentences so the speaking video can't keep looping
      // (lips still moving) through the TTS fetch/decode gap before the next
      // sentence's audio is actually ready — the next onStart callback above
      // switches back to speaking only once its own audio chunk is ready.
      if (els.media && els.media.tagName === 'VIDEO') {
        const idleSrc = AVATARS._maryIdleVideo || AVATARS.User_Prompt.src;
        if (idleSrc && (els.media.getAttribute('src') || '') !== idleSrc) {
          els.media.src = idleSrc;
          try { els.media.play().catch(() => {}); } catch {}
        }
      }
    }

    // Switch back to idle after all audio done
    if (mySession === session) {
      Caption.hide();
      const doneEl = els.media;
      if (doneEl && doneEl.tagName === 'VIDEO') {
        const idleSrc = AVATARS._maryIdleVideo || AVATARS.User_Prompt.src;
        if (idleSrc && (doneEl.getAttribute('src') || '') !== idleSrc) {
          doneEl.src = idleSrc;
          try { doneEl.play().catch(() => {}); } catch {}
        }
      }
    }

    isPlayingAudio = false;
    console.log('[FC] processQueue calling resolveStream, queue length:', sentenceQueue.length, 'streamDone:', streamDone);
    resolveStream();
  }

  // SSE stream reader
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const res = await fetch('/api/character-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: userSaid,
        scenarioKey: currentScenarioKey,
        characterId: currentCharacterId,
        history: conversationHistory,
        userStyle: currentUserStyle,
        lesson1Complete: localStorage.getItem('ozmeva_lesson1_complete') === 'true',
        lesson2Complete: localStorage.getItem('ozmeva_lesson2_complete') === 'true',
        lesson3Complete: localStorage.getItem('ozmeva_lesson3_complete') === 'true',
        lesson4Complete: localStorage.getItem('ozmeva_lesson4_complete') === 'true',
        practiceFocus: localStorage.getItem('ozmeva_practice_focus') || 'free',
        voiceInput: _lastInputMode === 'voice',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      usedFallback = true;
      return await getCharacterResponseFallback(userSaid);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Start queue processor immediately
    processQueue();

    while (true) {
      if (mySession !== session) { reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.error) { console.warn('Stream error:', payload.error); break; }
          // TRACE cue arrives as a dedicated event before sentence events.
          // Server extracted it from the leading parenthetical, already third-person.
          // Client-side check guards against the server accidentally sending a cue
          // in a non-lesson5 context.
          if (payload.cue && localStorage.getItem('ozmeva_practice_focus') === 'lesson5') {
            TraceCue.show(payload.cue);
            streamedCue = payload.cue;
          }
          if (payload.sentence) {
            const s = payload.sentence;
            if (s) { sentenceQueue.push(s); }
            if (!isPlayingAudio) processQueue();
          }
          if (payload.done) {
            fullText = payload.full || fullText;
            streamDone = true;
            // Fire the coached-practice moment-check NOW, while TTS is still playing.
            if (onTextReady && fullText) { onTextReady(fullText); onTextReady = null; }
          }
        } catch {}
      }
    }

    streamDone = true;

  } catch (err) {
    streamDone = true;
    if (err.name !== 'AbortError') console.warn('Stream fetch error:', err.message);
    if (!fullText && sentenceQueue.length === 0) {
      usedFallback = true;
      return await getCharacterResponseFallback(userSaid);
    }
  }

  await Promise.race([
    streamPromise,
    new Promise(resolve => setTimeout(resolve, 20000))
  ]);
  console.log('[FC] streamPromise resolved or timed out');

  if (fullText && !usedFallback && mySession === session) {
    if (!firstUserOpener) firstUserOpener = userSaid;
    conversationHistory.push({ role: 'user', content: userSaid });
    // Re-prepend the stage direction so coach.js can evaluate TRACE signals.
    // Server strips the parenthetical before streaming; we restore it here for the record.
    const historyContent = streamedCue ? `(${streamedCue}) ${fullText}` : fullText;
    conversationHistory.push({ role: 'assistant', content: historyContent });
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);
    _exchangeCount++;
  }
  // Always clear streaming flag so Coach me re-enables, even if this turn produced no text
  _streaming = false;
  updateCoachBtnVisibility();

  return fullText || null;
}

async function getCharacterResponseFallback(userSaid) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('/api/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: userSaid,
        scenarioKey: currentScenarioKey,
        characterId: currentCharacterId,
        history: conversationHistory,
        lesson1Complete: localStorage.getItem('ozmeva_lesson1_complete') === 'true',
        lesson2Complete: localStorage.getItem('ozmeva_lesson2_complete') === 'true',
        lesson3Complete: localStorage.getItem('ozmeva_lesson3_complete') === 'true',
        lesson4Complete: localStorage.getItem('ozmeva_lesson4_complete') === 'true',
        practiceFocus: localStorage.getItem('ozmeva_practice_focus') || 'free',
        voiceInput: _lastInputMode === 'voice',
      }),
      signal: controller.signal,
    });
  clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const maryText = data.response;
    if (!firstUserOpener) firstUserOpener = userSaid;
    conversationHistory.push({ role: 'user', content: userSaid });
    conversationHistory.push({ role: 'assistant', content: maryText });
    if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);
    _exchangeCount++;
    _streaming = false;
    updateCoachBtnVisibility();
    return maryText;
  } catch (err) {
    clearTimeout(timeout);
    _streaming = false;
    updateCoachBtnVisibility();
    return null;
  }
}

/* ===== Speech recognition ===== */
function createRecognition() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR) return null;
  const r=new SR(); r.lang='en-US'; r.interimResults=false; r.maxAlternatives=1;
  return r;
}

function getInputMode() {
  return localStorage.getItem('ozmeva_input_mode') || 'voice';
}

function correctSTT(text) {
  if (!text) return text;
  let t = text;
  // "novel Regional" → "novel or journal"
  t = t.replace(/\bnovel\s+regional\b/gi, 'novel or journal');
  // "treasury map" → "writing something"
  t = t.replace(/\btreasury\s+map\b/gi, 'writing something');
  // "ready you" → "aren't you"
  t = t.replace(/\bready\s+you\b/gi, "aren't you");
  // "fitt/fitting" in feeling context
  t = t.replace(/\bjust\s+my\s+fitt(?:ing)?\b/gi, 'just my feeling');
  t = t.replace(/\b(it'?s)\s+fitt(?:ing)?\b/gi, '$1 feeling');
  // "riding" → "writing" only when writing-related context is present
  if (/\b(book|novel|article|journal|story|piece|draft|chapter|essay|something)\b/i.test(t)) {
    t = t.replace(/\briding\b/gi, 'writing');
  }
  // Remove consecutive duplicate words — catchall for watchdog-restart STT artifacts
  t = t.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');
  return t;
}

function showListening(on=true) {
  if (els.listenPill) els.listenPill.style.display=on?'block':'none';
  const orbEl=document.getElementById('ryan-orb');
  if (orbEl) ryanOrbSetState(on?'listening':'silent');
  // Swap avatar: listening video when mic is open, talking video when Mary speaks
  if (on) {
    // User is speaking — show idle/listening video
    const current=els.media;
    if (current && current.tagName==='VIDEO' && current.id!=='ryan-orb') {
      const idleSrc=AVATARS.User_Prompt?.src;
      if (idleSrc && (current.getAttribute('src')||'')!==idleSrc) {
        current.src=idleSrc;
        try{current.play().catch(()=>{});}catch{}
      }
    }
  }
}

// Returns true only in Chrome/Edge/Android Chrome where the free Web Speech API works.
// iOS Safari, Firefox, and most other browsers return false → Whisper path is used instead.
function hasSpeechRecognition() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/* ===== Whisper STT — for iOS Safari and browsers without Web Speech API ===== */
// Records audio via MediaRecorder (works in iOS Safari 14.5+), sends blob to /api/stt,
// resolves with the transcript string — same shape as the Web Speech API path output.
// UI: press-and-hold "Hold to speak" button. Auto-stops after 30s.
function listenForUserWhisper(mySession, maxTotalMs) {
  return new Promise(resolve => {
    const MAX_RECORD_MS = Math.min(maxTotalMs || 30000, 30000);
    let resolved = false;
    let mediaRecorder = null;
    let chunks = [];
    let autoStopTimer = null;
    let holdBtn = null;
    let sessionPoll = null;

    function done(transcript) {
      if (resolved) return;
      resolved = true;
      if (sessionPoll) { clearInterval(sessionPoll); sessionPoll = null; }
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch {}
      }
      if (holdBtn) { holdBtn.remove(); holdBtn = null; }
      showListening(false);
      resolve(correctSTT(transcript || '') || null);
    }

    async function sendAudio(blob) {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `speech.${ext}`);
      if (holdBtn) { holdBtn.textContent = '⏳'; holdBtn.disabled = true; }
      try {
        const r = await fetch('/api/stt', { method: 'POST', body: form });
        if (!r.ok) { console.warn('[Whisper] STT error', r.status); done(null); return; }
        const data = await r.json();
        done(data.transcript || null);
      } catch (e) {
        console.warn('[Whisper] fetch error:', e.message);
        done(null);
      }
    }

    async function startRecording() {
      if (resolved || (mediaRecorder && mediaRecorder.state === 'recording')) return;
      chunks = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                       : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                       : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
                       : 'audio/ogg';
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          if (!resolved && chunks.length > 0) {
            sendAudio(new Blob(chunks, { type: mimeType }));
          } else if (!resolved) {
            done(null);
          }
        };
        mediaRecorder.start();
        showListening(true);
        if (holdBtn) { holdBtn.textContent = '🔴 Release to send'; holdBtn.setAttribute('data-stt-mode', 'whisper-recording'); }
        autoStopTimer = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, MAX_RECORD_MS);
      } catch (e) {
        // Mic permission denied or MediaRecorder not supported — resolve null so caller falls through
        console.warn('[Whisper] getUserMedia error:', e.name, e.message);
        done(null);
      }
    }

    function stopRecording() {
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }

    // Session guard (matches the pattern in listenForUserType)
    sessionPoll = setInterval(() => {
      if (resolved || mySession !== session) { clearInterval(sessionPoll); sessionPoll = null; if (!resolved) done(null); }
    }, 300);

    // Build the press-and-hold button
    holdBtn = document.createElement('button');
    holdBtn.id = 'whisper-hold-btn';
    holdBtn.setAttribute('data-stt-mode', 'whisper');
    holdBtn.textContent = '🎙 Hold to speak';
    holdBtn.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);' +
      'background:#ffb300;color:#000;border:none;border-radius:999px;' +
      'padding:14px 32px;font-size:16px;font-weight:700;cursor:pointer;' +
      'z-index:10000;touch-action:none;box-shadow:0 4px 20px rgba(255,179,0,.4);' +
      'user-select:none;-webkit-user-select:none;';

    holdBtn.addEventListener('pointerdown', e => { e.preventDefault(); startRecording(); });
    holdBtn.addEventListener('pointerup',   e => { e.preventDefault(); stopRecording(); });
    holdBtn.addEventListener('pointercancel', e => { e.preventDefault(); stopRecording(); });

    document.body.appendChild(holdBtn);
  });
}

/* ===== listenForUser — Chrome Web Speech API, Whisper (iOS), or type input ===== */
// Dynamic silence detection (Web Speech path):
//   SILENCE_SHORT = 900ms  — fires when last word ends with . ! ? or common sentence-enders
//   SILENCE_LONG  = 1800ms — fires otherwise (mid-thought, comma pause, etc.)
function listenForUser(mySession, maxTotalMs) {
  _lastInputMode = getInputMode();
  if (_lastInputMode === 'type') {
    return listenForUserType(mySession).then(result => {
      // null from mode-switch abort: user toggled to voice mid-listen — skip fallback, re-listen in voice
      if (result === null && mySession === session && getInputMode() === 'voice') {
        return listenForUser(mySession, maxTotalMs);
      }
      return result;
    });
  }
  if (typeof window !== 'undefined' && window._testMode) return Promise.resolve(null);
  // iOS Safari, Firefox, and other browsers lack Web Speech API — use Whisper via MediaRecorder instead.
  if (!hasSpeechRecognition()) return listenForUserWhisper(mySession, maxTotalMs);
  return new Promise(resolve=>{
    maxTotalMs=maxTotalMs||30000;
    let accumulated='', interim='', silenceTimer=null, hardTimer=null, currentRec=null;
    let resolved=false, lastActivity=Date.now(), restarts=0, errorRetries=0;
    const listenStartTime=Date.now();
    const MAX_RESTARTS=8;
    const MAX_ERROR_RETRIES=3;
    const SILENCE_SHORT=900;
    const SILENCE_LONG=1800;

    // Fix 1: watchdog heartbeat — detects silent drops where onend never fires
    watchdogInterval=setInterval(()=>{
      if(resolved||mySession!==session){clearInterval(watchdogInterval);watchdogInterval=null;return;}
      if(currentRec&&Date.now()-lastActivity>3000){
        console.warn('[SR] watchdog: no activity in 3s, restarting');
        try{currentRec.onresult=null;currentRec.onerror=null;currentRec.onend=null;currentRec.stop();}catch{}
        currentRec=null; rec=null;
        accumulated=''; // clear stale accumulated on watchdog restart to prevent cross-restart duplication
        setTimeout(()=>{if(!resolved&&mySession===session)startRec();},2000);
      }
    },3000);

    function isCompleteSentence(text) {
      if (!text) return false;
      const t = text.trim().toLowerCase();
      if (/[.!?]$/.test(t)) return true;
      if (/(thanks|please|okay|ok|sure|right|exactly|anyway|anyways|bye|hello|hi|hey|yes|no|maybe|later|now|today|here|there|that|this|you|me|us|them|it|him|her|too|though|well|fine|good|great|nice|cool|true|false|agree|agreed)$/.test(t)) return true;
      if (t.split(/\s+/).length >= 6) return true;
      return false;
    }

    function getSilenceMs() {
      const text = (accumulated + ' ' + interim).trim();
      return isCompleteSentence(text) ? SILENCE_SHORT : SILENCE_LONG;
    }

    function finish(val) {
      if (resolved) return;
      resolved=true;
      clearTimeout(silenceTimer); clearTimeout(hardTimer);
      if (watchdogInterval){clearInterval(watchdogInterval);watchdogInterval=null;}
      if (listenTimer) { clearTimeout(listenTimer); listenTimer=null; }
      if (currentRec) { try{currentRec.onresult=null;currentRec.onerror=null;currentRec.onend=null;currentRec.stop();}catch{}; currentRec=null; }
      showListening(false);
      let final=accumulated.trim();
      if (interim.trim() && !final.toLowerCase().includes(interim.trim().toLowerCase())) final=(final+' '+interim).trim();
      resolve(correctSTT(final)||null);
    }

    function scheduleSilence() {
      clearTimeout(silenceTimer);
      const ms = getSilenceMs();
      silenceTimer=setTimeout(()=>{ if(Date.now()-lastActivity>=ms-100) finish('silence'); }, ms);
    }

    function startRec() {
      if (resolved||mySession!==session) return;
      // Fix 3: on max restarts, clean reset with 2s pause — never kill the session
      if (restarts>=MAX_RESTARTS) {
        console.warn('[SR] max restarts reached — clean reset in 2s');
        restarts=0; accumulated=''; interim=''; errorRetries=0;
        setTimeout(()=>{if(!resolved&&mySession===session)startRec();},2000);
        return;
      }
      restarts++;
      const r=createRecognition(); if(!r){finish('no_sr');return;}
      r.interimResults=true; r.continuous=true;
      currentRec=r; rec=r; interim='';
      lastActivity=Date.now(); // reset watchdog clock on each new recognition instance

      r.onresult=e=>{
        if (resolved||mySession!==session){finish('session');return;}
        lastActivity=Date.now();
        let finals='', lat='';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const t=e.results[i][0].transcript;
          e.results[i].isFinal ? finals+=(finals?' ':'')+t.trim() : lat=t.trim();
        }
        if(finals) accumulated=(accumulated+' '+finals).trim();
        interim=lat;
        scheduleSilence();
      };

      r.onerror=e=>{
        if(e.error==='aborted') {
          // Chrome fires 'aborted' during fullscreen transitions and other browser-level
          // interruptions. Intentional stops (finish/stopEverything) always null the handlers
          // before calling r.stop(), so if we reach here the session is still live — restart.
          if (!resolved && mySession === session) {
            setTimeout(()=>{ if(!resolved&&mySession===session) startRec(); }, 400);
          }
          return;
        }
        // Fix 4: permission denied is unrecoverable — stop immediately
        if(e.error==='not-allowed'){finish('err_not-allowed');return;}
        if(e.error==='no-speech'){
          restarts=Math.max(0,restarts-1);
          setTimeout(()=>{ if(!resolved&&mySession===session) startRec(); }, 2000);
          return;
        }
        // Fix 4: network/audio-capture/service errors — retry up to MAX_ERROR_RETRIES
        if(errorRetries<MAX_ERROR_RETRIES){
          errorRetries++;
          console.warn('[SR] onerror',e.error,'— retry',errorRetries+'/'+MAX_ERROR_RETRIES);
          setTimeout(()=>{if(!resolved&&mySession===session)startRec();},1000);
        } else {
          finish('err_'+e.error);
        }
      };

      r.onend=()=>{
        if(resolved||mySession!==session) return;
        lastActivity=Date.now(); // onend firing proves Chrome is alive
        // Fix 2: mid-sentence guard — buffer has text, no sentence-ender, session still young
        if(accumulated&&!isCompleteSentence(accumulated)&&(Date.now()-listenStartTime)<8000){
          setTimeout(()=>{if(!resolved&&mySession===session)startRec();},300);
          return;
        }
        if(accumulated||interim) { finish(accumulated||interim); return; }
        setTimeout(()=>{ if(!resolved&&mySession===session) startRec(); }, 2000);
      };

      try { r.start(); showListening(true); }
      catch { setTimeout(()=>{ if(!resolved) startRec(); }, 500); }
    }

    hardTimer=setTimeout(()=>finish('hard_timeout'), maxTotalMs);
    listenTimer=hardTimer;
    startRec();
  });
}


/* ===== Type-mode listener — resolves when user submits text ===== */
// No per-turn timeout in type mode — the input stays open until the user submits.
// Session termination (7-min timer, stopEverything) is handled by the sessionPoll
// which fires when mySession !== session.
function listenForUserType(mySession) {
  return new Promise(resolve => {
    const wrap = document.getElementById('type-input-wrap');
    const field = document.getElementById('type-input-field');
    const sendBtn = document.getElementById('type-send-btn');
    if (!wrap || !field || !sendBtn) { resolve(null); return; }

    wrap.style.display = 'flex';
    field.value = '';
    field.style.height = 'auto';
    setTimeout(() => field.focus(), 50);

    let resolved = false;

    function done(text) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(text);
    }

    function cleanup() {
      wrap.style.display = 'none';
      sendBtn.removeEventListener('click', onSend);
      field.removeEventListener('keydown', onKey);
      field.removeEventListener('input', onInput);
      clearInterval(sessionPoll);
      window.removeEventListener('ozmeva-abort-type-listen', onAbort);
    }

    // Fired when the mic toggle switches back to voice mid-listen — lets playLoop
    // re-call listenForUser in voice mode for the same turn instead of hanging.
    function onAbort() { done(null); }

    function submit() {
      const text = field.value.trim();
      if (!text) return;
      done(text);
    }

    function onSend() { submit(); }
    function onKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    }
    function onInput() {
      field.style.height = 'auto';
      field.style.height = Math.min(field.scrollHeight, 120) + 'px';
    }

    sendBtn.addEventListener('click', onSend);
    field.addEventListener('keydown', onKey);
    field.addEventListener('input', onInput);
    window.addEventListener('ozmeva-abort-type-listen', onAbort, { once: true });

    const sessionPoll = setInterval(() => {
      if (mySession !== session) { done(null); }
    }, 500);
  });
}

/* ===== Mary API + TTS warmup — fires silently when a scenario loads ===== */
// Primes Groq cold start AND OpenAI TTS cold start so first real response has no extra latency.
// Fire-and-forget: responses discarded entirely.
function warmupCharacterApi(key) {
  // Warm up character API (Groq)
  fetch('/api/character', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userMessage: 'hi',
      scenarioKey: key,
      characterId: currentCharacterId,
      history: [],
    }),
  }).catch(() => {});

  // Warm up character-stream endpoint (Groq via SSE)
  fetch('/api/character-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userMessage: 'hi',
      scenarioKey: key,
      characterId: currentCharacterId,
      history: [],
    }),
  }).then(r => r.body?.cancel()).catch(() => {});

  // Warm up OpenAI TTS — fires a silent 1-word request to prime the connection
  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hi', voice: 'nova', characterId: currentCharacterId }),
  }).then(r => r.body?.cancel()).catch(() => {});
}

/* ===== Style selector ===== */
function showStyleSelector() {
  return new Promise(resolve => {
    const existing = document.getElementById('ek-style-selector');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ek-style-selector';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(10,13,20,0.97);z-index:99999',
      'display:flex;flex-direction:column;align-items:center;justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;text-align:center'
    ].join(';');

    const STYLES = [
      { key: 'curious', emoji: '🎯', label: 'Curious', desc: 'Ask questions, show genuine interest' },
      { key: 'playful', emoji: '😏', label: 'Playful', desc: 'Light teasing, keep it fun' },
      { key: 'direct',  emoji: '💪', label: 'Direct',  desc: 'Bold and honest, no games' },
    ];

    const cards = STYLES.map(s => `
      <div class="ek-style-card" data-style="${s.key}"
        style="background:#1a1f2e;border:1.5px solid #2a3040;border-radius:16px;padding:28px 24px;
               min-width:160px;max-width:200px;flex:1;text-align:center;cursor:pointer;
               transition:border-color 0.15s,transform 0.15s">
        <div style="font-size:32px;margin-bottom:12px">${s.emoji}</div>
        <div style="color:#fff;font-size:17px;font-weight:700;margin-bottom:8px">${s.label}</div>
        <div style="color:#9aa4b2;font-size:13px;line-height:1.5">${s.desc}</div>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div style="color:#fff;font-size:22px;font-weight:800;margin-bottom:8px;letter-spacing:-0.3px">
        How do you want to play this?
      </div>
      <div style="color:#9aa4b2;font-size:14px;margin-bottom:32px">Choose your approach for this session</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;max-width:680px;width:100%">
        ${cards}
      </div>
      <div style="margin-top:28px">
        <span id="ek-style-back" style="color:#555;font-size:13px;cursor:pointer;text-decoration:underline">
          ← Back
        </span>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.ek-style-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        card.style.borderColor = '#ffb300';
        card.style.transform = 'translateY(-2px)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = '#2a3040';
        card.style.transform = '';
      });
      card.addEventListener('click', () => {
        overlay.remove();
        resolve(card.dataset.style);
      });
    });

    document.getElementById('ek-style-back').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
  });
}

/* ===== Scenario countdown ===== */
function showCountdown(mySession) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);pointer-events:none';
    const num = document.createElement('div');
    num.style.cssText = 'font-size:120px;font-weight:900;color:#fff;line-height:1;text-shadow:0 4px 32px rgba(0,0,0,0.6);transition:opacity 0.2s ease,transform 0.15s ease';
    ov.appendChild(num);
    document.body.appendChild(ov);

    let beat = 3;
    function tick() {
      if (mySession !== session) { ov.remove(); resolve(); return; }
      num.style.opacity = '1';
      num.style.transform = 'scale(1)';
      num.textContent = beat;
      setTimeout(() => {
        num.style.opacity = '0';
        num.style.transform = 'scale(0.85)';
        setTimeout(() => {
          beat--;
          if (beat > 0) tick();
          else { ov.remove(); resolve(); }
        }, 200);
      }, 700);
    }
    tick();
  });
}

/* ===== Scenario engine ===== */
async function playScenario(key, practice=false) {
  const sc=SCENARIOS[key]; if(!sc) return;
  // Cold open scenarios skip demo entirely — throw user straight into practice.
  // Must resolve BEFORE the daily gate, or coldOpen sessions bypass it.
  if (sc.coldOpen) practice=true;

  // ── Daily session gate (practice only — demos always free) ────────────────
  if (practice) {
    const allowed = await DailyLimit.canPlay();
    if (!allowed) return; // paywall shown by canPlay()

    const style = await showStyleSelector();
    if (style === null) return;
    currentUserStyle = style;
    DailyLimit.countSession(); // count at session start — fired once user commits, not after completion
  }

  // Kick off TTS fetch for the first Ryan line NOW — pause(800) + setup below gives it
  // ~900ms head start so line 1 never plays cold.
  const _introScript = practice ? sc.practice : sc.demo;
  const _firstIntroRyan = (_introScript || []).find(l => l.speaker === 'Ryan');
  const _introPrefetch = _firstIntroRyan
    ? KokoroSpeech.prefetch(_firstIntroRyan.text, 'am_adam')
    : null;
  if (_firstIntroRyan) console.log('[prefetch] intro warm-up:', _firstIntroRyan.text.slice(0, 60));

  // Declutter: hide marketing hero + lesson-recommendation banner while in session
  ['ek-hero', 'ek-practice-banner'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });

  stopEverything();
  const mySession=session; // capture BEFORE pause — rapid re-clicks each get a unique session id
  setMediaForSpeaker('Ryan'); // clear stale character video immediately — orb shows during setup
  resetConversation();
  hideCoachSuggestions();
  updateCoachBtnVisibility();
  firstUserOpener=null;
  await pause(800); // increased from 200ms — kills 1s audio bleed on fast clicks

  currentScenarioKey=key;
  // Apply character for this scenario. If the user has explicitly picked an avatar,
  // honour their choice; otherwise use the scenario's built-in default.
  if (!pickerHasOverride && SCENARIO_CHARACTER_MAP[key]) {
    currentCharacterId = SCENARIO_CHARACTER_MAP[key];
    const defaultSet = AVATAR_SETS.find(s => s.id === currentCharacterId);
    if (defaultSet) applyAvatarSet(defaultSet);
  } else if (pickerHasOverride) {
    // Re-apply the picked set (stopEverything clears the active video state)
    const pickedSet = AVATAR_SETS.find(s => s.id === currentCharacterId);
    if (pickedSet) applyAvatarSet(pickedSet);
  }

  // Fire warmup ping after character is set — primes Groq cold start with correct character
  warmupCharacterApi(key);
  Metrics.bumpView(key); Metrics.refreshUI(key);
  setSceneBackground(key);
  AmbientAudio.play(key);
  // PostHog — scenario started
  if (window.posthog) posthog.capture('scenario_started', { scenario: key, mode: practice ? 'practice' : 'demo' });
  isPractice=practice;
  currentScript=practice?sc.practice:sc.demo;
  stepIndex=0;
  if (practice) showMnemonicPill(localStorage.getItem('ozmeva_practice_focus') || 'free');
  else hideMnemonicPill();
  if(els.select && els.select.value!==key) els.select.value=key;
  if (window.showFullscreenBtn) window.showFullscreenBtn();
  await playLoop(mySession, _introPrefetch);
}

async function playLoop(mySession, introPrefetch = null) {
  // Use the pre-warmed promise from playScenario (has ~900ms head start) if available,
  // otherwise fall back to a fresh fetch (no head start — e.g. called from non-standard path).
  let ryanPrefetchPromise = introPrefetch;
  if (!ryanPrefetchPromise) {
    const firstRyanLine = currentScript.find(l => l.speaker === 'Ryan');
    if (firstRyanLine) {
      ryanPrefetchPromise = KokoroSpeech.prefetch(firstRyanLine.text, 'am_adam');
      console.log('[prefetch] first Ryan line (no head start):', firstRyanLine.text.slice(0, 60));
    }
  }

  // On repeat plays of the same scenario this session, skip motivational intro lines
  // and jump straight to the final Ryan cue (e.g. "What do you do?") before User_Prompt.
  if (_seenScenarioIntros.has(currentScenarioKey)) {
    let lastRyanIdx = -1;
    for (let i = 0; i < currentScript.length; i++) {
      if (currentScript[i].speaker === 'User_Prompt') break;
      if (currentScript[i].speaker === 'Ryan') lastRyanIdx = i;
    }
    if (lastRyanIdx > 0) {
      stepIndex = lastRyanIdx;
      ryanPrefetchPromise = KokoroSpeech.prefetch(currentScript[lastRyanIdx].text, 'am_adam');
      console.log('[intro] repeat play — skipping to cue:', currentScript[lastRyanIdx].text.slice(0, 60));
    }
  } else {
    _seenScenarioIntros.add(currentScenarioKey);
  }

  while (stepIndex < currentScript.length) {
    if (mySession !== session) return;
    const line = currentScript[stepIndex];
    renderLine(line);

    if (line.speaker === 'User_Prompt') {
      ryanPrefetchPromise = null;
      const said = await listenForUser(mySession, 60000);
      if (mySession !== session) return;

      if (said && isPractice) {
        if (stepIndex + 1 < currentScript.length && currentScript[stepIndex + 1].speaker === 'Mary') stepIndex++;
        const reply = await streamCharacterAndSpeak(said, mySession);
        if (mySession !== session) return;
        if (!reply) {
          await speak(randomChoice(['Sorry, say that again?', 'Hmm, what was that?', 'Say that again?']), 'Mary');
        }
        setMediaForSpeaker('User_Prompt');
        let look = stepIndex + 1;
        while (look < currentScript.length && currentScript[look].speaker === 'Ryan') look++;
        if (look < currentScript.length && currentScript[look].speaker === 'User_Prompt') stepIndex = look - 1;
      } else if (!said) {
        await speak("No worries, let's keep going.", 'Ryan');
      }
      stepIndex++;
      continue;
    }

    let prefetchedUrl = null;
    if (line.speaker === 'Ryan') {
      if (ryanPrefetchPromise) {
        prefetchedUrl = await ryanPrefetchPromise;
        ryanPrefetchPromise = null;
        console.log('[prefetch] HIT:', line.text.slice(0, 60));
      } else {
        console.log('[prefetch] COLD:', line.text.slice(0, 60));
      }
      // Start prefetching the next Ryan line NOW — runs concurrently with speak() below
      const nextRyanLine = currentScript.slice(stepIndex + 1).find(l => l.speaker === 'Ryan');
      ryanPrefetchPromise = nextRyanLine ? KokoroSpeech.prefetch(nextRyanLine.text, 'am_adam') : null;
      if (nextRyanLine) console.log('[prefetch] queued next:', nextRyanLine.text.slice(0, 60));
    }
    await speak(line.text, line.speaker, undefined, prefetchedUrl);
    if (mySession !== session) return;
    await pause(250);
    stepIndex++;
  }

  if (!isPractice) renderAskToPractice(mySession);
  else await freeConversation(mySession);
}

/* ===== Free Conversation ===== */
async function freeConversation(mySession) {
  let freeConvRescueUsed = null;
  let firstExchangeDone = false;
  let silenceCount = 0;
  _interruptCount = 0;
  _turnSnapshot   = null;
  _momentCheckPromise = null;
  const _coachActive = isCoachMode();
  if (mySession !== session) return;
  const sc = SCENARIOS[currentScenarioKey] || {};
  const FREE_MS = 7 * 60 * 1000, NUDGE_MS = 5 * 60 * 1000;
  const start = Date.now();
  let nudged = false;
  resetConversation();
  const nudgeText = "Two minutes left -- make it count.";
  const nudgePrefetchPromise = KokoroSpeech.prefetch(nudgeText, 'am_adam');

  if (!sc.coldOpen) {
    await speak("Great work! Now let's have a real conversation -- no script, just talk to her naturally for ten minutes. I'll give you feedback at the end.", 'Ryan');
    if (mySession !== session) return;
    await pause(900);
  }

  const timerEl = document.createElement('div');
  timerEl.id = 'free-timer';
  timerEl.style.cssText = 'position:fixed;top:70px;right:20px;background:#1a1c22;border:1px solid #2b2e36;border-radius:999px;padding:6px 16px;font-size:13px;font-weight:700;color:#ffb300;z-index:9999';
  document.body.appendChild(timerEl);
  const timerInterval = setInterval(() => {
    if (mySession !== session) { clearInterval(timerInterval); timerEl.remove(); return; }
    const rem = Math.max(0, FREE_MS - (Date.now() - start));
    timerEl.textContent = Math.floor(rem / 60000) + ':' + String(Math.floor((rem % 60000) / 1000)).padStart(2, '0') + ' left';
    if (rem <= 0) clearInterval(timerInterval);
  }, 1000);

  await showCountdown(mySession);
  if (mySession !== session) { clearInterval(timerInterval); timerEl.remove(); return; }

  setMediaForSpeaker('Mary');
  els.name.textContent = getCharacterDisplayName(currentCharacterId);
  els.text.textContent = '...';
  const warmupMs = currentScenarioKey === 'street' ? 2500 : 1200;
  await pause(warmupMs);

  while (mySession === session) {
    const elapsed = Date.now() - start;
    if (elapsed >= FREE_MS) {
      await speak("That's time. Let me put together your feedback.", 'Ryan');
      break;
    }

    if (!nudged && elapsed >= NUDGE_MS) {
      nudged = true;
      const nudgePrefetchedUrl = await nudgePrefetchPromise;
      await speak(nudgeText, 'Ryan', null, nudgePrefetchedUrl);
      if (mySession !== session) break;
      await pause(900);
      setMediaForSpeaker('Mary');
      els.name.textContent = getCharacterDisplayName(currentCharacterId);
    }

    const remMs = Math.min(30000, FREE_MS - (Date.now() - start));
    if (remMs < 2000) break;

    console.log('[FC] loop start, elapsed:', Date.now()-start, 'mySession:', mySession, 'session:', session);
    await pause(500); // brief gap so mic doesn't pick up tail of avatar audio
    // Snapshot taken here — before each user turn — so a rewind can cleanly restore to this state
    if (_coachActive) _turnSnapshot = { history: conversationHistory.slice(), exchangeCount: _exchangeCount };
    const said = await listenForUser(mySession, remMs);
    hideCoachSuggestions();
    console.log('[FC] heard:', said, 'mySession:', mySession, 'session:', session);
    if (mySession !== session) break;

    if (!said) {
      if (sc.coldOpen && !firstExchangeDone) {
        const rescuesByScenario = {
          beach:        ["You walked all the way over here. Might as well say something.", "I don't bite. Usually.", "The waves aren't that interesting, I promise.", "Most people just walk past. You didn't.", "You can sit if you want. I don't mind.", "The quiet is better when someone breaks it well.", "I saw you walk by earlier.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          street:       ["You stopped for a reason.", "I have somewhere to be, just so you know.", "Clock's ticking.", "Most people just walk past.", "You look like you had something to say.", "Take your time. But not too much.", "Still working up to it?", "This is the part where you say something."],
          bar:          ["You came over for a reason.", "I don't bite. Usually.", "Most people just stand at the bar.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          gym:          ["You came over for a reason.", "I'm between sets, not retired.", "Clock's ticking.", "You look like you had something to say.", "Take your time."],
          museum:       ["You stopped here for a reason.", "Most people just walk past.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          bookstore:    ["You came down this aisle for a reason.", "Most people just browse.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          rooftop:      ["You came all the way over here.", "The view isn't going anywhere.", "Most people just stay on their side.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          house_party:  ["You came over for a reason.", "I don't bite. I'm at a party.", "Most people just stay in their group.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          coffee_shop:  ["You stopped at this table for a reason.", "I'm not that focused on the notebook.", "Most people just walk past.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          art_gallery:  ["You stopped at this piece for a reason.", "Most people walked past it.", "You look like you had something to say.", "Take your time.", "Still working up to it?", "The painting isn't going anywhere."],
          yoga_studio:  ["You came over for a reason.", "I'm stretching, not meditating.", "Clock's ticking — I'll finish and leave.", "You look like you had something to say.", "Take your time."],
          airport:      ["We've got time. Flight's delayed.", "Most people just stay in their seat.", "You look like you had something to say.", "Take your time.", "Still working up to it?", "The board hasn't changed."],
          supermarket:  ["You stopped in this aisle for a reason.", "Most people just keep moving.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          office_lobby: ["You came over for a reason.", "The elevator's taking its time.", "Most people just look at their phones.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          train:        ["You're still here.", "The train has a few more stops.", "Most people just look out the window.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
          art_studio:   ["You walked in for a reason.", "Most people just look and leave.", "The work is right there.", "You look like you had something to say.", "Take your time.", "Still working up to it?"],
        };
        const rescues = rescuesByScenario[currentScenarioKey] || rescuesByScenario.beach;
        if (!freeConvRescueUsed) freeConvRescueUsed = new Set();
        const available = rescues.filter(r => !freeConvRescueUsed.has(r));
        const pool = available.length > 0 ? available : rescues;
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        freeConvRescueUsed.add(chosen);
        if (freeConvRescueUsed.size >= rescues.length) freeConvRescueUsed.clear();
        await speak(chosen, 'Mary');
        if (mySession !== session) break;
        await pause(1800);
      } else {
        silenceCount++;
        if (firstExchangeDone && silenceCount >= 2) {
          silenceCount = 0;
          const impatience = {
            street:       ["Still there?", "I do have somewhere to be.", "You went quiet.", "Was there something else?"],
            beach:        ["Still there?", "You went quiet.", "Was there something else?", "Take your time."],
            bar:          ["Still there?", "You went quiet.", "Was there something else?"],
            gym:          ["Still there?", "You went quiet.", "Was there something else?"],
            museum:       ["Still there?", "You went quiet.", "Was there something else?"],
            bookstore:    ["Still there?", "You went quiet.", "Was there something else?"],
            rooftop:      ["Still there?", "You went quiet.", "Was there something else?"],
            house_party:  ["Still there?", "You went quiet.", "Was there something else?"],
            coffee_shop:  ["Still there?", "You went quiet.", "Was there something else?"],
            art_gallery:  ["Still there?", "You went quiet.", "Was there something else?"],
            yoga_studio:  ["Still there?", "You went quiet.", "Was there something else?"],
            airport:      ["Still there?", "You went quiet.", "Was there something else?", "The board still hasn't changed."],
            supermarket:  ["Still there?", "You went quiet.", "Was there something else?"],
            office_lobby: ["Still there?", "You went quiet.", "Was there something else?"],
            train:        ["Still there?", "You went quiet.", "Was there something else?", "Few more stops."],
            art_studio:   ["Still there?", "You went quiet.", "Was there something else?"],
          };
          const pool = impatience[currentScenarioKey] || impatience.beach;
          const line = pool[Math.floor(Math.random() * pool.length)];
          await speak(line, 'Mary');
          if (mySession !== session) break;
          await pause(1000);
        } else {
          await pause(500);
        }
      }
      continue;
    }

    // ── Coached Practice: launch moment-check via callback so it runs during TTS playback ──
    // The check fires when payload.done arrives inside streamCharacterAndSpeak (full text known,
    // audio still playing). By the time TTS finishes + pause(300) elapses + waitIfPaused runs,
    // the API call has had the full audio duration to complete → near-zero gate overhead.
    const _shouldCheckMoment = _coachActive && _interruptCount < MAX_INTERRUPTS && said.trim().split(/\s+/).length >= 5;
    _momentCheckPromise = null;

    console.log('[FC] calling streamCharacterAndSpeak');
    const reply = await streamCharacterAndSpeak(
      said, mySession,
      _shouldCheckMoment
        ? (charText) => { _momentCheckPromise = checkMoment(said, charText, mySession); }
        : null
    );
    console.log('[FC] streamCharacterAndSpeak done, mySession:', mySession, 'session:', session);
    firstExchangeDone = true;
    console.log('[FC] firstExchangeDone set, looping back');
    silenceCount = 0;
    if (mySession !== session) break;
    if (!reply) {
      await speak(randomChoice(["Hmm?", "Say that again?", "What was that?"]), 'Mary');
    }
    if (mySession !== session) break;

    // Fallback: onTextReady wasn't triggered (non-streaming path or no fullText) — fire now
    if (_shouldCheckMoment && !_momentCheckPromise && reply) {
      const lastCharLine = conversationHistory[conversationHistory.length - 1]?.content || '';
      _momentCheckPromise = checkMoment(said, lastCharLine, mySession);
    }

    await pause(300);
    setMediaForSpeaker('Mary');
    els.name.textContent = getCharacterDisplayName(currentCharacterId);

    // ── Coached Practice gate: blocks if interrupt fired; discards check if still pending ──
    if (_coachActive) {
      await waitIfPaused(mySession);
      if (mySession !== session) break;
    }
  }

  clearInterval(timerInterval);
  const te = document.getElementById('free-timer');
  if (te) te.remove();
  if (mySession !== session) return;
  await runCoachFeedback(mySession);
}

/* ===== Coach Feedback ===== */
async function runCoachFeedback(mySession) {
  if(mySession!==session) return;
  els.name.textContent='Ryan'; els.text.textContent='Analyzing your session...';
  setMediaForSpeaker('Ryan');
  ryanOrbSetState('speaking');
  const sc=SCENARIOS[currentScenarioKey]||{};

  // Guard: if no conversation happened, skip coaching
  if (!conversationHistory.length) {
    await speak("Looks like we didn't get enough conversation to work with. Hit Try Again and give me something to coach.", 'Ryan');
    return;
  }
  // FIX 4: Fire API call and thinking line IN PARALLEL — no more dead silence
  // Both start at the same time. Thinking line plays while API is in flight.
  const coachPayload = JSON.stringify({
    conversation: conversationHistory,
    scenarioTitle: sc.title || 'Dating scenario',
    scenarioKey: currentScenarioKey || '',
    opener: firstUserOpener || '',
    lesson1Complete: localStorage.getItem('ozmeva_lesson1_complete') === 'true',
    lesson2Complete: localStorage.getItem('ozmeva_lesson2_complete') === 'true',
    lesson3Complete: localStorage.getItem('ozmeva_lesson3_complete') === 'true',
    lesson4Complete: localStorage.getItem('ozmeva_lesson4_complete') === 'true',
    practiceFocus: localStorage.getItem('ozmeva_practice_focus') || null,
    characterId: currentCharacterId || 'sofia',
  });

  // Start API call immediately (don't await yet)
  const coachPromise = (async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const coachController = new AbortController();
      const coachTimeout = setTimeout(() => coachController.abort(), 45000);
      try {
        const res = await fetch('/api/coach', {
          signal: coachController.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: coachPayload,
        });
        clearTimeout(coachTimeout);
        if (!res.ok) throw new Error('Coach API returned ' + res.status);
        return await res.json();
      } catch(fetchErr) {
        clearTimeout(coachTimeout);
        if (attempt === 2) throw fetchErr;
        console.warn('Coach timeout on attempt 1, retrying...');
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  })();

  // Play thinking lines while API is in flight
  const thinkingLines = [
    "Alright. Let me put together your feedback.",
    "Okay. Give me a moment.",
    "Let me go through that.",
    "Alright. One moment.",
    "Give me a moment.",
  ];
  const thinkingLine = thinkingLines[Math.floor(Math.random() * thinkingLines.length)];
  els.text.textContent = thinkingLine;
  await speak(thinkingLine, 'Ryan');
  if(mySession!==session) return;

  // Now wait for API — if it's already done, this resolves instantly
  let f;
  try {
    f = await coachPromise;
  } catch(err) {
    console.error('Coach feedback error:', err.message);
    await speak("Something went wrong pulling your feedback — the session was good though. Hit Try Again and let's go again.", 'Ryan');
    return;
  }

  if(mySession!==session) return;

  // Speaking order: [lesson1Eval →] [lesson2Eval →] [lesson3Eval →] [lesson4Eval →] [lesson5Eval →] part1 → trans2 → part2 → trans3 → part3 → trans4 → part4 → tryNextTime → score reveal
  if (f.lesson1Eval && mySession === session) {
    const l1url = await KokoroSpeech.prefetch(f.lesson1Eval, 'am_adam');
    await speak(f.lesson1Eval, 'Ryan', () => { els.text.textContent = f.lesson1Eval; }, l1url);
    if (mySession !== session) return;
    await pause(600);
  }
  if (f.lesson2Eval && mySession === session) {
    const l2url = await KokoroSpeech.prefetch(f.lesson2Eval, 'am_adam');
    await speak(f.lesson2Eval, 'Ryan', () => { els.text.textContent = f.lesson2Eval; }, l2url);
    if (mySession !== session) return;
    await pause(600);
  }
  if (f.lesson3Eval && mySession === session) {
    const l3url = await KokoroSpeech.prefetch(f.lesson3Eval, 'am_adam');
    await speak(f.lesson3Eval, 'Ryan', () => { els.text.textContent = f.lesson3Eval; }, l3url);
    if (mySession !== session) return;
    await pause(600);
  }
  if (f.lesson4Eval && mySession === session) {
    const l4url = await KokoroSpeech.prefetch(f.lesson4Eval, 'am_adam');
    await speak(f.lesson4Eval, 'Ryan', () => { els.text.textContent = f.lesson4Eval; }, l4url);
    if (mySession !== session) return;
    await pause(600);
  }
  if (f.lesson5Eval && mySession === session) {
    const l5url = await KokoroSpeech.prefetch(f.lesson5Eval, 'am_adam');
    await speak(f.lesson5Eval, 'Ryan', () => { els.text.textContent = f.lesson5Eval; }, l5url);
    if (mySession !== session) return;
    await pause(600);
  }
  const coachParts = [f.part1, f.part2, f.part3, f.part4].filter(Boolean);
  const transitions = [f.transition2, f.transition3, f.transition4];

  if (coachParts.length) {
    let prefetchPromise = KokoroSpeech.prefetch(coachParts[0], 'am_adam');
    for (let i = 0; i < coachParts.length; i++) {
      if (mySession !== session) return;
      const prefetchedUrl = await prefetchPromise;
      if (i + 1 < coachParts.length) {
        prefetchPromise = KokoroSpeech.prefetch(coachParts[i + 1], 'am_adam');
      }
      await speak(coachParts[i], 'Ryan', () => { els.text.textContent = coachParts[i]; }, prefetchedUrl);
      if(mySession!==session) return;

      if (i < coachParts.length - 1) {
        await pause(600);
        if(mySession!==session) return;
        const transition = transitions[i];
        if (transition) {
          await speak(transition, 'Ryan', () => { els.text.textContent = transition; });
          if(mySession!==session) return;
          await pause(400);
        }
      }
    }

    // Speak tryNextTime after part4
    if (f.tryNextTime && mySession === session) {
      await pause(600);
      const tryLine = `Next time, try this exact line: "${f.tryNextTime}"`;
      await speak(tryLine, 'Ryan', () => { els.text.textContent = tryLine; });
    }

  } else {
    els.text.textContent = f.spokenFeedback || f.spokenSummary;
    await speak(f.spokenFeedback || f.spokenSummary, 'Ryan');
  }

  // Score reveal LAST — dramatic pause, then the number
  if (mySession === session) {
    await pause(600);
    const scoreReveal = `I give that a... ${f.score} out of 10.`;
    await speak(scoreReveal, 'Ryan', () => { els.text.textContent = scoreReveal; });
  }

  if (mySession === session) {
    await pause(800);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const encouragement =
      f.score <= 4 ? pick([
        "Rough one. But now you know exactly where you lost her — that's worth something. Go again.",
        "That stung, didn't it? Good. That feeling is exactly what makes the next one better. Go again.",
        "She didn't bite. That's not failure — that's data. You know what to fix. Now fix it.",
      ]) :
      f.score <= 6 ? pick([
        "You had real moments in there. The gap between good and great is smaller than you think. Go again.",
        "She felt something — you just didn't hold it long enough. One more rep and you'll feel the difference.",
        "Closer than the score shows. You know what landed. Build on that. Go again.",
      ]) :
      f.score <= 8 ? pick([
        "That's the version of you she remembers. Now do it again and make it sharper.",
        "You created something real in there. That's not luck — that's skill. Go again.",
        "She was interested. You felt it. Lock in what worked and go again.",
      ]) : pick([
        "That's it. That's exactly it. Remember how that felt — that's your baseline now.",
        "She would have said yes. You know that. Now do it again at that level.",
        "That conversation had pull. Real pull. That's who you are when you stop overthinking.",
      ]);
    await speak(encouragement, 'Ryan', () => { els.text.textContent = encouragement; });
  }

  if(mySession!==session) return;
  showFeedbackCard(f);
}

/* ===== EkComments — per-scenario community comments ===== */
const EkComments = (() => {

  function renderList(comments, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!comments || comments.length === 0) {
      el.innerHTML = '<div style="color:#555;font-size:13px;text-align:center;padding:8px 0">No comments yet — be the first.</div>';
      return;
    }
    el.innerHTML = comments.slice().reverse().map(c => {
      const ts = new Date(c.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const scoreTag = c.score ? `<span style="background:#1a2a1a;color:#40c770;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:6px">${c.score}/10</span>` : '';
      return `
        <div style="background:#161820;border:1px solid #2b2e36;border-radius:10px;padding:12px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:13px;font-weight:700;color:#cfd6e4">${c.name || 'Anonymous'}</span>
            ${scoreTag}
            <span style="margin-left:auto;font-size:11px;color:#555">${ts}</span>
          </div>
          <div style="font-size:13px;color:#9aa4b2;line-height:1.6">${c.text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
        </div>`;
    }).join('');
  }

  async function load(scenarioKey) {
    try {
      const res = await fetch('/api/comments?scenario=' + scenarioKey);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      renderList(data.comments || [], 'ek-comments-list');
    } catch {
      const el = document.getElementById('ek-comments-list');
      if (el) el.innerHTML = '<div style="color:#555;font-size:13px;text-align:center">Comments unavailable.</div>';
    }
  }

  async function submit(scenarioKey, score) {
    const nameEl = document.getElementById('ek-comment-name');
    const inputEl = document.getElementById('ek-comment-input');
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) { inputEl.style.border = '1px solid #ff6b6b'; setTimeout(() => inputEl.style.border = '1px solid #2b2e36', 1500); return; }
    const name = nameEl ? nameEl.value.trim() : '';
    const listEl = document.getElementById('ek-comments-list');
    const tempEl = document.createElement('div');
    tempEl.style.cssText = 'background:#161820;border:1px solid #2b2e36;border-radius:10px;padding:12px;opacity:0.6';
    tempEl.innerHTML = `<div style="font-size:13px;color:#9aa4b2">${text.replace(/</g,'&lt;')}</div>`;
    if (listEl) listEl.prepend(tempEl);
    inputEl.value = '';
    if (nameEl) nameEl.value = '';
    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioKey, text, name, score }),
      });
      await load(scenarioKey);
    } catch {
      if (tempEl) tempEl.style.opacity = '1';
    }
  }

  return { load, submit };
})();
window.EkComments = EkComments;

function showFeedbackCard(f) {
  if (window.hideFullscreenBtn) window.hideFullscreenBtn();
  // Fallback for missing card fields — GPT sometimes omits them on short conversations
  if (!f.openerBreakdown || f.openerBreakdown === '---') f.openerBreakdown = f.part1 ? f.part1.split('.')[0] + '.' : 'Opener not captured.';
  if (!f.bestMoment || f.bestMoment === '---') f.bestMoment = 'Keep building — more reps will show your best moments.';
  if (!f.missedOpportunity || f.missedOpportunity === '---') f.missedOpportunity = 'Focus on asking specific questions about her world.';

  if (!f.wouldSheDateHim || f.wouldSheDateHim === '---') f.wouldSheDateHim = 'Maybe — show more genuine curiosity next time.';
  // Record this session in progress history
  if (f.score >= 1 && f.score <= 10) Progress.recordSession(f.score, currentScenarioKey, currentCharacterId);
  // Lesson 1 certification tracking
  if (f.lesson1Check && window.LessonPlayer) {
    const lc = f.lesson1Check;
    const passed = typeof lc.passed === 'boolean' ? lc.passed : (lc.score >= 4);
    LessonPlayer.recordCoachResult(currentCharacterId, passed);
  }
  // PostHog — session completed
  if (window.posthog) posthog.capture('session_completed', { scenario: currentScenarioKey, score: f.score });
  // PostHog — coach feedback viewed
  if (window.posthog) posthog.capture('coach_viewed', { scenario: currentScenarioKey, score: f.score });
  const scoreColor=f.score>=7?'#40c770':f.score>=5?'#ffb300':'#ff6b6b';
  const charDisplayName=getCharacterDisplayName(currentCharacterId)||'her';
  const bodyHTML=`
    <div style="display:grid;gap:10px;margin-bottom:14px">
      <div style="background:#161820;border:1px solid #2b2e3a;border-radius:10px;padding:12px">
        <div style="color:#9aa4b2;font-size:11px;font-weight:700;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">Your opener</div>
        <div style="color:#cfd6e4;font-size:13px;line-height:1.6">${f.openerBreakdown||'---'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#162016;border:1px solid #1e3a1e;border-radius:10px;padding:12px">
          <div style="color:#40c770;font-size:11px;font-weight:700;margin-bottom:5px;text-transform:uppercase">Best moment</div>
          <div style="color:#c8e6c9;font-size:13px;line-height:1.6">${f.bestMoment||'---'}</div>
        </div>
        <div style="background:#1e1616;border:1px solid #3a1e1e;border-radius:10px;padding:12px">
          <div style="color:#ff6b6b;font-size:11px;font-weight:700;margin-bottom:5px;text-transform:uppercase">Missed opportunity</div>
          <div style="color:#ffcdd2;font-size:13px;line-height:1.6">${f.missedOpportunity||'---'}</div>
        </div>
      </div>
      <div style="background:#1a1730;border:1px solid #2e2a50;border-radius:10px;padding:12px">
        <div style="color:#a78bfa;font-size:11px;font-weight:700;margin-bottom:5px;text-transform:uppercase">Try this next time</div>
        <div style="color:#e0d9ff;font-size:14px;font-style:italic">"${f.tryNextTime||f.tryThisLine||'---'}"</div>
      </div>
      <div style="background:#1a1620;border:1px solid #2e1e3a;border-radius:10px;padding:12px;display:flex;align-items:center;gap:12px">
        <div style="font-size:22px">${(f.wouldSheDateHim||'').startsWith('Yes')?'💜':(f.wouldSheDateHim||'').startsWith('No')?'✖':'🤔'}</div>
        <div>
          <div style="color:#d4a8ff;font-size:11px;font-weight:700;margin-bottom:3px;text-transform:uppercase">Would ${charDisplayName} date you?</div>
          <div style="color:#e0d9ff;font-size:13px;line-height:1.5">${f.wouldSheDateHim||'---'}</div>
        </div>
      </div>
    </div>`;

  els.text.innerHTML=`
    <div style="background:#1a1c22;border:1px solid #2b2e36;border-radius:16px;padding:20px;margin:10px 0;text-align:left;max-width:860px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <div style="font-size:42px;font-weight:900;color:${scoreColor}"><span id="ek-score-display">0</span><span style="font-size:20px;color:#666">/10</span></div>
        <div style="font-size:16px;color:#cfd6e4;line-height:1.5">${f.spokenSummary}</div>
      </div>
      ${bodyHTML}
      ${Progress.getHistoryHTML()}
      ${Certification.getProgressHTML(currentCharacterId)}
      <div style="text-align:center;margin-top:14px">
        <button onclick="if(window.posthog) posthog.capture('try_again_clicked', {scenario:'${currentScenarioKey}'}); playScenario('${currentScenarioKey}',true)" style="background:#ffb300;color:#000;border:none;border-radius:999px;padding:10px 28px;font-size:14px;font-weight:800;cursor:pointer;margin-right:8px">
          Try Again
        </button>
        <button onclick="playScenario(Object.keys(SCENARIOS).find(k=>k!=='${currentScenarioKey}'),false)" style="background:#2a2e36;color:#fff;border:1px solid #3a3f4b;border-radius:999px;padding:10px 28px;font-size:14px;font-weight:700;cursor:pointer">
          Next Scenario
        </button>
      </div>
      <div id="ek-comments-section" style="margin-top:20px;border-top:1px solid #2b2e36;padding-top:16px">
        <div style="font-size:13px;font-weight:700;color:#9aa4b2;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">💬 Community — ${SCENARIOS[currentScenarioKey]?.title || 'This scenario'}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          <input id="ek-comment-name" type="text" maxlength="30" placeholder="Your name (optional)" style="background:#161820;border:1px solid #2b2e36;border-radius:8px;padding:8px 12px;color:#e9ecf1;font-size:13px;outline:none" />
          <textarea id="ek-comment-input" maxlength="500" rows="3" placeholder="Share your experience — what worked, what didn't, what surprised you..." style="background:#161820;border:1px solid #2b2e36;border-radius:8px;padding:10px 12px;color:#e9ecf1;font-size:13px;resize:none;outline:none;font-family:inherit"></textarea>
          <button id="ek-post-btn" data-scenario="${currentScenarioKey}" data-score="${f.score}" onclick="window.EkComments.submit(this.dataset.scenario, parseInt(this.dataset.score)||0)" style="background:#ffb300;color:#000;border:none;border-radius:999px;padding:9px 24px;font-size:13px;font-weight:800;cursor:pointer;align-self:flex-end">Post comment</button>
        </div>
        <div id="ek-comments-list" style="display:flex;flex-direction:column;gap:10px"><div style="color:#666;font-size:13px;text-align:center">Loading comments…</div></div>
      </div>
    </div>`;
  // Animate score counter 0 → final over 1.5s
  const _scoreEl = document.getElementById('ek-score-display');
  if (_scoreEl) {
    const _target = f.score, _dur = 1500, _t0 = performance.now();
    (function _tick(now) {
      const p = Math.min((now - _t0) / _dur, 1);
      _scoreEl.textContent = Math.round(p * _target);
      if (p < 1) requestAnimationFrame(_tick);
    })(performance.now());
  }
  setTimeout(() => window.EkComments.load('${currentScenarioKey}'), 100);
}

/* ===== After demo ===== */
function renderAskToPractice(mySession) {
  if(mySession!==session) return;
  els.name.textContent='Ryan';
  els.text.textContent='Want to practice this one? Say yes or pick another scenario.';
  speak("Want to practice this one? Say yes, or pick another scenario.",'Ryan').then(()=>startListeningYesNo(mySession));
}

function startListeningYesNo(mySession) {
  if(mySession!==session) return;
  const r=createRecognition(); if(!r) return;
  rec=r; showListening(true);
  listenTimer=setTimeout(()=>{try{r.stop();}catch{}},6000);
  r.onresult=e=>{
    clearTimeout(listenTimer); showListening(false);
    if(e.results[0][0].transcript.toLowerCase().includes('yes')) playScenario(currentScenarioKey,true);
    else speak("Okay -- choose any scenario from the list.",'Ryan');
  };
  r.onerror=()=>showListening(false);
  r.onend=()=>showListening(false);
  try{r.start();}catch{}
}

/* ===== UI ===== */
function renderShelf() {
  // Restore hero + banner when user returns to the shelf from a session
  const _heroEl = document.getElementById('ek-hero');
  if (_heroEl) _heroEl.style.display = '';
  const _bannerEl = document.getElementById('ek-practice-banner');
  if (_bannerEl) {
    const alreadyComplete = typeof LessonPlayer !== 'undefined' && LessonPlayer.isComplete();
    const dismissed = sessionStorage.getItem('ek-lesson-banner-dismissed');
    _bannerEl.style.display = (!alreadyComplete && !dismissed) ? 'flex' : 'none';
  }

  const keys=Object.keys(SCENARIOS).filter(k=>!SCENARIOS[k].hidden);
  // #scenarioSelect was removed from index.html (a1ae651) — guard against null
  if (els.select) {
    els.select.innerHTML=keys.map(k=>`<option value="${k}">${SCENARIOS[k].title}</option>`).join('');
    els.select.onchange=()=>playScenario(els.select.value,false);
  }
  els.shelf.innerHTML='';
  const limit=3;
  keys.slice(0,limit).forEach(k=>els.shelf.appendChild(makeCard(k)));
  if(keys.length>limit){
    els.showMore.style.display='block';
    els.showMore.textContent='+ '+(keys.length-limit)+' more -- show all';
    let exp=false;
    els.showMore.onclick=()=>{
      exp=!exp; els.shelf.innerHTML='';
      (exp?keys:keys.slice(0,limit)).forEach(k=>els.shelf.appendChild(makeCard(k)));
      els.showMore.textContent=exp?'Show fewer':'+ '+(keys.length-limit)+' more -- show all';
    };
  } else els.showMore.style.display='none';
}

function makeCard(key) {
  const sc=SCENARIOS[key];
  const card=document.createElement('div'); card.className='sc-card';
  const img=document.createElement('img'); img.className='sc-thumb'; img.src=sc.thumb||'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ryan.jpg'; img.onerror=()=>img.style.display='none';
  const title=document.createElement('div'); title.innerHTML='<div class="sc-title">'+sc.title+'</div><div class="sc-sub">Click to load</div>';
  card.appendChild(img); card.appendChild(title);
  card.onclick=()=>showPracticeFocusModal(key);
  return card;
}

// Central registry of all lessons — add new entries here as lessons ship.
// id must match the practiceFocus value sent to the APIs ('lesson1', 'lesson2', …).
const LESSON_REGISTRY = [
  { id: 'lesson1', label: 'Lesson 1 — The Approach (OTIMC)',        lsKey: 'ozmeva_lesson1_complete' },
  { id: 'lesson2', label: 'Lesson 2 — Holding Your Ground (FRAME)', lsKey: 'ozmeva_lesson2_complete' },
  { id: 'lesson3', label: 'Lesson 3 — The Long Game (PACE)',        lsKey: 'ozmeva_lesson3_complete' },
  { id: 'lesson4', label: 'Lesson 4 — The Thread (CHAIN)',          lsKey: 'ozmeva_lesson4_complete' },
  { id: 'lesson5', label: 'Lesson 5 — The Read (TRACE)',           lsKey: 'ozmeva_lesson5_complete' },
];

// Mnemonic data sourced from lesson-player.js LESSON_DATA.mnemonicMap — keep in sync when lessons change.
const LESSON_MNEMONICS = {
  lesson1: {
    label: 'OTIMC',
    items: [
      { letter: 'O', meaning: 'Observe something specific' },
      { letter: 'T', meaning: 'Tease playfully' },
      { letter: 'M', meaning: "Mystery — don't give it all away" },
      { letter: 'I', meaning: 'Imply your interest' },
      { letter: 'C', meaning: 'Close naturally' },
    ],
  },
  lesson2: {
    label: 'FRAME',
    items: [
      { letter: 'F', meaning: 'Feel Nothing — stay still under pressure' },
      { letter: 'R', meaning: 'Reframe — offer a different way to see it' },
      { letter: 'A', meaning: "Add Humor — don't defend, just deflect" },
      { letter: 'M', meaning: 'Make Her Qualify — stay curious, push deeper' },
      { letter: 'E', meaning: 'Exit — decision-makers leave first' },
    ],
  },
  lesson3: {
    label: 'PACE',
    items: [
      { letter: 'P', meaning: 'Pause — make her wait for it' },
      { letter: 'A', meaning: 'Ask-back — redirect back to her' },
      { letter: 'C', meaning: 'Contain — hold the compliment' },
      { letter: 'E', meaning: 'Earn — let her show it first' },
    ],
  },
  lesson4: {
    label: 'CHAIN',
    items: [
      { letter: 'C', meaning: 'Catch threads — hear all of them before you respond' },
      { letter: 'H', meaning: 'Hook the richest — pick the one with the most charge' },
      { letter: 'A', meaning: 'Ask deeper — one layer further on the same thread' },
      { letter: 'I', meaning: 'Inject yourself — share something real and connected' },
      { letter: 'N', meaning: 'Never abandon a live thread — go back to what she lit up about' },
    ],
  },
  lesson5: {
    label: 'TRACE',
    items: [
      { letter: 'T', meaning: 'Track gaze — name it when she holds it too long' },
      { letter: 'R', meaning: 'Register proximity — notice when she moves closer' },
      { letter: 'A', meaning: 'Attend to alignment — catch her mirroring your posture' },
      { letter: 'C', meaning: 'Catch touch — acknowledge brief deliberate contact' },
      { letter: 'E', meaning: 'Enter — make your move before the window closes' },
    ],
  },
};

// Drill rep content per lesson — Sofia's line + pass criteria for each letter.
const DRILL_REPS = {
  lesson1: [
    {
      letter: 'O', cue: 'Observe',
      sofiasLine: 'So what made you come talk to me?',
      criteria: 'PASS if the user names something real they noticed — a detail about her, the scene, or the situation. FAIL if the response is generic ("you seemed interesting") with nothing real attached.',
    },
    {
      letter: 'T', cue: 'Tease',
      sofiasLine: 'Wow, another guy walking up to me. So original.',
      criteria: "PASS if the user plays along, teases back, or agrees with a twist — anything that doesn't get defensive or apologetic. FAIL if the user apologizes, over-explains, or tries to convince her they're different.",
    },
    {
      letter: 'M', cue: 'Mystery',
      sofiasLine: 'So what do you do?',
      criteria: 'PASS if the user gives a partial, vague, or intriguing answer — even a short deflection counts. FAIL only if the user gives a full resume: job title, company, years, everything at once.',
    },
    {
      letter: 'I', cue: 'Imply',
      sofiasLine: "I don't really talk to strangers.",
      criteria: 'PASS if the user implies interest through subtext or quiet confidence — without begging or stating attraction directly. FAIL if the user explicitly declares attraction or over-explains why she should talk to them.',
    },
    {
      letter: 'C', cue: 'Close',
      sofiasLine: 'This was actually kind of fun.',
      criteria: 'PASS if the user moves toward a natural next step — number ask, invite somewhere, suggest continuing — without hedge language ("no pressure", "only if you want"). FAIL if the user says something like "yeah it was" with no move.',
    },
  ],
  lesson2: [
    {
      letter: 'F', cue: 'Feel Nothing',
      sofiasLine: 'Are you always this weird?',
      criteria: 'PASS if the user stays calm — agrees, laughs it off, or turns it back without defending. FAIL if the user gets flustered, apologizes, or over-explains.',
    },
    {
      letter: 'R', cue: 'Reframe',
      sofiasLine: "You're probably just like every other guy who talks to me.",
      criteria: 'PASS if the user reframes or flips it — makes her qualify, challenges the assumption, or sidesteps it with confidence. FAIL if the user argues against it, agrees, or rushes to prove they are different.',
    },
    {
      letter: 'A', cue: 'Add Humor',
      sofiasLine: "I don't think this is going anywhere.",
      criteria: 'PASS if the user deflects with humor — light, playful, does not take the bait. FAIL if the user gets serious, defensive, or tries to logic her out of it.',
    },
    {
      letter: 'M', cue: 'Make Her Qualify',
      sofiasLine: "I'm actually pretty interesting, you know.",
      criteria: "PASS if the user turns it back and makes her prove something — 'prove it', 'I'm listening', bold claim energy. FAIL if the user agrees, compliments her, or says something like 'I'm sure you are'.",
    },
    {
      letter: 'E', cue: 'Exit',
      sofiasLine: 'I could probably talk to you all night, honestly.',
      criteria: 'PASS if the user initiates a confident close or natural ending on their terms — number ask, plan, or clean exit. FAIL if the user just keeps talking, trails off, or waits for her to decide.',
    },
  ],
  lesson3: [
    {
      letter: 'P', cue: 'Pause',
      sofiasLine: 'Do you actually like me, or are you just here for fun?',
      criteria: "PASS if the user gives a non-direct answer — holds back, deflects, or makes her wait for it. FAIL if the user immediately confirms feelings ('yes I like you', 'no I'm not seeing anyone') without making her earn the answer.",
    },
    {
      letter: 'A', cue: 'Ask-back',
      sofiasLine: 'What do you actually do for work?',
      criteria: "PASS if the user answers briefly and then redirects back to her with a question or 'your turn'. FAIL if the user answers entirely about themselves with no question back — turn ends completely on them.",
    },
    {
      letter: 'C', cue: 'Contain',
      sofiasLine: "I'm actually really enjoying talking to you.",
      criteria: "PASS if the user receives it calmly without rushing to match or stack compliments — holds the tension. FAIL if the user immediately mirrors with multiple compliments ('you're beautiful, I really like you too') or gives more than they should.",
    },
    {
      letter: 'E', cue: 'Earn',
      sofiasLine: "So tell me — what do you want from this?",
      criteria: "PASS if the user lets her show more interest before committing — gives a light or non-answer, or turns it back on her. FAIL if the user immediately declares strong interest ('I really like you', 'I want to take you out') before she has earned it.",
    },
  ],
  lesson4: [
    {
      letter: 'C', cue: 'Catch threads',
      sofiasLine: "I've been here before. My friend used to work here — she moved to Amsterdam a while back. Got a job she'd been after for years.",
      criteria: "PASS if the user picks up on one of the specific threads she offered (the friend, the move, years of trying for something) rather than ignoring them and asking something unrelated. FAIL if the user responds with a generic pivot ('Oh nice, what do you do?') that bypasses what she gave them.",
    },
    {
      letter: 'H', cue: 'Hook the richest',
      sofiasLine: "I was here last week. Kind of a weird night. Anyway — it's quieter on weekdays.",
      criteria: "PASS if the user picks up on 'weird night' — the thread with clear emotional charge — rather than the surface remark about weekdays. FAIL if the user responds to 'quieter on weekdays' or asks a generic question that ignores the signal she gave.",
    },
    {
      letter: 'A', cue: 'Ask deeper',
      sofiasLine: "I don't usually end up talking to people I've just met. I'm pretty selective about it.",
      criteria: "PASS if the user asks one question that goes one layer deeper on the same thread — why, what made her that way, what that actually means in practice. FAIL if the user pivots to a new topic, gives a generic reply ('Me too'), or asks something unconnected to what she said.",
    },
    {
      letter: 'I', cue: 'Inject yourself',
      sofiasLine: "I've been trying to figure out what I actually want. For a while now. It's kind of exhausting.",
      criteria: "PASS if the user briefly shares something genuine from their own life that connects to what she described — without making it a monologue or pivoting entirely to their own story. FAIL if the user stays in question mode ('What do you mean?'), gives a platitude ('I get that'), or takes over the thread entirely.",
    },
    {
      letter: 'N', cue: 'Never abandon a live thread',
      sofiasLine: "I used to do something completely different before this. But that's — anyway. Do you come here a lot?",
      criteria: "PASS if the user goes back to the dropped thread ('What did you used to do?') instead of accepting her redirect and answering her question. FAIL if the user answers her redirect and lets the disclosure she started drop.",
    },
  ],
  lesson5: [
    {
      letter: 'T', cue: 'Track gaze',
      sofiasLine: "(You hold his gaze a little past where you meant to.) ...so where do you usually end up on a night like this?",
      criteria: "PASS if the user names or plays with the eye contact — 'don't look away on my account', 'I noticed that', anything that engages the gaze rather than ignoring it. FAIL if the user only answers the conversational question and makes no reference to the stage direction.",
    },
    {
      letter: 'R', cue: 'Register proximity',
      sofiasLine: "(You're closer than you were. You don't remember crossing the distance.) ...I feel like I've seen you here before.",
      criteria: "PASS if the user names or plays with the proximity — 'we started much further apart', 'you moved over here', 'I'm not moving'. FAIL if the user only responds to the conversational content and ignores the closeness entirely.",
    },
    {
      letter: 'A', cue: 'Attend to alignment',
      sofiasLine: "(Your body has settled into the same angle as his — you can't say when.) ...honestly, this place gets better after midnight.",
      criteria: "PASS if the user names the mirroring — 'you match whoever you're talking to', 'you just did what I did', any acknowledgment of the alignment. FAIL if the user ignores the stage direction and only responds to the surface remark.",
    },
    {
      letter: 'C', cue: 'Catch touch',
      sofiasLine: "(Your hand settles on his arm for a second. Lifts.) ...sorry. Where were we?",
      criteria: "PASS if the user names or plays with the touch — 'you did that on purpose', 'that wasn't accidental', any acknowledgment that the contact happened. FAIL if the user ignores it entirely and just resumes conversation.",
    },
    {
      letter: 'E', cue: 'Enter',
      sofiasLine: "...I should probably go find what I actually came in for. [shifts]",
      criteria: "PASS if the user makes a direct move with no hedge language — asks for her number, suggests continuing somewhere else, or includes her in what they're doing. FAIL if the user lets the window close, uses hedge language ('maybe we could...'), or asks permission rather than making a statement.",
    },
  ],
};

function showMnemonicPill(practiceFocus) {
  const pill = document.getElementById('mnemonic-pill');
  if (!pill) return;
  const data = LESSON_MNEMONICS[practiceFocus];
  if (!data || localStorage.getItem('ozmeva_mnemonic_off') === '1') { pill.style.display = 'none'; return; }
  document.getElementById('mnemonic-pill-label').textContent = data.label + ' ▸';
  document.getElementById('mnemonic-card-name').textContent  = data.label;
  document.getElementById('mnemonic-items').innerHTML = data.items.map(it =>
    `<li class="mn-item"><span class="mn-letter">${it.letter}</span><span class="mn-meaning">${it.meaning}</span></li>`
  ).join('');
  const expanded = localStorage.getItem('ozmeva_mnemonic_expanded') === '1';
  document.getElementById('mnemonic-pill-collapsed').style.display = expanded ? 'none' : 'flex';
  document.getElementById('mnemonic-pill-card').style.display      = expanded ? 'block' : 'none';
  pill.style.display = 'block';
}

function hideMnemonicPill() {
  const pill = document.getElementById('mnemonic-pill');
  if (pill) pill.style.display = 'none';
}

function initMnemonicPill() {
  const label    = document.getElementById('mnemonic-pill-label');
  const offBtn   = document.getElementById('mnemonic-pill-off');
  const collapse = document.getElementById('mnemonic-card-collapse');
  if (!label) return;
  label.addEventListener('click', () => {
    localStorage.setItem('ozmeva_mnemonic_expanded', '1');
    document.getElementById('mnemonic-pill-collapsed').style.display = 'none';
    document.getElementById('mnemonic-pill-card').style.display      = 'block';
  });
  collapse.addEventListener('click', () => {
    localStorage.setItem('ozmeva_mnemonic_expanded', '0');
    document.getElementById('mnemonic-pill-collapsed').style.display = 'flex';
    document.getElementById('mnemonic-pill-card').style.display      = 'none';
  });
  offBtn.addEventListener('click', () => {
    localStorage.setItem('ozmeva_mnemonic_off', '1');
    document.getElementById('mnemonic-pill').style.display = 'none';
  });
}

function buildDrillSkipHTML(focus) {
  const lbl = (LESSON_MNEMONICS[focus] || {}).label || focus.toUpperCase();
  const S  = 'display:block;width:100%;background:#252836;border:1px solid #2f3344;border-radius:10px;padding:14px 16px;color:#e4e8f1;font-size:14px;font-weight:600;cursor:pointer;text-align:left;transition:background .15s,border-color .15s';
  const HV = `onmouseover="this.style.background='#2e3245';this.style.borderColor='#4a5070'" onmouseout="this.style.background='#252836';this.style.borderColor='#2f3344'"`;
  return `
<p style="font-size:18px;font-weight:700;color:#f0f2f6;margin:0 0 6px">Start with a warm-up?</p>
<p style="font-size:13px;color:#8a93a8;margin:0 0 18px;line-height:1.5">${(DRILL_REPS[focus]||[]).length} quick reps — one for each ${lbl} skill.</p>
<div style="display:flex;flex-direction:column;gap:8px">
  <button id="drill-warmup-btn" style="${S}" ${HV}>
    <div>Warm up first <span style="color:#6b7495;font-size:12px">(${(DRILL_REPS[focus]||[]).length} reps)</span></div>
    <div style="font-size:12px;color:#6b7495;margin-top:3px">One exchange per skill before the full scenario</div>
  </button>
  <button id="drill-skip-btn" style="${S}" ${HV}>
    <div>Skip to full scenario</div>
    <div style="font-size:12px;color:#6b7495;margin-top:3px">Jump straight in</div>
  </button>
</div>`;
}

async function runDrill(lessonKey, scenarioKey) {
  stopEverything();
  const mySession = session;

  // Apply the character who will run this scenario before the drill starts.
  // Without this, the drill warm-up always shows Sofia (the boot default).
  if (!pickerHasOverride && SCENARIO_CHARACTER_MAP[scenarioKey]) {
    currentCharacterId = SCENARIO_CHARACTER_MAP[scenarioKey];
  }
  const drillSet = AVATAR_SETS.find(s => s.id === currentCharacterId);
  if (drillSet) applyAvatarSet(drillSet);

  resetConversation();
  firstUserOpener = null;
  hideCoachSuggestions();
  updateCoachBtnVisibility();
  showMnemonicPill(lessonKey);

  const reps = DRILL_REPS[lessonKey];

  for (let i = 0; i < reps.length; i++) {
    if (mySession !== session) return;
    const rep = reps[i];

    // Status card — brief rep indicator before Sofia speaks
    setMediaForSpeaker('Ryan');
    els.name.textContent = `Warm-up ${i + 1} / ${reps.length}`;
    els.text.textContent = `${rep.letter} — ${rep.cue}`;
    await pause(1200);
    if (mySession !== session) return;

    // Sofia delivers her line
    els.name.textContent = getCharacterDisplayName(currentCharacterId);
    els.text.dataset.pendingText = rep.sofiasLine;
    await speak(rep.sofiasLine, 'Mary');
    if (mySession !== session) return;

    // Show her line as context while user composes reply
    els.name.textContent = 'Your Turn';
    els.text.textContent = rep.sofiasLine;
    await pause(300);
    if (mySession !== session) return;

    const userText = await listenForUser(mySession, 60_000);
    if (mySession !== session) return;
    if (!userText) break;  // timeout — skip remaining reps, still launch scenario

    // Lightweight eval
    let coaching = 'Keep going.';
    try {
      const resp = await fetch('/api/drill-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonKey, letter: rep.letter, cue: rep.cue,
          sofiasLine: rep.sofiasLine, userResponse: userText, criteria: rep.criteria,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.coaching) coaching = data.coaching;
      }
    } catch (_) {}

    if (mySession !== session) return;

    // Ryan delivers coaching line
    setMediaForSpeaker('Ryan');
    els.name.textContent = 'Ryan';
    els.text.dataset.pendingText = coaching;
    await speak(coaching, 'Ryan');
    if (mySession !== session) return;
    await pause(700);
  }

  if (mySession !== session) return;

  localStorage.setItem(`ozmeva_${lessonKey}_drill_done`, '1');
  const bridge = "Good. Now let's run the full scenario.";
  setMediaForSpeaker('Ryan');
  els.name.textContent = 'Ryan';
  els.text.dataset.pendingText = bridge;
  await speak(bridge, 'Ryan');
  if (mySession !== session) return;
  await pause(600);
  if (mySession !== session) return;
  playScenario(scenarioKey, true);
}

function showPracticeFocusModal(scenarioKey) {
  const completed = LESSON_REGISTRY.filter(l => localStorage.getItem(l.lsKey) === 'true');
  const latest    = completed[completed.length - 1] || null;
  const modal     = document.getElementById('practice-focus-modal');
  const body      = document.getElementById('practice-focus-body');

  function start(focus, coached = false) {
    localStorage.setItem('ozmeva_practice_focus', focus);
    if (coached) {
      localStorage.setItem('ozmeva_coached_mode', '1');
    } else {
      localStorage.removeItem('ozmeva_coached_mode');
    }
    if (!DRILL_REPS[focus]) {
      // No drill for this focus (Free Practice, All Lessons)
      modal.style.display = 'none';
      playScenario(scenarioKey, true);
      return;
    }
    if (localStorage.getItem(`ozmeva_${focus}_drill_done`) !== '1') {
      // First time — forced drill (runDrill calls playScenario internally when done)
      modal.style.display = 'none';
      runDrill(focus, scenarioKey);
      return;
    }
    // Subsequent entries — offer skip choice within the same modal
    body.innerHTML = buildDrillSkipHTML(focus);
    document.getElementById('drill-warmup-btn').onclick = () => {
      modal.style.display = 'none';
      runDrill(focus, scenarioKey);
    };
    document.getElementById('drill-skip-btn').onclick = () => {
      modal.style.display = 'none';
      playScenario(scenarioKey, true);
    };
  }

  const S   = 'display:block;width:100%;background:#252836;border:1px solid #2f3344;border-radius:10px;padding:14px 16px;color:#e4e8f1;font-size:14px;font-weight:600;cursor:pointer;text-align:left;transition:background .15s,border-color .15s';
  const SUB = 'font-size:12px;color:#6b7495;margin-top:3px';
  const HV  = `onmouseover="this.style.background='#2e3245';this.style.borderColor='#4a5070'" onmouseout="this.style.background='#252836';this.style.borderColor='#2f3344'"`;
  const hasAny      = completed.length > 0;
  const completedIds = new Set(completed.map(l => l.id));

  // ── Lesson list (shared, searchable — scales to 100+ lessons) ─────────────
  const lessonListHTML = `
  <div id="pfm-list" style="display:none;margin-top:6px;background:#141620;border:1px solid #252836;border-radius:10px;overflow:hidden">
    <div style="padding:8px 10px;border-bottom:1px solid #1e2132">
      <input id="pfm-search" type="text" placeholder="Search lessons…" autocomplete="off"
        style="width:100%;box-sizing:border-box;padding:7px 10px;background:#0e1018;border:1px solid #252836;border-radius:6px;color:#e4e8f1;font-size:13px;outline:none">
    </div>
    <div id="pfm-list-items" style="max-height:200px;overflow-y:auto">
      ${LESSON_REGISTRY.map(l =>
        `<button data-lessonid="${l.id}" data-label="${l.label.toLowerCase()}"
          style="display:block;width:100%;padding:11px 16px;color:#c9d0e8;font-size:13px;font-weight:600;cursor:pointer;text-align:left;background:transparent;border:none;border-bottom:1px solid #1e2132;transition:background .12s"
          onmouseover="this.style.background='#1e2132'" onmouseout="this.style.background='transparent'">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>${l.label}</span>
            ${completedIds.has(l.id) ? '<span style="font-size:11px;color:#5db870;font-weight:700">✓</span>' : ''}
          </div>
        </button>`
      ).join('')}
    </div>
  </div>`;

  if (!hasAny) {
    // ── New / zero-lesson user: minimal first-decision UI ──────────────────
    // Primary: Start Practicing (Free Practice). Secondary: choose a lesson.
    body.innerHTML = `
<p style="font-size:18px;font-weight:700;color:#f0f2f6;margin:0 0 4px">Ready to practice?</p>
<p style="font-size:13px;color:#8a93a8;margin:0 0 18px;line-height:1.5">She's ready when you are.</p>
<div style="display:flex;flex-direction:column;gap:10px">

<button id="pfm-free"
  style="display:block;width:100%;background:#1c2a1e;border:1px solid #2a4a2f;border-radius:10px;padding:16px;color:#e4e8f1;font-size:15px;font-weight:700;cursor:pointer;text-align:left;transition:background .15s,border-color .15s"
  onmouseover="this.style.background='#243524';this.style.borderColor='#3a6040'" onmouseout="this.style.background='#1c2a1e';this.style.borderColor='#2a4a2f'">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <span>Start Practicing →</span>
    <span style="font-size:11px;color:#5db870;font-weight:600;background:#1a3320;padding:2px 8px;border-radius:4px">Recommended</span>
  </div>
  <div style="${SUB}">Free conversation — no pressure, just practice</div>
</button>

<div style="display:flex;align-items:center;gap:10px;margin:2px 0">
  <div style="flex:1;height:1px;background:#252836"></div>
  <span style="font-size:12px;color:#4a5070">or focus on a lesson</span>
  <div style="flex:1;height:1px;background:#252836"></div>
</div>

<div id="pfm-choose-wrap">
  <button id="pfm-choose-btn" style="${S}" ${HV}>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span>Choose a Lesson</span>
      <span id="pfm-arrow" style="font-size:16px;transition:transform .2s;display:inline-block">›</span>
    </div>
    <div style="${SUB}">Practice a specific lesson's skills</div>
  </button>
  ${lessonListHTML}
</div>

</div>`;
  } else {
    // ── Returning user: primary actions prominent, secondary options below ──
    body.innerHTML = `
<p style="font-size:18px;font-weight:700;color:#f0f2f6;margin:0 0 4px">What do you want to practice?</p>
<p style="font-size:13px;color:#8a93a8;margin:0 0 16px;line-height:1.5">She adapts to your choice.</p>
<div style="display:flex;flex-direction:column;gap:8px">

<button id="pfm-latest"
  style="display:block;width:100%;background:#1e2a3a;border:1px solid #2a4a6a;border-radius:10px;padding:14px 16px;color:#e4e8f1;font-size:14px;font-weight:700;cursor:pointer;text-align:left;transition:background .15s,border-color .15s"
  onmouseover="this.style.background='#253344';this.style.borderColor='#3a6080'" onmouseout="this.style.background='#1e2a3a';this.style.borderColor='#2a4a6a'">
  <div style="display:flex;align-items:center;gap:8px">
    <span>▶</span>
    <span>${latest.label.replace(/^Lesson \d+ — /, '')}</span>
    <span style="font-size:11px;color:#6a9abf;font-weight:600;background:#152030;padding:2px 6px;border-radius:4px">Latest</span>
  </div>
  <div style="${SUB}">Continue with your most recently completed lesson</div>
</button>

<button id="pfm-coached"
  style="display:block;width:100%;background:#1e2030;border:1px solid #3d3060;border-radius:10px;padding:14px 16px;color:#e4e8f1;font-size:14px;font-weight:600;cursor:pointer;text-align:left;transition:background .15s,border-color .15s"
  onmouseover="this.style.background='#28204a';this.style.borderColor='#6a4fbf'" onmouseout="this.style.background='#1e2030';this.style.borderColor='#3d3060'">
  <div style="display:flex;align-items:center;gap:8px"><span>⚡</span><span>Coached Practice</span></div>
  <div style="${SUB}">Ryan interrupts with real-time coaching — rewind and retry on the spot</div>
</button>

<div style="display:flex;align-items:center;gap:10px;margin:4px 0">
  <div style="flex:1;height:1px;background:#252836"></div>
  <span style="font-size:12px;color:#4a5070">or explore</span>
  <div style="flex:1;height:1px;background:#252836"></div>
</div>

<div id="pfm-choose-wrap">
  <button id="pfm-choose-btn" style="${S}" ${HV}>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span>Choose a Lesson</span>
      <span id="pfm-arrow" style="font-size:16px;transition:transform .2s;display:inline-block">›</span>
    </div>
    <div style="${SUB}">Pick any lesson to focus on</div>
  </button>
  ${lessonListHTML}
</div>

<button id="pfm-free" style="${S}" ${HV}>
  <div>Free Practice</div>
  <div style="${SUB}">Open conversation — no skill testing or evaluation</div>
</button>

<button id="pfm-all" style="${S}" ${HV}>
  <div>All Lessons</div>
  <div style="${SUB}">Test every completed lesson's skills in one session</div>
</button>

</div>`;
  }

  // ── Event listeners ──────────────────────────────────────────────────────
  document.getElementById('pfm-free').addEventListener('click', () => start('free'));

  const chooseBtn = document.getElementById('pfm-choose-btn');
  const list      = document.getElementById('pfm-list');
  const arrow     = document.getElementById('pfm-arrow');
  let open = false;
  chooseBtn.addEventListener('click', () => {
    open = !open;
    list.style.display    = open ? 'block' : 'none';
    arrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    if (open) { const s = document.getElementById('pfm-search'); if (s) setTimeout(() => s.focus(), 40); }
  });
  const searchInput = document.getElementById('pfm-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#pfm-list-items [data-lessonid]').forEach(btn => {
        btn.style.display = btn.dataset.label.includes(q) ? 'block' : 'none';
      });
    });
  }
  list.querySelectorAll('[data-lessonid]').forEach(btn => {
    btn.addEventListener('click', () => start(btn.getAttribute('data-lessonid')));
  });

  if (hasAny) {
    document.getElementById('pfm-latest').addEventListener('click', () => start(latest.id));
    document.getElementById('pfm-coached').addEventListener('click', () => start(latest.id, true));
    document.getElementById('pfm-all').addEventListener('click', () => start('all'));
  }

  modal.style.display = 'flex';
}

function renderAvatarPicker() {
  if(!els.pickerBackdrop) return;
  els.pickerGrid.innerHTML=AVATAR_SETS.filter(s=>!s.hidden).map(s=>`
    <div class="pick-card" data-id="${s.id}">
      <img class="pick-img" src="${s.thumb||'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/ryan.jpg'}" alt="${s.label}" style="height:160px;object-fit:cover;">
      <div class="pick-meta">
        <b style="font-size:15px">${s.label}</b>
        <div style="color:#9aa4b2;font-size:12px;margin-top:3px">${s.vibe||''}</div>
        <div style="color:#ffb300;font-size:11px;font-weight:700;margin-top:4px;text-transform:uppercase;letter-spacing:.05em">${s.scenario||''}</div>
        ${Certification.getBadgeHTML(s.id)}
      </div>
    </div>`).join('');
  els.pickerGrid.querySelectorAll('.pick-card').forEach(card=>{
    card.onclick=()=>{
      const set=AVATAR_SETS.find(x=>x.id===card.getAttribute('data-id'));
      applyAvatarSet(set);
      currentCharacterId = set.id;
      pickerHasOverride = true;
      els.pickerBackdrop.style.display='none';
      renderShelf(); Metrics.refreshUI(currentScenarioKey||Object.keys(SCENARIOS)[0]);
      // Do NOT auto-launch scenario — user picks it manually from the shelf
    };
  });
  els.pickerBackdrop.style.display='flex';
  // Close picker when clicking outside the grid
  els.pickerBackdrop.onclick=(e)=>{
    if(e.target===els.pickerBackdrop) els.pickerBackdrop.style.display='none';
  };
}

els.chooseBtn.onclick=renderAvatarPicker;

/* ===== Helpers ===== */
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const randomChoice=arr=>arr[Math.floor(Math.random()*arr.length)];
function similarity(actual,promptText){
  const exp=promptText.replace('Say: ','').replace(/'/g,'').toLowerCase();
  const words=exp.split(/\s+/).filter(w=>w.length>2);
  const said=(actual||'').toLowerCase();
  return words.filter(w=>said.includes(w)).length/Math.max(1,words.length);
}

/* ===== Onboarding ===== */
const ONBOARDING_KEY = 'ek-onboarding-v1';
function hasSeenOnboarding() { try { return !!localStorage.getItem(ONBOARDING_KEY); } catch { return false; } }
function markOnboardingDone() { try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {} }

function launchHeroV6() {
  const R2 = 'https://pub-8dcb197cb8474bcfb3ef344b733745ca.r2.dev/';

  // Inject CSS (scoped to ek-h6- prefix to avoid conflicts)
  if (!document.getElementById('ek-h6-style')) {
    const s = document.createElement('style');
    s.id = 'ek-h6-style';
    s.textContent = `
      #ek-hero-v6{position:fixed;inset:0;z-index:10000;overflow-y:auto;
        background:radial-gradient(ellipse 900px 500px at 85% -10%,rgba(217,160,84,.09),transparent 60%),
          radial-gradient(ellipse 700px 600px at -10% 90%,rgba(94,200,217,.05),transparent 60%),#15171C;
        font-family:'Inter',system-ui,sans-serif;color:#F2EFE9;}
      #ek-hero-v6 *,#ek-hero-v6 *::before,#ek-hero-v6 *::after{box-sizing:border-box;}
      .ek-h6-nav{display:flex;align-items:center;justify-content:space-between;
        max-width:1180px;margin:0 auto;padding:28px 32px 0;}
      .ek-h6-brand{font-family:'Fraunces',serif;font-weight:600;font-size:20px;
        letter-spacing:.01em;color:#F2EFE9;}
      .ek-h6-navlinks{display:flex;gap:32px;align-items:center;font-size:14px;color:#8A8F98;}
      .ek-h6-navlinks a{color:#8A8F98;text-decoration:none;}
      .ek-h6-signin-btn{color:#15171C;background:#F2EFE9;padding:9px 18px;border-radius:100px;
        font-size:13.5px;font-weight:600;border:none;cursor:pointer;}
      .ek-h6-signin-btn:focus-visible{outline:2px solid #D9A054;outline-offset:2px;}
      .ek-h6-hero{max-width:1180px;margin:0 auto;padding:64px 32px 40px;
        display:grid;grid-template-columns:1.02fr .98fr;gap:60px;align-items:center;}
      .ek-h6-eyebrow{display:inline-flex;align-items:center;gap:8px;
        font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.08em;
        color:#D9A054;text-transform:uppercase;margin-bottom:22px;}
      .ek-h6-eyebrow::before{content:'';width:6px;height:6px;border-radius:50%;
        background:#D9A054;box-shadow:0 0 0 4px rgba(217,160,84,.14);}
      .ek-h6-h1{font-family:'Fraunces',serif;font-weight:500;font-size:50px;line-height:1.1;
        letter-spacing:-.01em;margin:0 0 22px;color:#F2EFE9;}
      .ek-h6-h1 em{font-style:italic;font-weight:500;color:#D9A054;}
      .ek-h6-sub{font-size:16.5px;line-height:1.65;color:#8A8F98;max-width:460px;margin:0 0 30px;}
      .ek-h6-prompt-label{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#8A8F98;
        text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;}
      .ek-h6-prompt-box{position:relative;display:flex;align-items:center;gap:10px;
        background:#20232B;border:1px solid rgba(242,239,233,.08);border-radius:14px;
        padding:16px 16px 16px 18px;transition:border-color .2s ease;}
      .ek-h6-prompt-box:focus-within{border-color:rgba(217,160,84,.5);}
      .ek-h6-input{flex:1;background:transparent;border:none;outline:none;color:#F2EFE9;
        font-family:'Inter',sans-serif;font-size:15px;position:relative;z-index:2;
        caret-color:#D9A054;}
      .ek-h6-ghost{position:absolute;left:18px;top:50%;transform:translateY(-50%);
        color:#8A8F98;font-size:15px;pointer-events:none;z-index:1;
        white-space:nowrap;overflow:hidden;}
      .ek-h6-go-btn{background:#D9A054;color:#1a1508;border:none;border-radius:9px;
        width:36px;height:36px;flex-shrink:0;cursor:pointer;font-size:16px;
        display:flex;align-items:center;justify-content:center;}
      .ek-h6-go-btn:focus-visible{outline:2px solid #D9A054;outline-offset:2px;}
      .ek-h6-hint{font-size:12px;color:#8A8F98;margin:10px 0 0 2px;}
      .ek-h6-proof-row{display:flex;gap:26px;font-family:'IBM Plex Mono',monospace;
        font-size:12px;color:#8A8F98;flex-wrap:wrap;margin-top:30px;}
      .ek-h6-proof-row b{color:#F2EFE9;font-weight:500;}
      .ek-h6-prog-wrap{display:none;margin-top:14px;}
      .ek-h6-prog-bar{background:rgba(255,255,255,.15);border-radius:6px;height:4px;
        overflow:hidden;margin-bottom:6px;}
      .ek-h6-prog-fill{background:#D9A054;height:100%;width:0%;border-radius:6px;
        transition:width .25s ease;}
      .ek-h6-prog-label{font-size:12px;color:#8A8F98;}
      .ek-h6-stage{position:relative;background:#20232B;border:1px solid rgba(242,239,233,.08);
        border-radius:22px;overflow:hidden;height:520px;
        box-shadow:0 40px 80px -30px rgba(0,0,0,.65);display:flex;flex-direction:column;}
      .ek-h6-portraits{position:relative;flex:1;overflow:hidden;}
      .ek-h6-slide{position:absolute;inset:0;opacity:0;transition:opacity .7s ease;}
      .ek-h6-slide.active{opacity:1;}
      .ek-h6-portrait-img{position:absolute;inset:0;width:100%;height:100%;
        object-fit:cover;object-position:top center;filter:brightness(.78);}
      .ek-h6-live-chip{position:absolute;top:18px;right:18px;display:flex;align-items:center;
        gap:6px;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);padding:6px 12px;
        border-radius:100px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#fff;z-index:2;}
      .ek-h6-live-dot{width:6px;height:6px;border-radius:50%;background:#5EC8D9;
        box-shadow:0 0 0 3px rgba(94,200,217,.3);animation:ek-h6-pulse 2.4s ease-in-out infinite;}
      @keyframes ek-h6-pulse{0%,100%{box-shadow:0 0 0 3px rgba(94,200,217,.3);}
        50%{box-shadow:0 0 0 7px rgba(94,200,217,.07);}}
      .ek-h6-slide-meta{position:absolute;bottom:32px;left:22px;color:#fff;z-index:2;}
      .ek-h6-slide-name{font-family:'Fraunces',serif;font-size:19px;font-weight:600;
        text-shadow:0 2px 8px rgba(0,0,0,.6);}
      .ek-h6-slide-role{font-family:'IBM Plex Mono',monospace;font-size:11px;
        color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;}
      .ek-h6-quote-area{padding:18px 22px 20px;border-top:1px solid rgba(242,239,233,.08);
        background:#20232B;}
      .ek-h6-quote-text{margin:0 0 10px;font-size:14.5px;line-height:1.45;color:#F2EFE9;}
      .ek-h6-coach-line{font-size:12.5px;color:#D9A054;line-height:1.4;}
      .ek-h6-dots{position:absolute;bottom:12px;left:22px;display:flex;gap:6px;z-index:5;}
      .ek-h6-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.3);
        transition:all .2s ease;border:none;padding:0;cursor:pointer;}
      .ek-h6-dot.active{background:#fff;width:16px;border-radius:3px;}
      .ek-h6-dot:focus-visible{outline:2px solid #fff;outline-offset:2px;}
      .ek-h6-breadth{text-align:center;padding:44px 32px 72px;
        border-top:1px solid rgba(242,239,233,.08);margin-top:26px;}
      .ek-h6-breadth-label{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#8A8F98;
        text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px;}
      .ek-h6-breadth-h2{font-family:'Fraunces',serif;font-weight:400;font-size:22px;
        max-width:640px;margin:0 auto;line-height:1.5;color:#F2EFE9;}
      .ek-h6-breadth-h2 b{color:#D9A054;font-weight:600;}
      .ek-h6-ticker{margin-top:34px;overflow:hidden;
        -webkit-mask-image:linear-gradient(90deg,transparent,black 10%,black 90%,transparent);
        mask-image:linear-gradient(90deg,transparent,black 10%,black 90%,transparent);}
      .ek-h6-ticker-track{display:flex;gap:14px;width:max-content;
        animation:ek-h6-scroll 34s linear infinite;}
      .ek-h6-ticker-chip{font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:#8A8F98;
        border:1px solid rgba(242,239,233,.08);border-radius:100px;padding:8px 16px;white-space:nowrap;}
      @keyframes ek-h6-scroll{from{transform:translateX(0);}to{transform:translateX(-50%);}}
      @media(max-width:880px){
        .ek-h6-hero{grid-template-columns:1fr;padding-top:36px;gap:36px;}
        .ek-h6-h1{font-size:34px;}
        .ek-h6-navlinks{display:none;}
        .ek-h6-stage{height:460px;}
      }
      @media(max-width:430px){
        .ek-h6-nav{padding:18px 20px 0;}
        .ek-h6-hero{padding:32px 20px 28px;}
        .ek-h6-h1{font-size:28px;}
        .ek-h6-sub{font-size:15px;}
        .ek-h6-stage{height:400px;}
        .ek-h6-breadth{padding:32px 20px 56px;}
        .ek-h6-breadth-h2{font-size:18px;}
        .ek-h6-proof-row{gap:14px;}
      }
    `;
    document.head.appendChild(s);
  }

  const cast = [
    { name:'Sofia',    role:'Dating \u00b7 Beach Walk', thumb:R2+'sofia_thumb.jpg',
      quote:'\u201cHonestly? I almost didn\u2019t. But you seemed easy to talk to.\u201d',
      coach:'<b>Ryan:</b> she just opened a door \u2014 notice it out loud, don\u2019t just answer.' },
    { name:'Nadia',    role:'Dating \u00b7 Bookstore',  thumb:R2+'Nadia.jpg',
      quote:'\u201cI wasn\u2019t going to say yes to a stranger\u2019s table, honestly.\u201d',
      coach:'<b>Ryan:</b> she\u2019s testing you \u2014 hold the tease, don\u2019t over-explain why you asked.' },
    { name:'Isabelle', role:'Dating \u00b7 Museum',     thumb:R2+'Isabelle_thumb.jpg',
      quote:'\u201cOkay, that\u2019s actually a good guess. How\u2019d you know that?\u201d',
      coach:'<b>Ryan:</b> the cold read landed \u2014 build on it, don\u2019t explain the trick.' },
    { name:'Zoe',      role:'Dating \u00b7 Gym',        thumb:R2+'zoe_thumb.jpg',
      quote:'\u201cMy friends are gonna ask who you are, you know.\u201d',
      coach:'<b>Ryan:</b> she\u2019s already thinking past tonight \u2014 match that, don\u2019t downplay it.' },
    { name:'Julia',    role:'Dating \u00b7 Street',     thumb:R2+'julia_thumb.jpg',
      quote:'\u201cI don\u2019t usually give my number out this fast.\u201d',
      coach:'<b>Ryan:</b> good \u2014 you made her feel safe enough to break her own rule.' }
  ];

  const tickerLines = [
    '\u201cnotice what she didn\u2019t say\u201d',
    '\u201chold the pause\u201d',
    '\u201cname the real objection\u201d',
    '\u201cdon\u2019t defend, redirect\u201d',
    '\u201cmake them qualify\u201d',
    '\u201clet the silence do the work\u201d',
    '\u201cmirror, then pivot\u201d',
    '\u201cown it without over-explaining\u201d'
  ];

  const overlay = document.createElement('div');
  overlay.id = 'ek-hero-v6';

  const slidesHTML = cast.map((c, i) => `
    <div class="ek-h6-slide${i===0?' active':''}" role="group" aria-label="${c.name}">
      <img class="ek-h6-portrait-img" src="${c.thumb}" alt="${c.name}" loading="${i===0?'eager':'lazy'}">
      <div class="ek-h6-live-chip" aria-hidden="true"><span class="ek-h6-live-dot"></span>LIVE</div>
    </div>`).join('');

  const dotsHTML = cast.map((c, i) =>
    `<button class="ek-h6-dot${i===0?' active':''}" data-idx="${i}" aria-label="${c.name}"></button>`
  ).join('');

  const tickerChips = [...tickerLines, ...tickerLines]
    .map(t => `<span class="ek-h6-ticker-chip">${t}</span>`).join('');

  overlay.innerHTML = `
    <nav class="ek-h6-nav">
      <div class="ek-h6-brand">Ozmeva</div>
      <div class="ek-h6-navlinks">
        <a href="#ek-h6-breadth">How it works</a>
      </div>
      <button class="ek-h6-signin-btn" id="ek-hero-signin">Sign in</button>
    </nav>
    <section class="ek-h6-hero">
      <div>
        <div class="ek-h6-eyebrow">Practice, not another video</div>
        <h1 class="ek-h6-h1">Watching changes nothing.<br><em>Doing</em> changes you.</h1>
        <p class="ek-h6-sub">You can read every book and watch every video, and still freeze when it’s real. That’s because a skill isn’t something you learn. It’s something you build, by doing it badly, then doing it again, and again, until it’s easy. Ozmeva is where you do the real thing, as many times as it takes, until you’re actually good at it.</p>
        <div>
          <div class="ek-h6-prompt-label">What do you want to get good at?</div>
          <div class="ek-h6-prompt-box">
            <input class="ek-h6-input" id="ek-h6-input" type="text" autocomplete="off" aria-label="What do you want to get good at?">
            <span class="ek-h6-ghost" id="ek-h6-ghost" aria-hidden="true"></span>
            <button class="ek-h6-go-btn" id="ek-h6-start" aria-label="Start">&#8594;</button>
          </div>
          <div class="ek-h6-hint">Type it. Whatever you’re stuck on, you can practice it here, over and over, until it’s easy.</div>
        </div>
        <div class="ek-h6-prog-wrap" id="ek-h6-prog-wrap">
          <div class="ek-h6-prog-bar"><div class="ek-h6-prog-fill" id="ek-h6-prog-fill"></div></div>
          <div class="ek-h6-prog-label" id="ek-h6-prog-label">Loading AI model…</div>
        </div>
        <div class="ek-h6-proof-row">
          <span><b>Unlimited</b> reps, not one video</span>
          <span><b>2</b> free sessions, no card</span>
          <span><b>7 min</b> avg. session</span>
        </div>
      </div>
      <div>
        <div class="ek-h6-stage" aria-live="polite">
          <div class="ek-h6-portraits">
            ${slidesHTML}
            <div class="ek-h6-slide-meta">
              <div class="ek-h6-slide-name" id="ek-h6-slide-name">${cast[0].name}</div>
              <div class="ek-h6-slide-role" id="ek-h6-slide-role">${cast[0].role}</div>
            </div>
            <div class="ek-h6-dots" role="group" aria-label="Slide navigation">${dotsHTML}</div>
          </div>
          <div class="ek-h6-quote-area">
            <p class="ek-h6-quote-text" id="ek-h6-quote-text">${cast[0].quote}</p>
            <div class="ek-h6-coach-line" id="ek-h6-coach-line">${cast[0].coach}</div>
          </div>
        </div>
      </div>
    </section>
    <div class="ek-h6-breadth" id="ek-h6-breadth">
      <div class="ek-h6-breadth-label">Not a course. A gym for real conversations.</div>
      <h2 class="ek-h6-breadth-h2">A book ends. A video ends. Nothing about you has to change once they’re over. Ozmeva doesn’t end, you practice the same moment <b>again and again</b>, and Ozmeva tells you exactly what to fix, until you can’t get it wrong anymore.</h2>
      <div class="ek-h6-ticker"><div class="ek-h6-ticker-track">${tickerChips}</div></div>
    </div>`;

  document.body.appendChild(overlay);

  // Slideshow
  let slideIdx = 0;
  const slides = overlay.querySelectorAll('.ek-h6-slide');
  const dots = overlay.querySelectorAll('.ek-h6-dot');

  function goToSlide(next) {
    slides[slideIdx].classList.remove('active');
    dots[slideIdx].classList.remove('active');
    slideIdx = next;
    slides[slideIdx].classList.add('active');
    dots[slideIdx].classList.add('active');
    overlay.querySelector('#ek-h6-slide-name').textContent = cast[next].name;
    overlay.querySelector('#ek-h6-slide-role').textContent = cast[next].role;
    overlay.querySelector('#ek-h6-quote-text').innerHTML = cast[next].quote;
    overlay.querySelector('#ek-h6-coach-line').innerHTML = cast[next].coach;
  }

  const ssTimer = setInterval(() => goToSlide((slideIdx + 1) % cast.length), 4200);
  dots.forEach(d => d.addEventListener('click', () => goToSlide(parseInt(d.dataset.idx, 10))));

  // Typewriter ghost text
  const examples = [
    "the apology I owe my ex",
    "asking her out without overthinking it",
    "small talk that doesn’t feel forced",
    "the first message that doesn’t sound try-hard",
    "keeping the conversation going past hello",
    "flirting without sounding cheesy",
    "what to say when she goes quiet",
    "the conversation I keep avoiding on dates"
  ];
  const ghostEl = overlay.querySelector('#ek-h6-ghost');
  const inputEl = overlay.querySelector('#ek-h6-input');
  let exIdx = 0, charIdx = 0, deleting = false, typeTimer = null;

  function typeLoop() {
    if (document.activeElement === inputEl || inputEl.value.length) {
      ghostEl.textContent = '';
      typeTimer = setTimeout(typeLoop, 400);
      return;
    }
    const full = examples[exIdx];
    if (!deleting) {
      charIdx++;
      ghostEl.textContent = full.slice(0, charIdx);
      if (charIdx === full.length) { deleting = true; typeTimer = setTimeout(typeLoop, 1400); return; }
    } else {
      charIdx--;
      ghostEl.textContent = full.slice(0, charIdx);
      if (charIdx === 0) { deleting = false; exIdx = (exIdx + 1) % examples.length; }
    }
    typeTimer = setTimeout(typeLoop, deleting ? 22 : 38);
  }
  typeLoop();

  // Sign in
  overlay.querySelector('#ek-hero-signin').addEventListener('click', () => {
    if (window.EkAuth && typeof window.EkAuth.showModal === 'function') window.EkAuth.showModal('signin');
  });

  // Boot sequence (same as old launchApp's start handler)
  let _bootStarted = false;
  async function doStart() {
    if (_bootStarted) return;
    _bootStarted = true;
    clearTimeout(typeTimer);
    clearInterval(ssTimer);
    const goBtn = overlay.querySelector('#ek-h6-start');
    goBtn.disabled = true; goBtn.style.opacity = '.5';
    overlay.querySelector('#ek-h6-prog-wrap').style.display = 'block';
    try {
      await KokoroSpeech.preload(info => {
        const fill = overlay.querySelector('#ek-h6-prog-fill');
        const lbl  = overlay.querySelector('#ek-h6-prog-label');
        if (fill && info.progress != null) fill.style.width = Math.round(info.progress) + '%';
        if (lbl  && info.file) lbl.textContent = 'Loading ' + info.file.split('/').pop() + '…';
      });
    } catch (err) {
      const lbl = overlay.querySelector('#ek-h6-prog-label');
      if (lbl) lbl.innerHTML = '<span style="color:#ff6b6b">Failed: ' + err.message + '</span>';
      goBtn.disabled = false; goBtn.style.opacity = '';
      _bootStarted = false;
      return;
    }
    overlay.remove();
    setTimeout(prewarmCharacterVideos, 2000);
    const firstKey = Object.keys(SCENARIOS)[0];
    currentScenarioKey = firstKey;
    setMediaForSpeaker('Ryan');
    els.name.textContent = 'Ryan';
    els.text.textContent = '';
    Metrics.refreshUI(firstKey);
    if (!document.getElementById('ek-stat-bar')) {
      const bar = document.createElement('div');
      bar.id = 'ek-stat-bar';
      bar.style.cssText = 'display:none;justify-content:center;align-items:center;gap:12px;font-size:11px;color:#9aa4b2;padding:4px 0;flex-wrap:wrap;opacity:0.5';
      const nameEl = document.getElementById('speakerName');
      if (nameEl && nameEl.parentNode) nameEl.parentNode.insertBefore(bar, nameEl.nextSibling);
    }
    renderShelf();
    ryanOrbSetState('silent');
    Progress.refreshStatBar();
    Progress.refreshStreakBadge();
  }

  overlay.querySelector('#ek-h6-start').addEventListener('click', doStart);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') doStart(); });
}

/* ===== Fullscreen ===== */
function initFullscreen() {
  // Create fullscreen button that sits over the video frame
  const btn = document.createElement('button');
  btn.id = 'ek-fullscreen-btn';
  btn.title = 'Toggle fullscreen';
  btn.innerHTML = '⛶';
  btn.style.cssText = [
    'position:absolute',
    'bottom:12px',
    'right:12px',
    'z-index:999',
    'background:rgba(0,0,0,0.55)',
    'color:#fff',
    'border:none',
    'border-radius:8px',
    'width:36px',
    'height:36px',
    'font-size:18px',
    'cursor:pointer',
    'display:none', // hidden until session starts
    'align-items:center',
    'justify-content:center',
    'transition:background 0.2s',
  ].join(';');

  btn.onmouseenter = () => btn.style.background = 'rgba(255,179,0,0.85)';
  btn.onmouseleave = () => btn.style.background = 'rgba(0,0,0,0.55)';

  btn.onclick = () => {
    const frame = document.getElementById('stageFrame');
    if (!frame) return;
    if (!document.fullscreenElement) {
      frame.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  document.addEventListener('fullscreenchange', () => {
    btn.innerHTML = document.fullscreenElement ? '✕' : '⛶';
  });

  // Add button inside stageFrame so it sits over the video
  const frame = document.getElementById('stageFrame');
  if (frame) {
    frame.style.position = 'relative';
    frame.appendChild(btn);
  }

  // Show button when session is active, hide on home screen
  window.showFullscreenBtn = () => { btn.style.display = 'flex'; };
  window.hideFullscreenBtn = () => { btn.style.display = 'none'; btn.innerHTML = '⛶'; };
}

/* ===== Boot ===== */
function bootDefault() {
  pickerHasOverride = false;
  const set=AVATAR_SETS.find(s=>s.id==='sofia');
  applyAvatarSet(set);
  Metrics.bindLikeButton();
  initFullscreen();
  launchHeroV6();
}

function prewarmCharacterVideos() {
  const keys = Object.keys(SCENARIOS).filter(k => !SCENARIOS[k].hidden);
  keys.forEach(key => {
    const charId = SCENARIO_CHARACTER_MAP[key];
    const set = charId && AVATAR_SETS.find(s => s.id === charId);
    if (!set) return;
    [set.maryVideo, set.maryIdleVideo].filter(Boolean).forEach(url => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.src = url;
    });
  });
}


/* ===== Coach-me button ===== */
function initCoachBtn() {
  const btn = document.createElement('button');
  btn.id = 'ek-coach-btn';
  btn.textContent = '🎯 Coach me';
  btn.style.cssText = [
    'display:none;position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1c22;border:1.5px solid #2b2e36;border-radius:999px',
    'color:#ffb300;font-size:13px;font-weight:700;padding:8px 20px',
    'cursor:pointer;z-index:9998;letter-spacing:0.3px'
  ].join(';');
  btn.addEventListener('click', handleCoachBtn);
  document.body.appendChild(btn);
}

async function handleCoachBtn() {
  const btn = document.getElementById('ek-coach-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '...';

  // Diagnostic: log what history is being sent so stale-anchor bugs are traceable
  console.log('[coach-btn] history at fire time (' + conversationHistory.length + ' msgs):',
    conversationHistory.map((m, i) => i + ':' + m.role + ' ' + m.content.slice(0, 60)));

  try {
    const res = await fetch('/api/coach-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: conversationHistory,
        scenarioKey: currentScenarioKey,
        userStyle: currentUserStyle,
      }),
    });
    if (!res.ok) throw new Error('suggest failed');
    const data = await res.json();
    showCoachSuggestions(data.suggestions);
    // Log to session transcript so every coach-suggest call is captured alongside conversation turns
    if (typeof window.EkTranscript?.logCoachSuggest === 'function') {
      window.EkTranscript.logCoachSuggest({
        anchor: data.anchor || '',
        fillerSkipped: data.fillerSkipped || false,
        fillerText: data.fillerText || '',
        suggestions: data.suggestions,
        historyContext: conversationHistory.slice(-6),
      });
    }
  } catch (err) {
    console.warn('[coach-btn] error:', err.message);
    // Show brief inline error so the button doesn't just silently reset
    btn.textContent = 'Try again';
    setTimeout(() => { if (btn) btn.textContent = '🎯 Coach me'; }, 2500);
    return;
  } finally {
    btn.disabled = false;
    if (btn.textContent === '...') btn.textContent = '🎯 Coach me';
  }
}

function showCoachSuggestions(suggestions) {
  hideCoachSuggestions();
  const overlay = document.createElement('div');
  overlay.id = 'ek-coach-overlay';
  overlay.style.cssText = [
    'position:fixed;bottom:130px;left:50%;transform:translateX(-50%)',
    'display:flex;flex-direction:column;gap:10px;z-index:9997;width:min(440px,90vw)'
  ].join(';');
  overlay.innerHTML = suggestions.map(s => `
    <div style="background:#1a1c22;border:1.5px solid #2b2e36;border-radius:12px;
                padding:12px 16px;display:flex;align-items:flex-start;gap:10px">
      <span style="color:#ffb300;font-size:11px;font-weight:800;text-transform:uppercase;
                   min-width:52px;padding-top:1px">${s.style}</span>
      <span style="color:#e8ecf0;font-size:14px;line-height:1.5">${s.text}</span>
    </div>
  `).join('');
  document.body.appendChild(overlay);
}

function hideCoachSuggestions() {
  const el = document.getElementById('ek-coach-overlay');
  if (el) el.remove();
}

function updateCoachBtnVisibility() {
  const btn = document.getElementById('ek-coach-btn');
  if (!btn) return;
  btn.style.display = _exchangeCount >= 1 ? 'block' : 'none';
  // Disable (but keep visible) while a turn is in flight — prevents stale-history suggestions
  btn.disabled = _streaming;
  btn.style.opacity = _streaming ? '0.4' : '1';
  btn.style.cursor = _streaming ? 'default' : 'pointer';
}

bootDefault();
initCoachBtn();
initInputModeToggle();
initMnemonicPill();

function initInputModeToggle() {
  const btn = document.getElementById('input-mode-toggle');
  if (!btn) return;

  function updateToggle() {
    const mode = getInputMode();
    if (mode === 'type') {
      btn.textContent = '🎤';
      btn.title = 'Switch to voice input';
      btn.classList.add('type-active');
    } else {
      btn.textContent = '⌨️';
      btn.title = 'Switch to keyboard input';
      btn.classList.remove('type-active');
    }
  }

  updateToggle();

  btn.addEventListener('click', () => {
    const current = getInputMode();
    const next = current === 'voice' ? 'type' : 'voice';
    localStorage.setItem('ozmeva_input_mode', next);
    updateToggle();
    if (next === 'voice') {
      // Signal listenForUserType (if currently waiting) to abort and let playLoop
      // re-call listenForUser in voice mode for the same turn.
      window.dispatchEvent(new CustomEvent('ozmeva-abort-type-listen'));
      const wrap = document.getElementById('type-input-wrap');
      if (wrap) wrap.style.display = 'none';
    }
  });
}

// Test hooks — allow browser tests to inject speech and end sessions without microphone
if (typeof window !== 'undefined') {
  // Default false for real users. OTIMC test files set window._testMode = true in
  // context.addInitScript() (runs before this script) to suppress concurrent SR calls.
  if (window._testMode === undefined) window._testMode = false;
  window._testBusy = false;
  window.addEventListener('test:speech', async (e) => {
    if (e.detail?.text && typeof streamCharacterAndSpeak === 'function') {
      window._testBusy = true;
      await streamCharacterAndSpeak(e.detail.text, session);
      window._testBusy = false;
    }
  });
  window.addEventListener('test:end-session', () => {
    stopEverything();
    runCoachFeedback(session);
  });
}

/* ===== Debug overlay (?debug=1) ===== */
if (new URLSearchParams(location.search).get('debug') === '1') {
  const _dbg = document.createElement('div');
  _dbg.id = 'ek-debug';
  _dbg.style.cssText = [
    'position:fixed;bottom:8px;left:8px;z-index:99999',
    'background:rgba(0,0,0,0.72);color:#39ff14',
    'font:10px/1.6 monospace;padding:4px 9px;border-radius:4px',
    'pointer-events:none;white-space:nowrap',
  ].join(';');
  document.body.appendChild(_dbg);

  let _dAudio = 'idle', _dSTT = 'off', _dVideo = 'idle';
  const _dbgRender = () => {
    _dbg.textContent = `AUDIO: ${_dAudio} | STT: ${_dSTT} | VIDEO: ${_dVideo}`;
  };

  const _origSpeak = window.speak;
  window.speak = async function(text, speaker) {
    _dAudio = 'playing(' + (speaker || '?') + ')';
    _dbgRender();
    const r = await _origSpeak.apply(this, arguments);
    _dAudio = 'idle';
    _dbgRender();
    return r;
  };

  const _origSetMedia = window.setMediaForSpeaker;
  window.setMediaForSpeaker = function(speaker) {
    _dVideo = (speaker === 'Mary') ? 'speaking' : 'idle';
    _dbgRender();
    return _origSetMedia.apply(this, arguments);
  };

  // Poll rec (let, not window property) every 300ms
  setInterval(() => {
    const s = (rec !== null) ? 'listening' : 'off';
    if (s !== _dSTT) { _dSTT = s; _dbgRender(); }
  }, 300);

  _dbgRender();
}