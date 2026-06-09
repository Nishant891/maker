// Map incoming UIEvents from the SSE stream onto state mutations + renders.
// Pure dispatch — no fetch here, no DOM event listeners.

import { state } from './state.js';
import {
  renderPlan, renderChat, renderArtifacts,
  setViewport, selectArtifact, updateOverlay,
} from './views.js';

export function dispatchUIEvent(ev) {
  if (state.planning) state.planning = false;
  switch (ev.type) {
    case 'text':   return handleText(ev);
    case 'todos':  return handleTodos(ev);
    case 'file':   return handleFile(ev);
    case 'tool':   return handleTool(ev);
    case 'error':  return handleError(ev);
    case 'done':   return; // streaming-end is handled by the caller's finally
  }
}

function handleText(ev) {
  // Append to the open assistant bubble, or start a new one.
  let last = state.userMsgs[state.userMsgs.length - 1];
  if (!last || last.role !== 'assistant' || last.kind !== 'msg') {
    last = { role: 'assistant', content: '', kind: 'msg' };
    state.userMsgs.push(last);
  }
  last.content = (last.content ? last.content + '\n' : '') + (ev.text || '');
  renderChat();
}

function handleTodos(ev) {
  state.todos = ev.todos || [];
  const active = state.todos.find(t => t.status === 'active');
  let writingName = null;
  if (active) {
    const m = active.text.match(/artifact_\d+[a-z0-9_\-]*\.html?/i) ||
              active.text.match(/\b([a-zA-Z0-9_\-]+\.html?)\b/);
    if (m) writingName = m[1] || m[0];
  }
  state.writingName = writingName;

  if (writingName) {
    const existing = state.artifacts.find(a => a.name === writingName);
    if (existing) {
      setViewport(existing.name, existing.content, existing.width, existing.height);
    } else {
      // Blank-ish placeholder so the overlay has something to sit over.
      setViewport(writingName, null, 1280, 720);
    }
  }
  renderPlan();
  renderArtifacts();
  renderChat();
  updateOverlay();
}

function handleFile(ev) {
  const name = ev.name || 'artifact.html';
  const art = {
    name,
    content: ev.content || '',
    width:   ev.width  || 1280,
    height:  ev.height || 720,
  };
  const ix = state.artifacts.findIndex(a => a.name === name);
  if (ix >= 0) state.artifacts[ix] = art;
  else state.artifacts.push(art);
  if (state.writingName === name) state.writingName = null;
  selectArtifact(name);
}

function handleTool(ev) {
  state.userMsgs.push({
    kind: 'tool',
    tool: ev.tool || 'tool',
    title: ev.title || '',
  });
  renderChat();
}

function handleError(ev) {
  console.warn('[maker] stream error:', ev.message);
  state.userMsgs.push({
    role: 'assistant',
    content: '⚠ ' + (ev.message || 'error'),
    kind: 'msg',
  });
  renderChat();
}
