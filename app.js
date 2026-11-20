/* Holo Stage — interactive stories in a 4-sided Pepper's ghost pyramid.
 * app.js: storage, state, the stage (four tiles in a cross, one per pyramid
 * face) and button input. story.js runs stories; ui.js is the setup panel.
 */
'use strict';

const SIDES = ['bottom', 'right', 'top', 'left'];   // going round the pyramid
const COLORS = ['#ff4b3e', '#2f9bff', '#3ddc6a', '#ffd028'];
const SCENE_TYPES = {
  chapter: { labelKey: 'sceneChapter', label: 'Animation', icon: 'i-film' },
  together: { labelKey: 'sceneTogether', label: 'All together', icon: 'i-together' },
  quiz: { labelKey: 'sceneQuiz', label: 'Quiz', icon: 'i-quiz' },
  turns: { labelKey: 'sceneTurns', label: 'Take turns', icon: 'i-turns' },
  currents: { labelKey: 'sceneCurrents', label: 'Ocean currents', icon: 'i-wave' },
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const clone = o => JSON.parse(JSON.stringify(o));

function defaultLabel() {
  return { text: '', pos: 'top', size: 0.07, color: '#ffffff', show: 'always' };
}
function newScene(type) {
  const base = { id: uid(), type };
  if (type === 'together') {
    return {
      ...base,
      prompt: 'Everyone hold your button!',
      i18n: {
        en: { prompt: 'Everyone hold your button!' },
        de: { prompt: 'Haltet alle euren Knopf gedrückt!' },
        it: { prompt: 'Tenete tutti premuto il pulsante!' },
      },
      clip: '', seconds: 3, successClip: '',
    };
  }
  if (type === 'quiz') {
    return {
      ...base, question: '', clip: '', decide: 'agree', seconds: 20, correct: 0, explain: '',
      answers: [{ text: '', goto: '' }, { text: '', goto: '' }],
    };
  }
  if (type === 'turns') {
    return {
      ...base,
      prompt: 'Take turns!',
      i18n: {
        en: { prompt: 'Take turns!' },
        de: { prompt: 'Abwechseln!' },
        it: { prompt: 'A turno!' },
      },
      clip: '', clips: [],
    };
  }
  if (type === 'currents') {
    return {
      ...base,
      level: 0,
      prompt: 'Drive the ocean current!',
      i18n: {
        en: { prompt: 'Drive the ocean current!' },
        de: { prompt: 'Treibt die Meeresströmung an!' },
        it: { prompt: 'Attivate la corrente marina!' },
      },
      successClip: '',
    };
  }
  return { ...base, type: 'chapter', clip: '', seconds: 0, caption: '' };
}
const DEFAULTS = {
  version: 2,
  lang: detectLang(),
  mode: 'story',                       // 'story' | 'free'
  layout: {
    tile: 1 / 3, hole: 1 / 3, feather: 0.04, fade: 300,
    orientation: 'outward', rotate: 0, mirror: false, tapTrigger: true, guides: false, kioskLock: false, sound: false,
    screenDiag: 10.1, screenRatio: '16:10', screenMm: 136,   // for the pyramid calculator
  },
  players: [1, 2, 3, 4].map((n, i) => ({
    name: `Player ${n}`, side: SIDES[i], lang: '', color: COLORS[i], mode: 'trigger', interrupt: false, clips: [],
    binding: { type: 'key', code: `Digit${n}`, label: `Key ${n}` },
    label: defaultLabel(),
  })),
  story: {
    title: '', attractClip: '', joinSeconds: 6, idleReset: 45,
    text: clone(DEFAULT_STORY_TEXT.en),
    textByLang: clone(DEFAULT_STORY_TEXT),
    scenes: [],
  },
  pendingClips: {},
};
const DEMO = [
  { url: 'demo/volcano_idle_turning.mp4', name: 'Volcano – idle, turning (loop)' },
  { url: 'demo/volcano_eruption_turning.mp4', name: 'Volcano – eruption, turning' },
];
const BUILTIN_PACKS = [
  {
    id: 'morganucodon',
    titleKey: 'packMorganucodon',
    viewerUrl: 'morganucodon/index.html',
    clips: [
      { url: 'morganucodon/morganucodon_idle_turning.mp4', name: 'Morganucodon – idle, turning (loop)' },
      { url: 'morganucodon/morganucodon_jump_turning.mp4', name: 'Morganucodon – jump, turning' },
      { url: 'morganucodon/morganucodon_idle.mp4', name: 'Morganucodon – idle (loop)' },
      { url: 'morganucodon/morganucodon_jump.mp4', name: 'Morganucodon – jump' },
    ],
  },
  {
    id: 'permian',
    titleKey: 'packPermian',
    viewerUrl: 'permian_extinction/index.html',
    clips: [
      { url: 'permian_extinction/pt_permian_idle_turning.mp4', name: 'Permian–Triassic – Permian Earth, turning (loop)' },
      { url: 'permian_extinction/pt_extinction_turning.mp4', name: 'Permian–Triassic – eruption & warming, turning' },
      { url: 'permian_extinction/pt_extinction_full.mp4', name: 'Permian–Triassic – eruption & warming (full)' },
      { url: 'permian_extinction/pt_aftermath_idle_turning.mp4', name: 'Permian–Triassic – greenhouse aftermath, turning (loop)' },
    ],
  },
  {
    id: 'volcano',
    titleKey: 'packVolcano',
    clips: [
      { url: 'demo/volcano_idle_turning.mp4', name: 'Volcano – idle, turning (loop)' },
      { url: 'demo/volcano_eruption_turning.mp4', name: 'Volcano – eruption, turning' },
      { url: 'demo/volcano_idle.mp4', name: 'Volcano – idle (loop)' },
      { url: 'demo/volcano_eruption.mp4', name: 'Volcano – eruption' },
    ],
  },
];
const durations = new Map();          // clip id -> seconds (known once a clip has loaded)
const PRESS_DEBOUNCE_MS = 150;

/* ---------------------------------------------------------------- storage */
const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('holo-stage', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('clips', { keyPath: 'id' });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    allClips: () => run('clips', 'readonly', s => s.getAll()),
    putClip: c => run('clips', 'readwrite', s => s.put(c)),
    delClip: id => run('clips', 'readwrite', s => s.delete(id)),
    get: k => run('kv', 'readonly', s => s.get(k)),
    set: (k, v) => run('kv', 'readwrite', s => s.put(v, k)),
  };
})();

