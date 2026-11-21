/* Holo Stage — setup panel: story editor, buttons, video library, pyramid layout. */
'use strict';

const icon = name => `<svg class="ic" aria-hidden="true"><use href="#${name}"/></svg>`;
const fmtSize = b => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const fmtDur = s => !Number.isFinite(s) || s <= 0 ? '' : s < 60 ? `${s.toFixed(1).replace(/\.0$/, '')}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clipName = id => clips.get(id)?.name || state.pendingClips?.[id] || '';
const clipOptions = (selected, emptyLabel) => {
  const pendingOpt = selected && !clips.has(selected) && state.pendingClips?.[selected]
    ? `<option value="${esc(selected)}" selected>${esc(t('missingClipOption', { name: state.pendingClips[selected] }))}</option>`
    : '';
  return `<option value="">${esc(emptyLabel)}</option>${pendingOpt}` +
    [...clips.values()].map(c => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
};

const noticeEl = $('#notice');
let noticeTimer;
function notice(msg, { tone = 'info', ms = 4500 } = {}) {
  clearTimeout(noticeTimer);
  noticeEl.className = `notice ${tone}`;
  noticeEl.innerHTML = `<span>${esc(msg)}</span><button class="icon" aria-label="${esc(t('dismiss'))}">${icon('i-close')}</button>`;
  noticeEl.querySelector('button').onclick = () => { clearTimeout(noticeTimer); noticeEl.hidden = true; };
  noticeEl.hidden = false;
  if (ms > 0) noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, ms);
}

const disarmers = new WeakMap();
function armConfirm(btn, confirmText, onConfirm, timeout = 4500) {
  if (disarmers.has(btn)) { disarmers.get(btn)(); onConfirm(); return; }
  const orig = btn.textContent;
  const cancel = document.createElement('button');
  cancel.textContent = t('cancel');
  let timer;
  const disarm = () => {
    clearTimeout(timer);
    disarmers.delete(btn);
    btn.textContent = orig;
    btn.classList.remove('armed');
    cancel.remove();
  };
  disarmers.set(btn, disarm);
  btn.textContent = confirmText;
  btn.classList.add('armed');
  cancel.onclick = disarm;
  btn.after(cancel);
  if (timeout) timer = setTimeout(disarm, timeout);
}

function translateDOM(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

function syncLangButtons() {
  document.querySelectorAll('#panelLang [data-lang], #tLang [data-lang]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === state.lang));
    btn.title = LANG_NAMES[btn.dataset.lang] || '';
  });
}

function renderAddSceneButtons() {
  $('#addScene').innerHTML = Object.entries(SCENE_TYPES).map(([type, T]) =>
    `<button data-type="${type}" class="add-${type}">${icon(T.icon)}${esc(t(T.labelKey))}</button>`).join('');
}

function applyLang() {
  document.documentElement.lang = state.lang;
  translateDOM(document);
  syncLangButtons();
  renderAddSceneButtons();
  layout(); renderPlayers(); renderLibrary(); renderStoryMeta(); renderScenes(); renderBuild(); renderTour();
  if (Story.running()) Story.render();
  lastTransportKey = '';
  Story.onchange?.();
}

function setLang(lang) {
  if (!LANGS.includes(lang) || state.lang === lang) return;
  state.lang = lang;
  state.story.text = state.story.textByLang[lang];
  save();
  applyLang();
}

for (const sel of ['#panelLang', '#tLang']) {
  $(sel).addEventListener('click', e => {
    const btn = e.target.closest('[data-lang]');
    if (btn) setLang(btn.dataset.lang);
  });
}

/* ---------------------------------------------------------------- panel + guide controls */
const transport = $('#transport');
const tStatus = $('#tStatus');
const cornerHold = $('#cornerHold');
const HOLD_MS = 1200;
let uiTimer, cursorTimer, holdTimer, holdPointer = null;
function pokeCursor() {
  document.body.classList.remove('idle-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => { if (panel.hidden) document.body.classList.add('idle-cursor'); }, 3000);
}
function pokeUI() {
  pokeCursor();
  transport.classList.add('show');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => { transport.classList.remove('show'); }, 3500);
}
function cancelHold() {
  clearTimeout(holdTimer); holdTimer = null; holdPointer = null;
  cornerHold.classList.remove('active');
}
addEventListener('pointermove', e => {
  pokeCursor();
  if (holdPointer === e.pointerId && (e.clientX > 96 || e.clientY > 96)) cancelHold();
  if (!state.layout.kioskLock || (transport.classList.contains('show') && e.target.closest('#transport'))) pokeUI();
});
addEventListener('pointerdown', e => {
  pokeCursor();
  if (e.target.closest('#transport')) return pokeUI();
  if (!panel.hidden || e.clientX >= 80 || e.clientY >= 80) return;
  if (!state.layout.kioskLock || transport.classList.contains('show')) return pokeUI();
  cancelHold();
  holdPointer = e.pointerId;
  cornerHold.style.left = `${Math.max(24, e.clientX)}px`;
  cornerHold.style.top = `${Math.max(24, e.clientY)}px`;
  void cornerHold.offsetWidth;
  cornerHold.classList.add('active');
  holdTimer = setTimeout(() => { cancelHold(); pokeUI(); }, HOLD_MS);
});
for (const ev of ['pointerup', 'pointercancel']) {
  addEventListener(ev, e => { if (holdPointer === e.pointerId) cancelHold(); });
}
function togglePanel(force) {
  cancelHold();
  panel.hidden = force === undefined ? !panel.hidden : !force;
  document.body.classList.toggle('panel-open', !panel.hidden);
  if (!panel.hidden || state.layout.kioskLock) transport.classList.remove('show');
  if (panel.hidden) {
    endTour();
    learning = null; closePreview(); renderPlayers();
    if (panel.contains(document.activeElement)) {
      if (transport.classList.contains('show')) $('#gear').focus();
      else document.activeElement.blur();
    }
  } else {
    panel.querySelector('.tabs [aria-selected="true"]')?.focus();
  }
  layout();
}
$('#gear').onclick = () => togglePanel(true);
$('#btnClose').onclick = () => togglePanel(false);
$('#btnFullscreen').onclick = async () => {
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { console.warn(e); }
  togglePanel(false);
  transport.classList.remove('show');
  requestWakeLock();
  if (Story.running()) Story.start();
};
$('#tRestart').onclick = () => Story.start();
$('#tPrev').onclick = () => Story.prev();
$('#tNext').onclick = () => Story.next();
$('#tPause').onclick = () => Story.togglePause();

const tabBtns = [...document.querySelectorAll('.tabs [data-tab]')];
function selectTab(btn, moveFocus = false) {
  if (btn.dataset.tab !== 'videos') closePreview();
  tabBtns.forEach(b => {
    const on = b === btn;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== `tab-${btn.dataset.tab}`; });
  panel.scrollTop = 0;
  renderClipShelf();
  if (moveFocus) btn.focus();
}
tabBtns.forEach((btn, i) => {
  btn.onclick = () => selectTab(btn);
  btn.onkeydown = e => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) { e.preventDefault(); selectTab(tabBtns[(i + dir + tabBtns.length) % tabBtns.length], true); }
    else if (e.key === 'Home') { e.preventDefault(); selectTab(tabBtns[0], true); }
    else if (e.key === 'End') { e.preventDefault(); selectTab(tabBtns[tabBtns.length - 1], true); }
  };
});

let installPrompt = null;
const btnInstall = $('#btnInstall');
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  btnInstall.hidden = false;
});
btnInstall.onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') { installPrompt = null; btnInstall.hidden = true; }
};
addEventListener('appinstalled', () => {
  installPrompt = null;
  btnInstall.hidden = true;
  notice(t('noticeInstalled'), { tone: 'good', ms: 4000 });
});
window.onSWUpdate = () => notice(t('noticeSWUpdate'), { tone: 'info', ms: 8000 });

// Switch between story and free play whenever the story or the run mode changes.
function applyMode() {
  const story = runMode() === 'story';
  document.body.classList.toggle('story-mode', story);
  if (story) { if (!Story.running()) Story.start(); }
  else if (Story.running()) { Story.stop(); players.forEach(p => p.start()); }
}
let lastTransportKey = '';
function syncTransport() {
  if (!Story.running() || !Story.scenes.length) {
    if (lastTransportKey !== '') { lastTransportKey = ''; tStatus.innerHTML = ''; }
    transport.classList.remove('is-paused');
    return;
  }
  const dots = [0, 1, 2, 3].map(p => {
    const st = !Story.joined.has(p) ? 'out' : (Story.phase === 'scene' && Story.isAway(p)) ? 'away' : 'on';
    return `<i class="t-dot ${st}" style="--c:${esc(state.players[p].color)}" title="${esc(displayPlayerName(state.players[p], p))}"></i>`;
  }).join('');
  let text = t('tStart');
  if (Story.phase === 'attract' && Story.s.count != null) text = t('tStarting', { s: Math.ceil(Story.s.count / 1000) });
  else if (Story.phase === 'end') text = t('tEnd');
  else if (Story.phase === 'scene') text = `${Story.idx + 1}/${Story.scenes.length} · ${t(SCENE_TYPES[Story.scene.type].labelKey)}`;
  if (Story.paused) text = `${state.story.text.paused || DEFAULT_STORY_TEXT[state.lang].paused} · ${text}`;
  const key = `${state.lang}|${Story.paused ? 1 : 0}|${Story.phase}|${text}|${dots}`;
  if (key === lastTransportKey) return;
  lastTransportKey = key;
  tStatus.innerHTML = `<span class="t-label">${esc(text)}</span><span class="t-dots">${dots}</span>`;
  transport.classList.toggle('is-paused', Story.paused);
  $('#tPrev').disabled = Story.phase === 'attract';
}

Story.onchange = () => {
  document.querySelectorAll('#scenes .scene').forEach((li, i) => li.classList.toggle('playing', Story.phase === 'scene' && Story.idx === i));
  const pause = $('#tPause');
  pause.innerHTML = icon(Story.paused ? 'i-play' : 'i-pause');
  pause.title = t(Story.paused ? 'continueTitle' : 'pauseTitle');
  pause.setAttribute('aria-label', t(Story.paused ? 'continueAria' : 'pauseAria'));
  syncTransport();
};

/* ---------------------------------------------------------------- story editor */
const scenesEl = $('#scenes');
let openScene = -1;            // index of the scene whose fields are shown

const locVal = (obj, k) => getLoc(obj, k, state.lang, { fallback: false });
const locPh = (obj, k, defaultKey, vars = {}) => {
  const own = locVal(obj, k);
  const fb = !own.trim() ? getLoc(obj, k, state.lang, { fallback: true }) : '';
  return fb || t(defaultKey, vars);
};

function sceneTitle(sc) {
  const key = { chapter: 'caption', together: 'prompt', quiz: 'question', turns: 'prompt', currents: 'prompt' }[sc.type];
  const text = getLoc(sc, key, state.lang, { fallback: true });
  return (text || '').trim().split('\n')[0] || clipName(sc.clip) || t(SCENE_TYPES[sc.type].labelKey);
}
const field = (label, control, cls = '') => `<label${cls ? ` class="${cls}"` : ''}>${esc(label)}${control}</label>`;
const textArea = (k, value, placeholder) => `<textarea data-k="${k}" rows="2" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea>`;
const clipSelect = (k, value, emptyLabel) => `<select data-k="${k}" data-clip-slot>${clipOptions(value, emptyLabel)}</select>`;
const numInput = (k, value, min, max) => `<input data-k="${k}" type="number" min="${min}" max="${max}" step="1" value="${Number(value) || 0}">`;

function sceneFields(sc) {
  if (sc.type === 'chapter') {
    return `<div class="grid">
        ${field(t('chapterClip'), clipSelect('clip', sc.clip, t('noClipTextOnly')))}
        ${field(t('loopSeconds'), numInput('seconds', sc.seconds, 0, 600))}
      </div>
      ${field(t('captionLabel'), textArea('caption', locVal(sc, 'caption'), locPh(sc, 'caption', 'captionPlaceholder')))}`;
  }
  if (sc.type === 'together') {
    return `${field(t('playersRead'), textArea('prompt', locVal(sc, 'prompt'), locPh(sc, 'prompt', 'togetherPlaceholder')))}
      <div class="grid">
        ${field(t('whileWaitingLoop'), clipSelect('clip', sc.clip, t('keepPicture')))}
        ${field(t('holdTogetherFor'), numInput('seconds', sc.seconds, 1, 30))}
      </div>
      ${field(t('whenMadeItPlay'), clipSelect('successClip', sc.successClip, t('nothingGoOn')))}
      <p class="hint">${esc(t('togetherHint'))}</p>`;
  }
  if (sc.type === 'quiz') {
    const gotoOptions = a => `<option value="">${esc(t('thenGoOn'))}</option>` + state.story.scenes.map((targetSc, n) =>
      (targetSc === sc ? '' : `<option value="${targetSc.id}"${a.goto === targetSc.id ? ' selected' : ''}>${esc(t('thenJumpTo', { n: n + 1, title: sceneTitle(targetSc) }))}</option>`)).join('');
    const rows = sc.answers.map((a, n) => {
      const L = LETTERS[n];
      return `<div class="answer">
        <input type="radio" name="right-${sc.id}" data-k="correct" value="${n}"${sc.correct === n ? ' checked' : ''} title="${esc(t('rightAnswerTitle'))}" aria-label="${esc(t('answerIsRightAria', { letter: L }))}">
        <input data-a="${n}" data-k="text" value="${esc(locVal(a, 'text'))}" placeholder="${esc(locPh(a, 'text', 'answerPlaceholder', { letter: L }))}" aria-label="${esc(t('answerPlaceholder', { letter: L }))}">
        <select data-a="${n}" data-k="goto" aria-label="${esc(t('afterAnswerAria', { letter: L }))}">${gotoOptions(a)}</select>
        <button class="icon" data-act="delAnswer" data-a="${n}" title="${esc(t('removeAnswerTitle'))}" aria-label="${esc(t('removeAnswerAria', { letter: L }))}"${sc.answers.length <= 2 ? ' disabled' : ''}>${icon('i-trash')}</button>
      </div>`;
    }).join('');
    return `${field(t('questionLabel'), textArea('question', locVal(sc, 'question'), locPh(sc, 'question', 'questionPlaceholder')))}
      <div class="answers-edit">
        <span class="hint">${esc(t('answersMarkRight'))}</span>
        ${rows}
        <div class="row spread">
          <label class="check"><input type="radio" name="right-${sc.id}" data-k="correct" value="-1"${sc.correct < 0 ? ' checked' : ''}> ${esc(t('noRightVote'))}</label>
          <button data-act="addAnswer"${sc.answers.length >= 4 ? ' disabled' : ''}>${icon('i-plus')}${esc(t('addAnswer'))}</button>
        </div>
      </div>
      <div class="grid">
        ${field(t('groupDecides'), `<select data-k="decide">
          <option value="agree"${sc.decide === 'agree' ? ' selected' : ''}>${esc(t('decideAgree'))}</option>
          <option value="timer"${sc.decide === 'timer' ? ' selected' : ''}>${esc(t('decideTimer'))}</option>
        </select>`)}
        ${sc.decide === 'timer' ? field(t('timeToAnswer'), numInput('seconds', sc.seconds, 3, 120)) : field(t('behindQuestionLoop'), clipSelect('clip', sc.clip, t('keepPicture')))}
      </div>
      ${sc.decide === 'timer' ? field(t('behindQuestionLoop'), clipSelect('clip', sc.clip, t('keepPicture'))) : ''}
      ${field(t('explainLabel'), textArea('explain', locVal(sc, 'explain'), locPh(sc, 'explain', 'explainPlaceholder')))}
      <p class="hint">${esc(t('quizHint'))}</p>`;
  }
  if (sc.type === 'currents') {
    const lvls = [0, 1, 2, 3].map(n => `<option value="${n}"${Number(sc.level) === n ? ' selected' : ''}>${esc(t(`currentsLvl${n}`))}</option>`).join('');
    return `${field(t('playersRead'), textArea('prompt', locVal(sc, 'prompt'), locPh(sc, 'prompt', 'currentsPlaceholder')))}
      <div class="grid">
        ${field(t('currentsLevelLabel'), `<select data-k="level">${lvls}</select>`)}
        ${field(t('whenMadeItPlay'), clipSelect('successClip', sc.successClip, t('nothingGoOn')))}
      </div>
      <p class="hint">${esc(t('currentsHint'))}</p>`;
  }
  const turnClips = sc.clips.map((id, n) => `<li><span class="tag">${esc(t('turnTag', { n: n + 1 }))}</span><span class="name">${esc(clipName(id) || t('missingClip'))}</span>
      <button class="icon" data-act="upTurn" data-a="${n}" title="${esc(t('moveUp'))}" aria-label="${esc(t('moveTurnUp', { n: n + 1 }))}"${n === 0 ? ' disabled' : ''}>${icon('i-up')}</button>
      <button class="icon" data-act="downTurn" data-a="${n}" title="${esc(t('moveDown'))}" aria-label="${esc(t('moveTurnDown', { n: n + 1 }))}"${n === sc.clips.length - 1 ? ' disabled' : ''}>${icon('i-down')}</button>
      <button class="icon" data-act="delTurn" data-a="${n}" title="${esc(t('remove'))}" aria-label="${esc(t('removeTurn', { n: n + 1 }))}">${icon('i-trash')}</button></li>`).join('');
  return `${field(t('playersRead'), textArea('prompt', locVal(sc, 'prompt'), locPh(sc, 'prompt', 'turnsPlaceholder')))}
    ${field(t('whileWaitingLoop'), clipSelect('clip', sc.clip, t('keepPicture')))}
    <div class="answers-edit">
      <span class="hint">${esc(t('turnsHint'))}</span>
      <ol class="p-clips">${turnClips}</ol>
      <select data-add="clips" data-clip-slot aria-label="${esc(t('addTurnClipAria'))}"${clips.size ? '' : ' disabled'}>${clipOptions('', t('addTurnClipOption'))}</select>
    </div>`;
}

function analyzeStory(list) {
  const n = list.length;
  const idxById = new Map(list.map((sc, i) => [sc.id, i]));
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const sc = list[i];
    if (sc.type === 'quiz') {
      const targets = sc.answers.map(a => (a.goto && idxById.has(a.goto) ? idxById.get(a.goto) : i + 1));
      if (sc.decide === 'timer') targets.push(i + 1);
      adj[i] = [...new Set(targets)];
    } else {
      adj[i] = [i + 1];
    }
  }
  const reachable = new Set();
  if (n > 0) {
    const q = [0];
    while (q.length) {
      const u = q.shift();
      if (reachable.has(u) || u < 0 || u >= n) continue;
      reachable.add(u);
      for (const v of adj[u]) q.push(v);
    }
  }
  const rev = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < n; i++) for (const v of adj[i]) rev[Math.min(n, v)].push(i);
  const canFinish = new Set([n]);
  const rq = [n];
  while (rq.length) {
    const v = rq.shift();
    for (const u of rev[v]) if (!canFinish.has(u)) { canFinish.add(u); rq.push(u); }
  }
  return { reachable, canFinish };
}

function renderScenes() {
  const list = state.story.scenes;
  if (openScene >= list.length) openScene = -1;
  const { reachable, canFinish } = analyzeStory(list);
  scenesEl.innerHTML = list.map((sc, i) => {
    const open = i === openScene;
    const T = SCENE_TYPES[sc.type];
    const branches = sc.type === 'quiz' && sc.answers.some(a => a.goto);
    const unreach = !reachable.has(i);
    const loop = !unreach && !canFinish.has(i);
    const warn = (sc.type === 'quiz' && (!getLoc(sc, 'question', state.lang, { fallback: true }).trim() || sc.answers.filter(a => getLoc(a, 'text', state.lang, { fallback: true }).trim()).length < 2))
      || (sc.clip && !clips.has(sc.clip))
      || (sc.successClip && !clips.has(sc.successClip))
      || (sc.clips?.some(id => !clips.has(id)));
    return `<li class="scene is-${sc.type}${open ? ' open' : ''}${Story.phase === 'scene' && Story.idx === i ? ' playing' : ''}" data-i="${i}">
      <button class="scene-head" data-act="toggle" aria-expanded="${open}">
        <span class="node">${icon(T.icon)}</span>
        <span class="scene-title">${esc(sceneTitle(sc))}</span>
        <span class="scene-meta">${branches ? `<span class="scene-badge">${esc(t('badgeBranches'))}</span>` : ''}${unreach ? `<span class="scene-badge warn" title="${esc(t('badgeUnreachableTitle'))}">${esc(t('badgeUnreachable'))}</span>` : ''}${loop ? `<span class="scene-badge err" title="${esc(t('badgeLoopTitle'))}">${esc(t('badgeLoop'))}</span>` : ''}${warn ? `<span class="scene-badge warn" title="${esc(t('badgeWarnTitle'))}">!</span>` : ''}<span class="scene-kind">${esc(t(T.labelKey))}</span></span>
      </button>
      ${open ? `<div class="scene-body">${sceneFields(sc)}
        ${unreach ? `<p class="hint">${esc(t('warnUnreachable'))}</p>` : ''}
        ${loop ? `<p class="hint">${esc(t('warnLoop'))}</p>` : ''}
        <div class="row spread scene-actions">
          <button data-act="play">${icon('i-play')}${esc(t('playFromHere'))}</button>
          <div class="row">
            <button class="icon" data-act="up" title="${esc(t('moveEarlier'))}" aria-label="${esc(t('moveEarlier'))}"${i === 0 ? ' disabled' : ''}>${icon('i-up')}</button>
            <button class="icon" data-act="down" title="${esc(t('moveLater'))}" aria-label="${esc(t('moveLater'))}"${i === list.length - 1 ? ' disabled' : ''}>${icon('i-down')}</button>
            <button class="icon" data-act="dup" title="${esc(t('duplicate'))}" aria-label="${esc(t('duplicateScene'))}">${icon('i-copy')}</button>
            <button class="icon danger" data-act="del" title="${esc(t('deleteScene'))}" aria-label="${esc(t('deleteScene'))}">${icon('i-trash')}</button>
          </div>
        </div></div>` : ''}
    </li>`;
  }).join('');
  $('#storyEmpty').hidden = list.length > 0;
  $('.add-scene .hint').textContent = openScene >= 0 ? t('insertSceneAfter', { n: openScene + 1 }) : t('addScene');
  $('#modeHint').textContent = state.mode === 'free'
    ? t('modeHintFree')
    : list.length ? t('modeHintStory')
      : t('modeHintEmpty');
}

// After the list changed shape: keep the stage on the scene being edited.
function storyChanged() {
  save(); renderScenes(); applyMode();
  if (!Story.running()) return;
  if (openScene >= 0) Story.preview(openScene); else Story.attract();
}

renderAddSceneButtons();
$('#addScene').onclick = e => {
  const type = e.target.closest('[data-type]')?.dataset.type;
  if (!type) return;
  const list = state.story.scenes;
  const sc = newScene(type);
  const at = openScene >= 0 ? openScene + 1 : list.length;
  // start from the clip of the scene before, so the picture doesn't change by accident
  if (type !== 'chapter' && type !== 'currents') sc.clip = list[at - 1]?.clip || state.story.attractClip || '';
  list.splice(at, 0, sc);
  openScene = at;
  storyChanged();
  scenesEl.children[at]?.querySelector('textarea, select')?.focus();
};

scenesEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const i = Number(btn.closest('.scene').dataset.i);
  const list = state.story.scenes;
  const sc = list[i];
  const a = Number(btn.dataset.a);
  switch (btn.dataset.act) {
    case 'toggle':
      openScene = openScene === i ? -1 : i;
      renderScenes();
      if (openScene >= 0 && Story.running()) Story.preview(i);
      return;
    case 'play': Story.running() && Story.preview(i); return;
    case 'up': [list[i - 1], list[i]] = [list[i], list[i - 1]]; openScene = i - 1; break;
    case 'down': [list[i + 1], list[i]] = [list[i], list[i + 1]]; openScene = i + 1; break;
    case 'dup': list.splice(i + 1, 0, { ...clone(sc), id: uid() }); openScene = i + 1; break;
    case 'del':
      list.splice(i, 1);
      list.forEach(other => other.answers?.forEach(ans => { if (ans.goto === sc.id) ans.goto = ''; }));
      openScene = -1;
      break;
    case 'addAnswer': sc.answers.push({ text: '', goto: '' }); break;
    case 'delAnswer':
      sc.answers.splice(a, 1);
      if (sc.correct === a) sc.correct = 0; else if (sc.correct > a) sc.correct--;
      break;
    case 'upTurn': [sc.clips[a - 1], sc.clips[a]] = [sc.clips[a], sc.clips[a - 1]]; break;
    case 'downTurn': [sc.clips[a + 1], sc.clips[a]] = [sc.clips[a], sc.clips[a + 1]]; break;
    case 'delTurn': sc.clips.splice(a, 1); break;
    default: return;
  }
  storyChanged();
});

// Typing updates the hologram live: the stage redraws its prompts from the scene every frame.
const LOC_KEYS = new Set(['caption', 'prompt', 'question', 'explain', 'text']);
scenesEl.addEventListener('input', e => {
  const el = e.target;
  const li = el.closest('.scene');
  if (!li) return;
  const sc = state.story.scenes[Number(li.dataset.i)];
  if (el.dataset.add) {
    if (el.value) { sc[el.dataset.add].push(el.value); storyChanged(); }
    return;
  }
  const k = el.dataset.k;
  if (!k) return;
  const target = el.dataset.a != null ? sc.answers[Number(el.dataset.a)] : sc;
  if (LOC_KEYS.has(k)) setLoc(target, k, el.value, state.lang);
  else target[k] = el.type === 'number' || k === 'correct' || k === 'level' ? Number(el.value) || 0 : el.value;
  save();
  li.querySelector('.scene-title').textContent = sceneTitle(sc);
});
// Choices that change what plays restart the scene on the stage.
scenesEl.addEventListener('change', e => {
  const el = e.target;
  if (!el.dataset.k || el.tagName === 'TEXTAREA' || el.type === 'text') return;
  if (el.dataset.k === 'decide') return storyChanged();
  const i = Number(el.closest('.scene').dataset.i);
  if (Story.phase === 'scene' && Story.idx === i) Story.preview(i);
});

function renderStoryMeta() {
  const S = state.story;
  document.querySelectorAll('input[name=runMode]').forEach(r => { r.checked = r.value === state.mode; });
  $('#sTitle').value = locVal(S, 'title');
  $('#sTitle').placeholder = locPh(S, 'title', 'storyTitlePlaceholder');
  $('#sAttract').innerHTML = clipOptions(S.attractClip, t('sameAsFirstScene'));
  $('#sJoin').value = S.joinSeconds;
  $('#sIdle').value = S.idleReset;
  $('#sWordsHint').innerHTML = t('wordsHintHtml', { lang: LANG_NAMES[state.lang] });
  const WORDS = {
    join: 'wordJoin', joined: 'wordJoined', yourTurn: 'wordYourTurn',
    turnOf: 'wordTurnOf', right: 'wordRight', wrong: 'wordWrong',
    tie: 'wordTie', paused: 'wordPaused', end: 'wordEnd',
  };
  const texts = S.textByLang?.[state.lang] || S.text;
  $('#sWords').innerHTML = Object.entries(WORDS).map(([k, key]) =>
    `<label>${esc(t(key))}<input data-word="${k}" value="${esc(texts[k] ?? '')}"></label>`).join('');
}
document.querySelectorAll('input[name=runMode]').forEach(r => {
  r.onchange = () => { state.mode = r.value; save(); renderScenes(); applyMode(); };
});
$('#sTitle').oninput = e => { setLoc(state.story, 'title', e.target.value, state.lang); save(); };
$('#sAttract').onchange = e => { state.story.attractClip = e.target.value; save(); if (Story.phase === 'attract') Story.attract(); };
$('#sJoin').onchange = e => { state.story.joinSeconds = Math.max(1, Number(e.target.value) || 6); save(); };
$('#sIdle').onchange = e => { state.story.idleReset = Math.max(0, Number(e.target.value) || 0); save(); };
$('#sWords').oninput = e => {
  const k = e.target.dataset.word;
  if (!k) return;
  state.story.textByLang ||= clone(DEFAULT_STORY_TEXT);
  state.story.textByLang[state.lang] ||= { ...DEFAULT_STORY_TEXT[state.lang] };
  state.story.textByLang[state.lang][k] = e.target.value;
  state.story.text = state.story.textByLang[state.lang];
  save();
  if (Story.running()) Story.render();
};

/* ---------------------------------------------------------------- players */
function formatBinding(b) {
  if (!b) return t('none');
  if (b.type === 'pad') return t('gamepadButton', { pad: b.pad + 1, btn: b.button });
  if (b.type === 'axis') return t('gamepadAxis', { pad: b.pad + 1, axis: b.axis, dir: b.dir > 0 ? '+' : '−' });
  if (b.type === 'key' && /^Digit([1-4])$/.test(b.code) && /^Key\s+[1-4]$/.test(b.label || '')) {
    return t('keyLabel', { key: b.code.slice(5) });
  }
  return b.label;
}

function renderPlayers() {
  const host = $('#players');
  const openDetails = [...host.querySelectorAll('details')].map(d => d.open);
  host.innerHTML = '';
  const tpl = $('#tplPlayer');
  state.players.forEach((cfg, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    translateDOM(node);
    node.dataset.i = i;
    const q = s => node.querySelector(s);
    q('details').open = !!openDetails[i];
    q('.p-color').value = cfg.color;
    q('.p-color').oninput = e => { cfg.color = e.target.value; save(); layout(); };
    q('.p-name').value = displayPlayerName(cfg, i, state.lang);
    q('.p-name').onchange = e => { cfg.name = e.target.value.trim() || defaultPlayerName(i + 1, state.lang); save(); layout(); };
    q('.p-side').value = cfg.side;
    q('.p-side').onchange = e => {
      const next = e.target.value;
      const other = state.players.find((p, j) => j !== i && p.side === next);
      if (other) other.side = cfg.side;
      cfg.side = next;
      save(); renderPlayers(); layout();
    };
    q('.p-lang').value = cfg.lang || '';
    q('.p-lang').onchange = e => {
      cfg.lang = e.target.value;
      save(); layout();
      if (Story.running()) Story.render();
    };
    q('.p-mode').value = cfg.mode;
    q('.p-mode').onchange = e => { cfg.mode = e.target.value; save(); renderPlayers(); if (!Story.running()) players[i].start(); };
    q('.p-interrupt').checked = !!cfg.interrupt;
    q('.p-interrupt').onchange = e => { cfg.interrupt = e.target.checked; save(); };
    q('.p-interrupt').closest('label').hidden = cfg.mode !== 'trigger';
    q('.p-test').onclick = () => { buttonDown(i); setTimeout(() => buttonUp(i), 120); };
    const lbl = cfg.label;
    const lblText = q('.p-ltext');
    lblText.value = locVal(lbl, 'text');
    lblText.placeholder = locPh(lbl, 'text', 'infoLabelPlaceholder');
    lblText.addEventListener('input', () => {
      setLoc(lbl, 'text', lblText.value, state.lang);
      players[i].renderLabel(players[i].el.offsetWidth);
      save();
    });
    const lblField = (sel, key, parse = v => v, ev = 'change') => {
      const el = q(sel);
      el.value = lbl[key];
      el.addEventListener(ev, () => { lbl[key] = parse(el.value); players[i].renderLabel(players[i].el.offsetWidth); save(); });
    };
    lblField('.p-lpos', 'pos');
    lblField('.p-lshow', 'show');
    lblField('.p-lcolor', 'color', v => v, 'input');
    lblField('.p-lsize', 'size', Number, 'input');
    q('.p-binding').textContent = formatBinding(cfg.binding);
    const learn = q('.p-learn');
    if (learning === i) { learn.textContent = t('pressButtonNow'); learn.classList.add('learning'); }
    learn.onclick = () => { learning = learning === i ? null : i; renderPlayers(); };
    q('.p-unbind').onclick = () => { cfg.binding = null; save(); renderPlayers(); };

    const restart = () => { if (!Story.running()) players[i].start(); };
    const ol = q('.p-clips');
    const list = cfg.clips.filter(id => clips.has(id));
    if (!list.length) ol.innerHTML = `<li class="hint">${esc(t('noClipsYet'))}</li>`;
    list.forEach((id, k) => {
      const li = document.createElement('li');
      const tag = cfg.mode === 'trigger'
        ? (k === 0 ? `<span class="tag idle">${esc(t('idleLoopTag'))}</span>` : `<span class="tag">${esc(t('actionTag', { n: k }))}</span>`)
        : `<span class="tag">${k + 1}</span>`;
      li.innerHTML = `${tag}<span class="name">${esc(clips.get(id).name)}</span>
        <button class="icon" data-a="up" title="${esc(t('moveUp'))}" aria-label="${esc(t('moveUp'))}" ${k === 0 ? 'disabled' : ''}>${icon('i-up')}</button>
        <button class="icon" data-a="down" title="${esc(t('moveDown'))}" aria-label="${esc(t('moveDown'))}" ${k === list.length - 1 ? 'disabled' : ''}>${icon('i-down')}</button>
        <button class="icon" data-a="del" title="${esc(t('removeFromPlayer'))}" aria-label="${esc(t('removeFromPlayer'))}">${icon('i-trash')}</button>`;
      li.onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        const arr = cfg.clips.filter(x => clips.has(x));
        if (a === 'del') arr.splice(k, 1);
        if (a === 'up') [arr[k - 1], arr[k]] = [arr[k], arr[k - 1]];
        if (a === 'down') [arr[k + 1], arr[k]] = [arr[k], arr[k + 1]];
        cfg.clips = arr; save(); renderPlayers(); restart();
      };
      ol.appendChild(li);
    });
    const add = q('.p-add');
    add.innerHTML = clipOptions('', t('addClipOption'));
    add.disabled = clips.size === 0;
    add.onchange = e => {
      if (!e.target.value) return;
      cfg.clips = cfg.clips.filter(x => clips.has(x)).concat(e.target.value);
      save(); renderPlayers();
      if (cfg.clips.length === 1 || cfg.mode === 'cycle') restart();
    };
    host.appendChild(node);
  });
}

/* ---------------------------------------------------------------- video library */
const libPreview = $('#libPreview');
const libPreviewVideo = $('#libPreviewVideo');
const libPreviewName = $('#libPreviewName');
let previewClipId = null;
function closePreview() {
  previewClipId = null;
  libPreview.hidden = true;
  libPreviewVideo.pause();
  libPreviewVideo.removeAttribute('src');
  libPreviewVideo.load();
}
function openPreview(c) {
  if (previewClipId === c.id && !libPreview.hidden) return closePreview();
  previewClipId = c.id;
  libPreviewName.textContent = c.name;
  libPreviewVideo.src = c.url;
  libPreview.hidden = false;
  libPreviewVideo.play().catch(() => {});
}
$('#libPreviewClose').onclick = closePreview;

const probing = new Set();
function probeDuration(c) {
  if (durations.has(c.id) || probing.has(c.id)) return;
  probing.add(c.id);
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.src = c.url;
  const done = () => {
    probing.delete(c.id);
    if (Number.isFinite(v.duration) && v.duration > 0) {
      durations.set(c.id, v.duration);
      const el = document.querySelector(`#library [data-dur="${c.id}"]`);
      if (el) el.textContent = fmtDur(v.duration);
    }
    v.removeAttribute('src');
    v.load();
  };
  v.onloadedmetadata = done;
  v.onerror = done;
}

