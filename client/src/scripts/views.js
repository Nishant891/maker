// Render functions — read state.* and write DOM. Pure rendering, no IO.
//
// Each renderer is idempotent: it wipes its target container and rebuilds.
// That keeps the code dead simple at the cost of a few extra DOM ops per
// frame; for our small lists this is fine.

import { state, animatedTodoKeys } from './state.js';
import { buildSrcdoc } from './editor.js';

const dom = {};
export function bindDom() {
  dom.canvasDir       = document.getElementById('canvasDir');
  dom.artifactCount   = document.getElementById('artifactCount');
  dom.planStrip       = document.getElementById('planStrip');
  dom.planList        = document.getElementById('planList');
  dom.planProgress    = document.getElementById('planProgress');
  dom.chatMessages    = document.getElementById('chatMessages');
  dom.artifactsList   = document.getElementById('artifactsList');
  dom.artifactTitle   = document.getElementById('artifactTitle');
  dom.artifactDim     = document.getElementById('artifactDim');
  dom.viewportEmpty   = document.getElementById('viewportEmpty');
  dom.stage           = document.getElementById('stage');
  dom.preview         = document.getElementById('preview');
  dom.stageOverlay    = document.getElementById('stageOverlay');
  dom.overlayLabel    = document.getElementById('stageOverlayLabel');
  dom.overlayFile     = document.getElementById('stageOverlayFile');
  dom.viewport        = document.getElementById('viewport');
  dom.zoomPct         = document.getElementById('zoomPct');
  dom.paneRight       = document.querySelector('.pane-right');
}

// ─── Plan strip ──────────────────────────────────────────────────────
export function renderPlan() {
  if (!state.todos.length) {
    dom.planStrip.classList.add('empty');
    dom.planList.innerHTML = '';
    dom.planProgress.textContent = '';
    return;
  }
  dom.planStrip.classList.remove('empty');
  const done = state.todos.filter(t => t.status === 'done').length;
  dom.planProgress.textContent = done + '/' + state.todos.length;

  dom.planList.innerHTML = '';
  state.todos.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = t.status || 'pending';
    const key = i + '|' + t.text;
    if (animatedTodoKeys.has(key)) {
      li.style.animation = 'none';
      li.style.opacity   = '1';
      li.style.transform = 'none';
    } else {
      li.style.animationDelay = (i * 45) + 'ms';
      animatedTodoKeys.add(key);
    }
    const marker = document.createElement('span');
    marker.className = 'marker';
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = t.text;
    li.append(marker, text);
    dom.planList.appendChild(li);
  });
}

// ─── Chat ────────────────────────────────────────────────────────────
export function renderChat() {
  dom.chatMessages.innerHTML = '';
  if (!state.userMsgs.length && !state.streaming) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'Describe an artifact to generate. Try “Make a 3-slide deck on Tesla”.';
    dom.chatMessages.appendChild(empty);
    return;
  }
  for (const m of state.userMsgs) {
    if (m.kind === 'tool')      dom.chatMessages.appendChild(toolEl(m.tool, m.title));
    else if (m.role === 'user') dom.chatMessages.appendChild(userEl(m.content));
    else                        dom.chatMessages.appendChild(agentEl(m.content));
  }
  if (state.planning) {
    dom.chatMessages.appendChild(statusEl('Planning'));
  } else if (state.streaming && state.writingName) {
    dom.chatMessages.appendChild(statusEl('Writing ' + state.writingName));
  } else if (state.streaming) {
    dom.chatMessages.appendChild(statusEl('Working'));
  }
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}
function userEl(content) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = content;
  return el;
}
function agentEl(content) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  const body = document.createElement('span');
  body.textContent = content || '';
  wrap.append(avatar, body);
  return wrap;
}
function toolEl(tool, title) {
  const wrap = document.createElement('div');
  wrap.className = 'msg tool';
  const kind = document.createElement('span');
  kind.className = 'tool-kind';
  kind.textContent = tool;
  const t = document.createElement('span');
  t.className = 'tool-title';
  t.textContent = title;
  wrap.append(kind, t);
  return wrap;
}
function statusEl(label) {
  const wrap = document.createElement('div');
  wrap.className = 'msg status';
  const sp = document.createElement('span');
  sp.className = 'spinner';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  const dots = document.createElement('span');
  dots.className = 'dots';
  wrap.append(sp, lbl, dots);
  return wrap;
}

// ─── Artifacts list ──────────────────────────────────────────────────
const KIND_NAMES = {
  '1280x720':  'Slide',
  '794x1123':  'A4',
  '1123x794':  'A4 ‧ L',
  '1080x1080': 'Card',
  '1080x1920': 'Story',
  '1440x900':  'Web',
  '1440x2400': 'Long',
};
function kindFromDims(w, h) {
  return KIND_NAMES[w + 'x' + h] || 'Custom';
}
function prettyName(name) {
  if (!name) return 'Untitled';
  return name.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ');
}