let state = clone(DEFAULTS);
const clips = new Map();               // id -> {id, name, size, blob, url}
const save = () => DB.set('config', state).catch(e => console.error('save failed', e));

function seedLegacyI18n(obj, keys, lang) {
  if (!obj || typeof obj !== 'object' || (obj.i18n && typeof obj.i18n === 'object')) return;
  const entry = {};
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k]) entry[k] = obj[k];
  }
  if (Object.keys(entry).length) obj.i18n = { [lang]: entry };
}

function normalizeState(s) {
  const out = clone(DEFAULTS);
  if (!s || typeof s !== 'object') {
    out.story.text = out.story.textByLang[out.lang];
    return out;
  }
  out.lang = LANGS.includes(s.lang) ? s.lang : detectLang();
  out.mode = s.mode === 'free' ? 'free' : 'story';
  Object.assign(out.layout, s.layout || {});
  (s.players || []).slice(0, 4).forEach((p, i) => {
    Object.assign(out.players[i], p);
    out.players[i].lang = LANGS.includes(p?.lang) ? p.lang : '';
    out.players[i].label = { ...defaultLabel(), ...(p?.label || {}) };
    seedLegacyI18n(out.players[i].label, ['text'], out.lang);
  });
  if (s.story && typeof s.story === 'object') {
    Object.assign(out.story, s.story);
    const byLang = clone(DEFAULT_STORY_TEXT);
    for (const l of LANGS) {
      if (s.story.textByLang?.[l] && typeof s.story.textByLang[l] === 'object') {
        Object.assign(byLang[l], s.story.textByLang[l]);
      }
    }
    if (!s.story.textByLang && s.story.text && typeof s.story.text === 'object') {
      const legacyLang = LANGS.includes(s.lang) ? s.lang : 'en';
      for (const [k, v] of Object.entries(s.story.text)) {
        if (typeof v === 'string' && v !== DEFAULT_STORY_TEXT.en[k]) byLang[legacyLang][k] = v;
      }
    }
    out.story.textByLang = byLang;
    out.story.text = byLang[out.lang];
    out.story.scenes = (s.story.scenes || [])
      .filter(sc => sc && SCENE_TYPES[sc.type])
      .map(sc => {
        const hadI18n = !!(sc.i18n && typeof sc.i18n === 'object');
        const merged = { ...newScene(sc.type), ...sc };
        if (!hadI18n) delete merged.i18n;
        else merged.i18n = clone(sc.i18n);
        if (Array.isArray(merged.answers)) {
          merged.answers = merged.answers.map(a => ({ text: '', goto: '', ...(a || {}) }));
        }
        return merged;
      });
    upgradeDemoI18n(out.story);
    seedLegacyI18n(out.story, ['title'], out.lang);
    out.story.scenes.forEach(sc => {
      seedLegacyI18n(sc, ['caption', 'prompt', 'question', 'explain'], out.lang);
      sc.answers?.forEach(ans => seedLegacyI18n(ans, ['text'], out.lang));
    });
  } else {
    out.story.text = out.story.textByLang[out.lang];
  }
  out.pendingClips = s.pendingClips && typeof s.pendingClips === 'object' ? { ...s.pendingClips } : {};
  return out;
}