const replaceInput = $('#replaceInput');
let replaceTargetId = null;
replaceInput.onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  const id = replaceTargetId; replaceTargetId = null;
  if (!f || !id) return;
  try {
    if (!await replaceClip(id, f)) return;
    if (previewClipId === id) { previewClipId = null; openPreview(clips.get(id)); }
    applyAll();
    notice(t('noticeReplaced', { name: f.name }), { tone: 'good', ms: 3500 });
  } catch (err) {
    notice(t('noticeReplaceErr', { msg: err?.message || t('storageError') }), { tone: 'err', ms: 0 });
  }
};

function startRename(li, c) {
  const nameEl = li.querySelector('.name');
  if (!nameEl || nameEl.tagName === 'INPUT') return;
  li.draggable = false;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename';
  input.value = c.name;
  input.setAttribute('aria-label', t('clipNameAria'));
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async commit => {
    if (done) return;
    done = true;
    if (commit) {
      await renameClip(c.id, input.value);
      if (previewClipId === c.id) libPreviewName.textContent = clips.get(c.id)?.name || '';
      clipsChanged();
    } else {
      renderLibrary();
    }
  };
  input.onkeydown = ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
  };
  input.onblur = () => finish(true);
}

function linkPendingClips() {
  if (!state.pendingClips || !Object.keys(state.pendingClips).length) return 0;
  const byName = new Map([...clips.values()].map(c => [c.name, c.id]));
  let linked = 0;
  for (const [oldId, name] of Object.entries(state.pendingClips)) {
    const found = byName.get(name);
    if (!found) continue;
    mapClipRefs(state, id => (id === oldId ? found : id));
    delete state.pendingClips[oldId];
    linked++;
  }
  if (linked) save();
  return linked;
}

