# DOM to PDF Picker

Browser extension (Chrome + Firefox, Manifest V3). Pick any element on a
page and save it as a PDF with real, selectable text and images - via the
browser's native print dialog, no rasterization, no dependencies.

![Demo](demo.gif)

## Installing it

Chrome/Firefox both need the manifest named `manifest.json`, so copy the
right one first:

- Chrome/Edge/Brave: `cp manifest.chrome.json manifest.json`, then
  `chrome://extensions` -> Developer mode -> Load unpacked -> this folder.
- Firefox: `cp manifest.firefox.json manifest.json`, then
  `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on ->
  pick `manifest.json`.

## Using it

Right-click a page and pick "Pick element for PDF (long page)", click the
toolbar icon, or hit Alt+Shift+P. Then:

- Hover to highlight elements; arrow keys walk the DOM (up/down =
  parent/child, left/right = siblings).
- Enter or click confirms and opens the print dialog - choose "Save as PDF".
- Esc cancels.

Printing always produces one continuous "long page" PDF instead of
splitting across A4/Letter sheets - the extension measures the element's
height and sets a custom `@page` size to match.

## Options

Margin size, forcing background colors (`print-color-adjust: exact`, still
needs "Background graphics" enabled in the browser's print dialog), and
appending the source URL below the printed content.

## Limitations

No custom PDF engine (always the browser's own print-to-PDF), no
headers/footers/page numbers, no `chrome://`/`about:` pages, closed
Shadow DOM and cross-origin-tainted canvases aren't supported.
