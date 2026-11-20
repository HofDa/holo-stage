/* Holo Stage — story engine.
 * A story is a list of scenes. Animation chapters play by themselves; interactive
 * scenes wait for the group and are driven only by the four player buttons.
 * Every face gets the same clip plus its own prompt layer (the "hud").
 */
'use strict';

const AWAY_MS = 15000;      // a joined player who does nothing this long is no longer waited for
const TAP_HOLD_MS = 700;    // a tap counts as "holding" this long, so buttons that can't be held still work
const TURN_MS = 12000;      // a turn passes on when its player doesn't press
const AGREE_MS = 2000;      // everyone must stay on the same answer this long
const END_MS = 7000;
const LETTERS = 'ABCD';

const hudText = (cls, text, style = '') =>
  (text && String(text).trim() ? `<p class="${cls}"${style ? ` style="${style}"` : ''}>${esc(text)}</p>` : '');

const Story = {
  phase: 'off',             // off | attract | scene | end
  idx: -1, scene: null,
  joined: new Set(),
  paused: false,
  down: [false, false, false, false],
  lastPress: [-1e9, -1e9, -1e9, -1e9],
  lastInput: 0, sceneStart: 0,
  now: 0,                   // story clock in ms; stands still while paused
  t: 0,                     // ms in the current scene
  s: {},                    // state of the current scene
  token: 0,
  cur: null, curLoop: false, lastOnce: null,
  html: ['', '', '', ''],
  onchange: null,

  get scenes() { return state.story.scenes; },
  get text() { return state.story.text; },
  langFor(i = 0) {
    return (i != null && state.players[i]?.lang) || state.lang || 'en';
  },
  textFor(i = 0) {
    const lang = this.langFor(i);
    return state.story.textByLang?.[lang] || DEFAULT_STORY_TEXT[lang] || state.story.text;
  },
  loc(obj, key, i = 0) {
    return getLoc(obj, key, this.langFor(i), { fallback: true });
  },
  running() { return this.phase !== 'off'; },
  handler() { return HANDLERS[this.phase === 'scene' ? this.scene.type : this.phase]; },

  /* ---- flow ---- */
  set(phase, idx = -1) {
    this.phase = phase;
    this.idx = idx;
    this.scene = phase === 'scene' ? this.scenes[idx] : null;
    this.t = 0; this.s = {}; this.token++;
    this.lastInput = this.sceneStart = this.now;
    this.meter(0);
    players.forEach(p => p.setMinigame(false));
    stage.classList.remove('rumble', 'cine');
    stage.classList.toggle('story', phase !== 'off');
    stage.dataset.scene = phase === 'scene' ? this.scene.type : phase;
    this.onchange?.();
  },
  start() {
    this.setPaused(false);
    this.attract();
  },
  stop() {
    this.setPaused(false);
    this.set('off');
    this.cur = null;
    this.render();
  },
  attract() {
    this.joined.clear();
    this.set('attract');
    const clip = [state.story.attractClip, ...this.scenes.map(sc => sc.clip)].find(id => clips.has(id));
    if (clip) this.playLoop(clip); else { this.cur = null; players.forEach(p => p.blank()); }
    this.render();
  },
  begin(i = 0) {
    if (!this.joined.size) [0, 1, 2, 3].forEach(p => this.joined.add(p));
    this.goto(i);
  },
  goto(i) {
    if (!this.scenes.length) return this.attract();
    if (i < 0) return this.attract();
    if (i >= this.scenes.length) return this.end();
    this.set('scene', i);
    this.handler().enter(this.scene, this);
    this.render();
  },
  advance(toId) {
    const i = toId ? this.scenes.findIndex(sc => sc.id === toId) : -1;
    this.goto(i >= 0 ? i : this.idx + 1);
  },
  end() { this.set('end'); this.render(); },
  // guide controls
  next() {
    if (this.phase === 'attract') this.begin(0);
    else if (this.phase === 'scene') this.goto(this.idx + 1);
    else if (this.phase === 'end') this.attract();
  },
  prev() {
    if (this.phase === 'scene') this.goto(this.idx - 1);
    else if (this.phase === 'end') this.goto(this.scenes.length - 1);
  },
  preview(i) {
    this.setPaused(false);
    this.begin(i);
  },
  togglePause() { if (this.running()) this.setPaused(!this.paused); },
  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    stage.classList.toggle('paused', p);
    players.forEach(pl => {
      const v = pl.vids[pl.active];
      if (!v.getAttribute('src')) return;
      if (p) v.pause(); else if (!v.ended) v.play().catch(() => {});
    });
    this.render();
    this.onchange?.();
  },

  /* ---- buttons ---- */
  press(i) {
    if (!this.running()) return;
    this.down[i] = true;
    if (this.paused) return;
    this.lastPress[i] = this.lastInput = this.now;
    players[i].pulse();
    if (this.phase === 'scene') this.joined.add(i);     // latecomers join in
    this.handler().press?.(this.scene, this, i);
    this.render();
  },
  release(i) { this.down[i] = false; },
  isOn(i) { return this.down[i] || this.now - this.lastPress[i] < TAP_HOLD_MS; },
  isAway(i) { return this.now - Math.max(this.lastPress[i], this.sceneStart) >= AWAY_MS; },
  // The players the scene waits for: everyone who joined and hasn't wandered off.
  required() {
    const all = [...this.joined];
    const here = all.filter(i => !this.isAway(i));
    return here.length ? here : all;
  },
  // Joined players in the order they stand around the pyramid.
  ring() {
    return SIDES.map(side => state.players.findIndex(p => p.side === side)).filter(i => i >= 0 && this.joined.has(i));
  },

  /* ---- time ---- */
  tick(dt) {
    if (!this.running() || this.paused) return;
    this.now += dt; this.t += dt;
    this.handler().tick?.(this.scene, this, dt);
    // An unattended exhibit goes back to the start when everybody has left.
    const idle = state.story.idleReset * 1000;
    if (this.phase === 'scene' && this.scene.type !== 'chapter' && !this.s.busy && idle > 0 && panel.hidden
      && this.now - this.lastInput > idle) return this.attract();
    this.render();
  },

  /* ---- picture ---- */
  meter(v) { stage.style.setProperty('--meter', Math.max(0, Math.min(1, v)).toFixed(3)); },
  flash() {
    stage.classList.remove('flash'); void stage.offsetWidth; stage.classList.add('flash');
  },
  showAll(id, loop, onEnd, startAt = 0) {
    players.forEach((p, i) => p.show(id, loop, i === 0 ? onEnd : null, startAt));
  },
  playLoop(id) {
    if (!clips.has(id)) return;
    if (this.cur === id && this.curLoop) return;       // same loop carries on across scenes
    // After a one-shot, pick the loop up where a turntable clip of the same speed would be.
    const loopDur = durations.get(id), onceDur = durations.get(this.lastOnce);
    this.showAll(id, true, null, loopDur && onceDur ? onceDur % loopDur : 0);
    this.cur = id; this.curLoop = true; this.lastOnce = null;
  },
  playOnce(id, then) {
    const token = this.token;
    this.cur = id; this.curLoop = false; this.lastOnce = id;
    this.showAll(id, false, () => { if (token === this.token) then(); });
  },
  render() {
    const h = this.running() ? this.handler() : null;
    players.forEach((p, i) => {
      const html = h ? h.hud(this.scene, this, i) : '';
      if (html !== this.html[i]) { this.html[i] = html; p.hud.innerHTML = html; }
      const pauseText = this.paused ? (this.textFor(i).paused || DEFAULT_STORY_TEXT[this.langFor(i)].paused || 'Paused') : '';
      const span = p.pauseBadge.lastElementChild;
      if (span && span.textContent !== pauseText) span.textContent = pauseText;
    });
  },
  // The four players as seen from face i: yourself nearest, the others where they stand.
  team(i, stateOf, { meter = false, center = '' } = {}) {
    const me = SIDES.indexOf(state.players[i].side);
    const pips = ['me', 'right', 'across', 'left'].map((slot, k) => {
      const pi = state.players.findIndex(p => p.side === SIDES[(me + k) % 4]);
      if (pi < 0) return '';
      return `<i class="pip ${slot} ${stateOf(pi)}" style="--c:${esc(state.players[pi].color)}"></i>`;
    }).join('');
    const ring = meter
      ? '<svg class="ring" viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="30"/><circle class="fill" cx="50" cy="50" r="30" pathLength="1" transform="rotate(-90 50 50)"/></svg>'
      : '';
    return `<div class="team">${ring}${pips}${center !== '' ? `<b class="count">${esc(center)}</b>` : ''}</div>`;
  },
};

