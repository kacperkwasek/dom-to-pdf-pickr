# DOM to PDF Picker (Firefox build)

Browser extension (Manifest V3, Firefox). Pick any element on a page and
save it as a PDF with real, selectable text and images - via the
browser's native print dialog, no rasterization, no dependencies.

This is the Firefox branch - `manifest.json` here uses
`background.scripts` plus `browser_specific_settings.gecko.id`. There's a
separate `chromium` branch with the `background.service_worker` variant;
the rest of the code is identical.

![Demo](demo.gif)

## Installing it

Open `about:debugging#/runtime/this-firefox`, click Load Temporary Add-on
and pick `manifest.json` in this folder. It unloads when Firefox restarts
since it's not signed - that's normal for a temporary install. Permanent
installation needs signing through addons.mozilla.org.

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
