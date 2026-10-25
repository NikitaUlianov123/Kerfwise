import { parseLength, formatLength, convertText, UNITS } from './units.js';
import { esc, partHue, groupSheets, sheetSvg, cutTable, partCounts, usefulOffcuts } from './render.js';
import { parsePasteLine } from './paste.js';
import { solve } from './packer.js';
import { verifySolution } from './verify.js';

const STORAGE_KEY = 'kerfwise-v1';
const MAX_ITEMS = 5000;
const DEBOUNCE_MS = 350;

const DEFAULT_STATE = {
  unit: 'in',
  effort: 'normal',
  sheetLength: '96',
  sheetWidth: '48',
  kerf: '1/8',
  trim: '0',
  sheetGrain: true,
  parts: [
    { label: 'Side', length: '72', width: '11 1/4', qty: '2', grain: true },
    { label: 'Shelf', length: '34 1/2', width: '11 1/4', qty: '5', grain: true },
    { label: 'Top', length: '36', width: '12', qty: '1', grain: true },
    { label: 'Back', length: '72', width: '35', qty: '1', grain: true },
    { label: 'Drawer side', length: '16', width: '4 1/2', qty: '8', grain: false },
  ],
};

const $ = (id) => document.getElementById(id);

let state = null;
let rowSeq = 0;
let worker = null;
let jobId = 0;
let timer = null;

function freshRow(values) {
  rowSeq++;
  return { id: `r${rowSeq}`, label: '', length: '', width: '', qty: '1', grain: true, ...values };
}

function cloneDefault() {
  const s = JSON.parse(JSON.stringify(DEFAULT_STATE));
  s.parts = s.parts.map((p) => freshRow(p));
  return s;
}

function normalizeState(raw) {
  const base = cloneDefault();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const out = { ...base };
  for (const key of ['sheetLength', 'sheetWidth', 'kerf', 'trim']) {
    if (typeof raw[key] === 'string') {
      out[key] = raw[key];
    }
  }
  if (raw.unit === 'in' || raw.unit === 'mm') {
    out.unit = raw.unit;
  }
  if (raw.effort === 'quick' || raw.effort === 'normal' || raw.effort === 'thorough') {
    out.effort = raw.effort;
  }
  if (typeof raw.sheetGrain === 'boolean') {
    out.sheetGrain = raw.sheetGrain;
  }
  if (Array.isArray(raw.parts)) {
    out.parts = raw.parts
      .filter((p) => p && typeof p === 'object')
      .map((p) =>
        freshRow({
          label: String(p.label ?? ''),
          length: String(p.length ?? ''),
          width: String(p.width ?? ''),
          qty: String(p.qty ?? '1'),
          grain: p.grain !== false,
        }),
      );
  }
  return out;
}

function serializable() {
  return {
    unit: state.unit,
    effort: state.effort,
    sheetLength: state.sheetLength,
    sheetWidth: state.sheetWidth,
    kerf: state.kerf,
    trim: state.trim,
    sheetGrain: state.sheetGrain,
    parts: state.parts.map(({ label, length, width, qty, grain }) => ({ label, length, width, qty, grain })),
  };
}

function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function loadState() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('s=')) {
    try {
      return normalizeState(decodeShare(hash.slice(2)));
    } catch {
      // A damaged link falls back to the saved state.
    }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return normalizeState(JSON.parse(saved));
    }
  } catch {
    // Storage can be blocked; the default example is used.
  }
  return cloneDefault();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable()));
  } catch {
    // Not saved when storage is blocked; the page still works.
  }
}

// ===== Parts table =========================================================

function rowIsBlank(row) {
  return row.label.trim() === '' && row.length.trim() === '' && row.width.trim() === '';
}