function renderLibrary() {
  const ul = $('#library');
  if (previewClipId && !previewClipId.startsWith('builtin:') && !clips.has(previewClipId)) closePreview();
  ul.innerHTML = clips.size ? '' : `<li class="hint">${esc(t('noVideosYet'))}</li>`;
  for (const c of clips.values()) {
    const dur = durations.has(c.id) ? fmtDur(durations.get(c.id)) : '';
    if (!dur) probeDuration(c);
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.dragClip = c.id;
    li.title = t('dragClipTitle');
    li.innerHTML = `<button class="icon" data-prev title="${esc(t('previewClip'))}" aria-label="${esc(t('previewClipAria', { name: c.name }))}">${icon('i-play')}</button>
      <span class="name" title="${esc(c.name)}">${esc(c.name)}</span>
      <span class="dur" data-dur="${esc(c.id)}">${dur}</span>
      <span class="size">${fmtSize(c.size)}</span>
      <button class="icon" data-ren title="${esc(t('renameClip'))}" aria-label="${esc(t('renameClipAria', { name: c.name }))}">${icon('i-edit')}</button>
      <button data-rep title="${esc(t('replaceVideoTitle'))}">${esc(t('replace'))}</button>
      <button class="danger" data-del>${esc(t('delete'))}</button>`;
    li.querySelector('[data-prev]').onclick = () => openPreview(c);
    li.querySelector('[data-ren]').onclick = () => startRename(li, c);
    li.querySelector('[data-rep]').onclick = () => { replaceTargetId = c.id; replaceInput.click(); };
    const delBtn = li.querySelector('[data-del]');
    delBtn.onclick = () => armConfirm(delBtn, t('confirmDelete'), async () => {
      delBtn.disabled = true;
      try {
        await deleteClip(c.id);
      } catch (err) {
        delBtn.disabled = false;
        notice(t('noticeDeleteErr', { name: c.name, msg: err?.message || t('storageError') }), { tone: 'err', ms: 0 });
      }
    }, 0);
    ul.appendChild(li);
  }
  const waiting = [...new Set(Object.values(state.pendingClips || {}))];
  const pendEl = $('#pendingClips');
  pendEl.hidden = waiting.length === 0;
  if (waiting.length) pendEl.textContent = t('waitingImported', { list: waiting.join(', ') });
  if (navigator.storage?.estimate) navigator.storage.estimate().then(({ usage, quota }) => {
    $('#storage').textContent = t('storageUsed', { used: fmtSize(usage), quota: fmtSize(quota) });
  });
  renderBuiltinPacks();
  renderClipShelf();
  syncDemoButtons();
}

