# DOM to PDF Picker

A browser extension (Chrome + Firefox, Manifest V3) for picking any DOM
element on a page and saving it as a PDF **with selectable text and
images** — no rasterization at all.

Zero external dependencies, zero npm, plain vanilla JS. Saving to PDF is
done exclusively through the browser's native `window.print()` with an
injected `@media print` stylesheet — it does **not** use html2canvas,
jsPDF, html2pdf, or any other rasterization library.

## File structure

| File                     | Role |
|--------------------------|------|
| `manifest.chrome.json`   | MV3 manifest for Chrome (`background.service_worker`) |
| `manifest.firefox.json`  | MV3 manifest for Firefox (`background.scripts`, `browser_specific_settings.gecko.id`) |
| `background.js`          | Handles the icon click, the context menu and the shortcut; injects `printer.js` + `picker.js` |
| `picker.js`              | Element-picking overlay: hover, keyboard navigation, badge |
| `printer.js`             | Builds the print rules, prepares content, `window.print()`, cleanup |
| `options.html/.js`       | Settings page: margins, mode A/B, backgrounds, source URL |
| `icons/`                 | SVG + PNG icons, 16/48/128 |

Both manifests reference the same `.js` files — the difference is
**only** in how the background is declared (`service_worker` vs `scripts`)
and the `browser_specific_settings` field. The code everywhere uses:

```js
const api = globalThis.browser ?? chrome;
```

Permissions: `activeTab`, `scripting`, `commands`, `storage`, `contextMenus`.
No `host_permissions`, no network requests, no telemetry.

## Installation

Chrome and Firefox only accept a manifest file named **`manifest.json`**,
so before loading the extension you need to copy the right file under that
name (in the same folder, next to the other files).

### Chrome (or Edge/Brave — any Chromium-based browser)

1. Copy the Chrome manifest under the target name:
   - macOS/Linux: `cp manifest.chrome.json manifest.json`
   - Windows (PowerShell): `Copy-Item manifest.chrome.json manifest.json`
