// Editor: CSS + JS injected into the artifact iframe so the user can select,
// drag, resize, double-click-to-edit, and delete elements in place.
//
// The body of EDITOR_JS is intentionally a near-verbatim copy of the original
// implementation that the user has already validated — DO NOT rewrite the
// drag / resize / select / dblclick logic. The only additions:
//
//   1.  html, body { overflow: visible !important; }  in EDITOR_CSS so
//       absolutely-positioned children (post-drag) don't get clipped by the
//       body's natural overflow.
//   2.  A delete affordance ('×' button) that floats next to the selection's
//       top-right corner. Clicking it removes the selected element and clears
//       selection. Wired through __editor.deleteSelected for the parent.

export const EDITOR_CSS = `
  html, body {
    overflow: visible !important;
  }
  .selected { outline: 2px solid #5e6ad2 !important; outline-offset: 1px; }
  .resize-handle {
    position: absolute; width: 10px; height: 10px;
    background: #5e6ad2; border: 1px solid #fff;
    z-index: 999999; box-sizing: border-box;
    border-radius: 2px;
  }
  .resize-handle.nw { cursor: nwse-resize; }
  .resize-handle.n  { cursor: ns-resize; }
  .resize-handle.ne { cursor: nesw-resize; }
  .resize-handle.e  { cursor: ew-resize; }
  .resize-handle.se { cursor: nwse-resize; }
  .resize-handle.s  { cursor: ns-resize; }
  .resize-handle.sw { cursor: nesw-resize; }
  .resize-handle.w  { cursor: ew-resize; }
  .editor-delete {
    position: absolute;
    z-index: 999999;
    width: 24px;
    height: 24px;
    background: #e5484d;
    color: #ffffff;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    font-family: -apple-system, system-ui, sans-serif;
    font-weight: 600;
    user-select: none;
    transition: background 0.12s ease, transform 0.12s ease;
  }
  .editor-delete:hover { background: #ff6b6f; transform: scale(1.05); }
  .editor-delete:active { transform: scale(0.95); }
  .editor-delete svg { width: 13px; height: 13px; pointer-events: none; }
  .e-bold   { font-weight: bold; }
  .e-italic { font-style: italic; }
  body * { cursor: default; }
`;

const TRASH_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11"/><path d="M5 4V2.6c0-.33.27-.6.6-.6h4.8c.33 0 .6.27.6.6V4"/><path d="M6.2 7v5"/><path d="M9.8 7v5"/><path d="M3.6 4l.78 8.92c.04.5.46.88.96.88h5.32c.5 0 .92-.38.96-.88L12.4 4"/></svg>`;