async function importBuiltinItems(items, btn) {
  if (btn) { btn.disabled = true; btn.textContent = t('loading'); }
  let added = 0;
  try {
    for (const item of items) {
      if ([...clips.values()].some(c => c.name === item.name)) continue;
      const r = await fetch(item.url);
      if (!r.ok) throw new Error(`${item.url}: ${r.status}`);
      await addClip(await r.blob(), item.name);
      added++;
    }
    const linked = linkPendingClips();
    if (linked) { applyAll(); notice(t('noticeLinked', { n: linked }), { tone: 'good', ms: 3500 }); }
    else if (added) {
      clipsChanged();
      notice(added === 1 ? t('noticeClipAdded', { name: items[0].name }) : t('noticePackAdded', { n: added }), { tone: 'good', ms: 3000 });
    } else {
      renderBuiltinPacks();
    }
  } catch (e) {
    notice(t('noticeClipLoadErr', { msg: e.message }), { tone: 'err' });
    renderBuiltinPacks();
  }
}

function isOfflineRemote() {
  return !navigator.onLine && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

function renderBuiltinPacks() {
  const host = $('#builtinPacks');
  if (!host || typeof BUILTIN_PACKS === 'undefined') return;
  host.innerHTML = '';
  const offline = isOfflineRemote();
  for (const pack of BUILTIN_PACKS) {
    const card = document.createElement('div');
    card.className = 'builtin-pack';
    const allIn = pack.clips.every(item => [...clips.values()].some(c => c.name === item.name));
    const head = document.createElement('div');
    head.className = 'row spread builtin-pack-head';
    const viewerLink = pack.viewerUrl
      ? `<a class="button builtin-3d" href="${esc(pack.viewerUrl)}" target="_blank" rel="noopener" title="${esc(t('open3DViewer'))}">3D ↗</a>`
      : '';
    head.innerHTML = `<strong>${esc(t(pack.titleKey))}</strong>
      <div class="row">${viewerLink}<button class="builtin-all" ${allIn || offline ? 'disabled' : ''}>${esc(allIn ? t('added') : t('addAll'))}</button></div>`;
    const allBtn = head.querySelector('.builtin-all');
    if (offline && !allIn) allBtn.title = t('offlineDemoTitle');
    allBtn.onclick = () => importBuiltinItems(pack.clips, allBtn);
    card.appendChild(head);

    const ul = document.createElement('ul');
    ul.className = 'library builtin-list';
    for (const item of pack.clips) {
      const has = [...clips.values()].some(c => c.name === item.name);
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.dragBuiltin = item.url;
      li.title = t('dragClipTitle');
      li.innerHTML = `<button class="icon" data-prev title="${esc(t('previewClip'))}" aria-label="${esc(t('previewClipAria', { name: item.name }))}">${icon('i-play')}</button>
        <span class="name" title="${esc(item.name)}">${esc(item.name)}</span>
        <button data-add ${has || offline ? 'disabled' : ''} class="${has ? 'is-added' : ''}">${esc(has ? t('added') : t('addToLibrary'))}</button>`;
      li.querySelector('[data-prev]').onclick = () => openPreview({ id: `builtin:${item.url}`, name: item.name, url: item.url });
      const addBtn = li.querySelector('[data-add]');
      if (offline && !has) addBtn.title = t('offlineDemoTitle');
      addBtn.onclick = () => importBuiltinItems([item], addBtn);
      ul.appendChild(li);
    }
    card.appendChild(ul);
    host.appendChild(card);
  }
}
// New clips change every clip menu, so redraw the editors without touching what plays.
function clipsChanged() {
  renderLibrary(); renderPlayers(); renderStoryMeta(); renderScenes();
}
async function sameVideo(a, b) {
  // Compare in chunks so checking a repeat import doesn't load two full videos into memory.
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < a.size; offset += chunkSize) {
    const [first, second] = await Promise.all([a, b].map(async blob =>
      new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer())
    ));
    if (!first.every((byte, i) => byte === second[i])) return false;
  }
  return true;
}