2. Open `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. The extension's icon appears in the toolbar.

### Firefox

1. Copy the Firefox manifest under the target name:
   - macOS/Linux: `cp manifest.firefox.json manifest.json`
   - Windows (PowerShell): `Copy-Item manifest.firefox.json manifest.json`
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select the `manifest.json` file in
   this folder.
4. The extension is loaded temporarily — it disappears on Firefox restart
   (normal for unsigned add-ons loaded this way). Permanent installation
   requires signing through addons.mozilla.org (out of scope for this
   project).

> Tip: if you want both versions ready at the same time, create two
> folders (e.g. `build-chrome/`, `build-firefox/`) with a copy of all the
> files and the corresponding manifest named `manifest.json` in each.

## Usage

### Three ways to start it

All three do exactly the same thing: they start the picker, and printing
always produces a single continuous **"long page"** PDF (see below) — there
is no method to choose.

1. **Right-click** — right-click anywhere on the page and click **"Pick
   element for PDF (long page)"**.
2. **The extension icon** — click it.
3. **Alt+Shift+P shortcut.**

### Picking the element

1. Once started, hover over page elements — the one under the cursor gets
   highlighted, and a badge shows its selector, size in px, and the
   current print mode (A/B).
2. Keyboard navigation (without touching the mouse):
   - **↑** — go to the parent
   - **↓** — go to the first child
   - **←** / **→** — previous / next sibling
   - **M** — toggle print mode A/B for this pick only
3. **Enter** or a **click** confirms the selection and opens the browser's
   native print dialog with just the selected fragment.
4. **Esc** cancels — the page returns exactly to the state it was in
   before you started, with no leftover styles or attributes.
5. In the print dialog, choose **Save as PDF** as the destination.

## Long page printing

Every printout produces a single continuous page instead of being split
across A4/Letter sheets: the extension measures the full height of the
selected element and injects a custom `@page { size: 210mm <content
height>mm; }` rule, so the entire content fits on one continuous PDF page.

Notes:
- This only works correctly if you choose **"Save as PDF"** as the print
  destination — a physical printer doesn't support paper of that length.
- The paper size shown in the print dialog will switch to "Custom" — this
  is expected.
- The height is **estimated** from the on-screen rendering
  (`scrollHeight`/element height), so with very unusual layouts it may be
  slightly off — adjust the margin in the options if needed.
- There's an upper bound of roughly 5 meters of page height (a safeguard
  against browser limits) — longer content is clamped to that value.

## Mode A vs. Mode B

- **Mode A — in-place (default).** The selected element and its entire
  ancestor chain up to `<html>` are marked with attributes (`data-pick*`).
  An injected `<style media="print">` hides (`display:none`) the siblings
  of every ancestor (not `visibility:hidden`, so it doesn't leave blank
  pages), neutralizes the ancestors (`position:static`,
  `overflow:visible`, zeroed margins/paddings) and stretches the selected
  element (`width:100%`). Everything is removed on `afterprint`, and the
  page returns to its original state. This is the most faithful variant,
  since it prints the real, styled document.
- **Mode B — isolated fallback.** The selected element is deep-cloned
  into a hidden frame, and each cloned node gets only the print-relevant
  CSS properties written inline (based on `getComputedStyle` of the
  original). Image URLs are made absolute, `<canvas>` elements are
  replaced with `<img>`. Only that frame is printed — useful when a page
  has very aggressive, hard-to-override CSS that keeps Mode A from
  producing a clean result.

You set the default mode in the extension's options; it can also be
switched once, for a single pick, with the **M** key (shown on the picker
badge).

## Settings (options page)

- **Page margin (mm)** — the value inserted into the `@page { margin }`
  rule.
- **Print mode A/B** — the default mode described above.
- **Force background colors/images** — adds
  `print-color-adjust: exact` to the printed content.
- **Append the source page URL** — appends `location.href` below the
  printed content.

### Important: background graphics in the PDF

Even with "Force background colors/images" enabled, background colors and
images (`background-color`, `background-image`) will only actually show
up in the resulting PDF **if** you also enable **"Background graphics"**
in the browser's native print dialog (under "More settings"). That
setting belongs to the browser and can't be turned on programmatically
from the page — the CSS only tells the browser "if you're printing
backgrounds, do it exactly", it doesn't force the decision to print them
in the first place.

## Edge cases — how they're handled

- **Lazy-loaded images** — before printing, every `<img>` in the selected
  fragment gets `loading="eager"`, and the extension waits for all images
  to load and `decode()`.
- **Scrolling containers** — elements with scrolling (`overflow:
  auto/scroll` and actual overflow content) get `overflow:visible;
  height:auto`, so the PDF doesn't clip content to the on-screen window
  height.
- **`position:fixed` / `sticky` inside the selection** — switched to
  `static`, so the element doesn't repeat on every printed page.
- **`<canvas>`** — replaced with an `<img>` generated via `toDataURL()`
  (temporarily in the live DOM for Mode A, only in the clone for Mode B) —
  after printing, Mode A restores the original `<canvas>`. A canvas
  "tainted" by cross-origin content (`toDataURL` throws) is skipped.
- **Shadow DOM** — the picker detects the element under the cursor via
  `event.composedPath()`, so it correctly highlights elements inside open
  Shadow Roots. The printer also walks through `element.shadowRoot` while
  scanning/cloning. Closed Shadow Roots are inherently inaccessible from
  the outside and are not supported.
- **Foreign `<iframe>`s** — the picker blocks selecting inside a frame
  (a separate document, out of the script's reach) and shows a red badge
  explaining why: "Cannot select inside an `<iframe>` — hover over an
  element outside the frame." In Mode B, any `<iframe>` encountered in the
  cloned subtree is replaced with a visible placeholder carrying the same
  message.

## Out of scope (deliberately not implemented)

- No custom PDF renderer — the PDF is always produced through the
  browser's native print ("Save as PDF").
- No headers, footers, or page numbering.
- No saving multiple elements into a single PDF.
- No automatic saving without the print dialog — the print dialog always
  opens.
- No support for `chrome://`, `about:`, `edge://` pages, etc. — this is a
  platform limitation of extensions; scripts simply can't be injected
  there.
- Closed Shadow DOM and cross-origin-"tainted" `<canvas>` are not
  supported (platform limitations that can't be worked around without
  network permissions).

## Troubleshooting

- **Icon/context menu/shortcut does nothing** — check that the tab is a
  regular `http(s)://` page (not `chrome://`, not the extensions store,
  not the new-tab page). Check the service worker console (Chrome:
  `chrome://extensions` → "Details" → "Service worker" → "Inspect") for a
  warning about a blocked page.
- **Context menu shows a duplicate/stale entry after code changes** —
  reload the extension in `chrome://extensions` (or `about:debugging` in
  Firefox); `background.js` clears and rebuilds the menu on every start,
  so after a reload it goes back to a single, up-to-date entry.
- **PDF has no background colors** — see "Important: background graphics
  in the PDF" above.
- **Element looks different from on-screen** — try Mode B (`M` key while
  picking) — it helps when a page has very specific CSS rules that are
  hard to override in Mode A.