function renderRows() {
  const tbody = $('parts').querySelector('tbody');
  tbody.innerHTML = state.parts
    .map((row) => {
      let checked = '';
      if (row.grain) {
        checked = ' checked';
      }
      return (
        `<tr data-id="${row.id}">` +
        `<td><input data-field="label" value="${esc(row.label)}" aria-label="Label" autocomplete="off"></td>` +
        `<td><input data-field="length" value="${esc(row.length)}" aria-label="Length" inputmode="decimal" autocomplete="off"></td>` +
        `<td><input data-field="width" value="${esc(row.width)}" aria-label="Width" inputmode="decimal" autocomplete="off"></td>` +
        `<td><input data-field="qty" value="${esc(row.qty)}" aria-label="Quantity" inputmode="numeric" class="qty" autocomplete="off"></td>` +
        `<td class="center"><input type="checkbox" data-field="grain" aria-label="Grain locked"${checked}></td>` +
        `<td><button type="button" class="icon remove" aria-label="Remove part" title="Remove part">×</button></td>` +
        '</tr>'
      );
    })
    .join('');
}

function findRow(id) {
  return state.parts.find((r) => r.id === id);
}

// ===== Input collection ====================================================

function parseQty(text) {
  const t = String(text).trim();
  if (!/^\d+$/.test(t)) {
    return null;
  }
  const n = Number(t);
  if (n < 1) {
    return null;
  }
  return n;
}

function collectInput() {
  const unit = state.unit;
  const errors = [];
  const fieldErrors = new Map();
  const mark = (key, message) => {
    fieldErrors.set(key, message);
    errors.push(message);
  };

  const sheetLength = parseLength(state.sheetLength, unit);
  const sheetWidth = parseLength(state.sheetWidth, unit);
  const kerf = parseLength(state.kerf, unit);
  const trim = parseLength(state.trim, unit);
  if (sheetLength === null || sheetLength <= 0) {
    mark('sheet-length', 'Enter a sheet length more than zero.');
  }
  if (sheetWidth === null || sheetWidth <= 0) {
    mark('sheet-width', 'Enter a sheet width more than zero.');
  }
  if (kerf === null) {
    mark('kerf', 'Enter a blade width (0 is allowed).');
  }
  if (trim === null) {
    mark('trim', 'Enter an edge trim (0 is allowed).');
  }

  if (sheetLength > 0 && sheetWidth > 0 && trim !== null) {
    if (2 * trim >= sheetLength || 2 * trim >= sheetWidth) {
      mark('trim', 'Edge trim removes the full sheet.');
    }
  }

  const parts = [];
  let total = 0;
  state.parts.forEach((row, index) => {
    if (rowIsBlank(row)) {
      return;
    }
    let label = row.label.trim();
    if (label === '') {
      label = `Part ${index + 1}`;
    }
    const length = parseLength(row.length, unit);
    const width = parseLength(row.width, unit);
    const qty = parseQty(row.qty);
    if (length === null || length <= 0) {
      mark(`${row.id}:length`, `${label}: enter a length more than zero.`);
    }
    if (width === null || width <= 0) {
      mark(`${row.id}:width`, `${label}: enter a width more than zero.`);
    }
    if (qty === null) {
      mark(`${row.id}:qty`, `${label}: quantity must be a whole number, 1 or more.`);
    } else {
      total += qty;
    }
    parts.push({ id: row.id, label, length, width, qty, grain: row.grain });
  });
  if (total > MAX_ITEMS) {
    errors.push(`Total quantity is ${total}. The limit is ${MAX_ITEMS}.`);
  }
  const input = { sheet: { length: sheetLength, width: sheetWidth }, kerf, trim, sheetGrain: state.sheetGrain, parts };
  return { input, errors, fieldErrors };
}

function showFieldErrors(fieldErrors) {
  for (const el of document.querySelectorAll('.invalid')) {
    el.classList.remove('invalid');
    el.removeAttribute('title');
  }
  for (const [key, message] of fieldErrors) {
    let el = null;
    if (key.includes(':')) {
      const [rowId, field] = key.split(':');
      el = document.querySelector(`tr[data-id="${rowId}"] input[data-field="${field}"]`);
    } else {
      el = $(key);
    }
    if (el) {
      el.classList.add('invalid');
      el.title = message;
    }
  }
}

// ===== Solving =============================================================

function ensureWorker() {
  if (worker) {
    return worker;
  }
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = onWorkerMessage;
  worker.onerror = () => {
    setStatus('The optimizer stopped with an error. Reload the page to try again.', 'error');
    worker = null;
  };
  return worker;
}

function cancelWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

let lastInput = null;