async function addFiles(files) {
  let added = 0, skipped = 0, duplicates = 0;
  for (const f of files) {
    if (!(f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name))) { skipped++; continue; }
    try {
      const candidates = [...clips.values()].filter(c => c.name === f.name && c.size === f.size);
      let duplicate = false;
      for (const candidate of candidates) {
        if (await sameVideo(candidate.blob, f) && clips.get(candidate.id)?.blob === candidate.blob) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) duplicates++;
      else { await addClip(f, f.name); added++; }
    } catch (e) {
      notice(t('noticeStoreErr', { name: f.name, msg: e?.message || t('storageLimit') }), { tone: 'err', ms: 0 });
      break;
    }
  }
  const linked = added || duplicates ? linkPendingClips() : 0;
  if (linked) { applyAll(); notice(t('noticeLinked', { n: linked }), { tone: 'good', ms: 3500 }); }
  else if (added) clipsChanged();
  if (duplicates && !added && !linked) notice(t('noticeAlreadyInLibrary'));
  else if (skipped && !added && !linked) notice(t('noticeVideoOnly'), { tone: 'warn' });
}
let importQueue = Promise.resolve();
function queueFiles(files) {
  importQueue = importQueue.then(() => addFiles(files));
}
$('#fileInput').onchange = e => { queueFiles([...e.target.files]); e.target.value = ''; };
panel.addEventListener('dragover', e => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); panel.classList.add('dragover'); });
panel.addEventListener('dragleave', () => panel.classList.remove('dragover'));
panel.addEventListener('drop', e => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  panel.classList.remove('dragover');
  const items = [...e.dataTransfer.items].filter(item => item.kind === 'file');
  const files = items.length
    ? items.filter(item => !item.webkitGetAsEntry?.()?.isDirectory).map(item => item.getAsFile()).filter(Boolean)
    : [...e.dataTransfer.files];
  if (files.length) queueFiles(files);
  else notice(t('noticeVideoOnly'), { tone: 'warn' });
});

/* ---------------------------------------------------------------- drag clips onto slots */
// Sources: library rows, bundled clips and the clip shelf. Targets: clip pickers, scene
// headers, free-play clip lists and the four pyramid faces on the stage.
const CLIP_MIME = 'application/x-holo-clip';
const isClipDrag = e => !!e.dataTransfer?.types?.includes(CLIP_MIME);

// Compact strip of the library above the Story and Buttons tabs, so a clip can be dragged
// without switching to Videos.
function renderClipShelf() {
  const shelf = document.getElementById('clipShelf');
  const tab = document.querySelector('.tabs [aria-selected="true"]')?.dataset.tab;
  const show = clips.size > 0 && (tab === 'story' || tab === 'buttons');
  shelf.hidden = !show;
  if (!show) { shelf.innerHTML = ''; return; }
  shelf.innerHTML = `<span class="shelf-label">${esc(t('clipShelfLabel'))}</span>` + [...clips.values()].map(c =>
    `<span class="chip" draggable="true" data-drag-clip="${esc(c.id)}" title="${esc(t('dragClipTitle'))}">${esc(c.name)}</span>`).join('');
}