const HANDLERS = {
  /* Start screen: loops until somebody presses, then gives the others a moment to join. */
  attract: {
    press(sc, S, i) {
      if (!S.scenes.length || S.joined.has(i)) return;
      S.joined.add(i);
      SFX.play('join');
      const wait = Math.max(1, state.story.joinSeconds) * 1000;
      if (S.joined.size >= 4) S.s.count = Math.min(S.s.count ?? wait, 1200);
      else S.s.count = S.s.count == null ? wait : Math.max(S.s.count, 3000);
    },
    tick(sc, S, dt) {
      if (S.s.count == null) return;
      S.s.count -= dt;
      if (S.s.count <= 0) S.goto(0);
    },
    hud(sc, S, i) {
      if (!S.scenes.length) return '';
      const T = S.textFor(i);
      const count = S.s.count == null ? '' : String(Math.ceil(S.s.count / 1000));
      return `<div class="hud-top">${hudText('hud-title', S.loc(state.story, 'title', i))}</div>
        <div class="hud-bottom">${hudText('hud-prompt', S.joined.has(i) ? T.joined : T.join)}
        ${S.team(i, p => (S.joined.has(p) ? 'on' : 'out'), { center: count })}</div>`;
    },
  },

  end: {
    press(sc, S) { if (S.t >= 1000) S.attract(); },
    tick(sc, S) {
      S.meter(1 - S.t / END_MS);
      if (S.t >= END_MS) S.attract();
    },
    hud(sc, S, i) {
      const T = S.textFor(i);
      return `<div class="hud-top"></div><div class="hud-mid">${hudText('hud-title', T.end)}</div><div class="hud-bottom"><div class="bar"><i></i></div></div>`;
    },
  },

  /* Animation chapter: plays on all faces, nobody has to do anything. */
  chapter: {
    enter(sc, S) {
      const has = clips.has(sc.clip);
      if (has && !(sc.seconds > 0)) return S.playOnce(sc.clip, () => S.advance());
      if (has) S.playLoop(sc.clip);
      S.s.until = (sc.seconds > 0 ? sc.seconds : 5) * 1000;
    },
    tick(sc, S) { if (S.s.until && S.t >= S.s.until) S.advance(); },
    hud(sc, S, i) { return `<div class="hud-top"></div><div class="hud-bottom">${hudText('hud-caption', S.loc(sc, 'caption', i))}</div>`; },
  },

  /* All together: the meter only fills while every player holds (or keeps tapping). */
  together: {
    enter(sc, S) { S.playLoop(sc.clip); S.s.meter = 0; },
    tick(sc, S, dt) {
      const s = S.s;
      if (s.done) { if (s.until && S.t >= s.until) S.advance(); return; }
      const req = S.required();
      const all = req.length > 0 && req.every(i => S.isOn(i));
      const rate = dt / (Math.max(0.5, sc.seconds || 3) * 1000);
      s.meter = Math.max(0, Math.min(1, s.meter + (all ? rate : -rate * 0.6)));
      S.meter(s.meter);
      stage.classList.toggle('rumble', s.meter > 0.3);
      if (s.meter < 1) return;
      s.done = s.busy = true;
      stage.classList.remove('rumble');
      stage.classList.add('cine');
      S.flash();
      SFX.play('together');
      if (clips.has(sc.successClip)) S.playOnce(sc.successClip, () => S.advance());
      else s.until = S.t + 900;
    },
    hud(sc, S, i) {
      if (S.s.done) return '';
      const st = p => (!S.joined.has(p) ? 'out' : S.isOn(p) ? 'on' : S.isAway(p) ? 'away' : 'in nudge');
      return `<div class="hud-top">${hudText('hud-prompt', S.loc(sc, 'prompt', i))}</div>
        <div class="hud-bottom">${S.team(i, st, { meter: true })}</div>`;
    },
  },

  /* Quiz: each press moves your marker to the next answer. */
  quiz: {
    enter(sc, S) { S.playLoop(sc.clip); S.s.sel = [-1, -1, -1, -1]; S.s.meter = 0; S.s.reveal = null; S.s.tied = null; },
    press(sc, S, i) {
      if (S.s.reveal !== null || !sc.answers.length) return;
      S.s.sel[i] = (S.s.sel[i] + 1) % sc.answers.length;
      SFX.play('press');
    },
    tick(sc, S, dt) {
      const s = S.s;
      if (s.reveal !== null) {
        S.meter(Math.max(0, (s.until - S.t) / (s.revealDur || 5000)));
        if (S.t >= s.until) S.advance(sc.answers[s.reveal]?.goto);
        return;
      }
      if (sc.decide === 'agree') {
        const req = S.required();
        const a = req.length ? s.sel[req[0]] : -1;
        const agreed = a >= 0 && req.every(i => s.sel[i] === a);
        s.meter = agreed ? s.meter + dt / AGREE_MS : 0;
        S.meter(s.meter);
        if (s.meter >= 1) this.reveal(sc, S, a);
      } else {
        const total = Math.max(3, sc.seconds || 20) * 1000;
        S.meter(1 - S.t / total);
        if (S.t >= total) { const { choice, tied } = this.majority(sc, S); this.reveal(sc, S, choice, tied); }
      }
    },
    majority(sc, S) {
      const votes = sc.answers.map((_, a) => S.s.sel.filter(v => v === a).length);
      const best = Math.max(...votes, 0);
      const tied = best > 0 ? votes.map((v, a) => (v === best ? a : -1)).filter(a => a >= 0) : [];
      if (tied.length > 1) return { choice: tied[0], tied };
      return { choice: tied[0] ?? -1, tied: null };
    },
    reveal(sc, S, choice, tied = null) {
      S.s.reveal = choice;
      S.s.tied = tied;
      S.s.busy = true;
      S.s.revealDur = getLoc(sc, 'explain', state.lang, { fallback: true }).trim() ? 9000 : 5000;
      S.s.until = S.t + S.s.revealDur;
      S.meter(1);
      S.flash();
      const hasRight = sc.correct >= 0 && sc.correct < sc.answers.length;
      const isTie = Array.isArray(tied) && tied.length > 1;
      if (hasRight && !isTie && choice === sc.correct) SFX.play('good');
      else if (hasRight || isTie) SFX.play('bad');
      else if (choice >= 0) SFX.play('join');
    },
    hud(sc, S, i) {
      const s = S.s;
      const T = S.textFor(i);
      const hasRight = sc.correct >= 0 && sc.correct < sc.answers.length;
      const row = (a, cls, votes = '') => `<li class="${cls}"><b>${LETTERS[a]}</b><span>${esc(S.loc(sc.answers[a], 'text', i))}</span><em>${votes}</em></li>`;
      if (s.reveal === null) {
        const rows = sc.answers.map((_, a) => {
          const votes = [0, 1, 2, 3].filter(p => p !== i && s.sel[p] === a)
            .map(p => `<i style="--c:${esc(state.players[p].color)}"></i>`).join('');
          return row(a, s.sel[i] === a ? 'mine' : '', votes);
        }).join('');
        return `<div class="hud-top">${hudText('hud-question', S.loc(sc, 'question', i))}</div>
          <ol class="answers${s.sel[i] < 0 ? ' unpicked' : ''}">${rows}</ol>
          <div class="hud-bottom"><div class="bar ${sc.decide === 'agree' ? 'agree' : ''}"><i></i></div></div>`;
      }
      // reveal: keep what matters on the glass, including wrong picks and ties
      const isTie = Array.isArray(s.tied) && s.tied.length > 1;
      const good = hasRight && !isTie && s.reveal === sc.correct;
      const verdict = isTie
        ? hudText('hud-verdict bad', T.tie || 'Tie!')
        : (hasRight ? hudText(`hud-verdict ${good ? 'good' : 'bad'}`, good ? T.right : T.wrong) : '');
      const wrongPick = a => !good && (isTie ? s.tied.includes(a) : a === s.reveal);
      const shownRows = hasRight
        ? sc.answers.map((_, a) => (a === sc.correct ? row(a, 'right') : (wrongPick(a) ? row(a, 'picked-wrong') : ''))).join('')
        : (isTie
          ? s.tied.map(a => row(a, s.sel[i] === a ? 'mine' : 'chosen')).join('')
          : (s.reveal >= 0 ? row(s.reveal, s.sel[i] === s.reveal ? 'mine' : 'chosen') : ''));
      return `<div class="hud-top">${verdict}</div>
        <ol class="answers">${shownRows}</ol>
        <div class="hud-bottom">${hudText('hud-explain', S.loc(sc, 'explain', i))}<div class="bar"><i></i></div></div>`;
    },
  },

  /* Take turns: one player at a time triggers the next part. */
  turns: {
    enter(sc, S) {
      const s = S.s;
      S.playLoop(sc.clip);
      s.list = sc.clips.filter(id => clips.has(id));
      s.k = 0;
      s.total = Math.max(S.ring().length, s.list.length, 1);
      s.cur = S.ring()[0] ?? 0;
      s.turnAt = 0;
    },
    pass(S) {
      const ring = S.ring();
      const at = ring.indexOf(S.s.cur);
      S.s.cur = ring[(at + 1) % ring.length] ?? S.s.cur;
      S.s.turnAt = S.t;
    },
    press(sc, S, i) {
      const s = S.s;
      if (s.busy || i !== s.cur) return;
      s.busy = true;
      stage.classList.add('cine');
      SFX.play('turn');
      const clip = s.list.length ? s.list[s.k % s.list.length] : null;
      if (clip) S.playOnce(clip, () => this.done(sc, S));
      else { S.flash(); s.until = S.t + 700; }
    },
    done(sc, S) {
      const s = S.s;
      s.k++; s.busy = false; s.until = 0;
      stage.classList.remove('cine');
      S.lastInput = S.now;
      if (s.k >= s.total) return S.advance();
      this.pass(S);
      S.playLoop(sc.clip);      // without a waiting clip the last frame simply stays
    },
    tick(sc, S) {
      const s = S.s;
      if (s.busy) { if (s.until && S.t >= s.until) this.done(sc, S); return; }
      if (S.t - s.turnAt > TURN_MS) this.pass(S);
    },
    hud(sc, S, i) {
      const s = S.s;
      if (s.busy) return '';
      const T = S.textFor(i);
      const cur = state.players[s.cur];
      const who = i === s.cur ? T.yourTurn : T.turnOf.replace('{name}', displayPlayerName(cur, s.cur, S.langFor(i)));
      const steps = Array.from({ length: s.total }, (_, k) => `<i class="${k < s.k ? 'done' : ''}"></i>`).join('');
      const st = p => (!S.joined.has(p) ? 'out' : p === s.cur ? 'on turn' : 'in');
      return `<div class="hud-top">${hudText('hud-prompt', S.loc(sc, 'prompt', i))}<div class="steps">${steps}</div></div>
        <div class="hud-bottom">${hudText(`hud-turn ${i === s.cur ? 'mine' : ''}`, who, `--c:${esc(cur.color)}`)}
        ${S.team(i, st)}</div>`;
    },
  },

  /* Ocean currents minigame: players control 4 thermal stations (heat vents & polar ice)
   * to drive real thermal convection currents and oxygenate deep-sea life. */
  currents: {
    enter(sc, S) {
      S.cur = null; S.curLoop = false;
      players.forEach(p => { p.blank(); p.setMinigame(true); });
      CurrentsGame.init(sc.level || 0, state.players);
      S.s.latched = [false, false, false, false];
      S.s.pressAt = [0, 0, 0, 0];
      S.s.wasDown = [false, false, false, false];
      S.s.done = false;
      S.s.until = 0;
      S.s.dT = 0;
      CurrentsGame.renderToTiles(players, [false, false, false, false]);
    },
    press(sc, S, i) {
      if (S.s.done) return;
      S.s.latched[i] = !S.s.latched[i];
      S.s.pressAt[i] = S.now;
      S.s.wasDown[i] = true;
      SFX.play('press');
    },
    tick(sc, S, dt) {
      const s = S.s;
      if (s.done) { if (s.until && S.t >= s.until) S.advance(); return; }
      // Hybrid control: short tap toggles station on/off; holding >=350ms turns off on release
      const active = [0, 1, 2, 3].map(i => {
        if (s.wasDown[i] && !S.down[i]) {
          s.wasDown[i] = false;
          if (S.now - s.pressAt[i] >= 350) s.latched[i] = false;
        }
        return S.down[i] || s.latched[i];
      });
      const g = CurrentsGame.step(dt / 1000, active);
      s.dT = g.dT;
      s.active = active;
      S.meter(g.progress);
      CurrentsGame.renderToTiles(players, active);
      if (!g.won) return;
      s.done = s.busy = true;
      stage.classList.add('cine');
      S.flash();
      SFX.play('together');
      if (clips.has(sc.successClip)) {
        players.forEach(p => p.setMinigame(false));
        S.playOnce(sc.successClip, () => S.advance());
      } else {
        s.until = S.t + 2200;
      }
    },
    hud(sc, S, i) {
      const s = S.s;
      const pLang = S.langFor(i);
      if (s.done) {
        if (clips.has(sc.successClip)) return '';
        return `<div class="hud-top"></div><div class="hud-mid">${hudText('hud-verdict good', S.textFor(i).right)}</div><div class="hud-bottom"></div>`;
      }
      const roleKey = `currentsRole${i}`;
      const on = !!(s.active && s.active[i]);
      const role = t(roleKey, {}, pLang);
      const dtStr = `ΔT ${(s.dT || 0).toFixed(0)}°C`;
      return `<div class="hud-top">${hudText('hud-prompt', S.loc(sc, 'prompt', i))}<div class="bar agree"><i></i></div></div>
        <div class="hud-bottom"><p class="hud-mg-role${on ? ' on' : ''}" style="--c:${esc(state.players[i].color)}">${esc(role)} · ${esc(dtStr)}</p></div>`;
    },
  },
};