// Rewrite every clip reference in a state object; fn returns the new id or nothing to drop it.
function mapClipRefs(st, fn) {
  const one = id => (id && fn(id)) || '';
  st.players.forEach(p => { p.clips = p.clips.map(fn).filter(Boolean); });
  st.story.attractClip = one(st.story.attractClip);
  st.story.scenes.forEach(sc => {
    if ('clip' in sc) sc.clip = one(sc.clip);
    if ('successClip' in sc) sc.successClip = one(sc.successClip);
    if (sc.clips) sc.clips = sc.clips.map(fn).filter(Boolean);
  });
}

// A story runs when there is one; otherwise every player triggers their own clips.
const runMode = () => (state.mode === 'story' && state.story.scenes.length ? 'story' : 'free');

/* ---------------------------------------------------------------- stage */
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stage = $('#stage');
const panel = $('#panel');
const TRANSFORM_OUT = {          // top of the clip points away from the centre
  bottom: 'scaleY(-1)',
  top: 'scaleX(-1)',
  left: 'rotate(90deg) scaleY(-1)',
  right: 'rotate(-90deg) scaleY(-1)',
};

class Player {
  constructor(idx) {
    this.idx = idx;
    this.el = document.createElement('div');
    this.el.className = 'tile';
    this.inner = document.createElement('div');
    this.inner.className = 'inner';
    this.vids = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      this.inner.appendChild(v);
      return v;
    });
    this.mg = document.createElement('canvas');
    this.mg.className = 'minigame';
    this.mg.width = 420; this.mg.height = 420;
    this.mg.hidden = true;
    this.mgCtx = this.mg.getContext('2d');
    this.label = document.createElement('div');
    this.label.className = 'label';
    this.hud = document.createElement('div');   // story prompts, drawn mirrored like the clip
    this.hud.className = 'hud';
    this.pauseBadge = document.createElement('div');
    this.pauseBadge.className = 'pause-badge';
    this.pauseBadge.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-pause"/></svg><span></span>';
    this.inner.append(this.mg, this.label, this.hud, this.pauseBadge);
    this.guide = document.createElement('div');
    this.guide.className = 'guide';
    this.el.append(this.inner, this.guide);
    // Touching a tile stands in for that player's button (handy without hardware).
    this.el.addEventListener('pointerdown', e => {
      if (!state.layout.tapTrigger) return;
      try { this.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      buttonDown(idx);
    });
    for (const ev of ['pointerup', 'pointercancel']) this.el.addEventListener(ev, () => buttonUp(idx));
    stage.appendChild(this.el);
    this.active = 0; this.token = 0; this.cursor = 0; this.busy = false; this.lastPress = 0;
  }
  get cfg() { return state.players[this.idx]; }
  list() { return this.cfg.clips.filter(id => clips.has(id)); }

  setBusy(b) {
    this.busy = b;
    this.el.classList.toggle('is-action', b);
  }
  pulse() {
    this.el.classList.remove('pressed'); void this.el.offsetWidth; this.el.classList.add('pressed');
  }
  renderLabel(tilePx) {
    const L = this.cfg.label;
    const el = this.label;
    const pLang = this.cfg.lang || state.lang;
    const text = getLoc(L, 'text', pLang, { fallback: true });
    el.textContent = text;
    el.hidden = !text.trim();
    el.dataset.pos = L.pos;
    el.dataset.show = L.show;
    el.style.color = L.color;
    if (tilePx) el.style.fontSize = `${Math.max(6, tilePx * L.size)}px`;
  }
  start() {
    this.cursor = 0; this.setBusy(false);
    const list = this.list();
    if (!list.length) return this.blank();
    this.show(list[0], true);
  }
  setMinigame(on) {
    this.mg.hidden = !on;
    if (!on) this.mgCtx.clearRect(0, 0, this.mg.width, this.mg.height);
  }
  blank() {
    this.token++;
    for (const v of this.vids) { v.classList.remove('on'); v.pause(); v.removeAttribute('src'); v.load(); }
  }
  // free play: this player's own clips
  press() {
    const now = performance.now();
    if (now - this.lastPress < PRESS_DEBOUNCE_MS) return;
    this.lastPress = now;
    this.pulse();
    SFX.play('press');

    const list = this.list();
    if (!list.length) return;
    if (this.cfg.mode === 'cycle') {
      this.cursor = (this.cursor + 1) % list.length;
      this.show(list[this.cursor], true);
      return;
    }
    // trigger mode: list[0] = idle loop, list[1..] = one-shot actions
    if (this.busy && !this.cfg.interrupt) return;
    const actions = list.slice(1);
    const id = actions.length ? actions[this.cursor++ % actions.length] : list[0];
    this.setBusy(true);
    this.show(id, false, () => {
      this.setBusy(false);
      // Continue the idle loop at the matching point of its cycle, so rotating
      // (turntable) clips with the same speed carry on without a jump.
      const idleDur = durations.get(list[0]), actDur = durations.get(id);
      this.show(list[0], true, null, idleDur && actDur ? actDur % idleDur : 0);
    });
  }
  async show(id, loop, onEnd, startAt = 0) {
    const clip = clips.get(id);
    if (!clip) return;
    const token = ++this.token;
    const next = this.vids[1 - this.active];
    const cur = this.vids[this.active];
    next.onended = null;
    next.loop = loop;
    if (next.src !== clip.url) next.src = clip.url;
    next.currentTime = startAt;
    try { await next.play(); } catch (e) { if (token === this.token) console.warn('play failed', e); }
    if (Number.isFinite(next.duration)) durations.set(id, next.duration);
    if (token !== this.token) return;
    next.classList.add('on');
    cur.classList.remove('on');
    this.active = 1 - this.active;
    setTimeout(() => { if (token === this.token) cur.pause(); }, state.layout.fade + 60);
    if (!loop && onEnd) next.onended = () => { if (token === this.token) onEnd(); };
  }
}

