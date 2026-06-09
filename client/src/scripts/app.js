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
} from './views.js';
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
function wireZoom() {
  document.getElementById('zoomIn').addEventListener('click', () => {
    state.zoom = Math.min(currentZoomScale() * 1.2, 4);
    applyZoom();
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    state.zoom = Math.max(currentZoomScale() / 1.2, 0.05);
    applyZoom();
  });
  document.getElementById('zoomReset').addEventListener('click', () => {
    state.zoom = 'fit';
    applyZoom();
  });
  window.addEventListener('resize', () => {
    if (state.zoom === 'fit') applyZoom();
  });
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

// Public for places that need to switch tabs imperatively (none right now,
// but kept around in case the artifact-arrival logic wants to jump tabs).
export { switchTab };
