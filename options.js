// DOM to PDF Picker - options.js
const api = globalThis.browser ?? chrome;

const DEFAULT_OPTIONS = { marginMm: 12, mode: 'A', printBackgrounds: true, includeSourceUrl: false };

const marginInput = document.getElementById('marginMm');
const printBackgroundsInput = document.getElementById('printBackgrounds');
const includeSourceUrlInput = document.getElementById('includeSourceUrl');
const modeRadios = [...document.querySelectorAll('input[name="mode"]')];
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

async function load() {
  const stored = await api.storage.local.get(DEFAULT_OPTIONS);
  const opts = Object.assign({}, DEFAULT_OPTIONS, stored);
  marginInput.value = opts.marginMm;
  printBackgroundsInput.checked = !!opts.printBackgrounds;
  includeSourceUrlInput.checked = !!opts.includeSourceUrl;
  modeRadios.forEach((r) => { r.checked = r.value === opts.mode; });
}

async function save() {
  const marginMm = Math.max(0, Math.min(50, Number(marginInput.value) || 0));
  const mode = (modeRadios.find((r) => r.checked) || {}).value || 'A';
  const options = {
    marginMm,
    mode,
    printBackgrounds: printBackgroundsInput.checked,
    includeSourceUrl: includeSourceUrlInput.checked
  };
  await api.storage.local.set(options);
  statusEl.hidden = false;
  clearTimeout(save._t);
  save._t = setTimeout(() => { statusEl.hidden = true; }, 1800);
}

saveBtn.addEventListener('click', save);
load();
