// Toolbar over the iframe: bold / italic / color / align. Wired to the
// __editor handle the injected EDITOR_JS publishes on the iframe's window.

export function initToolbar() {
  const $toolbar = document.getElementById('toolbar');
  const $color   = document.getElementById('colorPicker');
  const $iframe  = document.getElementById('preview');

  $toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const ed = $iframe.contentWindow && $iframe.contentWindow.__editor;
    if (!ed) return;
    if (cmd === 'bold')   ed.toggleClass('e-bold');
    if (cmd === 'italic') ed.toggleClass('e-italic');
    if (cmd === 'delete') ed.deleteSelected();
    if (cmd === 'left' || cmd === 'center' || cmd === 'right') ed.setAlign(cmd);
    refreshToolbar();
  });
  $color.addEventListener('input', () => {
    const ed = $iframe.contentWindow && $iframe.contentWindow.__editor;
    if (ed) ed.setColor($color.value);
  });

  window.__editorOnSelectionChange = refreshToolbar;
}

function refreshToolbar() {
  const $toolbar = document.getElementById('toolbar');
  const $color   = document.getElementById('colorPicker');
  const $iframe  = document.getElementById('preview');
  const ed  = $iframe.contentWindow && $iframe.contentWindow.__editor;
  const sel = ed && ed.getSelected();
  $toolbar.querySelectorAll('button[data-cmd]').forEach(b => b.classList.remove('active'));
  if (!sel) return;
  if (sel.classList.contains('e-bold'))   markActive($toolbar, 'bold');
  if (sel.classList.contains('e-italic')) markActive($toolbar, 'italic');
  const align = sel.style.textAlign;
  if (align === 'left')   markActive($toolbar, 'left');
  if (align === 'center') markActive($toolbar, 'center');
  if (align === 'right')  markActive($toolbar, 'right');
  if (sel.style.color) {
    const hex = rgbToHex(sel.style.color);
    if (hex) $color.value = hex;
  }
}
function markActive(toolbar, cmd) {
  const btn = toolbar.querySelector('[data-cmd="' + cmd + '"]');
  if (btn) btn.classList.add('active');
}
function rgbToHex(s) {
  const m = /rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/.exec(s);
  if (!m) return null;
  const toHex = n => Number(n).toString(16).padStart(2, '0');
  return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
}