function schedule() {
  saveState();
  clearTimeout(timer);
  timer = setTimeout(runSolve, DEBOUNCE_MS);
}

function runSolve() {
  const { input, errors, fieldErrors } = collectInput();
  showFieldErrors(fieldErrors);
  const list = $('input-errors');
  list.innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
  cancelWorker();
  if (errors.length > 0) {
    setStatus('Fix the marked fields to see a plan.', 'error');
    clearResults();
    return;
  }
  if (input.parts.length === 0) {
    setStatus('Add parts to see a plan.', '');
    clearResults();
    return;
  }
  jobId++;
  lastInput = input;
  setStatus('Optimizing…', 'busy');
  document.body.classList.add('solving');
  const options = { effort: state.effort };
  const w = ensureWorker();
  if (w) {
    w.postMessage({ id: jobId, input, options });
    return;
  }
  // No worker support: solve on the page with a short budget so it stays responsive.
  const id = jobId;
  setTimeout(() => {
    const result = solve(input, { timeLimitMs: 400 });
    let problems = [];
    if (!result.errors) {
      problems = verifySolution(input, result);
    }
    onWorkerMessage({ data: { id, result, problems } });
  }, 0);
}

function onWorkerMessage(event) {
  const { id, result, problems, failure } = event.data;
  if (id !== jobId) {
    return;
  }
  document.body.classList.remove('solving');
  if (failure) {
    setStatus(`The optimizer failed: ${failure}`, 'error');
    return;
  }
  if (result.errors) {
    setStatus('Fix the input problems to see a plan.', 'error');
    $('input-errors').innerHTML = result.errors.map((e) => `<li>${esc(e)}</li>`).join('');
    clearResults();
    return;
  }
  renderResult(lastInput, result, problems);
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function clearResults() {
  $('summary').innerHTML = '';
  $('warnings').innerHTML = '';
  $('sheets').innerHTML = '';
}

// ===== Results =============================================================

function tile(value, label, title) {
  let t = '';
  if (title) {
    t = ` title="${esc(title)}"`;
  }
  return `<div class="tile"${t}><div class="tile-value">${esc(value)}</div><div class="tile-label">${esc(label)}</div></div>`;
}

function renderResult(input, result, problems) {
  const unit = state.unit;
  const fmt = (v) => formatLength(v, unit);
  const st = result.stats;
  const requested = input.parts.reduce((n, p) => n + p.qty, 0);
  const hues = new Map();
  input.parts.forEach((p, i) => hues.set(p.id, partHue(i)));

  let boundNote = 'The plan uses the fewest sheets possible.';
  if (st.sheetCount > st.lowerBound) {
    boundNote = `Total part area needs at least ${st.lowerBound}. Fit and blade width can make more necessary.`;
  }
  const cutLen = st.cutLength / UNITS[unit].scale;
  let cutLenText = '';
  if (unit === 'in') {
    cutLenText = `${(cutLen / 12).toFixed(1)} ft`;
  } else {
    cutLenText = `${(cutLen / 1000).toFixed(1)} m`;
  }
  $('summary').innerHTML =
    tile(String(st.sheetCount), 'sheets', boundNote) +
    tile(String(st.lowerBound), 'area minimum', 'Sheets needed if parts could be any shape. No plan can use fewer.') +
    tile(`${(st.efficiency * 100).toFixed(1)}%`, 'yield') +
    tile(`${st.placedCount}/${requested}`, 'parts placed') +
    tile(String(st.cutCount), 'cuts') +
    tile(cutLenText, 'total cut length');

  let status = `Done in ${(st.elapsedMs / 1000).toFixed(1)} s, ${st.trials} layouts tried.`;
  if (st.sheetCount === st.lowerBound && st.sheetCount > 0) {
    status += ' This is the minimum sheet count.';
  }
  setStatus(status, 'done');

  let warn = '';
  if (problems.length > 0) {
    warn +=
      '<div class="alert error"><strong>The layout check found a problem. Do not cut from this plan.</strong><ul>' +
      problems.map((p) => `<li>${esc(p)}</li>`).join('') +
      '</ul></div>';
  }
  if (result.unplaced.length > 0) {
    warn +=
      '<div class="alert warn"><strong>Some parts do not fit on the sheet:</strong><ul>' +
      result.unplaced.map((u) => `<li>${esc(u.label)} × ${u.count}: ${esc(u.reason)}</li>`).join('') +
      '</ul></div>';
  }
  $('warnings').innerHTML = warn;

  const groups = groupSheets(result.sheets);
  $('sheets').innerHTML = groups
    .map((g, gi) => {
      const s = g.sheet;
      const first = g.indexes[0] + 1;
      let title = `Sheet ${first}`;
      if (g.indexes.length > 1) {
        title = `Sheets ${g.indexes.map((i) => i + 1).join(', ')}`;
      }
      let badge = '';
      if (g.indexes.length > 1) {
        badge = `<span class="badge">× ${g.indexes.length}</span>`;
      }
      const used = ((s.usedArea / (input.sheet.length * input.sheet.width)) * 100).toFixed(1);
      const legend = [...partCounts(s).entries()]
        .map(([id, e]) => `<li><span class="swatch" style="--h:${hues.get(id)}"></span>${esc(e.label)} × ${e.count}</li>`)
        .join('');
      const offcuts = usefulOffcuts(s, unit, 4)
        .map((o) => `${esc(fmt(o.w))} × ${esc(fmt(o.h))}`)
        .join(', ');
      let offcutLine = '';
      if (offcuts) {
        offcutLine = `<p class="hint">Largest offcuts (length × width): ${offcuts}</p>`;
      }
      return (
        `<article class="sheet-card" data-group="${gi}">` +
        `<header><h3>${esc(title)} ${badge}</h3><span class="muted">${used}% used · ${s.placements.length} parts · ${s.cuts.length} cuts</span></header>` +
        sheetSvg(s, input, unit, hues, gi) +
        `<ul class="legend">${legend}</ul>` +
        offcutLine +
        `<details class="cut-details"><summary>Cut sequence (${s.cuts.length})</summary>${cutTable(s, input, unit)}</details>` +
        '</article>'
      );
    })
    .join('');
}

// ===== Events ==============================================================

function bindSettings() {
  const fields = [
    ['sheet-length', 'sheetLength'],
    ['sheet-width', 'sheetWidth'],
    ['kerf', 'kerf'],
    ['trim', 'trim'],
  ];
  for (const [id, key] of fields) {
    const el = $(id);
    el.value = state[key];
    el.addEventListener('input', () => {
      state[key] = el.value;
      schedule();
    });
  }
  $('sheet-grain').checked = state.sheetGrain;
  $('sheet-grain').addEventListener('change', (e) => {
    state.sheetGrain = e.target.checked;
    schedule();
  });
  $('effort').value = state.effort;
  $('effort').addEventListener('change', (e) => {
    state.effort = e.target.value;
    schedule();
  });
  $('unit').value = state.unit;
  $('unit').addEventListener('change', (e) => changeUnit(e.target.value));
  updateUnitHint();
}

function updateUnitHint() {
  let hint = 'Enter millimeters, for example 2440 or 3.2.';
  if (state.unit === 'in') {
    hint = `Enter inches as 23.5, 23 1/2, 23-1/2 or 1' 11 1/2". Feet with ' are allowed.`;
  }
  $('unit-hint').textContent = hint;
}

function changeUnit(next) {
  const prev = state.unit;
  if (prev === next) {
    return;
  }
  for (const key of ['sheetLength', 'sheetWidth', 'kerf', 'trim']) {
    state[key] = convertText(state[key], prev, next);
  }
  for (const row of state.parts) {
    row.length = convertText(row.length, prev, next);
    row.width = convertText(row.width, prev, next);
  }
  state.unit = next;
  $('sheet-length').value = state.sheetLength;
  $('sheet-width').value = state.sheetWidth;
  $('kerf').value = state.kerf;
  $('trim').value = state.trim;
  updateUnitHint();
  renderRows();
  schedule();
}

function bindTable() {
  const tbody = $('parts').querySelector('tbody');
  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    const field = e.target.dataset.field;
    if (!tr || !field) {
      return;
    }
    const row = findRow(tr.dataset.id);
    if (field === 'grain') {
      row.grain = e.target.checked;
    } else {
      row[field] = e.target.value;
    }
    schedule();
  });
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button.remove');
    if (!btn) {
      return;
    }
    const tr = btn.closest('tr');
    state.parts = state.parts.filter((r) => r.id !== tr.dataset.id);
    renderRows();
    schedule();
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') {
      return;
    }
    e.preventDefault();
    const tr = e.target.closest('tr');
    const field = e.target.dataset.field;
    const index = state.parts.findIndex((r) => r.id === tr.dataset.id);
    if (index === state.parts.length - 1) {
      addRow(false);
    }
    const next = tbody.querySelectorAll('tr')[index + 1];
    if (next) {
      next.querySelector(`input[data-field="${field}"]`).focus();
    }
  });
  $('add-btn').addEventListener('click', () => addRow(true));
  $('clear-btn').addEventListener('click', () => {
    if (!confirm('Remove all parts?')) {
      return;
    }
    state.parts = [freshRow({})];
    renderRows();
    schedule();
  });
}