export function renderArtifacts() {
  dom.artifactsList.innerHTML = '';
  dom.artifactCount.textContent = state.artifacts.length ? String(state.artifacts.length) : '';

  const writing = state.writingName;
  const placeholderNeeded = writing && !state.artifacts.some(a => a.name === writing);

  if (!state.artifacts.length && !placeholderNeeded) {
    const e = document.createElement('div');
    e.className = 'artifacts-empty';
    e.textContent = 'No artifacts yet. They appear here as opencode writes them.';
    dom.artifactsList.appendChild(e);
    return;
  }
  state.artifacts.forEach((a, i) => {
    dom.artifactsList.appendChild(artifactCard({
      classes: (a.name === state.activeName ? ' active' : ''),
      num: String(i + 1).padStart(2, '0'),
      title: prettyName(a.name),
      sub: a.width + ' × ' + a.height,
      badge: kindFromDims(a.width, a.height),
      onClick: () => selectArtifact(a.name),
    }));
  });
  if (placeholderNeeded) {
    const isActive = state.activeName === writing;
    dom.artifactsList.appendChild(artifactCard({
      classes: ' placeholder' + (isActive ? ' active' : ''),
      generating: true,
      num: String(state.artifacts.length + 1).padStart(2, '0'),
      title: prettyName(writing),
      sub: 'writing…',
      badge: '',
    }));
  }
}
function artifactCard(opts) {
  const row = document.createElement('div');
  row.className = 'artifact-row' + (opts.classes || '');

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = opts.num;

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = opts.title;
  const dim = document.createElement('span');
  dim.className = 'dim';
  dim.textContent = opts.sub;
  title.appendChild(dim);

  const right = document.createElement('div');
  if (opts.generating) {
    right.className = 'gen-tag';
    const sp = document.createElement('span'); sp.className = 'spinner';
    const lbl = document.createElement('span'); lbl.textContent = 'Writing';
    right.append(sp, lbl);
  } else if (opts.badge) {
    right.className = 'badge';
    right.textContent = opts.badge;
  }

  row.append(num, title, right);
  if (opts.onClick) row.addEventListener('click', opts.onClick);
  return row;
}

// ─── Viewport / iframe / overlay ─────────────────────────────────────
export function setViewport(name, content, width, height) {
  state.activeName = name;
  const w = width  || 1280;
  const h = height || 720;
  dom.artifactTitle.firstChild.textContent = prettyName(name) + ' ';
  dom.artifactDim.textContent = w + ' × ' + h;
  dom.viewportEmpty.style.display = 'none';
  dom.stage.style.display = 'block';
  dom.stage.style.width  = w + 'px';
  dom.stage.style.height = h + 'px';
  if (content) {
    dom.preview.srcdoc = buildSrcdoc(content);
  } else {
    dom.preview.srcdoc =
      '<!doctype html><html><body style="margin:0;background:#fff"></body></html>';
  }
  applyZoom();
}
export function selectArtifact(name) {
  const a = state.artifacts.find(x => x.name === name);
  if (!a) return;
  setViewport(a.name, a.content, a.width, a.height);
  renderArtifacts();
  updateOverlay();
}
export function updateOverlay() {
  const show = !!(state.streaming &&
                  state.writingName &&
                  state.activeName === state.writingName);
  dom.stageOverlay.classList.toggle('active', show);
  if (show) {
    dom.overlayLabel.textContent = 'Writing';
    dom.overlayFile.textContent  = state.writingName || '';
  }
}

// ─── Zoom ────────────────────────────────────────────────────────────
const PADDING = 64;
export function applyZoom() {
  if (!dom.stage.style.width) {
    dom.zoomPct.textContent = '—';
    return;
  }
  const w = parseFloat(dom.stage.style.width)  || 1280;
  const h = parseFloat(dom.stage.style.height) || 720;
  const availW = dom.viewport.clientWidth  - PADDING * 2;
  const availH = dom.viewport.clientHeight - PADDING * 2;
  let scale;
  if (state.zoom === 'fit') {
    scale = Math.min(availW / w, availH / h);
    if (!isFinite(scale) || scale <= 0) scale = 1;
  } else {
    scale = state.zoom;
  }
  dom.stage.style.transform = 'scale(' + scale + ')';
  dom.zoomPct.textContent = Math.round(scale * 100) + '%';
}
export function currentZoomScale() {
  if (state.zoom !== 'fit') return state.zoom;
  const w = parseFloat(dom.stage.style.width)  || 1280;
  const h = parseFloat(dom.stage.style.height) || 720;
  const availW = dom.viewport.clientWidth  - PADDING * 2;
  const availH = dom.viewport.clientHeight - PADDING * 2;
  return Math.min(availW / w, availH / h) || 1;
}

export function setCanvasDir(text) { if (dom.canvasDir) dom.canvasDir.textContent = text; }
export function getDom() { return dom; }