const players = [0, 1, 2, 3].map(i => new Player(i));

function layout() {
  const L = state.layout;
  // With the setup panel open on a wide screen, the stage moves beside it as a live preview.
  const pw = !panel.hidden && innerWidth >= 900 ? panel.offsetWidth : 0;
  const s = Math.min(innerWidth - pw, innerHeight);
  const H = s * L.hole;
  const T = Math.min(s * L.tile, (s - H) / 2);
  const c = s / 2;
  const pos = {
    bottom: [c - T / 2, c + H / 2],
    top: [c - T / 2, c - H / 2 - T],
    left: [c - H / 2 - T, c - T / 2],
    right: [c + H / 2, c - T / 2],
  };
  Object.assign(stage.style, { width: `${s}px`, height: `${s}px`, left: `${pw + (innerWidth - pw) / 2}px` });
  stage.style.setProperty('--stage-rot', `${L.rotate}deg`);
  stage.style.setProperty('--hole', `${H}px`);
  stage.style.setProperty('--hole-x', `${c - H / 2}px`);
  stage.style.setProperty('--hole-y', `${c - H / 2}px`);
  stage.classList.toggle('guides', !!L.guides);
  document.documentElement.style.setProperty('--fade', `${L.fade}ms`);
  document.documentElement.style.setProperty('--feather', `${L.feather * 100}%`);
  players.forEach(p => {
    const side = p.cfg.side;
    const [x, y] = pos[side];
    Object.assign(p.el.style, { left: `${x}px`, top: `${y}px`, width: `${T}px`, height: `${T}px` });
    p.el.style.setProperty('--me', p.cfg.color);
    let transform = TRANSFORM_OUT[side];
    if (L.orientation === 'inward') transform = `rotate(180deg) ${transform}`;
    if (L.mirror) transform += ' scaleX(-1)';
    p.inner.style.transform = transform;
    p.renderLabel(T);
    const pLang = p.cfg.lang || state.lang;
    const sideLabel = t(`sideShort${side[0].toUpperCase()}${side.slice(1)}`, {}, pLang);
    p.guide.textContent = `${displayPlayerName(p.cfg, p.idx, pLang)} · ${sideLabel}`;
    // keep the label readable with the base of the clip
    p.guide.style.transform = transform;
  });
}
addEventListener('resize', layout);