function addRow(focus) {
  let grain = true;
  if (state.parts.length > 0) {
    grain = state.parts[state.parts.length - 1].grain;
  }
  state.parts.push(freshRow({ grain }));
  renderRows();
  if (focus) {
    const rows = $('parts').querySelectorAll('tbody tr');
    rows[rows.length - 1].querySelector('input[data-field="label"]').focus();
  }
}

// ===== Paste import ========================================================

function bindPaste() {
  const dialog = $('paste-dialog');
  $('paste-btn').addEventListener('click', () => {
    $('paste-error').textContent = '';
    dialog.showModal();
    $('paste-text').focus();
  });
  $('paste-ok').addEventListener('click', () => {
    const lines = $('paste-text').value.split(/\r?\n/).filter((l) => l.trim() !== '');
    const rows = [];
    const bad = [];
    lines.forEach((line, i) => {
      const parsed = parsePasteLine(line);
      if (!parsed) {
        bad.push(i + 1);
        return;
      }
      let grain = state.sheetGrain;
      if (parsed.grain !== null) {
        grain = parsed.grain;
      }
      rows.push(freshRow({ ...parsed, grain }));
    });
    if (bad.length > 0) {
      $('paste-error').textContent = `Lines ${bad.join(', ')} have no length and width. Nothing was added.`;
      return;
    }
    if ($('paste-replace').checked) {
      state.parts = rows;
    } else {
      state.parts = state.parts.filter((r) => !rowIsBlank(r)).concat(rows);
    }
    if (state.parts.length === 0) {
      state.parts = [freshRow({})];
    }
    renderRows();
    dialog.close();
    $('paste-text').value = '';
    schedule();
  });
}

