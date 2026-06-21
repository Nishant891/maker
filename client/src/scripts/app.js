// Entry point — wires the DOM event listeners, owns the send/stream loop,
// and is the only module that talks to localStorage. Everything else stays
// pure (views render, dir-modal owns the modal, stream maps events).

import { state, animatedTodoKeys } from './state.js';
import { streamGenerate } from './api.js';
import { initDirModal, openModal } from './dir-modal.js';
import { initToolbar } from './toolbar.js';
import {
  bindDom, getDom,
  renderPlan, renderChat, renderArtifacts,
  applyZoom, currentZoomScale, setCanvasDir,
  reportIframeHeight,
} from './views.js';
import { saveArtifact } from './api.js';
import { dispatchUIEvent } from './stream.js';

const LS_KEY = 'maker.dir.v1';

export function initApp() {
  bindDom();
  initToolbar();
  initDirModal({
    onSelect(path) {
      localStorage.setItem(LS_KEY, path);
      setCanvasDir(path);
    },
  });

  wireTabs();
  wireZoom();
  wireComposer();
  wireSwitchCanvas();
  wireEditorBridge();

  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    state.dir = stored;
    setCanvasDir(stored);
    renderChat();
  } else {
    openModal();
  }
}

// ─── Tabs ────────────────────────────────────────────────────────────
function wireTabs() {
  const $tabs     = document.querySelectorAll('.tab');
  const $panes    = document.querySelectorAll('.tab-pane');
  $tabs.forEach(t => t.addEventListener('click', () => {
    const name = t.dataset.tab;
    $tabs.forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    $panes.forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  }));
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

// ─── Zoom ────────────────────────────────────────────────────────────
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 4;
function wireZoom() {
  document.getElementById('zoomIn').addEventListener('click', () => {
    state.zoom = Math.min(currentZoomScale() * 1.2, ZOOM_MAX);
    applyZoom();
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    state.zoom = Math.max(currentZoomScale() / 1.2, ZOOM_MIN);
    applyZoom();
  });
  document.getElementById('zoomReset').addEventListener('click', () => {
    state.zoom = 'fit';
    applyZoom();
  });
  window.addEventListener('resize', () => {
    if (state.zoom === 'fit') applyZoom();
  });

  // Trackpad pinch on macOS is delivered as wheel + ctrlKey. Cmd+wheel on
  // a mouse is the same idea. Regular two-finger scroll falls through to
  // stage-wrap's overflow:auto so the user can still pan.
  const viewport = document.getElementById('viewport');
  if (viewport) {
    viewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (!state.dir || !state.activeName) return;
      e.preventDefault();
      const cur = currentZoomScale();
      // Exponential so the gesture feels smooth and symmetric.
      const next = cur * Math.exp(-e.deltaY * 0.01);
      state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
      applyZoom();
    }, { passive: false });
  }
}

// ─── Switch-canvas button ────────────────────────────────────────────
function wireSwitchCanvas() {
  document.getElementById('btnSwitchCanvas').addEventListener('click', () => openModal());
}

// ─── Composer / send / stream ────────────────────────────────────────
function wireComposer() {
  const $prompt = document.getElementById('prompt');
  const $send   = document.getElementById('btnSend');
  $send.addEventListener('click', send);
  $prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

async function send() {
  if (state.streaming) return;
  if (!state.dir) { openModal(); return; }
  const $prompt = document.getElementById('prompt');
  const $send   = document.getElementById('btnSend');
  const prompt  = $prompt.value.trim();
  if (!prompt) return;

  // Per-run reset; artifacts from earlier runs stay.
  animatedTodoKeys.clear();
  state.todos = [];
  state.writingName = null;
  state.userMsgs.push({ role: 'user', content: prompt, kind: 'msg' });
  state.userMsgs.push({ role: 'assistant', content: '', kind: 'msg' });
  $prompt.value = '';
  state.streaming = true;
  state.planning  = true;
  $send.disabled = true;
  getDom().paneRight.classList.add('locked');
  renderPlan();
  renderChat();
  renderArtifacts();

  try {
    await streamGenerate({ dir: state.dir, prompt }, dispatchUIEvent);
  } catch (e) {
    console.error('[maker] stream error:', e);
    state.userMsgs.push({ role: 'assistant', content: '⚠ ' + e.message, kind: 'msg' });
  } finally {
    state.streaming = false;
    state.planning  = false;
    state.writingName = null;
    $send.disabled = false;
    getDom().paneRight.classList.remove('locked');
    renderChat();
    renderArtifacts();
  }
}

// ─── Editor bridge ────────────────────────────────────────────────────
// The editor running inside the iframe calls back into the parent through
// these globals: __editorReportHeight (auto-height artifacts) and
// __editorOnChange (any edit ⇒ debounced save).
const SAVE_DEBOUNCE_MS = 1500;
function wireEditorBridge() {
  window.__editorReportHeight = (px) => reportIframeHeight(px);

  window.__editorOnChange = () => {
    if (!state.activeName || !state.dir) return;
    state.dirtyFile = state.activeName;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(flushDirty, SAVE_DEBOUNCE_MS);
  };

  // Last-chance flush on tab close / refresh.
  window.addEventListener('beforeunload', () => {
    if (state.dirtyFile) flushDirty();
  });
}

async function flushDirty() {
  const file = state.dirtyFile;
  if (!file || !state.dir) return;
  if (state.saveInFlight) {
    state.pendingSave = true;
    return;
  }
  const iframe = document.getElementById('preview');
  const ed = iframe && iframe.contentWindow && iframe.contentWindow.__editor;
  if (!ed || typeof ed.exportClean !== 'function') return;
  const html = ed.exportClean();
  state.dirtyFile = null;
  state.saveInFlight = true;
  try {
    await saveArtifact(state.dir, file, html);
    // Keep the in-memory artifact mirror up to date so re-selecting later
    // shows the latest edits even before the next stream.
    const art = state.artifacts.find(a => a.name === file);
    if (art) art.content = html;
  } catch (e) {
    console.warn('[maker] save failed:', e);
  } finally {
    state.saveInFlight = false;
    if (state.pendingSave) {
      state.pendingSave = false;
      state.dirtyFile = file;
      state.saveTimer = window.setTimeout(flushDirty, SAVE_DEBOUNCE_MS);
    }
  }
}

// Public for places that need to switch tabs imperatively (none right now,
// but kept around in case the artifact-arrival logic wants to jump tabs).
export { switchTab };
