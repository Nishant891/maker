// Bottom-floating insert dock. Each button calls __editor.insertElement(kind)
// inside the iframe; the editor places the new node at the artifact's visual
// center, gives it a fresh z-index, and selects it so the in-iframe
// selection toolbar (B / I / U / S / colour / align / border / rounded / shadow
// / A± / delete) appears automatically.

export function initToolbar() {
  const $dock   = document.getElementById('insertDock');
  const $iframe = document.getElementById('preview');
  if (!$dock || !$iframe) return;

  $dock.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-insert]');
    if (!btn) return;
    const kind = btn.dataset.insert;
    const ed = $iframe.contentWindow && $iframe.contentWindow.__editor;
    if (!ed) return;
    ed.insertElement(kind);
  });

  // No-op kept around for parity with the editor's selection-change callback.
  // The selection-state UI lives inside the iframe now.
  window.__editorOnSelectionChange = () => {};
}