function bindTopbar() {
  $('print-btn').addEventListener('click', () => {
    for (const d of document.querySelectorAll('.cut-details')) {
      d.open = true;
    }
    window.print();
  });
  $('share-btn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#s=${encodeShare(serializable())}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flash($('share-btn'), 'Link copied');
    } catch {
      flash($('share-btn'), 'Link is in the address bar');
    }
  });
}

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1800);
}

function bindCutHighlight() {
  const sheets = $('sheets');
  const toggle = (e, on) => {
    const tr = e.target.closest('tr[data-cut]');
    if (!tr) {
      return;
    }
    const card = tr.closest('.sheet-card');
    const rect = card.querySelector(`.sheet-svg rect.cut[data-cut="${tr.dataset.cut}"]`);
    if (rect) {
      rect.classList.toggle('hot', on);
    }
  };
  sheets.addEventListener('mouseover', (e) => toggle(e, true));
  sheets.addEventListener('mouseout', (e) => toggle(e, false));
}

function init() {
  state = loadState();
  if (state.parts.length === 0) {
    state.parts.push(freshRow({}));
  }
  bindSettings();
  renderRows();
  bindTable();
  bindPaste();
  bindTopbar();
  bindCutHighlight();
  window.addEventListener('beforeprint', () => {
    for (const d of document.querySelectorAll('.cut-details')) {
      d.open = true;
    }
  });
  runSolve();
}

if (typeof document !== 'undefined') {
  init();
}
