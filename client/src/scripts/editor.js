// Editor: CSS + JS injected into the artifact iframe so the user can select,
// drag, resize, double-click-to-edit, and richly format elements in place.
//
// The drag / resize / select / dblclick logic is the same shape as the original
// implementation the user already validated. What this revision adds:
//
//   1.  A floating "selection toolbar" that hovers above the selected element
//       with: B / I / U / S, align L/C/R, text & background color, border /
//       rounded / shadow toggles, A− / A+ font sizing, and a trash button.
//   2.  Element-class palette expanded: e-underline, e-strike, e-border,
//       e-rounded, e-shadow.
//   3.  __editor.insertElement(kind) — drops a new element (text / heading /
//       image / video / chart / line-chart / rect / circle / divider / button)
//       at the artifact's visual center, gives it a high z-index, and selects
//       it so the handles + selection toolbar appear immediately.
//   4.  __editor.setBgColor + __editor.nudgeFont for the toolbar.
//   5.  resolveTarget() — selection / drag / dblclick always operate on the
//       component root (inserted wrapper, table, svg root, media element),
//       never on internals. SVG internals and table cells are not CSS boxes
//       you can absolutize, so they must never become drag targets.
//   6.  z-index lifecycle — the counter is seeded from the document's max
//       z-index (AI HTML often ships inline z-index: 100/9999), the selection
//       bump is temporary and restored on deselect, and a real drag commits
//       the new z so "dropped on top" sticks.
//   7.  Handle/toolbar updates during drag/resize are rAF'd position
//       mutations instead of full DOM rebuilds; the toolbar hides while
//       dragging and comes back on drop.

export const EDITOR_CSS = `
  html, body {
    overflow: visible !important;
  }
  .selected {
    outline: 2px solid #5e6ad2 !important;
    outline-offset: 1px;
    box-shadow: 0 0 0 4px rgba(94, 105, 210, 0.14) !important;
  }
  .resize-handle {
    position: absolute; width: 10px; height: 10px;
    background: #ffffff; border: 1.5px solid #5e6ad2;
    z-index: 2147483646; box-sizing: border-box;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgba(15, 17, 21, 0.18);
  }
  .resize-handle.nw { cursor: nwse-resize; }
  .resize-handle.n  { cursor: ns-resize; }
  .resize-handle.ne { cursor: nesw-resize; }
  .resize-handle.e  { cursor: ew-resize; }
  .resize-handle.se { cursor: nwse-resize; }
  .resize-handle.s  { cursor: ns-resize; }
  .resize-handle.sw { cursor: nesw-resize; }
  .resize-handle.w  { cursor: ew-resize; }

  .editor-toolbar {
    position: absolute;
    z-index: 2147483647;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 5px;
    background: #ffffff;
    border: 1px solid #d4d8de;
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(15, 17, 21, 0.14), 0 2px 4px rgba(15, 17, 21, 0.06);
    font-family: -apple-system, system-ui, "Inter", "Segoe UI", Roboto, sans-serif;
    color: #3d4148;
    user-select: none;
    -webkit-user-select: none;
  }
  .editor-toolbar .et-btn {
    width: 28px; height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: #3d4148;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    padding: 0;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .editor-toolbar .et-btn:hover { background: #f2f3f5; color: #0c0d10; }
  .editor-toolbar .et-btn.active { background: rgba(94, 105, 210, 0.12); color: #5e6ad2; }
  .editor-toolbar .et-btn.danger { color: #d62a30; }
  .editor-toolbar .et-btn.danger:hover { background: rgba(214, 42, 48, 0.10); color: #d62a30; }
  .editor-toolbar .et-btn svg { width: 14px; height: 14px; display: block; }
  .editor-toolbar .et-btn b,
  .editor-toolbar .et-btn i,
  .editor-toolbar .et-btn u,
  .editor-toolbar .et-btn s { font-style: normal; font-weight: 500; }
  .editor-toolbar .et-btn b { font-weight: 700; }
  .editor-toolbar .et-btn i { font-style: italic; }
  .editor-toolbar .et-btn u { text-decoration: underline; }
  .editor-toolbar .et-btn s { text-decoration: line-through; }
  .editor-toolbar .et-sep {
    width: 1px;
    height: 16px;
    background: #e6e8ec;
    margin: 0 4px;
    flex-shrink: 0;
  }
  .editor-toolbar .et-color {
    position: relative;
    width: 28px; height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    cursor: pointer;
    overflow: hidden;
    transition: background 0.12s ease;
  }
  .editor-toolbar .et-color:hover { background: #f2f3f5; }
  .editor-toolbar .et-color .glyph {
    position: relative;
    z-index: 1;
    pointer-events: none;
    font-size: 13px;
    font-weight: 600;
    color: #0c0d10;
    line-height: 1;
  }
  .editor-toolbar .et-color .swatch {
    position: absolute;
    left: 5px; right: 5px; bottom: 4px;
    height: 3px;
    border-radius: 2px;
    background: #0c0d10;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(15, 17, 21, 0.12) inset;
  }
  .editor-toolbar .et-color input[type="color"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: 0;
    padding: 0;
    cursor: pointer;
    background: transparent;
  }

  .e-bold     { font-weight: 700; }
  .e-italic   { font-style: italic; }
  .e-underline { text-decoration: underline; }
  .e-strike    { text-decoration: line-through; }
  .e-underline.e-strike { text-decoration: underline line-through; }
  .e-uppercase { text-transform: uppercase; letter-spacing: 0.08em; }
  .e-border    { border: 2px solid #0c0d10; }
  .e-rounded   { border-radius: 12px; }
  .e-shadow    { box-shadow: 0 12px 32px rgba(15, 17, 21, 0.18), 0 2px 6px rgba(15, 17, 21, 0.08); }

  body * { cursor: default; }
  .editor-toolbar, .editor-toolbar * { cursor: pointer; }
  .resize-handle { cursor: inherit; }
  [contenteditable="true"], [contenteditable="true"] * { cursor: text !important; }

  /* All clicks on inserted components must land on the wrapper itself —
     never on svg internals, table cells, media, etc. While the wrapper is
     being text-edited, children become interactive again so the caret can
     be placed. */
  [data-editor-inserted]:not([contenteditable="true"]) * { pointer-events: none; }

  /* Alignment guides drawn while dragging an element. The .v variant is a
     vertical hairline spanning the artifact height; .h is horizontal. */
  .editor-guide {
    position: absolute;
    background: #ff3b6b;
    pointer-events: none;
    z-index: 2147483645;
    opacity: 0.95;
  }
  .editor-guide.v { width: 1px; }
  .editor-guide.h { height: 1px; }
`;

