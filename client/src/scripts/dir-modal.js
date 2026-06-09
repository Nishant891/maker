// Directory picker modal — visual file browser that the user navigates to
// pick (or create) the opencode working directory.

import { state } from './state.js';
import { browse, selectDir, SERVER } from './api.js';

let dom = null;
let onSelected = null;

export function initDirModal(opts) {
  onSelected = opts.onSelect;
  dom = {
    backdrop:  document.getElementById('dirModal'),
    up:        document.getElementById('dirUp'),
    pathText:  document.getElementById('dirPathText'),
    list:      document.getElementById('dirList'),
    newName:   document.getElementById('dirNewName'),
    create:    document.getElementById('dirCreate'),
    error:     document.getElementById('dirError'),
    cancel:    document.getElementById('dirCancel'),
    select:    document.getElementById('dirSelect'),
  };
  dom.cancel.addEventListener('click', () => {
    if (state.dir) closeModal();
  });
  dom.up.addEventListener('click', () => {
    if (state.browseParent) navigate(state.browseParent);
  });
  dom.create.addEventListener('click', onCreate);
  dom.select.addEventListener('click', onSelect);
  dom.newName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onCreate(); }
  });
}

export function openModal(initialPath) {
  hideError();
  dom.newName.value = '';
  dom.backdrop.classList.add('open');
  navigate(initialPath || state.dir || '~');
}
export function closeModal() {
  dom.backdrop.classList.remove('open');
}

async function navigate(path) {
  try {
    const data = await browse(path);
    state.browsePath   = data.path;
    state.browseParent = data.parent || '';
    state.browseCanUse = !!data.canUse;
    state.browseReason = data.reason || '';
    render(data.dirs || []);
  } catch (e) {
    showError(e.message || ('Server unreachable at ' + SERVER));
  }
}

function render(dirs) {
  dom.pathText.textContent = state.browsePath;
  dom.up.disabled = !state.browseParent;
  dom.select.disabled = !state.browseCanUse;
  if (state.browseCanUse) hideError();
  else if (state.browseReason) showError(state.browseReason);

  dom.list.innerHTML = '';
  if (!dirs.length) {
    const e = document.createElement('div');
    e.className = 'dir-empty';
    e.textContent = '(no subfolders)';
    dom.list.appendChild(e);
    return;
  }
  for (const name of dirs) {
    const row = document.createElement('div');
    row.className = 'dir-row';
    const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = '▸';
    const lbl  = document.createElement('span'); lbl.className  = 'name'; lbl.textContent  = name;
    const arr  = document.createElement('span'); arr.className  = 'arrow'; arr.textContent = '›';
    row.append(icon, lbl, arr);
    row.addEventListener('click', () => {
      const sep = state.browsePath.endsWith('/') ? '' : '/';
      navigate(state.browsePath + sep + name);
    });
    dom.list.appendChild(row);
  }
}

async function onCreate() {
  const name = dom.newName.value.trim();
  if (!name) { showError('Type a folder name first.'); return; }
  try {
    const data = await selectDir(state.browsePath, name);
    if (!data.ok) { showError(data.reason || 'Could not create folder.'); return; }
    dom.newName.value = '';
    await navigate(data.path);
  } catch (e) {
    showError('Server unreachable at ' + SERVER);
  }
}
async function onSelect() {
  try {
    const data = await selectDir(state.browsePath);
    if (!data.ok) { showError(data.reason || 'Cannot use this directory.'); return; }
    state.dir = data.path;
    onSelected && onSelected(data.path);
    closeModal();
  } catch (e) {
    showError('Server unreachable at ' + SERVER);
  }
}

function showError(msg) {
  dom.error.textContent = msg;
  dom.error.classList.add('show');
}
function hideError() {
  dom.error.classList.remove('show');
  dom.error.textContent = '';
}
