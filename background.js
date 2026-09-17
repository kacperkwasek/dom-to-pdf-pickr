// DOM to PDF Picker - background/service worker
// Reacts to: the toolbar icon click, the right-click context menu and the
// keyboard shortcut. All three do exactly the same thing: inject
// printer.js + picker.js into the active tab and toggle the picker, always
// producing a single continuous "long page" PDF.
// No network access, no telemetry, no host_permissions.

const api = globalThis.browser ?? chrome;

const BLOCKED_PROTOCOLS = /^(chrome|chrome-extension|edge|about|moz-extension|devtools|view-source):/i;

async function activate(tab) {
  if (!tab || !tab.id) return;
  if (tab.url && BLOCKED_PROTOCOLS.test(tab.url)) {
    console.warn('DOM to PDF Picker: cannot run on this page (%s).', tab.url);
    return;
  }

  try {
    // Order matters: printer.js defines window.__domPdfPrinter, which
    // picker.js uses once the user confirms a selection (Enter/click).
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['printer.js'] });
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
  } catch (err) {
    console.warn('DOM to PDF Picker: could not start on this tab.', err);
  }
}

// ---------- Toolbar icon ----------

api.action.onClicked.addListener((tab) => {
  activate(tab);
});

// ---------- Context menu (right mouse button) ----------

async function setupContextMenu() {
  try {
    await api.contextMenus.removeAll();
  } catch (_) { /* ignore - e.g. first run */ }

  api.contextMenus.create({
    id: 'dom-pdf-pick',
    title: 'Pick element for PDF (long page)',
    contexts: ['all']
  });
}

setupContextMenu();

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'dom-pdf-pick') activate(tab);
});

// ---------- Keyboard shortcut ----------

api.commands.onCommand.addListener(async (command, commandTab) => {
  if (command !== 'toggle-picker') return;
  let tab = commandTab;
  if (!tab) {
    const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  }
  activate(tab);
});