const TRASH_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11"/><path d="M5 4V2.6c0-.33.27-.6.6-.6h4.8c.33 0 .6.27.6.6V4"/><path d="M6.2 7v5"/><path d="M9.8 7v5"/><path d="M3.6 4l.78 8.92c.04.5.46.88.96.88h5.32c.5 0 .92-.38.96-.88L12.4 4"/></svg>`;

const ALIGN_LEFT_SVG   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4h12"/><path d="M2 8h7"/><path d="M2 12h10"/></svg>`;
const ALIGN_CENTER_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4h12"/><path d="M4.5 8h7"/><path d="M3 12h10"/></svg>`;
const ALIGN_RIGHT_SVG  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4h12"/><path d="M7 8h7"/><path d="M4 12h10"/></svg>`;
const BORDER_SVG       = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="11" height="11" rx="1.4"/></svg>`;
const ROUNDED_SVG      = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 13V6a3 3 0 0 1 3-3h7"/></svg>`;
const SHADOW_SVG       = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="9" height="9" rx="1.4"/><path d="M5 13.5h9v-9" opacity="0.45"/></svg>`;

export const EDITOR_JS = `
  (function () {
    const doc = document;

    let selected = null;
    let editing  = null;
    let zCounter = 1;
    const handles = [];
    let toolbar = null;
    let chromeHidden = false;   // toolbar hidden during drag / resize
    let raf = 0;                // pending rAF id for handle updates
    const HANDLE_DIRS = ['nw','n','ne','e','se','s','sw','w'];

    // Components whose internals must never be selected or dragged. Clicks
    // inside any of these climb to the component root (and further to the
    // inserted wrapper if there is one).
    const ATOMIC_SELECTOR = '[data-editor-inserted], table, svg, video, iframe, img';

    function exitEditing() {
      if (!editing) return;
      const wasEditing = editing;
      const start = wasEditing.__editStart;
      wasEditing.setAttribute('contenteditable', 'false');
      try { wasEditing.blur(); } catch (_) {}
      editing = null;
      if (start !== undefined) {
        if (wasEditing.innerHTML !== start) notifyParentChange();
        delete wasEditing.__editStart;
      }
    }

    function isEditorChrome(el) {
      if (!el || !el.classList) return false;
      if (el.classList.contains('resize-handle')) return true;
      if (el.classList.contains('editor-toolbar')) return true;
      return !!(el.closest && el.closest('.editor-toolbar'));
    }

    // Seed the z counter above anything the AI generated — artifacts often
    // ship inline z-index: 100 / 9999 on hero sections, and inserted elements
    // must start above all of it.
    function seedZ() {
      let max = 0;
      doc.querySelectorAll('body *').forEach(function (n) {
        const z = parseInt(n.style.zIndex || getComputedStyle(n).zIndex, 10);
        if (!isNaN(z) && z < 2147480000) max = Math.max(max, z);
      });
      zCounter = max + 1;
    }
    seedZ();

    // Map a raw event target to the element the editor should operate on.
    // Returns null for body / html (caller deselects or ignores).
    function resolveTarget(node) {
      if (node instanceof SVGElement) {
        // Inner SVG nodes are not CSS boxes (no offsetLeft, no left/top
        // positioning) — climb to the outermost <svg> root.
        while (node.ownerSVGElement) node = node.ownerSVGElement;
      }
      if (!node || node === doc.body || node === doc.documentElement) return null;
      if (!node.closest) return null;
      const atomic = node.closest(ATOMIC_SELECTOR);
      if (atomic) return atomic.closest('[data-editor-inserted]') || atomic;
      return node;
    }

    function ensureAbsolute(el) {
      const cs = getComputedStyle(el);
      if (cs.position === 'static' || !el.style.left || !el.style.top) {
        // SVG roots are CSS boxes but expose no offsetLeft/offsetTop
        // (HTMLElement API only) — fall back to rect-based measurement.
        const isHtml     = typeof el.offsetLeft === 'number';
        const beforeRect = el.getBoundingClientRect();
        const oLeft   = isHtml ? el.offsetLeft   : 0;
        const oTop    = isHtml ? el.offsetTop    : 0;
        const oWidth  = isHtml ? el.offsetWidth  : beforeRect.width;
        const oHeight = isHtml ? el.offsetHeight : beforeRect.height;

        const absDescendants = [];
        el.querySelectorAll('*').forEach(d => {
          if (getComputedStyle(d).position === 'absolute') {
            absDescendants.push({ node: d, rect: d.getBoundingClientRect() });
          }
        });

        if (el.parentNode && !el.__ghost) {
          const ghost = doc.createElement('div');
          ghost.className = 'edit-ghost';
          // display:inline ignores width/height — the ghost would hold no
          // space for inline elements (spans, svg roots), so promote it.
          ghost.style.display       = (cs.display === 'inline') ? 'inline-block' : cs.display;
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
        if (isHtml) {
          el.style.left = oLeft + 'px';
          el.style.top  = oTop  + 'px';
        } else {
          // Solve for left/top by probing where (0,0) lands inside the
          // element's containing block, then offsetting back to where the
          // element was visually before the lift.
          el.style.left = '0px';
          el.style.top  = '0px';
          const probe = el.getBoundingClientRect();
          el.style.left = (beforeRect.left - probe.left) + 'px';
          el.style.top  = (beforeRect.top  - probe.top)  + 'px';
        }
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

    // Any DOM mutation that should be persisted to disk OR live in the undo
    // history funnels through here. The host page wires __editorOnChange to
    // a debounced save.
    function notifyParentChange() {
      try { parent.__editorOnChange && parent.__editorOnChange(); } catch (e) {}
      scheduleHeightReport();
    }

    // ── Undo / redo history ──────────────────────────────────────────
    // We snapshot doc.body.innerHTML AFTER stripping selection chrome so
    // restoring a state can never resurrect stale handles or toolbars.
    // pushUndo() is called BEFORE every atomic op so the captured state is
    // the one to return to on Cmd+Z.
    const UNDO_MAX = 100;
    const undoStack = [];
    const redoStack = [];

    function snapshotBody() {
      const wasSelected = selected;
      if (wasSelected) wasSelected.classList.remove('selected');
      clearHandles();
      const html = doc.body.innerHTML;
      if (wasSelected) {
        wasSelected.classList.add('selected');
        // Re-show handles for the still-selected element after snapshot.
        placeHandles();
      }
      return html;
    }
    function pushUndo() {
      undoStack.push(snapshotBody());
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack.length = 0;
    }
    function applySnapshot(html) {
      // Drop selection / chrome before swapping innerHTML so dangling
      // references don't linger across the restore.
      if (selected) selected.classList.remove('selected');
      selected = null;
      editing = null;
      clearHandles();
      doc.body.innerHTML = html;
      notifyParentSelection();
    }
    function undo() {
      if (!undoStack.length) return;
      const cur = snapshotBody();
      const prev = undoStack.pop();
      redoStack.push(cur);
      applySnapshot(prev);
      try { parent.__editorOnChange && parent.__editorOnChange(); } catch (e) {}
      scheduleHeightReport();
    }
    function redo() {
      if (!redoStack.length) return;
      const cur = snapshotBody();
      const next = redoStack.pop();
      undoStack.push(cur);
      applySnapshot(next);
      try { parent.__editorOnChange && parent.__editorOnChange(); } catch (e) {}
      scheduleHeightReport();
    }

    // ── Height reporting (auto-height artifacts) ─────────────────────
    // The parent page calls setViewport with a sentinel height for "auto"
    // artifacts and listens on __editorReportHeight to size the stage to
    // the actual body content. Debounce so a burst of edits collapses to
    // one report.
    let heightReportTimer = 0;
    function scheduleHeightReport() {
      if (heightReportTimer) return;
      heightReportTimer = setTimeout(function () {
        heightReportTimer = 0;
        reportHeight();
      }, 80);
    }
    function reportHeight() {
      try {
        // Measure with chrome hidden so handles/toolbar can't inflate the
        // scrollHeight just because they're positioned past the content.
        const tbDisp = toolbar ? toolbar.style.display : null;
        if (toolbar) toolbar.style.display = 'none';
        handles.forEach(function (h) { h.style.display = 'none'; });
        const px = Math.max(
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight
        );
        if (toolbar && tbDisp !== null) toolbar.style.display = tbDisp;
        handles.forEach(function (h) { h.style.display = ''; });
        if (parent && parent.__editorReportHeight) {
          parent.__editorReportHeight(px);
        }
      } catch (e) {}
    }

    function clearHandles() {
      handles.forEach(h => h.remove());
      handles.length = 0;
      if (toolbar) { toolbar.remove(); toolbar = null; }
      chromeHidden = false;
    }

    function handlePositions(rect) {
      const left = rect.left + window.scrollX;
      const top  = rect.top  + window.scrollY;
      const w = rect.width, h = rect.height;
      return {
        nw: [left,         top],
        n:  [left + w / 2, top],
        ne: [left + w,     top],
        e:  [left + w,     top + h / 2],
        se: [left + w,     top + h],
        s:  [left + w / 2, top + h],
        sw: [left,         top + h],
        w:  [left,         top + h / 2],
      };
    }

    // Full build — runs on selection change only.
    function placeHandles() {
      clearHandles();
      if (!selected) return;
      const rect = selected.getBoundingClientRect();
      const positions = handlePositions(rect);
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

      toolbar = buildToolbar();
      doc.body.appendChild(toolbar);
      positionToolbar(rect.left + window.scrollX, rect.top + window.scrollY, rect.width);
      syncToolbarState();
    }

    // Cheap update — mutates positions of existing handles. Runs during
    // drag / resize / scroll instead of rebuilding the chrome every move.
    function updateHandlePositions() {
      if (!selected || !handles.length) return;
      const rect = selected.getBoundingClientRect();
      const positions = handlePositions(rect);
      handles.forEach(h => {
        const p = positions[h.dataset.dir];
        h.style.left = (p[0] - 5) + 'px';
        h.style.top  = (p[1] - 5) + 'px';
      });
      if (toolbar && !chromeHidden) {
        positionToolbar(rect.left + window.scrollX, rect.top + window.scrollY, rect.width);
      }
    }

    function scheduleHandleUpdate() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        updateHandlePositions();
      });
    }

    function hideChrome() {
      if (chromeHidden) return;
      chromeHidden = true;
      if (toolbar) toolbar.style.display = 'none';
    }

    function showChrome() {
      if (!chromeHidden) return;
      chromeHidden = false;
      if (toolbar && selected) {
        toolbar.style.display = '';
        const rect = selected.getBoundingClientRect();
        positionToolbar(rect.left + window.scrollX, rect.top + window.scrollY, rect.width);
        syncToolbarState();
      }
    }

    function buildToolbar() {
      const tb = doc.createElement('div');
      tb.className = 'editor-toolbar';
      tb.innerHTML =
        btn('bold',         '<b>B</b>',         'Bold') +
        btn('italic',       '<i>I</i>',         'Italic') +
        btn('underline',    '<u>U</u>',         'Underline') +
        btn('strike',       '<s>S</s>',         'Strikethrough') +
        btn('uppercase',    '<span style="font-size:11px;letter-spacing:.04em;">Aa</span>', 'Uppercase') +
        sep() +
        btn('align-left',   ${JSON.stringify(ALIGN_LEFT_SVG)},   'Align left') +
        btn('align-center', ${JSON.stringify(ALIGN_CENTER_SVG)}, 'Align center') +
        btn('align-right',  ${JSON.stringify(ALIGN_RIGHT_SVG)},  'Align right') +
        sep() +
        colorWell('text-color', 'A', 'Text color', '#0c0d10') +
        colorWell('bg-color',   '◼', 'Background color', '#5e6ad2') +
        sep() +
        btn('border',       ${JSON.stringify(BORDER_SVG)},   'Border') +
        btn('rounded',      ${JSON.stringify(ROUNDED_SVG)},  'Rounded') +
        btn('shadow',       ${JSON.stringify(SHADOW_SVG)},   'Shadow') +
        sep() +
        btn('font-down',    '<span style="font-size:11px;">A−</span>', 'Smaller') +
        btn('font-up',      '<span style="font-size:14px;">A+</span>', 'Larger') +
        sep() +
        btn('delete',       ${JSON.stringify(TRASH_SVG)}, 'Delete', 'danger');

      tb.addEventListener('pointerdown', (e) => {
        // Keep the toolbar from stealing selection / drag.
        e.stopPropagation();
      });
      tb.addEventListener('mousedown', (e) => {
        if (e.target && e.target.tagName !== 'INPUT') e.preventDefault();
      });
      tb.addEventListener('click', onToolbarClick);
      tb.addEventListener('input', onToolbarInput);
      return tb;
    }

    function btn(act, html, title, extra) {
      const cls = 'et-btn' + (extra ? ' ' + extra : '');
      return '<button type="button" class="' + cls + '" data-act="' + act + '" title="' + title + '" aria-label="' + title + '">' + html + '</button>';
    }
    function sep() { return '<span class="et-sep"></span>'; }
    function colorWell(act, glyph, title, defaultColor) {
      return '<label class="et-color" data-act="' + act + '" title="' + title + '">' +
               '<span class="glyph">' + glyph + '</span>' +
               '<span class="swatch" data-swatch="' + act + '"></span>' +
               '<input type="color" data-act="' + act + '" value="' + defaultColor + '" aria-label="' + title + '"/>' +
             '</label>';
    }

    function positionToolbar(left, top, w) {
      if (!toolbar) return;
      const tbW = toolbar.offsetWidth;
      const tbH = toolbar.offsetHeight;
      let tbLeft = left + w / 2 - tbW / 2;
      let tbTop  = top - tbH - 12;
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const viewportLeft = scrollX + 8;
      const viewportRight = scrollX + (doc.documentElement.clientWidth || window.innerWidth) - 8;
      if (tbLeft < viewportLeft) tbLeft = viewportLeft;
      if (tbLeft + tbW > viewportRight) tbLeft = Math.max(viewportLeft, viewportRight - tbW);
      if (tbTop < scrollY + 8) {
        // Flip below the element.
        const rect = selected.getBoundingClientRect();
        tbTop = rect.top + window.scrollY + rect.height + 12;
      }
      toolbar.style.left = tbLeft + 'px';
      toolbar.style.top  = tbTop  + 'px';
    }

    function syncToolbarState() {
      if (!toolbar || !selected) return;
      const cl = selected.classList;
      const map = {
        'bold':      cl.contains('e-bold'),
        'italic':    cl.contains('e-italic'),
        'underline': cl.contains('e-underline'),
        'strike':    cl.contains('e-strike'),
        'uppercase': cl.contains('e-uppercase'),
        'border':    cl.contains('e-border'),
        'rounded':   cl.contains('e-rounded'),
        'shadow':    cl.contains('e-shadow'),
      };
      toolbar.querySelectorAll('[data-act]').forEach(node => {
        const k = node.dataset.act;
        if (k in map) node.classList.toggle('active', !!map[k]);
      });
      const align = selected.style.textAlign;
      toolbar.querySelectorAll('[data-act^="align-"]').forEach(n => n.classList.remove('active'));
      if (align === 'left')   markAct('align-left');
      if (align === 'center') markAct('align-center');
      if (align === 'right')  markAct('align-right');

      const txtSwatch = toolbar.querySelector('[data-swatch="text-color"]');
      const bgSwatch  = toolbar.querySelector('[data-swatch="bg-color"]');
      const cs = getComputedStyle(selected);
      if (txtSwatch) txtSwatch.style.background = selected.style.color || cs.color || '#0c0d10';
      if (bgSwatch) {
        const bg = selected.style.backgroundColor || cs.backgroundColor;
        bgSwatch.style.background = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ? bg : 'transparent';
        bgSwatch.style.boxShadow = (bgSwatch.style.background === 'transparent')
          ? 'inset 0 0 0 1px rgba(15,17,21,0.18)'
          : 'inset 0 0 0 1px rgba(15,17,21,0.12)';
      }
      const txtInput = toolbar.querySelector('input[data-act="text-color"]');
      const bgInput  = toolbar.querySelector('input[data-act="bg-color"]');
      const txtHex = rgbToHex(selected.style.color || cs.color);
      const bgHex  = rgbToHex(selected.style.backgroundColor || cs.backgroundColor);
      if (txtInput && txtHex) txtInput.value = txtHex;
      if (bgInput  && bgHex)  bgInput.value  = bgHex;
    }

    function markAct(name) {
      const n = toolbar && toolbar.querySelector('[data-act="' + name + '"]');
      if (n) n.classList.add('active');
    }

    function rgbToHex(s) {
      if (!s) return null;
      const m = /rgba?\\((\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/.exec(s);
      if (!m) return null;
      const toHex = n => Number(n).toString(16).padStart(2, '0');
      return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
    }

    function onToolbarClick(e) {
      const colorLabel = e.target.closest && e.target.closest('.et-color');
      if (colorLabel) return; // let the native input handle it
      const node = e.target.closest && e.target.closest('[data-act]');
      if (!node) return;
      e.stopPropagation();
      e.preventDefault();
      const act = node.dataset.act;
      switch (act) {
        case 'bold':         return toggleClass('e-bold');
        case 'italic':       return toggleClass('e-italic');
        case 'underline':    return toggleClass('e-underline');
        case 'strike':       return toggleClass('e-strike');
        case 'uppercase':    return toggleClass('e-uppercase');
        case 'align-left':   return setAlign('left');
        case 'align-center': return setAlign('center');
        case 'align-right':  return setAlign('right');
        case 'border':       return toggleClass('e-border');
        case 'rounded':      return toggleClass('e-rounded');
        case 'shadow':       return toggleClass('e-shadow');
        case 'font-down':    return nudgeFont(-2);
        case 'font-up':      return nudgeFont(2);
        case 'delete':       return deleteSelected();
      }
    }

    function onToolbarInput(e) {
      const inp = e.target.closest && e.target.closest('input[type="color"]');
      if (!inp) return;
      const act = inp.dataset.act;
      if (act === 'text-color') setColor(inp.value);
      if (act === 'bg-color')   setBgColor(inp.value);
    }

    function deleteSelected() {
      if (!selected) return;
      pushUndo();
      const victim = selected;
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
      notifyParentChange();
    }

    function toggleClass(cls) {
      if (!selected) return;
      pushUndo();
      selected.classList.toggle(cls);
      syncToolbarState();
      notifyParentSelection();
      notifyParentChange();
    }
    function setColor(color) {
      if (!selected) return;
      pushUndo();
      selected.style.color = color;
      syncToolbarState();
      notifyParentSelection();
      notifyParentChange();
    }
    function setBgColor(color) {
      if (!selected) return;
      pushUndo();
      selected.style.backgroundColor = color;
      syncToolbarState();
      notifyParentSelection();
      notifyParentChange();
    }
    function setAlign(align) {
      if (!selected) return;
      pushUndo();
      selected.style.textAlign = align;
      syncToolbarState();
      notifyParentSelection();
      notifyParentChange();
    }
    function nudgeFont(delta) {
      if (!selected) return;
      pushUndo();
      const cs = getComputedStyle(selected);
      const cur = parseFloat(cs.fontSize) || 16;
      const next = Math.max(6, Math.min(240, cur + delta));
      selected.style.fontSize = next + 'px';
      updateHandlePositions();
      notifyParentSelection();
      notifyParentChange();
    }

    function select(el) {
      if (editing && editing !== el) exitEditing();
      if (selected === el) return;
      if (selected) {
        selected.classList.remove('selected');
        // Restore the pre-selection z-index: only the selected element is
        // temporarily on top. (__baseZ is committed on a real drag, and set
        // permanently for inserted elements at insert time.)
        selected.style.zIndex = (selected.__baseZ !== undefined) ? selected.__baseZ : '';
        delete selected.__baseZ;
      }
      selected = el;
      if (selected) {
        selected.classList.add('selected');
        selected.__baseZ = selected.style.zIndex || '';
        zCounter += 1;
        selected.style.zIndex = String(zCounter);
        placeHandles();
      } else {
        clearHandles();
      }
      notifyParentSelection();
    }

    doc.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
        if (!isEditorChrome(e.target)) e.preventDefault();
      }
      if (editing) {
        // Clicks inside the element being edited must not re-select / exit.
        if (e.target === editing || editing.contains(e.target)) return;
        exitEditing();
      }
      if (isEditorChrome(e.target)) return;
      // resolveTarget returns null for body / html → deselect.
      select(resolveTarget(e.target));
    }, true);

    const DRAG_THRESHOLD = 3;
    let drag = null;
    doc.addEventListener('pointerdown', function (e) {
      if (isEditorChrome(e.target)) return;
      if (e.target.isContentEditable) return;
      const target = resolveTarget(e.target);
      if (!target) return; // body / html — the click handler deselects
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
        pushUndo();
        ensureAbsolute(drag.el);
        drag.startLeft = parseFloat(drag.el.style.left) || 0;
        drag.startTop  = parseFloat(drag.el.style.top)  || 0;
        drag.lifted = true;
        drag.candidates = collectSnapCandidates(drag.el);
        hideChrome();
      }
      let newLeft = drag.startLeft + dx;
      let newTop  = drag.startTop  + dy;
      const snapped = snapToGuides(drag.el, newLeft, newTop, drag.candidates);
      drag.el.style.left = snapped.left + 'px';
      drag.el.style.top  = snapped.top  + 'px';
      drawGuides(snapped.guides);
      scheduleHandleUpdate();
    });

    doc.addEventListener('pointerup', function () {
      if (drag && drag.lifted) {
        // A real move happened — commit the bumped z so the element stays
        // above whatever it was dropped onto after deselect.
        drag.el.__baseZ = drag.el.style.zIndex;
        showChrome();
        updateHandlePositions();
        clearGuides();
        notifyParentChange();
      }
      drag = null;
    });

    let resize = null;
    function onResizeDown(e) {
      if (!selected) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndo();
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
      hideChrome();
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
      scheduleHandleUpdate();
    });

    doc.addEventListener('pointerup', function () {
      if (resize) {
        showChrome();
        updateHandlePositions();
        notifyParentChange();
      }
      resize = null;
    });

    // Inserted kinds that have no editable text content.
    const NON_TEXT_KINDS = {
      'image': 1, 'video': 1, 'chart': 1, 'line-chart': 1,
      'rect': 1, 'circle': 1, 'divider': 1,
    };

    function isTextEditable(el) {
      if (el.matches('svg, img, video, iframe, table, hr')) return false;
      const kind = el.getAttribute('data-editor-inserted');
      if (kind && NON_TEXT_KINDS[kind]) return false;
      return true;
    }

    doc.addEventListener('dblclick', function (e) {
      if (isEditorChrome(e.target)) return;
      const el = resolveTarget(e.target);
      if (!el || !isTextEditable(el)) return;
      // Capture the pre-edit state so undo restores it as one unit instead
      // of one snapshot per keystroke.
      pushUndo();
      el.setAttribute('contenteditable', 'true');
      el.__editStart = el.innerHTML;
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
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('contenteditable') === 'true') {
        t.setAttribute('contenteditable', 'false');
        if (t.__editStart !== undefined) {
          if (t.innerHTML !== t.__editStart) notifyParentChange();
          delete t.__editStart;
        }
      }
    }, true);

    doc.addEventListener('keydown', function (e) {
      const meta = e.metaKey || e.ctrlKey;
      // Undo / redo work even while text editing — let the browser's native
      // undo handle within the contenteditable, but a Cmd+Z at the top level
      // (no contenteditable) restores the previous structural state.
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        if (editing) return; // browser handles intra-text undo
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) {
        if (editing) return;
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Escape') {
        if (editing) { exitEditing(); return; }
        if (selected) select(null);
        return;
      }
      if (editing) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selected) return;
      e.preventDefault();
      deleteSelected();
    });

    window.addEventListener('scroll', scheduleHandleUpdate, true);
    window.addEventListener('resize', scheduleHandleUpdate);

    // ── Drag alignment guides ────────────────────────────────────────
    // collectSnapCandidates walks the artifact's top-level elements (plus
    // the artifact's own center axes) and gathers viewport-space x/y values
    // worth snapping to. Captured once per drag so we don't re-scan during
    // pointermove.
    const SNAP_THRESHOLD = 5;
    const guideEls = [];

    function collectSnapCandidates(drEl) {
      const xs = [];
      const ys = [];
      // The artifact's own bounding box (root element / body) gives the
      // outer edges + center cross to align against.
      const bodyRect = doc.body.getBoundingClientRect();
      xs.push({ x: bodyRect.left, kind: 'edge' });
      xs.push({ x: bodyRect.left + bodyRect.width / 2, kind: 'center' });
      xs.push({ x: bodyRect.right, kind: 'edge' });
      ys.push({ y: bodyRect.top, kind: 'edge' });
      ys.push({ y: bodyRect.top + bodyRect.height / 2, kind: 'center' });
      ys.push({ y: bodyRect.bottom, kind: 'edge' });

      // Siblings: only top-level children of body, skip chrome and the
      // dragged element itself (and its ghost spacer).
      Array.prototype.forEach.call(doc.body.children, function (n) {
        if (n === drEl) return;
        if (n === drEl.__ghost) return;
        if (n.classList && (
          n.classList.contains('resize-handle') ||
          n.classList.contains('editor-toolbar') ||
          n.classList.contains('editor-guide') ||
          n.classList.contains('edit-ghost')
        )) return;
        const r = n.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        xs.push({ x: r.left,   kind: 'edge' });
        xs.push({ x: r.left + r.width / 2, kind: 'center' });
        xs.push({ x: r.right,  kind: 'edge' });
        ys.push({ y: r.top,    kind: 'edge' });
        ys.push({ y: r.top + r.height / 2, kind: 'center' });
        ys.push({ y: r.bottom, kind: 'edge' });
      });
      return { xs: xs, ys: ys, bodyRect: bodyRect, startRect: drEl.getBoundingClientRect() };
    }

    // snapToGuides applies up to one snap per axis and returns the adjusted
    // (left, top) plus a list of guide overlays to render. The element rect
    // at the *target* position is derived from drag.startRect + delta —
    // works because the drag never scrolls the iframe.
    function snapToGuides(drEl, newLeft, newTop, cands) {
      if (!cands) return { left: newLeft, top: newTop, guides: [] };
      const startStyleLeft = drag ? drag.startLeft : parseFloat(drEl.style.left) || 0;
      const startStyleTop  = drag ? drag.startTop  : parseFloat(drEl.style.top)  || 0;
      const dx = newLeft - startStyleLeft;
      const dy = newTop  - startStyleTop;
      const r = cands.startRect;
      const targetLeft   = r.left + dx;
      const targetTop    = r.top  + dy;
      const targetRight  = targetLeft + r.width;
      const targetBottom = targetTop  + r.height;
      const targetCX     = targetLeft + r.width  / 2;
      const targetCY     = targetTop  + r.height / 2;

      const xRefs = [
        { v: targetLeft,  side: 'left'   },
        { v: targetCX,    side: 'center' },
        { v: targetRight, side: 'right'  },
      ];
      const yRefs = [
        { v: targetTop,    side: 'top'    },
        { v: targetCY,     side: 'center' },
        { v: targetBottom, side: 'bottom' },
      ];

      let bestX = null;
      xRefs.forEach(function (ref) {
        cands.xs.forEach(function (c) {
          const d = Math.abs(c.x - ref.v);
          if (d <= SNAP_THRESHOLD && (bestX === null || d < bestX.dist)) {
            bestX = { dist: d, offset: c.x - ref.v, line: c.x };
          }
        });
      });
      let bestY = null;
      yRefs.forEach(function (ref) {
        cands.ys.forEach(function (c) {
          const d = Math.abs(c.y - ref.v);
          if (d <= SNAP_THRESHOLD && (bestY === null || d < bestY.dist)) {
            bestY = { dist: d, offset: c.y - ref.v, line: c.y };
          }
        });
      });

      const guides = [];
      if (bestX !== null) {
        newLeft += bestX.offset;
        guides.push({ axis: 'v', pos: bestX.line });
      }
      if (bestY !== null) {
        newTop += bestY.offset;
        guides.push({ axis: 'h', pos: bestY.line });
      }
      return { left: newLeft, top: newTop, guides: guides };
    }

    function drawGuides(guides) {
      clearGuides();
      if (!guides || !guides.length) return;
      const bRect = doc.body.getBoundingClientRect();
      guides.forEach(function (g) {
        const el = doc.createElement('div');
        el.className = 'editor-guide ' + g.axis;
        if (g.axis === 'v') {
          el.style.left   = (g.pos + window.scrollX) + 'px';
          el.style.top    = (Math.max(0, bRect.top)    + window.scrollY) + 'px';
          el.style.height = Math.max(bRect.height, doc.documentElement.clientHeight) + 'px';
        } else {
          el.style.top    = (g.pos + window.scrollY) + 'px';
          el.style.left   = (Math.max(0, bRect.left)  + window.scrollX) + 'px';
          el.style.width  = Math.max(bRect.width,  doc.documentElement.clientWidth)  + 'px';
        }
        doc.body.appendChild(el);
        guideEls.push(el);
      });
    }
    function clearGuides() {
      guideEls.forEach(function (n) { n.remove(); });
      guideEls.length = 0;
    }

    // ── Insert helpers ────────────────────────────────────────────────
    function viewportCenter() {
      const cx = (window.scrollX || 0) + (doc.documentElement.clientWidth  || window.innerWidth)  / 2;
      const cy = (window.scrollY || 0) + (doc.documentElement.clientHeight || window.innerHeight) / 2;
      return { cx, cy };
    }

    function chartSvg() {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" style="width:100%;height:100%;display:block">' +
        '<rect x="0" y="0" width="320" height="220" rx="10" fill="#ffffff"/>' +
        '<text x="20" y="32" font-family="-apple-system,system-ui,sans-serif" font-size="13" font-weight="600" fill="#0c0d10">Quarterly performance</text>' +
        '<g fill="#5e6ad2">' +
          '<rect x="32"  y="130" width="34" height="66"  rx="3"/>' +
          '<rect x="86"  y="100" width="34" height="96"  rx="3"/>' +
          '<rect x="140" y="120" width="34" height="76"  rx="3"/>' +
          '<rect x="194" y="74"  width="34" height="122" rx="3"/>' +
          '<rect x="248" y="92"  width="34" height="104" rx="3"/>' +
        '</g>' +
        '<line x1="20" y1="196" x2="300" y2="196" stroke="#e6e8ec" stroke-width="1"/>' +
        '<g font-family="-apple-system,system-ui,sans-serif" font-size="10" fill="#6a6f78" text-anchor="middle">' +
          '<text x="49"  y="210">Q1</text>' +
          '<text x="103" y="210">Q2</text>' +
          '<text x="157" y="210">Q3</text>' +
          '<text x="211" y="210">Q4</text>' +
          '<text x="265" y="210">Q5</text>' +
        '</g>' +
      '</svg>';
    }

    function lineChartSvg() {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" style="width:100%;height:100%;display:block">' +
        '<rect x="0" y="0" width="320" height="220" rx="10" fill="#ffffff"/>' +
        '<text x="20" y="32" font-family="-apple-system,system-ui,sans-serif" font-size="13" font-weight="600" fill="#0c0d10">Trend</text>' +
        '<g stroke="#e6e8ec" stroke-width="1">' +
          '<line x1="20" y1="80"  x2="300" y2="80"/>' +
          '<line x1="20" y1="120" x2="300" y2="120"/>' +
          '<line x1="20" y1="160" x2="300" y2="160"/>' +
          '<line x1="20" y1="196" x2="300" y2="196"/>' +
        '</g>' +
        '<path d="M30 170 L80 130 L130 145 L180 95 L230 110 L280 60" fill="none" stroke="#5e6ad2" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M30 170 L80 130 L130 145 L180 95 L230 110 L280 60 L280 196 L30 196 Z" fill="url(#g1)" opacity="0.18"/>' +
        '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5e6ad2"/><stop offset="100%" stop-color="#5e6ad2" stop-opacity="0"/></linearGradient></defs>' +
        '<g fill="#5e6ad2">' +
          '<circle cx="30"  cy="170" r="3"/>' +
          '<circle cx="80"  cy="130" r="3"/>' +
          '<circle cx="130" cy="145" r="3"/>' +
          '<circle cx="180" cy="95"  r="3"/>' +
          '<circle cx="230" cy="110" r="3"/>' +
          '<circle cx="280" cy="60"  r="3"/>' +
        '</g>' +
      '</svg>';
    }

    function imagePlaceholderUrl() {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">' +
        '<rect width="320" height="200" rx="10" fill="#f2f3f5"/>' +
        '<g stroke="#9aa0a8" stroke-width="1.5" fill="none">' +
          '<rect x="16" y="14" width="288" height="172" rx="8"/>' +
          '<circle cx="72" cy="70" r="14"/>' +
          '<path d="M16 154 l72 -70 l54 50 l38 -30 l124 80"/>' +
        '</g>' +
      '</svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    function videoPlaceholder(node) {
      node.style.background = 'linear-gradient(135deg,#1c1c22 0%,#3a3a44 100%)';
      node.style.display = 'flex';
      node.style.alignItems = 'center';
      node.style.justifyContent = 'center';
      node.innerHTML = '<svg viewBox="0 0 64 64" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="32" cy="32" r="30" fill="rgba(255,255,255,0.16)"/>' +
        '<polygon points="26,20 46,32 26,44" fill="#ffffff"/>' +
      '</svg>';
    }

    function insertElement(kind) {
      pushUndo();
      const { cx, cy } = viewportCenter();
      const el = doc.createElement('div');
      el.setAttribute('data-editor-inserted', kind);
      el.style.boxSizing = 'border-box';
      let w = 240, h = 80;

      if (kind === 'text') {
        el.textContent = 'Double-click to edit';
        el.style.fontFamily = '-apple-system, system-ui, "Inter", "Segoe UI", Roboto, sans-serif';
        el.style.fontSize = '18px';
        el.style.color = '#0c0d10';
        el.style.padding = '6px 8px';
        el.style.lineHeight = '1.4';
        w = 260; h = 44;
      } else if (kind === 'heading') {
        el.textContent = 'Heading';
        el.style.fontFamily = '-apple-system, system-ui, "Inter", "Segoe UI", Roboto, sans-serif';
        el.style.fontSize = '36px';
        el.style.fontWeight = '700';
        el.style.letterSpacing = '-0.4px';
        el.style.color = '#0c0d10';
        el.style.padding = '4px 8px';
        el.style.lineHeight = '1.15';
        w = 360; h = 60;
      } else if (kind === 'image') {
        const url = (parent && typeof parent.prompt === 'function')
          ? parent.prompt('Image URL (leave blank for placeholder):', '')
          : window.prompt('Image URL (leave blank for placeholder):', '');
        if (url === null) return; // user cancelled
        const img = doc.createElement('img');
        img.src = url || imagePlaceholderUrl();
        img.draggable = false;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '10px';
        img.style.display = 'block';
        el.appendChild(img);
        el.style.borderRadius = '10px';
        el.style.overflow = 'hidden';
        w = 360; h = 220;
      } else if (kind === 'video') {
        const url = (parent && typeof parent.prompt === 'function')
          ? parent.prompt('Video URL (YouTube or .mp4) — leave blank for placeholder:', '')
          : window.prompt('Video URL (YouTube or .mp4) — leave blank for placeholder:', '');
        if (url === null) return;
        el.style.borderRadius = '10px';
        el.style.overflow = 'hidden';
        if (url && /(?:youtube\\.com|youtu\\.be)/.test(url)) {
          const m = url.match(/(?:v=|youtu\\.be\\/|embed\\/)([\\w-]{11})/);
          const id = m && m[1];
          if (id) {
            const f = doc.createElement('iframe');
            f.src = 'https://www.youtube.com/embed/' + id;
            f.allow = 'autoplay; encrypted-media; picture-in-picture';
            f.style.width = '100%'; f.style.height = '100%'; f.style.border = '0';
            f.style.display = 'block';
            el.appendChild(f);
          } else {
            videoPlaceholder(el);
          }
        } else if (url) {
          const v = doc.createElement('video');
          v.src = url; v.controls = true;
          v.style.width = '100%'; v.style.height = '100%'; v.style.display = 'block';
          v.style.background = '#000';
          el.appendChild(v);
        } else {
          videoPlaceholder(el);
        }
        w = 360; h = 200;
      } else if (kind === 'chart') {
        el.innerHTML = chartSvg();
        w = 360; h = 240;
      } else if (kind === 'line-chart') {
        el.innerHTML = lineChartSvg();
        w = 360; h = 240;
      } else if (kind === 'rect') {
        el.style.background = '#5e6ad2';
        el.style.borderRadius = '10px';
        w = 200; h = 140;
      } else if (kind === 'circle') {
        el.style.background = '#5e6ad2';
        el.style.borderRadius = '50%';
        w = 160; h = 160;
      } else if (kind === 'divider') {
        el.style.background = '#d4d8de';
        el.style.borderRadius = '2px';
        w = 360; h = 4;
      } else if (kind === 'button') {
        el.textContent = 'Button';
        el.style.background = '#5e6ad2';
        el.style.color = '#ffffff';
        el.style.fontFamily = '-apple-system, system-ui, "Inter", "Segoe UI", Roboto, sans-serif';
        el.style.fontWeight = '600';
        el.style.fontSize = '14px';
        el.style.letterSpacing = '-0.1px';
        el.style.borderRadius = '9999px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.boxShadow = '0 6px 16px rgba(94, 105, 210, 0.30)';
        w = 160; h = 44;
      } else {
        return;
      }

      el.style.position = 'absolute';
      el.style.width  = w + 'px';
      el.style.height = h + 'px';
      el.style.left   = (cx - w / 2) + 'px';
      el.style.top    = (cy - h / 2) + 'px';
      zCounter += 10;
      el.style.zIndex = String(zCounter);
      doc.body.appendChild(el);
      select(el);
      notifyParentChange();
    }

    // Initial height report + observer so auto-sized stages can size to
    // the body's actual rendered height. The host page ignores reports for
    // artifacts whose maker comment carried an explicit numeric height.
    scheduleHeightReport();
    window.addEventListener('load', scheduleHeightReport);
    try {
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(scheduleHeightReport).observe(doc.documentElement);
      }
    } catch (e) {}

    window.__editor = {
      getSelected: () => selected,
      deleteSelected: deleteSelected,
      toggleClass: function (cls) { toggleClass(cls); },
      setColor: function (color) { setColor(color); },
      setBgColor: function (color) { setBgColor(color); },
      setAlign: function (align) { setAlign(align); },
      nudgeFont: function (delta) { nudgeFont(delta); },
      insertElement: function (kind) { insertElement(kind); },
      undo: undo,
      redo: redo,
      exportClean: function () {
        clearHandles();
        const wasSelected = selected;
        if (wasSelected) wasSelected.classList.remove('selected');
        const clone = doc.documentElement.cloneNode(true);
        clone.querySelectorAll('.resize-handle, .editor-toolbar, #__editor_css, #__editor_js').forEach(n => n.remove());
        // Ghosts hold the flow slot of moved elements — removing them would
        // reflow every sibling below in the exported HTML. Keep them as
        // inert spacers (they already carry inline visibility:hidden + size).
        clone.querySelectorAll('.edit-ghost').forEach(n => {
          n.removeAttribute('class');
          n.setAttribute('data-editor-spacer', '');
        });
        clone.querySelectorAll('.selected').forEach(n => n.classList.remove('selected'));
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
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