let dropMark = null;
function markDrop(el) {
  if (dropMark === el) return;
  dropMark?.classList.remove('drop-ok');
  dropMark = el;
  el?.classList.add('drop-ok');
}
function endClipDrag() {
  document.body.classList.remove('clip-dragging');
  markDrop(null);
  players.forEach(p => p.el.classList.remove('drop-ok'));
}
document.addEventListener('dragstart', e => {
  const src = e.target.closest?.('[data-drag-clip], [data-drag-builtin]');
  if (!src) return;
  const payload = src.dataset.dragClip ? { id: src.dataset.dragClip } : { url: src.dataset.dragBuiltin };
  e.dataTransfer.setData(CLIP_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('clip-dragging');
});
// the source row can be re-rendered mid-drag, so clean up on drop as well as dragend
document.addEventListener('dragend', endClipDrag);
document.addEventListener('drop', endClipDrag);

// What a drop on `el` would change, described by meaning (the DOM is re-rendered before it applies).
function dropSlot(el) {
  if (!(el instanceof Element) || !panel.contains(el)) return null;
  const sel = el.closest('select[data-clip-slot]')
    || el.closest('label')?.querySelector('select[data-clip-slot]')
    || el.closest('.answers-edit, details.more')?.querySelector('select[data-clip-slot]');
  if (sel) {
    const mark = sel.closest('label, .answers-edit, details.more') || sel;
    if (sel.id === 'sAttract') return { mark, kind: 'attract' };
    const card = sel.closest('.player');
    if (card) return { mark, kind: 'player', i: Number(card.dataset.i) };
    const li = sel.closest('.scene');
    if (li) return { mark, kind: 'scene', i: Number(li.dataset.i), key: sel.dataset.k || '', add: sel.dataset.add || '' };
  }
  const head = el.closest('.scene-head');
  if (head) return { mark: head, kind: 'scene', i: Number(head.closest('.scene').dataset.i), key: '', add: '' };
  return null;
}

// Reads the payload synchronously (it is only readable during the drop event); a bundled
// clip is imported into the library first.
async function droppedClip(e) {
  let p;
  try { p = JSON.parse(e.dataTransfer.getData(CLIP_MIME)); } catch { return null; }
  if (p?.id) return clips.has(p.id) ? p.id : null;
  const item = typeof BUILTIN_PACKS !== 'undefined' && BUILTIN_PACKS.flatMap(pk => pk.clips).find(x => x.url === p?.url);
  if (!item) return null;
  const find = () => [...clips.values()].find(c => c.name === item.name)?.id || null;
  if (!find()) await importBuiltinItems([item]);
  return find();
}

function applyDrop(slot, id) {
  const name = clipName(id);
  const ok = msg => notice(msg, { tone: 'good', ms: 2600 });
  if (slot.kind === 'attract') {
    state.story.attractClip = id;
    save(); renderStoryMeta();
    if (Story.phase === 'attract') Story.attract();
    return ok(t('noticeDropStart', { name }));
  }
  if (slot.kind === 'player') {
    const cfg = state.players[slot.i];
    if (!cfg) return;
    cfg.clips = cfg.clips.filter(x => clips.has(x)).concat(id);
    save(); renderPlayers();
    if (!Story.running() && (cfg.clips.length === 1 || cfg.mode === 'cycle')) players[slot.i].start();
    return ok(t('noticeDropPlayer', { name, player: displayPlayerName(cfg, slot.i, state.lang) }));
  }
  const sc = state.story.scenes[slot.i];
  if (!sc) return;
  if (slot.add) sc[slot.add].push(id);
  else if (slot.key) sc[slot.key] = id;
  else { sc[sc.type === 'currents' ? 'successClip' : 'clip'] = id; openScene = slot.i; } // header or stage: open it to show the change
  storyChanged();
  ok(t('noticeDropScene', { n: slot.i + 1, name }));
}

panel.addEventListener('dragover', e => {
  if (!isClipDrag(e)) return;
  const slot = dropSlot(e.target);
  markDrop(slot?.mark || null);
  if (!slot) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
panel.addEventListener('dragleave', e => {
  if (isClipDrag(e) && !panel.contains(e.relatedTarget)) markDrop(null);
});
panel.addEventListener('drop', async e => {
  if (!isClipDrag(e)) return;
  e.preventDefault();
  const slot = dropSlot(e.target);
  const pending = droppedClip(e);
  endClipDrag();
  const id = slot && await pending;
  if (id) applyDrop(slot, id);
});

// Hovering a tab while dragging opens it, so a clip from Videos can reach the Story or Buttons tab.
let tabDragTimer;
tabBtns.forEach(btn => {
  btn.addEventListener('dragenter', e => {
    if (!isClipDrag(e) || btn.getAttribute('aria-selected') === 'true') return;
    clearTimeout(tabDragTimer);
    tabDragTimer = setTimeout(() => selectTab(btn), 450);
  });
  btn.addEventListener('dragleave', () => clearTimeout(tabDragTimer));
});

// The pyramid faces: in a story, a drop sets the clip of the scene being edited (or the start
// screen); in free play it adds the clip to that face's player.
players.forEach((p, i) => {
  p.el.addEventListener('dragover', e => {
    if (!isClipDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    p.el.classList.add('drop-ok');
  });
  p.el.addEventListener('dragleave', e => { if (!p.el.contains(e.relatedTarget)) p.el.classList.remove('drop-ok'); });
  p.el.addEventListener('drop', async e => {
    if (!isClipDrag(e)) return;
    e.preventDefault();
    const slot = !Story.running() ? { kind: 'player', i }
      : openScene >= 0 ? { kind: 'scene', i: openScene, key: '', add: '' }
        : { kind: 'attract' };
    const pending = droppedClip(e);
    endClipDrag();
    const id = await pending;
    if (id) applyDrop(slot, id);
  });
});

// Demo content: a short volcano story that uses every kind of scene.
function demoStory([idle, eruption]) {
  const sc = (type, props) => ({ ...newScene(type), ...props });
  const story = {
    title: DEMO_I18N.title[state.lang] || DEMO_I18N.title.en,
    i18n: makeI18nMap('title', DEMO_I18N.title),
    attractClip: idle,
    scenes: [
      sc('chapter', { clip: idle, seconds: 7, caption: DEMO_I18N.chapter.caption.en }),
      sc('quiz', {
        clip: idle, question: DEMO_I18N.quiz.question.en, correct: 0, decide: 'agree',
        answers: DEMO_I18N.quiz.answers.map(a => ({ text: a.en, goto: '' })),
        explain: DEMO_I18N.quiz.explain.en,
      }),
      sc('together', { clip: idle, seconds: 4, successClip: eruption, prompt: DEMO_I18N.together.prompt.en }),
      sc('turns', { clip: idle, clips: [eruption], prompt: DEMO_I18N.turns.prompt.en }),
    ],
  };
  story.scenes.forEach(s => { delete s.i18n; });
  upgradeDemoI18n(story);
  return story;
}
async function loadDemo(btn) {
  btn.disabled = true; btn.textContent = t('loading');
  try {
    const ids = [];
    for (const d of DEMO) {
      const existing = [...clips.values()].find(c => c.name === d.name);
      if (existing) { ids.push(existing.id); continue; }
      const r = await fetch(d.url);
      if (!r.ok) throw new Error(`${d.url}: ${r.status}`);
      ids.push(await addClip(await r.blob(), d.name));
    }
    // free play: fill empty players, and swap out older demo clips
    const isDemo = id => clips.get(id)?.name.startsWith('Volcano –');
    state.players.forEach(p => {
      const own = p.clips.filter(x => clips.has(x));
      if (!own.length || own.every(isDemo)) { p.clips = [...ids]; p.mode = 'trigger'; }
    });
    // an existing story is never overwritten
    if (!state.story.scenes.length) { Object.assign(state.story, demoStory(ids)); state.mode = 'story'; openScene = -1; }
    linkPendingClips();
    save(); applyAll();
  } catch (e) { notice(t('noticeDemoErr', { msg: e.message }), { tone: 'err' }); }
  btn.textContent = t(btn.dataset.i18n || 'loadVolcanoDemo');
  syncDemoButtons();
}
function syncDemoButtons() {
  const demoCached = DEMO.every(d => [...clips.values()].some(c => c.name === d.name));
  const offlineBlocked = isOfflineRemote() && !demoCached;
  document.querySelectorAll('[data-demo]').forEach(btn => {
    btn.disabled = offlineBlocked;
    btn.title = offlineBlocked ? t('offlineDemoTitle') : '';
  });
}
addEventListener('online', () => { syncDemoButtons(); renderBuiltinPacks(); });
addEventListener('offline', () => { syncDemoButtons(); renderBuiltinPacks(); });
document.querySelectorAll('[data-demo]').forEach(btn => { btn.onclick = () => loadDemo(btn); });

/* ---------------------------------------------------------------- pyramid layout + backup */
const bindLayout = (id, key, parse = v => v, fmt) => {
  const el = $(id);
  const out = el.parentElement.querySelector('output');
  const sync = () => {
    if (el.type === 'checkbox') el.checked = !!state.layout[key]; else el.value = state.layout[key];
    if (out) out.textContent = fmt ? fmt(state.layout[key]) : state.layout[key];
  };
  el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    state.layout[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
    if (key === 'sound' && state.layout[key]) SFX.play('press');
    sync(); layout(); save(); renderBuild();
  });
  return sync;
};
const pct = v => `${Math.round(v * 100)}%`;
const layoutSyncs = [
  bindLayout('#lTile', 'tile', Number, pct),
  bindLayout('#lHole', 'hole', Number, pct),
  bindLayout('#lFeather', 'feather', Number, pct),
  bindLayout('#lFade', 'fade', Number),
  bindLayout('#lOrientation', 'orientation'),
  bindLayout('#lRotate', 'rotate', Number),
  bindLayout('#lMirror', 'mirror'),
  bindLayout('#lTap', 'tapTrigger'),
  bindLayout('#lGuides', 'guides'),
  bindLayout('#lKiosk', 'kioskLock'),
  bindLayout('#lSound', 'sound'),
];

/* ---------------------------------------------------------------- first-run tutorial */
// A card walks through the setup panel step by step. Each step opens its tab, puts a
// spotlight on the part it explains (the rest of the panel dims) and pins numbered badges
// on the exact controls; the card text uses the same numbers. Some steps add a small
// diagram for things that are hard to say in words. Texts: i18n.js tour_<key>_t / _b, art_*.
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const TOUR = [
  { key: 'welcome', tab: 'story', art: 'welcome' },
  { key: 'pyramid', tab: 'setup', art: 'pyramid', target: () => $('#buildSection'),
    marks: () => [$('#bDiag').closest('.grid'), $('#btnPrintTemplate'), $('#bGuide > summary')] },
  { key: 'align', tab: 'setup', art: 'align', target: () => $('#lGuides').closest('.grid'),
    marks: () => [$('#lGuides').closest('label'), $('#lTile').closest('label'), $('#lHole').closest('label')] },
  { key: 'videos', tab: 'videos', art: 'videos', target: () => $('#fileInput').closest('.row'),
    marks: () => [$('#fileInput').closest('label'), $('#tab-videos [data-demo]')] },
  { key: 'library', tab: 'videos', target: () => $('#library') },
  { key: 'start', tab: 'story', art: 'start', target: () => $('#storyMeta'),
    marks: () => [$('#storyMeta .seg'), $('#sTitle').closest('label'), $('#sAttract').closest('label')] },
  { key: 'scenes', tab: 'story', art: 'scenes', target: () => $('.add-scene'),
    marks: () => ['chapter', 'together', 'quiz', 'turns'].map(k => $(`.add-scene .add-${k}`)) },
  { key: 'edit', tab: 'story',
    target: () => (state.story.scenes.length ? $('#scenes') : $('#storyEmpty')),
    marks: () => [state.story.scenes.length ? $('#scenes .scene-head') : $('#storyEmpty [data-demo]')] },
  { key: 'buttons', tab: 'buttons', art: 'buttons', target: () => $('#players .player'),
    marks: () => ['.p-color', '.p-learn', '.p-test'].map(s => $(`#players .player ${s}`)) },
  { key: 'play', tab: 'story', art: 'play', target: () => $('#btnFullscreen'), marks: () => [$('#btnFullscreen')] },
  { key: 'done', tab: 'setup', target: () => $('#backupRow'),
    marks: () => [$('#btnExport'), $('#importInput').closest('label'), $('#btnTour')] },
];

/* diagrams: inline SVG, colors from CSS classes so they follow the panel theme */
// a small volcano, drawn with plain coordinates (rot 180 = upside down)
const volcano = (x, y, s = 1, extra = '', rot = 0) => {
  const k = rot === 180 ? -s : s;
  const P = (px, py) => `${(x + px * k).toFixed(1)} ${(y + py * k).toFixed(1)}`;
  return `<g ${extra}><path class="a-lava" d="M${P(-18, 14)} L${P(-5, -8)} L${P(5, -8)} L${P(18, 14)} Z"/>`
    + `<path class="a-smoke" d="M${P(0, -10)} Q${P(4, -16)} ${P(-1, -22)} Q${P(-5, -28)} ${P(1, -33)}"/></g>`;
};
const TOUR_ART = {
  welcome: () => `
    <rect x="40" y="104" width="240" height="9" rx="3" class="a-device"/>
    <rect x="90" y="100" width="44" height="4" class="a-glow"/><rect x="186" y="100" width="44" height="4" class="a-glow"/>
    <path d="M112 100 V66 H38" class="a-ray"/><path d="M208 100 V66 H282" class="a-ray"/>
    <path d="M140 104 L96 44" class="a-film"/><path d="M180 104 L224 44" class="a-film"/><path d="M96 44 H224" class="a-dash"/>
    ${volcano(160, 82, 0.9, 'class="a-ghost"')}
    <path d="M14 66 q10 -8 20 0 q-10 8 -20 0 Z M286 66 q10 -8 20 0 q-10 8 -20 0 Z" class="a-eye"/><circle cx="24" cy="66" r="2.6" class="a-pupil"/><circle cx="296" cy="66" r="2.6" class="a-pupil"/>
    <text x="232" y="36" class="a-sig">${esc(t('art_film'))}</text>
    <text x="160" y="40" text-anchor="middle" class="a-acc">${esc(t('art_ghost'))}</text>
    <text x="160" y="126" text-anchor="middle" class="a-mut">${esc(t('art_screen'))}</text>
    <text x="24" y="88" text-anchor="middle" class="a-mut">${esc(t('art_player'))}</text><text x="296" y="88" text-anchor="middle" class="a-mut">${esc(t('art_player'))}</text>`,
  pyramid: () => `
    <path d="M20 34 H130 L93 86 H57 Z" class="a-face"/>
    <text x="75" y="27" text-anchor="middle" class="a-fg">${esc(t('art_long'))}</text>
    <text x="75" y="102" text-anchor="middle" class="a-acc">${esc(t('art_short'))}</text>
    <text x="75" y="116" text-anchor="middle" class="a-mut">${esc(t('art_shortSub'))}</text>
    <text x="75" y="66" text-anchor="middle" class="a-big">×4</text>
    <path d="M150 50 h24 m-7 -6 l7 6 -7 6" class="a-arrow"/>
    <rect x="196" y="8" width="84" height="84" class="a-face"/><rect x="224" y="36" width="28" height="28" class="a-hole"/>
    <path d="M196 8 L224 36" class="a-tape"/><path d="M280 8 L252 36" class="a-tape"/>
    <path d="M196 92 L224 64" class="a-tape"/><path d="M280 92 L252 64" class="a-tape"/>
    <text x="238" y="106" text-anchor="middle" class="a-mut">${esc(t('art_top'))}</text>
    <path d="M200 120 h16" class="a-tape"/><text x="222" y="124" class="a-acc">${esc(t('art_tape'))}</text>`,
  align: () => `
    <rect x="8" y="4" width="184" height="122" rx="6" class="a-device"/>
    <rect x="80.5" y="6" width="39" height="39" class="a-tile"/><rect x="80.5" y="85" width="39" height="39" class="a-tile"/>
    <rect x="41.5" y="45.5" width="39" height="39" class="a-tile"/><rect x="119.5" y="45.5" width="39" height="39" class="a-tile"/>
    <rect x="80.5" y="45.5" width="39" height="39" class="a-yel"/>
    <rect x="41.5" y="6" width="117" height="118" class="a-pyr"/>
    <path d="M41.5 6 L80.5 45.5 M158.5 6 L119.5 45.5 M41.5 124 L80.5 84.5 M158.5 124 L119.5 84.5" class="a-pyr"/>
    <rect x="206" y="26" width="14" height="14" class="a-yel"/><text x="226" y="37" class="a-fg">${esc(t('art_yellowT'))}</text><text x="206" y="53" class="a-mut">${esc(t('art_yellow'))}</text>
    <rect x="206" y="72" width="14" height="14" class="a-tile"/><text x="226" y="83" class="a-fg">${esc(t('art_blueT'))}</text><text x="206" y="99" class="a-mut">${esc(t('art_blue'))}</text>`,
  videos: () => [
    { x: 22, bg: 'a-thumb', ok: true, label: 'art_good', flip: false },
    { x: 128, bg: 'a-thumb-light', ok: false, label: 'art_bright', flip: false },
    { x: 234, bg: 'a-thumb', ok: false, label: 'art_turned', flip: true },
  ].map(v => `
    <rect x="${v.x}" y="6" width="64" height="64" rx="6" class="${v.bg}"/>
    ${v.flip ? volcano(v.x + 32, 30, 1.1, '', 180) : volcano(v.x + 32, 52, 1.1)}
    <path d="${v.ok ? `M${v.x + 24} 86 l6 6 l11 -12` : `M${v.x + 26} 80 l12 12 M${v.x + 38} 80 l-12 12`}" class="${v.ok ? 'a-ok' : 'a-bad'}"/>
    <text x="${v.x + 32}" y="112" text-anchor="middle" class="a-mut">${esc(t(v.label))}</text>`).join(''),
  start: () => `
    <rect x="12" y="20" width="76" height="60" rx="8" class="a-box"/><use href="#i-restart" x="36" y="34" width="28" height="28" class="a-icon"/>
    <path d="M98 50 h22 m-7 -6 l7 6 -7 6" class="a-arrow"/>
    <circle cx="160" cy="50" r="24" class="a-btn" style="fill:${esc(state.players[0]?.color || '#ff7a1a')}"/><circle cx="160" cy="50" r="30" class="a-press"/>
    <path d="M200 50 h22 m-7 -6 l7 6 -7 6" class="a-arrow"/>
    <rect x="232" y="20" width="76" height="60" rx="8" class="a-box"/><use href="#i-film" x="256" y="34" width="28" height="28" class="a-icon"/>
    <text x="50" y="102" text-anchor="middle" class="a-mut">${esc(t('art_loop'))}</text>
    <text x="160" y="102" text-anchor="middle" class="a-mut">${esc(t('art_press'))}</text>
    <text x="270" y="102" text-anchor="middle" class="a-mut">${esc(t('art_begin'))}</text>`,
  scenes: () => Object.entries(SCENE_TYPES).map(([k, T], i) => {
    const x = 6 + i * 79;
    return `<rect x="${x}" y="22" width="70" height="52" rx="8" class="a-box"/>
      <use href="#${T.icon}" x="${x + 23}" y="34" width="24" height="24" class="a-icon${k === 'chapter' ? '' : ' a-icon-acc'}"/>
      <circle cx="${x + 4}" cy="22" r="9" class="a-badge"/><text x="${x + 4}" y="26" text-anchor="middle" class="a-badgetxt">${i + 1}</text>
      ${i < 3 ? `<path d="M${x + 72} 48 h5" class="a-arrow"/>` : ''}
      <text x="${x + 35}" y="94" text-anchor="middle" class="a-mut">${esc(t(T.labelKey))}</text>`;
  }).join(''),
  buttons: () => {
    const pos = { bottom: [160, 112], top: [160, 14], left: [96, 63], right: [224, 63] };
    return `<rect x="122" y="25" width="76" height="76" class="a-face"/><rect x="146" y="49" width="28" height="28" class="a-hole"/>
      <path d="M122 25 L146 49 M198 25 L174 49 M122 101 L146 77 M198 101 L174 77" class="a-pyr"/>
      ${state.players.map((p, i) => {
        const [x, y] = pos[p.side] || pos.bottom;
        const lx = p.side === 'left' ? x - 16 : p.side === 'right' ? x + 16 : x + 16;
        const anchor = p.side === 'left' ? 'end' : 'start';
        return `<circle cx="${x}" cy="${y}" r="9" class="a-btn" style="fill:${esc(p.color)}"/>
          <text x="${lx}" y="${y + 4}" text-anchor="${anchor}" class="a-fg">${esc(displayPlayerName(p, i))}</text>`;
      }).join('')}`;
  },
  play: () => `
    <rect x="60" y="8" width="200" height="112" rx="8" class="a-device"/>
    <circle cx="78" cy="26" r="12" class="a-press"/><circle cx="78" cy="26" r="4" class="a-tap"/>
    <rect x="96" y="14" width="118" height="24" rx="12" class="a-box"/>
    ${['i-restart', 'i-prev', 'i-pause', 'i-next'].map((ic, i) => `<use href="#${ic}" x="${104 + i * 27}" y="18" width="16" height="16" class="a-icon"/>`).join('')}
    <text x="160" y="70" text-anchor="middle" class="a-fg">${esc(t('art_tap'))}</text>
    <text x="160" y="92" text-anchor="middle" class="a-mut">${esc(t('art_f1'))}</text>`,
};

const tourEl = $('#tour');
let tourStep = -1, tourMarks = [], tourRaf = 0;
const tourOpen = () => tourStep >= 0;

function clearTourHighlights() {
  $$('.tour-target').forEach(el => el.classList.remove('tour-target'));
  $$('.tour-badge').forEach(el => el.remove());
  panel.classList.remove('tour-head-target', 'tour-has-target');
  tourMarks = [];
}
// badges live inside the scrolling panel (or the sticky header), so they scroll with their control
function placeTourMarks() {
  for (const { el, badge } of tourMarks) {
    const box = badge.parentElement;
    if (!el.isConnected || !el.getClientRects().length) { badge.hidden = true; continue; }
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    badge.hidden = false;
    badge.style.left = `${Math.max(2, r.left - b.left - 9)}px`;
    badge.style.top = `${r.top - b.top + box.scrollTop - 9}px`;
  }
  tourRaf = tourOpen() ? requestAnimationFrame(placeTourMarks) : 0;
}

function renderTour() {
  if (!tourOpen()) return;
  const step = TOUR[tourStep];
  const tab = tabBtns.find(b => b.dataset.tab === step.tab);
  if (tab && tab.getAttribute('aria-selected') !== 'true') selectTab(tab);
  $('#tourCount').textContent = t('tourCount', { n: tourStep + 1, total: TOUR.length });
  $('#tourTitle').textContent = t(`tour_${step.key}_t`);
  const art = step.art && TOUR_ART[step.art];
  $('#tourArt').hidden = !art;
  $('#tourArt').innerHTML = art ? `<svg viewBox="0 0 320 130" class="tour-art" role="img" aria-label="${esc(t(`tour_${step.key}_t`))}">${art()}</svg>` : '';
  $('#tourBody').innerHTML = t(`tour_${step.key}_b`);
  $('#tourDots').innerHTML = TOUR.map((_, i) => `<span class="${i === tourStep ? 'on' : i < tourStep ? 'past' : ''}"></span>`).join('');
  $('#tourBack').disabled = tourStep === 0;
  $('#tourNext').textContent = t(tourStep === TOUR.length - 1 ? 'tourDone' : tourStep === 0 ? 'tourStart' : 'tourNext');
  $('#tourSkip').hidden = tourStep === TOUR.length - 1;

  clearTourHighlights();
  const target = step.target?.();
  if (target) {
    target.classList.add('tour-target');
    const inHead = !!target.closest('.panel-head');
    panel.classList.add('tour-has-target');
    panel.classList.toggle('tour-head-target', inHead);
    if (!inHead) {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }));
    }
  } else panel.scrollTop = 0;
  (step.marks?.() || []).forEach((el, i) => {
    if (!el) return;
    const badge = Object.assign(document.createElement('span'), { className: 'tour-badge', textContent: i + 1 });
    badge.setAttribute('aria-hidden', 'true');
    (el.closest('.panel-head') || panel).append(badge);
    tourMarks.push({ el, badge });
  });
  if (!tourRaf) placeTourMarks();
}
function startTour(at = 0) {
  if (panel.hidden) togglePanel(true);
  tourStep = at;
  tourEl.hidden = false;
  document.body.classList.add('touring');
  renderTour();
  $('#tourNext').focus();
}
function endTour() {
  if (!tourOpen()) return;
  tourStep = -1;
  tourEl.hidden = true;
  document.body.classList.remove('touring');
  clearTourHighlights();
  cancelAnimationFrame(tourRaf); tourRaf = 0;
  DB.set('tourSeen', true).catch(() => {});
}
$('#tourNext').onclick = () => {
  if (tourStep >= TOUR.length - 1) { endTour(); $('#btnTour').focus(); return; }
  tourStep++; renderTour();
};
$('#tourBack').onclick = () => { if (tourStep > 0) { tourStep--; renderTour(); } };
$('#tourSkip').onclick = () => { endTour(); $('#btnTour').focus(); };
$('#btnTour').onclick = () => startTour(0);
// Escape leaves the tutorial before it would close the panel
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !tourOpen() || learning !== null) return;
  e.preventDefault(); e.stopImmediatePropagation();
  endTour(); $('#btnTour').focus();
}, true);