/* ---------------------------------------------------------------- input */
let learning = null;   // player index waiting for a button
const lastInputEl = $('#lastInput');

function buttonDown(i) {
  if (Story.running()) Story.press(i); else players[i].press();
}
function buttonUp(i) {
  Story.release(i);
}

function sameBinding(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'key') return a.code === b.code;
  if (a.type === 'pad') return a.pad === b.pad && a.button === b.button;
  if (a.type === 'axis') return a.pad === b.pad && a.axis === b.axis && a.dir === b.dir;
  return false;
}

function onInput(ev, down = true) {
  if (!down) {
    players.forEach(p => { if (sameBinding(p.cfg.binding, ev)) buttonUp(p.idx); });
    return false;
  }
  lastInputEl.textContent = ev.label;
  if (learning !== null) {
    state.players.forEach((p, i) => { if (i !== learning && sameBinding(p.binding, ev)) p.binding = null; });
    state.players[learning].binding = ev;
    learning = null;
    save(); renderPlayers();
    return true;
  }
  let hit = false;
  players.forEach(p => { if (sameBinding(p.cfg.binding, ev)) { buttonDown(p.idx); hit = true; } });
  return hit;
}

// Keys for the guide, used only when no player button is bound to them.
const GUIDE_KEYS = {
  ArrowRight: () => Story.next(),
  ArrowLeft: () => Story.prev(),
  KeyP: () => Story.togglePause(),
  Home: () => Story.start(),
};

