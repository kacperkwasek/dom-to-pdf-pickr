// Gets re-injected on every pick, so it's wrapped in an IIFE and the
// toggle fn lives on window - a fresh injection just flips the existing
// picker off instead of stacking a second one.
(function () {
  const api = globalThis.browser ?? chrome;

  if (window.__domPdfPickerToggle) {
    window.__domPdfPickerToggle();
    return;
  }

  const DEFAULT_OPTIONS = { marginMm: 12, mode: 'A', printBackgrounds: true, includeSourceUrl: false };

  const STATE = {
    active: false,
    target: null,
    mode: 'A',
    options: DEFAULT_OPTIONS,
    hoverBlocked: false
  };

  let overlay = null;
  let flashTimer = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shortSelector(el) {
    if (!el) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 3) {
      let part = cur.tagName.toLowerCase();
      if (cur.classList && cur.classList.length) {
        part += '.' + [...cur.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.');
      }
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((s) => s.tagName === cur.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function createOverlay() {
    const host = document.createElement('div');
    host.setAttribute('data-pick-overlay-host', '1');
    host.style.cssText = 'all:initial; position:fixed; inset:0; z-index:2147483647; pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .box { position: fixed; box-sizing: border-box; border: 2px solid #2563eb; background: rgba(37,99,235,0.12); pointer-events: none; }
        .box.warn { border-color: #dc2626; background: rgba(220,38,38,0.14); }
        .badge {
          position: fixed; pointer-events: none; background: #111827; color: #fff;
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 4px 8px; border-radius: 4px; max-width: 70vw; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 8px rgba(0,0,0,.35);
        }
        .badge b { color: #93c5fd; font-weight: 600; }
        .hint {
          position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
          background: #111827; color: #e5e7eb;
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 8px 14px; border-radius: 6px; box-shadow: 0 2px 10px rgba(0,0,0,.4);
          pointer-events: none; text-align: center;
        }
      </style>
      <div class="box"></div>
      <div class="badge"></div>
      <div class="hint">↑ parent&nbsp;&nbsp;↓ child&nbsp;&nbsp;← → sibling&nbsp;&nbsp;M mode A/B&nbsp;&nbsp;Enter/click print&nbsp;&nbsp;Esc cancel</div>
    `;
    document.documentElement.appendChild(host);
    return { host, box: shadow.querySelector('.box'), badge: shadow.querySelector('.badge') };
  }

  function updateHighlight() {
    if (!overlay || !STATE.target) return;
    const rect = STATE.target.getBoundingClientRect();
    overlay.box.style.top = rect.top + 'px';
    overlay.box.style.left = rect.left + 'px';
    overlay.box.style.width = rect.width + 'px';
    overlay.box.style.height = rect.height + 'px';
    overlay.box.classList.toggle('warn', !!STATE.hoverBlocked);

    if (STATE.hoverBlocked) {
      overlay.badge.innerHTML = '⛔ Cannot select inside an &lt;iframe&gt; (separate document). Hover over an element outside the frame.';
    } else {
      const selector = shortSelector(STATE.target);
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      overlay.badge.innerHTML = `<b>${escapeHtml(selector)}</b> &nbsp;${w}×${h}px&nbsp; · Mode: ${STATE.mode}`;
    }

    const badgeTop = rect.top > 28 ? rect.top - 26 : rect.bottom + 6;
    overlay.badge.style.top = Math.max(4, badgeTop) + 'px';
    overlay.badge.style.left = Math.max(4, rect.left) + 'px';
  }

  function flashWarning(msg) {
    if (!overlay) return;
    overlay.badge.textContent = msg;
    overlay.box.classList.add('warn');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (STATE.active) updateHighlight(); }, 900);
  }

  function setTarget(el) {
    STATE.hoverBlocked = false;
    STATE.target = el;
    updateHighlight();
  }

  function showIframeWarning(el) {
    STATE.hoverBlocked = true;
    STATE.target = el;
    updateHighlight();
  }

  function focusElement(el) {
    if (!el || el === overlay.host) return;
    if (el.tagName === 'IFRAME') showIframeWarning(el);
    else setTarget(el);
  }

  function navigate(dir) {
    const current = STATE.target;
    if (!current) return;
    let next = null;
    if (dir === 'parent') {
      next = current.parentElement;
    } else if (dir === 'child') {
      const kids = [...current.children].filter((c) => c !== overlay.host);
      next = kids[0] || null;
    } else if (dir === 'prev') {
      next = current.previousElementSibling;
    } else if (dir === 'next') {
      next = current.nextElementSibling;
    }
    if (next && next !== overlay.host) focusElement(next);
  }

  async function confirmSelection() {
    if (STATE.hoverBlocked || !STATE.target) {
      flashWarning('Pick an element outside the blocked frame.');
      return;
    }
    const node = STATE.target;
    const options = Object.assign({}, STATE.options, { mode: STATE.mode, longPage: true });
    stop();
    try {
      await window.__domPdfPrinter.print(node, options);
    } catch (err) {
      console.error('DOM to PDF Picker: printing error', err);
    }
  }

  function onPointerMove(e) {
    const path = e.composedPath();
    const el = path[0];
    if (!(el instanceof Element)) return;
    if (el === STATE.target) return;
    focusElement(el);
  }

  function onReposition() {
    if (STATE.active) updateHighlight();
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // don't hijack system/browser shortcuts
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        stop();
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        confirmSelection();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        navigate('parent');
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        navigate('child');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        navigate('prev');
        break;
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        navigate('next');
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        e.stopPropagation();
        STATE.mode = STATE.mode === 'B' ? 'A' : 'B';
        updateHighlight();
        break;
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const path = e.composedPath();
    const el = path[0];
    if (el instanceof Element) focusElement(el);
    confirmSelection();
  }

  function onMouseDown(e) {
    e.preventDefault();
  }

  async function loadOptions() {
    try {
      const stored = await api.storage.local.get(DEFAULT_OPTIONS);
      return Object.assign({}, DEFAULT_OPTIONS, stored);
    } catch (_) {
      return DEFAULT_OPTIONS;
    }
  }

  let startToken = 0;

  async function start() {
    if (STATE.active) return;
    STATE.active = true;
    const token = ++startToken;
    const options = await loadOptions();
    if (token !== startToken) return; // stop()/another start() happened meanwhile

    STATE.options = options;
    STATE.mode = STATE.options.mode || 'A';
    STATE.hoverBlocked = false;
    STATE.target = document.body;

    overlay = createOverlay();
    updateHighlight();

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition, true);
  }

  function stop() {
    startToken++; // invalidate any start() still awaiting options
    if (!STATE.active) return;
    STATE.active = false;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition, true);
    clearTimeout(flashTimer);
    if (overlay) {
      overlay.host.remove();
      overlay = null;
    }
    STATE.target = null;
  }

  function toggle() {
    if (STATE.active) stop();
    else start();
  }

  window.__domPdfPickerToggle = toggle;
  toggle();
})();