/* ---------------------------------------------------------------- pyramid calculator + cutting template */
// Same geometry as layout(): on a fullscreen stage the square stage equals the screen's short side.
// Each face sits over one tile at 45°, so it is a trapezoid: short edge = hole, long edge = hole + 2 tiles.
function pyramidDims(s, L) {
  const b = s * L.hole;
  const T = Math.min(s * L.tile, (s - b) / 2);
  const a = b + 2 * T, h = T * Math.SQRT2, o = T;
  return { s, T, a, b, h, o, side: Math.hypot(h, o), angLong: Math.atan2(h, o) * 180 / Math.PI };
}
const ratioOf = r => { const [w, h] = String(r).split(':').map(Number); return w / h || 16 / 9; };
const shortFromDiag = (diag, r) => diag * 25.4 / Math.hypot(1, ratioOf(r));
const mm = v => (Math.round(v * 10) / 10).toLocaleString(state.lang, { maximumFractionDigits: 1 });

const PAPERS = [['A4', 297, 210], ['A3', 420, 297]];   // landscape, mm
const PRINT_MARGIN = 7, PRINT_HEAD = 12, FACE_GAP = 3;

// face outline; wideTop puts the long edge at the top
function facePts(d, x, y, wideTop) {
  return wideTop
    ? [[x, y], [x + d.a, y], [x + d.a - d.o, y + d.h], [x + d.o, y + d.h]]
    : [[x, y + d.h], [x + d.a, y + d.h], [x + d.o + d.b, y], [x + d.o, y]];
}
// 4 faces nest as two rows of a wide-top and a wide-bottom face
function fitSheet(d) {
  const rowLen = 2 * d.a - d.o + FACE_GAP;
  for (const [name, W, H] of PAPERS) {
    const w = W - 2 * PRINT_MARGIN, hgt = H - 2 * PRINT_MARGIN - PRINT_HEAD;
    if (rowLen <= w && 2 * d.h + FACE_GAP <= hgt) return { name, W, H, n: 4 };
    if (rowLen <= w && d.h <= hgt) return { name, W, H, n: 2 };
    if (d.a <= w && d.h <= hgt) return { name, W, H, n: 1 };
  }
  return null;
}

