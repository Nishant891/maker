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

  [data-editor-inserted] img,
  [data-editor-inserted] video,
  [data-editor-inserted] iframe { pointer-events: none; }
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
    const HANDLE_DIRS = ['nw','n','ne','e','se','s','sw','w'];

    function exitEditing() {
      if (!editing) return;
      editing.setAttribute('contenteditable', 'false');
      try { editing.blur(); } catch (_) {}
      editing = null;
    }

    function isEditorChrome(el) {
      if (!el || !el.classList) return false;
      if (el.classList.contains('resize-handle')) return true;
      if (el.classList.contains('editor-toolbar')) return true;
      return !!(el.closest && el.closest('.editor-toolbar'));
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
      if (toolbar) { toolbar.remove(); toolbar = null; }
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

      toolbar = buildToolbar();
      doc.body.appendChild(toolbar);
      positionToolbar(left, top, w);
      syncToolbarState();
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
    }

    function toggleClass(cls) {
      if (!selected) return;
      selected.classList.toggle(cls);
      syncToolbarState();
      notifyParentSelection();
    }
    function setColor(color) {
      if (!selected) return;
      selected.style.color = color;
      syncToolbarState();
      notifyParentSelection();
    }
    function setBgColor(color) {
      if (!selected) return;
      selected.style.backgroundColor = color;
      syncToolbarState();
      notifyParentSelection();
    }
    function setAlign(align) {
      if (!selected) return;
      selected.style.textAlign = align;
      syncToolbarState();
      notifyParentSelection();
    }
    function nudgeFont(delta) {
      if (!selected) return;
      const cs = getComputedStyle(selected);
      const cur = parseFloat(cs.fontSize) || 16;
      const next = Math.max(6, Math.min(240, cur + delta));
      selected.style.fontSize = next + 'px';
      placeHandles();
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
        if (!isEditorChrome(e.target)) e.preventDefault();
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

    doc.addEventListener('keydown', function (e) {
      if (editing) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selected) return;
      e.preventDefault();
      deleteSelected();
    });

    window.addEventListener('scroll', placeHandles, true);
    window.addEventListener('resize', placeHandles);

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
    }

    window.__editor = {
      getSelected: () => selected,
      deleteSelected: deleteSelected,
      toggleClass: function (cls) { toggleClass(cls); },
      setColor: function (color) { setColor(color); },
      setBgColor: function (color) { setBgColor(color); },
      setAlign: function (align) { setAlign(align); },
      nudgeFont: function (delta) { nudgeFont(delta); },
      insertElement: function (kind) { insertElement(kind); },
      exportClean: function () {
        clearHandles();
        const wasSelected = selected;
        if (wasSelected) wasSelected.classList.remove('selected');
        const clone = doc.documentElement.cloneNode(true);
        clone.querySelectorAll('.resize-handle, .editor-toolbar, .edit-ghost, #__editor_css, #__editor_js').forEach(n => n.remove());
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