addEventListener('keydown', e => {
  if (e.key === 'F1') { e.preventDefault(); togglePanel(); return; }
  const tag = e.target.tagName;
  if (e.key === 'Escape') {
    if (learning !== null) { e.preventDefault(); learning = null; renderPlayers(); return; }
    if (!panel.hidden && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { e.preventDefault(); togglePanel(false); return; }
  }
  if (learning === null && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')) return;
  if (e.repeat) { if (learning !== null) e.preventDefault(); return; }
  const wasLearning = learning !== null;
  const handled = onInput({ type: 'key', code: e.code, label: t('keyLabelCode', { key: e.key === ' ' ? t('keySpace') : e.key, code: e.code }) });
  if (handled || wasLearning) { e.preventDefault(); return; }
  if (Story.running() && GUIDE_KEYS[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); GUIDE_KEYS[e.code](); }
});
addEventListener('keyup', e => { onInput({ type: 'key', code: e.code }, false); });

const padPrev = {};
function pollPads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    p.buttons.forEach((b, i) => {
      const k = `${p.index}:b${i}`;
      const down = b.pressed || b.value > 0.5;
      if (down !== !!padPrev[k]) onInput({ type: 'pad', pad: p.index, button: i, label: t('gamepadButton', { pad: p.index + 1, btn: i }) }, down);
      padPrev[k] = down;
    });
    p.axes.forEach((v, i) => {
      for (const dir of [-1, 1]) {
        const k = `${p.index}:a${i}${dir}`;
        const down = v * dir > 0.6;
        if (down !== !!padPrev[k]) onInput({ type: 'axis', pad: p.index, axis: i, dir, label: t('gamepadAxis', { pad: p.index + 1, axis: i, dir: dir > 0 ? '+' : '−' }) }, down);
        padPrev[k] = down;
      }
    });
  }
}
addEventListener('gamepadconnected', e => { lastInputEl.textContent = t('connectedPad', { id: e.gamepad.id }); });

/* ---------------------------------------------------------------- clips */
async function addClip(blob, name) {
  const id = uid();
  const rec = { id, name, size: blob.size, type: blob.type, blob };
  await DB.putClip(rec);
  clips.set(id, { ...rec, url: URL.createObjectURL(blob) });
  return id;
}
async function renameClip(id, name) {
  const c = clips.get(id);
  const nextName = name.trim();
  if (!c || !nextName || nextName === c.name) return false;
  const rec = { id: c.id, name: nextName, size: c.size, type: c.type, blob: c.blob };
  await DB.putClip(rec);
  c.name = nextName;
  return true;
}
async function replaceClip(id, file) {
  const c = clips.get(id);
  if (!c) return false;
  const rec = { id, name: file.name, size: file.size, type: file.type, blob: file };
  await DB.putClip(rec);
  URL.revokeObjectURL(c.url);
  durations.delete(id);
  clips.set(id, { ...rec, url: URL.createObjectURL(file) });
  return true;
}
async function deleteClip(id) {
  const c = clips.get(id);
  await DB.delClip(id);
  if (c) URL.revokeObjectURL(c.url);
  clips.delete(id);
  durations.delete(id);
  mapClipRefs(state, x => (x === id ? null : x));
  save(); applyAll();
}

/* ---------------------------------------------------------------- platform */
const SFX = (() => {
  let ctx = null;
  const tone = (freq, dur, { type = 'sine', gain = 0.08, delay = 0, slide = 0 } = {}) => {
    if (!state.layout.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx ||= new AC();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch { /* audio blocked or unavailable */ }
  };
  return {
    play(kind) {
      if (!state.layout.sound) return;
      if (kind === 'press') tone(440, 0.07, { type: 'triangle', gain: 0.05 });
      else if (kind === 'join') { tone(523.25, 0.12, { gain: 0.07 }); tone(659.25, 0.16, { gain: 0.07, delay: 0.07 }); }
      else if (kind === 'turn') tone(587.33, 0.14, { type: 'triangle', gain: 0.07, slide: 784 });
      else if (kind === 'together') { tone(523.25, 0.25, { gain: 0.07 }); tone(659.25, 0.25, { gain: 0.07, delay: 0.06 }); tone(783.99, 0.35, { gain: 0.08, delay: 0.12 }); }
      else if (kind === 'good') { tone(587.33, 0.12, { gain: 0.07 }); tone(880, 0.26, { gain: 0.08, delay: 0.09 }); }
      else if (kind === 'bad') { tone(330, 0.14, { type: 'triangle', gain: 0.06 }); tone(261.63, 0.22, { type: 'triangle', gain: 0.06, delay: 0.1 }); }
    },
  };
})();

let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported / denied */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    if (!Story.paused) players.forEach(p => { const v = p.vids[p.active]; if (v.src && v.paused && !v.ended) v.play().catch(() => {}); });
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) window.onSWUpdate?.();
      });
    });
  }).catch(e => console.warn('SW registration failed', e));
}