export const EDITOR_JS = `
  (function () {
    const doc = document;

    let selected = null;
    let editing  = null;
    let zCounter = 1;
    const handles = [];
    let deleteBtn = null;
    const HANDLE_DIRS = ['nw','n','ne','e','se','s','sw','w'];

    function exitEditing() {
      if (!editing) return;
      editing.setAttribute('contenteditable', 'false');
      try { editing.blur(); } catch (_) {}
      editing = null;
    }

    function isEditorChrome(el) {
      if (!el || !el.classList) return false;
      return el.classList.contains('resize-handle') ||
             el.classList.contains('editor-delete') ||
             (el.closest && el.closest('.editor-delete'));
    }

    function ensureAbsolute(el) {
      const cs = getComputedStyle(el);
      if (cs.position === 'static' || !el.style.left || !el.style.top) {
        const oLeft   = el.offsetLeft;
        const oTop    = el.offsetTop;
        const oWidth  = el.offsetWidth;
        const oHeight = el.offsetHeight;

        const absDescendants = [];
        el.querySelectorAll('*').forEach(d => {
          if (getComputedStyle(d).position === 'absolute') {
            absDescendants.push({ node: d, rect: d.getBoundingClientRect() });
          }
        });

        if (el.parentNode && !el.__ghost) {
          const ghost = doc.createElement('div');
          ghost.className = 'edit-ghost';
          ghost.style.display       = cs.display;
          ghost.style.margin        = cs.margin;
          ghost.style.flex          = cs.flex;
          ghost.style.verticalAlign = cs.verticalAlign;
          ghost.style.width         = oWidth  + 'px';
          ghost.style.height        = oHeight + 'px';
          ghost.style.visibility    = 'hidden';
          el.parentNode.insertBefore(ghost, el);
          el.__ghost = ghost;
        }

        el.style.position = 'absolute';
        el.style.margin   = '0';
        el.style.left   = oLeft   + 'px';
        el.style.top    = oTop    + 'px';
        el.style.width  = oWidth  + 'px';
        el.style.height = oHeight + 'px';

        if (absDescendants.length) {
          const elRect = el.getBoundingClientRect();
          const ecs = getComputedStyle(el);
          const elBorderLeft = parseFloat(ecs.borderLeftWidth) || 0;
          const elBorderTop  = parseFloat(ecs.borderTopWidth)  || 0;
          absDescendants.forEach(({ node, rect }) => {
            node.style.left = (rect.left - elRect.left - elBorderLeft) + 'px';
            node.style.top  = (rect.top  - elRect.top  - elBorderTop)  + 'px';
          });
        }
      }
    }

    function notifyParentSelection() {
      try { parent.__editorOnSelectionChange && parent.__editorOnSelectionChange(); } catch (e) {}
    }

    function clearHandles() {
      handles.forEach(h => h.remove());
      handles.length = 0;
      if (deleteBtn) { deleteBtn.remove(); deleteBtn = null; }
    }

    function placeHandles() {
      clearHandles();
      if (!selected) return;
      const rect = selected.getBoundingClientRect();
      const left = rect.left + window.scrollX;
      const top  = rect.top  + window.scrollY;
      const w = rect.width, h = rect.height;
      const positions = {
        nw: [left,         top],
        n:  [left + w / 2, top],
        ne: [left + w,     top],
        e:  [left + w,     top + h / 2],
        se: [left + w,     top + h],
        s:  [left + w / 2, top + h],
        sw: [left,         top + h],
        w:  [left,         top + h / 2],
      };
      HANDLE_DIRS.forEach(dir => {
        const handle = doc.createElement('div');
        handle.className = 'resize-handle ' + dir;
        handle.dataset.dir = dir;
        const [x, y] = positions[dir];
        handle.style.left = (x - 5) + 'px';
        handle.style.top  = (y - 5) + 'px';
        handle.addEventListener('pointerdown', onResizeDown);
        doc.body.appendChild(handle);
        handles.push(handle);
      });

      // Delete button hovers just outside the top-right corner.
      deleteBtn = doc.createElement('div');
      deleteBtn.className = 'editor-delete';
      deleteBtn.title = 'Delete element';
      deleteBtn.innerHTML = ${JSON.stringify(TRASH_SVG)};
      deleteBtn.style.left = (left + w + 8) + 'px';
      deleteBtn.style.top  = (top - 28) + 'px';
      deleteBtn.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        e.preventDefault();
      });
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        deleteSelected();
      });
      doc.body.appendChild(deleteBtn);
    }

    function deleteSelected() {
      if (!selected) return;
      const victim = selected;
      // Drop selection chrome and the ghost we may have stamped in for layout.
      clearHandles();
      selected.classList.remove('selected');
      selected = null;
      if (victim.__ghost && victim.__ghost.parentNode) {
        victim.__ghost.parentNode.removeChild(victim.__ghost);
      }
      if (victim.parentNode) {
        victim.parentNode.removeChild(victim);
      }
      notifyParentSelection();
    }

    function select(el) {
      if (editing && editing !== el) exitEditing();
      if (selected === el) return;
      if (selected) selected.classList.remove('selected');
      selected = el;
      if (selected) {
        selected.classList.add('selected');
        zCounter += 1;
        selected.style.zIndex = String(zCounter);
        placeHandles();
      } else {
        clearHandles();
      }
      notifyParentSelection();
    }

    doc.addEventListener('click', function (e) {
      if (editing && e.target !== editing && !editing.contains(e.target)) {
        exitEditing();
      }
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
        e.preventDefault();
      }
      if (isEditorChrome(e.target)) return;
      if (e.target === doc.documentElement || e.target === doc.body) {
        select(null);
        return;
      }
      select(e.target);
    }, true);

    const DRAG_THRESHOLD = 3;
    let drag = null;
    doc.addEventListener('pointerdown', function (e) {
      if (isEditorChrome(e.target)) return;
      if (e.target === doc.documentElement || e.target === doc.body) return;
      const target = e.target;
      if (target.isContentEditable) return;
      select(target);
      drag = {
        el: target,
        startX: e.clientX, startY: e.clientY,
        startLeft: 0, startTop: 0,
        lifted: false,
      };
      try { target.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });

    doc.addEventListener('pointermove', function (e) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.lifted) {
        if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
        ensureAbsolute(drag.el);
        drag.startLeft = parseFloat(drag.el.style.left) || 0;
        drag.startTop  = parseFloat(drag.el.style.top)  || 0;
        drag.lifted = true;
      }
      drag.el.style.left = (drag.startLeft + dx) + 'px';
      drag.el.style.top  = (drag.startTop  + dy) + 'px';
      placeHandles();
    });

    doc.addEventListener('pointerup', function () { drag = null; });

    let resize = null;
    function onResizeDown(e) {
      if (!selected) return;
      e.stopPropagation();
      e.preventDefault();
      ensureAbsolute(selected);
      const dir = e.currentTarget.dataset.dir;
      resize = {
        dir, el: selected,
        startX: e.clientX, startY: e.clientY,
        startLeft:  parseFloat(selected.style.left) || 0,
        startTop:   parseFloat(selected.style.top)  || 0,
        startWidth:  selected.getBoundingClientRect().width,
        startHeight: selected.getBoundingClientRect().height,
      };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    }

    doc.addEventListener('pointermove', function (e) {
      if (!resize) return;
      const dx = e.clientX - resize.startX;
      const dy = e.clientY - resize.startY;
      let { startLeft, startTop, startWidth, startHeight, dir, el } = resize;
      let newLeft = startLeft, newTop = startTop;
      let newW = startWidth, newH = startHeight;
      if (dir.includes('e')) newW = startWidth + dx;
      if (dir.includes('s')) newH = startHeight + dy;
      if (dir.includes('w')) { newW = startWidth - dx; newLeft = startLeft + dx; }
      if (dir.includes('n')) { newH = startHeight - dy; newTop  = startTop  + dy; }
      const MIN = 8;
      if (newW < MIN) {
        if (dir.includes('w')) newLeft = startLeft + (startWidth - MIN);
        newW = MIN;
      }
      if (newH < MIN) {
        if (dir.includes('n')) newTop = startTop + (startHeight - MIN);
        newH = MIN;
      }
      el.style.left   = newLeft + 'px';
      el.style.top    = newTop  + 'px';
      el.style.width  = newW + 'px';
      el.style.height = newH + 'px';
      placeHandles();
    });

    doc.addEventListener('pointerup', function () { resize = null; });

    doc.addEventListener('dblclick', function (e) {
      if (isEditorChrome(e.target)) return;
      if (e.target === doc.documentElement || e.target === doc.body) return;
      const el = e.target;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      editing = el;
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    doc.addEventListener('blur', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true') {
        e.target.setAttribute('contenteditable', 'false');
      }
    }, true);

    // Backspace / Delete with selection (and nothing being edited) removes the element.
    doc.addEventListener('keydown', function (e) {
      if (editing) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selected) return;
      e.preventDefault();
      deleteSelected();
    });

    window.addEventListener('scroll', placeHandles, true);
    window.addEventListener('resize', placeHandles);

    window.__editor = {
      getSelected: () => selected,
      deleteSelected: deleteSelected,
      toggleClass: function (cls) {
        if (!selected) return;
        selected.classList.toggle(cls);
        notifyParentSelection();
      },
      setColor: function (color) {
        if (!selected) return;
        selected.style.color = color;
        notifyParentSelection();
      },
      setAlign: function (align) {
        if (!selected) return;
        selected.style.textAlign = align;
        notifyParentSelection();
      },
      exportClean: function () {
        clearHandles();
        const wasSelected = selected;
        if (wasSelected) wasSelected.classList.remove('selected');
        const clone = doc.documentElement.cloneNode(true);
        clone.querySelectorAll('.resize-handle, .editor-delete, .edit-ghost, #__editor_css, #__editor_js').forEach(n => n.remove());
        clone.querySelectorAll('.selected').forEach(n => n.classList.remove('selected'));
        const html = '<!doctype html>\\n' + clone.outerHTML;
        if (wasSelected) {
          wasSelected.classList.add('selected');
          placeHandles();
        }
        return html;
      },
    };
  })();
`;

// buildSrcdoc returns the artifact HTML with the editor stylesheet + script
// appended just before </body>. The injected ids let the editor strip itself
// out cleanly when the user exports.
export function buildSrcdoc(rawHtml) {
  const inject =
    '<style id="__editor_css">' + EDITOR_CSS + '</style>' +
    '<script id="__editor_js">' + EDITOR_JS + '</' + 'script>';
  if (/<\/body>/i.test(rawHtml)) {
    return rawHtml.replace(/<\/body>/i, inject + '</body>');
  }
  return rawHtml + inject;
}