function edgeText(p, q, inside, label, size) {
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  if ((inside[0] - mx) * nx + (inside[1] - my) * ny < 0) { nx = -nx; ny = -ny; }
  let ang = Math.atan2(dy, dx) * 180 / Math.PI;
  if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
  const k = size * 1.1;
  const x = mx + nx * k, y = my + ny * k;
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" transform="rotate(${ang.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})">${esc(label)}</text>`;
}

function faceSVG(d, pts, { size, number, onScreenShort }) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const wideTop = pts[0][1] < pts[2][1];
  const longE = wideTop ? [pts[0], pts[1]] : [pts[3], pts[2]];
  const shortE = wideTop ? [pts[3], pts[2]] : [pts[0], pts[1]];
  const screenE = onScreenShort ? shortE : longE;
  const screenY = screenE[0][1] + (screenE[0][1] < cy ? size * 4.2 : -size * 4.2);
  let out = `<polygon points="${pts.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ')}" class="cut"/>`;
  out += edgeText(...longE, [cx, cy], `${mm(d.a)} mm`, size);
  if (d.b > 0.5) out += edgeText(...shortE, [cx, cy], `${mm(d.b)} mm`, size);
  out += edgeText(pts[1], pts[2], [cx, cy], `${mm(d.side)} mm`, size);
  out += edgeText(pts[3], pts[0], [cx, cy], `${mm(d.side)} mm`, size);
  if (number) out += `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="${size * 2}" font-weight="700" text-anchor="middle" dominant-baseline="central">${number}</text>`;
  out += `<text x="${cx.toFixed(2)}" y="${screenY.toFixed(2)}" font-size="${size * 0.85}" text-anchor="middle" dominant-baseline="central" class="soft">${esc(t('edgeOnScreen'))}</text>`;
  return out;
}

function buildInputsSync() {
  const L = state.layout;
  $('#bDiag').value = L.screenDiag;
  $('#bRatio').value = L.screenRatio;
  $('#bShort').value = Math.round(L.screenMm);
}
$('#bDiag').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!(v > 0)) return;
  state.layout.screenDiag = v;
  state.layout.screenMm = shortFromDiag(v, state.layout.screenRatio);
  $('#bShort').value = Math.round(state.layout.screenMm);
  save(); renderBuild(false);
});
$('#bRatio').addEventListener('change', e => {
  state.layout.screenRatio = e.target.value;
  state.layout.screenMm = shortFromDiag(state.layout.screenDiag, e.target.value);
  save(); renderBuild();
});
$('#bShort').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!(v >= 20)) return;
  state.layout.screenMm = v;
  save(); renderBuild(false);
});

function renderBuild(syncInputs = true) {
  if (syncInputs) buildInputsSync();
  const L = state.layout;
  const d = pyramidDims(L.screenMm, L);
  const onScreenShort = L.orientation !== 'inward';

  // scaled preview of one face
  const pad = d.a * 0.12, size = d.a * 0.055;
  const svg = $('#bPreview');
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${d.a + 2 * pad} ${d.h + 2 * pad}`);
  svg.innerHTML = faceSVG(d, facePts(d, 0, 0, true), { size, onScreenShort });

  const rows = [
    [onScreenShort ? 'dimShortScreen' : 'dimShort', `${mm(d.b)} mm`],
    [onScreenShort ? 'dimLong' : 'dimLongScreen', `${mm(d.a)} mm`],
    ['dimFaceHeight', `${mm(d.h)} mm`],
    ['dimSide', `${mm(d.side)} mm`],
    ['dimAngles', `${d.angLong.toFixed(1)}° / ${(180 - d.angLong).toFixed(1)}°`],
    ['dimTall', `${mm(d.T)} mm`],
  ];
  $('#bDims').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('');

  const fit = fitSheet(d);
  $('#btnPrintTemplate').disabled = !fit;
  $('#bSheet').textContent = !fit ? t('sheetNone')
    : fit.n === 4 ? t('sheetAll', { paper: fit.name })
    : t('sheetSome', { paper: fit.name, n: fit.n, times: 4 / fit.n });

  const v = { a: mm(d.a), b: mm(d.b), h: mm(d.h), side: mm(d.side), tall: mm(d.T) };
  const steps = ['stepMaterial', 'stepPrint', 'stepDraw', 'stepCut', 'stepTape',
    onScreenShort ? 'stepPlaceOut' : 'stepPlaceIn', 'stepView'];
  $('#bSteps').innerHTML = steps.map(k => `<li>${t(k, v)}</li>`).join('');
}

function printTemplate() {
  const L = state.layout;
  const d = pyramidDims(L.screenMm, L);
  const fit = fitSheet(d);
  if (!fit) return;
  const onScreenShort = L.orientation !== 'inward';
  const { W, H, n } = fit;
  const size = 3.2;
  const x0 = PRINT_MARGIN, top = PRINT_MARGIN + PRINT_HEAD;
  const rowLen = n === 1 ? d.a : 2 * d.a - d.o + FACE_GAP;
  const blockH = n === 4 ? 2 * d.h + FACE_GAP : d.h;
  const ox = x0 + (W - 2 * PRINT_MARGIN - rowLen) / 2;
  const oy = top + (H - PRINT_MARGIN - top - blockH) / 2;
  let body = '', num = 1;
  for (let r = 0; r < (n === 4 ? 2 : 1); r++) {
    const y = oy + r * (d.h + FACE_GAP);
    body += faceSVG(d, facePts(d, ox, y, true), { size, number: num++, onScreenShort });
    if (n > 1) body += faceSVG(d, facePts(d, ox + d.a - d.o + FACE_GAP, y, false), { size, number: num++, onScreenShort });
  }
  // header: what this is, how to print, scale check
  const sx = W - PRINT_MARGIN - 50, sy = PRINT_MARGIN + 6;
  let head = `<text x="${x0}" y="${PRINT_MARGIN + 3.5}" font-size="4.2" font-weight="700">${esc(t('printTitle'))}</text>`;
  head += `<text x="${x0}" y="${PRINT_MARGIN + 7.5}" font-size="2.8">${esc(t('printInfo', {
    short: mm(d.s), tile: Math.round(L.tile * 100), hole: Math.round(L.hole * 100),
  }))}</text>`;
  head += `<text x="${x0}" y="${PRINT_MARGIN + 11}" font-size="2.8" font-weight="700">${esc(t('printScale'))}${n < 4 ? '  ' + esc(t('printTimes', { times: 4 / n })) : ''}</text>`;
  head += `<path d="M${sx} ${sy}h50${[0, 10, 20, 30, 40, 50].map(k => `M${sx + k} ${sy}v-2`).join('')}" class="cut"/>`;
  head += `<text x="${sx + 25}" y="${sy + 4}" font-size="3" text-anchor="middle">50 mm</text>`;
  const sheet = $('#printSheet');
  sheet.innerHTML = `<style>@page { size: ${fit.name} landscape; margin: 0; }</style>
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${head}${body}</svg>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); sheet.innerHTML = ''; removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  print();
}
$('#btnPrintTemplate').onclick = printTemplate;

$('#btnExport').onclick = () => {
  const clipNames = { ...(state.pendingClips || {}), ...Object.fromEntries([...clips.values()].map(c => [c.id, c.name])) };
  const blob = new Blob([JSON.stringify({ ...state, clipNames }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'holo-stage-story.json' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#importInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const next = normalizeState(data);
    // re-link clips by name when ids differ (e.g. a different device), keeping missing ones pending
    const byName = new Map([...clips.values()].map(c => [c.name, c.id]));
    const pending = {};
    const missing = new Set();
    mapClipRefs(next, id => {
      if (clips.has(id)) return id;
      const name = data.clipNames?.[id];
      if (!name) return '';
      const found = byName.get(name);
      if (found) return found;
      pending[id] = name;
      missing.add(name);
      return id;
    });
    next.pendingClips = pending;
    state = next; openScene = -1;
    save(); applyAll();
    if (missing.size) notice(t('noticeImportMissing', { n: missing.size, list: [...missing].join(', ') }), { tone: 'warn', ms: 0 });
    else notice(t('noticeImportOk'), { tone: 'good', ms: 3500 });
  } catch (err) { notice(t('noticeImportErr', { msg: err.message }), { tone: 'err' }); }
};
$('#btnReset').onclick = e => {
  armConfirm(e.currentTarget, t('confirmReset'), () => {
    const lang = state.lang;
    state = clone(DEFAULTS);
    state.lang = lang;
    state.story.text = state.story.textByLang[lang];
    openScene = -1; save(); applyAll();
    notice(t('noticeReset'), { tone: 'info', ms: 3500 });
  });
};

function applyAll() {
  document.documentElement.lang = state.lang;
  translateDOM(document);
  syncLangButtons();
  renderAddSceneButtons();
  layoutSyncs.forEach(f => f());
  layout(); renderPlayers(); renderLibrary(); renderStoryMeta(); renderScenes(); renderBuild(); renderTour();
  if (Story.running()) Story.stop();
  if (runMode() === 'free') players.forEach(p => p.start());
  applyMode();
  lastTransportKey = '';
  Story.onchange?.();
}

/* ---------------------------------------------------------------- start */
let lastFrame = 0;
function frame(ts) {
  pollPads();
  Story.tick(Math.min(100, ts - (lastFrame || ts)));
  syncTransport();
  lastFrame = ts;
  requestAnimationFrame(frame);
}

(async function init() {
  let firstRun = false;
  try {
    const stored = await DB.get('config');
    firstRun = !stored && !(await DB.get('tourSeen'));
    state = normalizeState(stored);
    for (const c of await DB.allClips()) clips.set(c.id, { ...c, url: URL.createObjectURL(c.blob) });
  } catch (e) { console.error('loading stored data failed', e); }
  navigator.storage?.persist?.();
  applyAll();
  requestAnimationFrame(frame);
  requestWakeLock();
  if (!clips.size) togglePanel(true);
  if (firstRun && !clips.size) startTour(0);
  if (!state.layout.kioskLock) pokeUI();
  else pokeCursor();
})();
