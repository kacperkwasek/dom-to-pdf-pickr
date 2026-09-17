// Mode A prints the page in place (marks the target + ancestors with
// attributes and injects a print stylesheet). Mode B clones the target
// into a hidden iframe with styles inlined and prints just that.
(function () {
  if (window.__domPdfPrinter) return; // already injected in this page session

  const MARK_TARGET = 'data-pick';
  const MARK_ANCESTOR = 'data-pick-anc';
  const MARK_FIXED = 'data-pick-fixed';
  const MARK_SCROLL = 'data-pick-scroll';
  const MARK_HIDE = 'data-pick-hide';
  const MARK_CANVAS_ORIG = 'data-pick-canvas-original';
  const MARK_CANVAS_IMG = 'data-pick-canvas-replacement';
  const MARK_FOOTER = 'data-pick-footer';
  const MARK_STYLE = 'data-pick-style';

  const PRINT_PROPS = [
    'display', 'position', 'top', 'left', 'right', 'bottom', 'float', 'clear',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'box-sizing', 'background-color', 'background-image', 'background-repeat', 'background-size', 'background-position',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'letter-spacing',
    'text-align', 'text-decoration-line', 'text-transform', 'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
    'list-style-type', 'list-style-position',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'gap', 'row-gap', 'column-gap',
    'table-layout', 'border-collapse', 'border-spacing',
    'object-fit', 'object-position', 'opacity', 'z-index', 'overflow'
  ];

  let activeState = null;

  const MM_PER_PX = 25.4 / 96; // 1 CSS px = 1/96 inch, independent of actual screen DPI
  const LONG_PAGE_WIDTH_MM = 210; // fixed "sheet" width (like A4) - only the height varies
  const LONG_PAGE_MAX_HEIGHT_MM = 5000; // ~5 m - a sane upper bound (browsers have their own caps too)

  function computeLongPageHeightMm(node, marginMm) {
    const rect = node.getBoundingClientRect();
    const heightPx = Math.max(node.scrollHeight || 0, rect.height || 0);
    const contentMm = heightPx * MM_PER_PX;
    const heightMm = Math.ceil(contentMm + marginMm * 2 + 5); // +5mm slack for rounding
    return Math.min(LONG_PAGE_MAX_HEIGHT_MM, Math.max(heightMm, marginMm * 2 + 20));
  }

  function buildPageRule(opts, node) {
    const margin = Number(opts.marginMm);
    const marginMm = Number.isFinite(margin) && margin >= 0 ? margin : 12;
    if (opts.longPage && node) {
      const heightMm = computeLongPageHeightMm(node, marginMm);
      return `@page { size: ${LONG_PAGE_WIDTH_MM}mm ${heightMm}mm; margin: ${marginMm}mm; }`;
    }
    return `@page { margin: ${marginMm}mm; }`;
  }

  function isScrollableEl(el, cs) {
    const overflow = cs.overflow || '';
    const overflowY = cs.overflowY || '';
    const scrolls = /(auto|scroll)/.test(overflow) || /(auto|scroll)/.test(overflowY);
    return scrolls && el.scrollHeight > el.clientHeight + 1;
  }

  // Walks the tree (including open shadow roots) collecting images,
  // canvases, fixed/scrollable elements and any shadow roots we passed
  // through, since styles in document.head don't pierce shadow DOM.
  function scanSubtree(root) {
    const images = [];
    const canvases = [];
    const fixedEls = [];
    const scrollEls = [];
    const shadowRoots = [];

    function walk(node) {
      if (!node || node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'IMG') images.push(node);
      if (tag === 'CANVAS') canvases.push(node);

      if (node !== root) {
        const cs = getComputedStyle(node);
        if (cs.position === 'fixed' || cs.position === 'sticky') fixedEls.push(node);
        if (isScrollableEl(node, cs)) scrollEls.push(node);
      }

      if (node.shadowRoot) {
        shadowRoots.push(node.shadowRoot);
        for (const child of node.shadowRoot.children) walk(child);
      }
      for (const child of node.children) walk(child);
    }

    walk(root);
    return { images, canvases, fixedEls, scrollEls, shadowRoots };
  }

  // Walks up to <html>, crossing shadow boundaries via .getRootNode().host
  // when parentElement is null. Also returns the shadow roots crossed and
  // the sibling nodes at each boundary, since those aren't reachable by
  // the "[data-pick-anc] > *" rule alone.
  function collectAncestorChain(node) {
    const ancestors = [];
    const shadowRoots = [];
    const extraHidden = [];
    let cur = node;
    while (true) {
      const parent = cur.parentElement;
      if (parent) {
        ancestors.push(parent);
        cur = parent;
        continue;
      }
      const root = cur.getRootNode();
      if (root && root.host) {
        shadowRoots.push(root);
        for (const sibling of root.children) {
          if (sibling !== cur) extraHidden.push(sibling);
        }
        ancestors.push(root.host);
        cur = root.host;
        continue;
      }
      break;
    }
    return { ancestors, shadowRoots, extraHidden };
  }

  async function waitForImages(images) {
    await Promise.all(images.map(async (img) => {
      try {
        if (img.loading === 'lazy') img.loading = 'eager';
        if (!img.complete) {
          await new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        }
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
      } catch (_) { /* one bad image shouldn't block the rest */ }
    }));
  }

  function replaceCanvasesLive(canvases) {
    const restores = [];
    for (const canvas of canvases) {
      let dataUrl = null;
      try { dataUrl = canvas.toDataURL('image/png'); } catch (_) { /* tainted canvas - skip it */ }
      if (!dataUrl) continue;
      const cs = getComputedStyle(canvas);
      const img = document.createElement('img');
      img.src = dataUrl;
      img.setAttribute(MARK_CANVAS_IMG, '1');
      img.style.cssText = `width:${cs.width};height:${cs.height};display:${cs.display === 'inline' ? 'inline-block' : cs.display};`;
      canvas.insertAdjacentElement('afterend', img);
      canvas.setAttribute(MARK_CANVAS_ORIG, '1');
      canvas.style.setProperty('display', 'none', 'important');
      restores.push({ canvas, img });
    }
    return restores;
  }

  function restoreCanvasesLive(restores) {
    for (const { canvas, img } of restores) {
      img.remove();
      canvas.style.removeProperty('display');
      canvas.removeAttribute(MARK_CANVAS_ORIG);
    }
  }

  function buildPrintCss(opts, node) {
    const colorAdjust = opts.printBackgrounds
      ? `* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }`
      : '';
    const pageRule = buildPageRule(opts, node);

    return `
${pageRule}
@media print {
  html, body { height: auto !important; overflow: visible !important; }
  [${MARK_ANCESTOR}] > *:not([${MARK_TARGET}]):not([${MARK_ANCESTOR}]) { display: none !important; }
  [${MARK_ANCESTOR}] {
    position: static !important;
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
    transform: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  [${MARK_TARGET}] {
    width: 100% !important;
    max-width: none !important;
    break-inside: auto !important;
    position: static !important;
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
    transform: none !important;
  }
  [${MARK_FIXED}] { position: static !important; top: auto !important; left: auto !important; }
  [${MARK_SCROLL}] { overflow: visible !important; height: auto !important; max-height: none !important; }
  [${MARK_HIDE}] { display: none !important; }
  [${MARK_CANVAS_ORIG}] { display: none !important; }
  [${MARK_FOOTER}] { display: block !important; margin-top: 8px; font-size: 10px; color: #666; }
  ${colorAdjust}
}`;
  }

  async function printModeA(node, opts) {
    if (activeState) cleanupActive();

    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    const { images, canvases, fixedEls, scrollEls, shadowRoots: descendantShadowRoots } = scanSubtree(node);
    await waitForImages(images);
    const canvasRestores = replaceCanvasesLive(canvases);

    fixedEls.forEach((el) => el.setAttribute(MARK_FIXED, '1'));
    scrollEls.forEach((el) => el.setAttribute(MARK_SCROLL, '1'));

    const { ancestors, shadowRoots: ancestorShadowRoots, extraHidden } = collectAncestorChain(node);
    ancestors.forEach((el) => el.setAttribute(MARK_ANCESTOR, '1'));
    extraHidden.forEach((el) => el.setAttribute(MARK_HIDE, '1'));
    node.setAttribute(MARK_TARGET, '1');

    // needs a copy of the stylesheet in every shadow root we crossed too
    const styleTargets = new Set([document.head, ...ancestorShadowRoots, ...descendantShadowRoots]);
    const cssText = buildPrintCss(opts, node);
    const styleEls = [...styleTargets].map((target) => {
      const styleEl = document.createElement('style');
      styleEl.setAttribute(MARK_STYLE, '1');
      styleEl.media = 'print';
      styleEl.textContent = cssText;
      target.appendChild(styleEl);
      return styleEl;
    });

    let footer = null;
    if (opts.includeSourceUrl) {
      footer = document.createElement('div');
      footer.setAttribute(MARK_FOOTER, '1');
      footer.style.display = 'none';
      footer.textContent = location.href;
      node.appendChild(footer);
    }

    const state = { mode: 'A', node, ancestors, extraHidden, fixedEls, scrollEls, canvasRestores, styleEls, footer };
    activeState = state;

    const onAfterPrint = () => {
      window.removeEventListener('afterprint', onAfterPrint);
      if (activeState === state) cleanupActive();
    };
    window.addEventListener('afterprint', onAfterPrint);

    await nextPaint();
    window.print();
    // fallback in case afterprint never fires
    setTimeout(() => {
      if (activeState === state) cleanupActive();
    }, 60000);
  }

  function cleanupActive() {
    const state = activeState;
    activeState = null;
    if (!state) return;

    if (state.mode === 'A') {
      state.styleEls.forEach((el) => el.remove());
      state.node.removeAttribute(MARK_TARGET);
      state.ancestors.forEach((el) => el.removeAttribute(MARK_ANCESTOR));
      state.extraHidden.forEach((el) => el.removeAttribute(MARK_HIDE));
      state.fixedEls.forEach((el) => el.removeAttribute(MARK_FIXED));
      state.scrollEls.forEach((el) => el.removeAttribute(MARK_SCROLL));
      restoreCanvasesLive(state.canvasRestores);
      if (state.footer) state.footer.remove();
    } else if (state.mode === 'B') {
      state.iframe.remove();
    }
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function applyPrintStyles(src, dst) {
    const cs = getComputedStyle(src);
    for (const prop of PRINT_PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val) {
        try { dst.style.setProperty(prop, val); } catch (_) { /* unsupported property */ }
      }
    }
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      dst.style.setProperty('position', 'static');
      dst.style.setProperty('top', 'auto');
      dst.style.setProperty('left', 'auto');
    }
    if (isScrollableEl(src, cs)) {
      dst.style.setProperty('overflow', 'visible');
      dst.style.setProperty('height', 'auto');
      dst.style.setProperty('max-height', 'none');
    }
  }

  function absoluteUrl(url) {
    try { return new URL(url, location.href).href; } catch (_) { return url; }
  }

  function cloneComposed(node, doc) {
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toLowerCase();

    if (tag === 'iframe') {
      const placeholder = doc.createElement('div');
      placeholder.textContent = '[nested <iframe> skipped]';
      placeholder.style.cssText = 'border:1px dashed #999;padding:6px;font-size:11px;color:#888;';
      return placeholder;
    }

    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'link') {
      return null; // not relevant for printing, and link/script could attempt network access
    }

    if (tag === 'canvas') {
      let dataUrl = null;
      try { dataUrl = node.toDataURL('image/png'); } catch (_) { /* tainted canvas */ }
      if (dataUrl) {
        const img = doc.createElement('img');
        img.src = dataUrl;
        if (node.style.width) img.style.width = node.style.width; else img.style.width = node.width + 'px';
        if (node.style.height) img.style.height = node.style.height; else img.style.height = node.height + 'px';
        return img;
      }
    }

    const clone = doc.createElement(tag);

    if (tag === 'img') {
      const src = node.currentSrc || node.src;
      if (src) clone.setAttribute('src', absoluteUrl(src));
      const alt = node.getAttribute('alt');
      if (alt) clone.setAttribute('alt', alt);
    } else if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href) clone.setAttribute('href', absoluteUrl(href));
    }

    applyPrintStyles(node, clone);

    const childRoot = node.shadowRoot ? node.shadowRoot : node;
    for (const child of childRoot.childNodes) {
      const c = cloneComposed(child, doc);
      if (c) clone.appendChild(c);
    }
    return clone;
  }

  async function printModeB(node, opts) {
    if (activeState) cleanupActive();

    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const { images } = scanSubtree(node);
    await waitForImages(images);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-pick-frame', '1');
    iframe.style.cssText = 'position:fixed; top:0; left:-99999px; width:1px; height:1px; border:0; visibility:hidden;';
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument;
    idoc.open();
    idoc.write('<!doctype html><html><head><meta charset="utf-8"><title>Print</title></head><body></body></html>');
    idoc.close();

    const clone = cloneComposed(node, idoc);
    idoc.body.appendChild(clone);

    const pageRule = buildPageRule(opts, node);
    const style = idoc.createElement('style');
    style.textContent = `
      ${pageRule}
      html, body { margin: 0; padding: 0; background: #fff; }
      body { -webkit-print-color-adjust: ${opts.printBackgrounds ? 'exact' : 'economy'}; print-color-adjust: ${opts.printBackgrounds ? 'exact' : 'economy'}; }
      img { max-width: 100%; }
    `;
    idoc.head.appendChild(style);

    if (opts.includeSourceUrl) {
      const footer = idoc.createElement('div');
      footer.style.cssText = 'margin-top:8px; font-size:10px; color:#666;';
      footer.textContent = location.href;
      idoc.body.appendChild(footer);
    }

    const state = { mode: 'B', iframe };
    activeState = state;

    const iwin = iframe.contentWindow;
    const onAfterPrint = () => {
      iwin.removeEventListener('afterprint', onAfterPrint);
      if (activeState === state) cleanupActive();
    };
    iwin.addEventListener('afterprint', onAfterPrint);

    await nextPaint();
    iwin.focus();
    iwin.print();
    setTimeout(() => {
      if (activeState === state) cleanupActive();
    }, 60000);
  }

  window.__domPdfPrinter = {
    async print(node, opts) {
      const options = Object.assign({ marginMm: 12, mode: 'A', printBackgrounds: true, includeSourceUrl: false, longPage: true }, opts || {});
      if (options.mode === 'B') return printModeB(node, options);
      return printModeA(node, options);
    },
    cancel() {
      if (activeState) cleanupActive();
    }
  };
})();
