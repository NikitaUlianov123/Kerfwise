import { parseLength, formatLength, convertText, UNITS } from './units.js';
import { esc, partHue, groupSheets, sheetSvg, cutTable, partCounts, usefulOffcuts } from './render.js';
import { parsePasteLine } from './paste.js';
import { solve, EFFORT_MS } from './packer.js';
import { verifySolution } from './verify.js';
import {
  STORAGE_KEY,
  LEGACY_KEY,
  normalizeProject,
  normalizeStore,
  serializeStore,
  serializeProject,
  blankProject,
  blankPart,
  exampleProject,
  defaultMaterial,
  cloneAsNew,
  uniqueName,
  makeFile,
  parseFile,
  fileName,
} from './store.js';

const MAX_ITEMS = 5000;
const DEBOUNCE_MS = 350;
const MIN_JOB_MS = 150;

const $ = (id) => document.getElementById(id);

let store = null;
let worker = null;
let jobId = 0;
let timer = null;
let pending = null;

function current() {
  return store.projects.find((p) => p.id === store.currentId);
}

// ===== Storage and share links =============================================

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

function readJson(key) {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Blocked or damaged storage is treated as empty.
  }
  return null;
}

function loadStore() {
  const saved = normalizeStore(readJson(STORAGE_KEY));
  if (saved) {
    return saved;
  }
  const legacy = readJson(LEGACY_KEY);
  if (legacy) {
    const project = normalizeProject(legacy);
    return { currentId: project.id, projects: [project] };
  }
  const project = exampleProject();
  return { currentId: project.id, projects: [project] };
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeStore(store)));
  } catch {
    // Not saved when storage is blocked; the page still works.
  }
}

// A share link always opens as a new project so it cannot overwrite saved work.
function importShareLink() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith('s=')) {
    return;
  }
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const shared = normalizeProject(decodeShare(hash.slice(2)));
    addProject(cloneAsNew(shared, uniqueName(shared.name, store.projects)));
    flashStatus = 'Opened the shared project as a new project.';
  } catch {
    flashStatus = 'The share link is damaged. Nothing was opened.';
  }
}

let flashStatus = '';

// ===== Projects ============================================================

function addProject(project) {
  store.projects.push(project);
  store.currentId = project.id;
}

function renderProjectSelect() {
  const select = $('project-select');
  select.innerHTML = store.projects
    .map((p) => {
      let selected = '';
      if (p.id === store.currentId) {
        selected = ' selected';
      }
      return `<option value="${esc(p.id)}"${selected}>${esc(p.name)}</option>`;
    })
    .join('');
}

function switchTo(projectId) {
  store.currentId = projectId;
  saveStore();
  renderProject();
  runSolve();
}

function closeMenu() {
  $('project-menu').open = false;
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function bindProjects() {
  $('project-select').addEventListener('change', (e) => switchTo(e.target.value));
  $('project-name').addEventListener('input', (e) => {
    current().name = e.target.value;
    renderProjectSelect();
    saveStore();
  });
  $('project-name').addEventListener('blur', (e) => {
    if (e.target.value.trim() === '') {
      current().name = 'Untitled project';
      e.target.value = current().name;
      renderProjectSelect();
      saveStore();
    }
  });
  $('new-project').addEventListener('click', () => {
    closeMenu();
    addProject(blankProject(uniqueName('Untitled project', store.projects)));
    switchTo(store.currentId);
    $('project-name').select();
  });
  $('duplicate-project').addEventListener('click', () => {
    closeMenu();
    const p = current();
    addProject(cloneAsNew(p, uniqueName(`${p.name} copy`, store.projects)));
    switchTo(store.currentId);
  });
  $('delete-project').addEventListener('click', () => {
    closeMenu();
    const p = current();
    if (!confirm(`Delete the project "${p.name}"? This cannot be undone.`)) {
      return;
    }
    const index = store.projects.indexOf(p);
    store.projects = store.projects.filter((x) => x.id !== p.id);
    if (store.projects.length === 0) {
      store.projects.push(blankProject());
    }
    switchTo(store.projects[Math.max(0, index - 1)].id);
  });
  $('save-file').addEventListener('click', () => {
    closeMenu();
    download(fileName(current().name), makeFile([current()]));
  });
  $('save-all').addEventListener('click', () => {
    closeMenu();
    download(fileName('Kerfwise projects'), makeFile(store.projects));
  });
  $('open-file').addEventListener('click', () => {
    closeMenu();
    $('file-input').click();
  });
  $('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) {
      return;
    }
    try {
      const projects = parseFile(await file.text());
      let firstId = null;
      for (const p of projects) {
        const copy = cloneAsNew(p, uniqueName(p.name, store.projects));
        addProject(copy);
        if (firstId === null) {
          firstId = copy.id;
        }
      }
      flashStatus = `Opened ${projects.length} project(s) from ${file.name}.`;
      switchTo(firstId);
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#project-menu')) {
      closeMenu();
    }
  });
}

// ===== Materials ===========================================================

function materialName(m, index) {
  if (m.name.trim() === '') {
    return `Material ${index + 1}`;
  }
  return m.name.trim();
}

function renderMaterials() {
  const p = current();
  let disabled = '';
  if (p.materials.length === 1) {
    disabled = ' disabled';
  }
  $('materials').innerHTML = p.materials
    .map((m) => {
      let checked = '';
      if (m.grain) {
        checked = ' checked';
      }
      return (
        `<div class="material" data-mid="${esc(m.id)}">` +
        `<div class="material-head"><input data-field="name" value="${esc(m.name)}" aria-label="Material name" placeholder="Material name" autocomplete="off">` +
        `<button type="button" class="icon remove-material" aria-label="Remove material" title="Remove material"${disabled}>×</button></div>` +
        '<div class="grid-fields three">' +
        `<label>Length (along grain)<input data-field="length" value="${esc(m.length)}" inputmode="decimal" autocomplete="off"></label>` +
        `<label>Width<input data-field="width" value="${esc(m.width)}" inputmode="decimal" autocomplete="off"></label>` +
        `<label>Edge trim<input data-field="trim" value="${esc(m.trim)}" inputmode="decimal" autocomplete="off"></label>` +
        '</div>' +
        `<label class="check"><input type="checkbox" data-field="grain"${checked}> Has grain (parts with "Grain" set keep their length along the sheet length)</label>` +
        '</div>'
      );
    })
    .join('');
}

function bindMaterials() {
  const box = $('materials');
  box.addEventListener('input', (e) => {
    const card = e.target.closest('.material');
    const field = e.target.dataset.field;
    if (!card || !field) {
      return;
    }
    const m = current().materials.find((x) => x.id === card.dataset.mid);
    if (field === 'grain') {
      m.grain = e.target.checked;
    } else {
      m[field] = e.target.value;
    }
    if (field === 'name') {
      renderRows();
    }
    schedule();
  });
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button.remove-material');
    if (!btn) {
      return;
    }
    const p = current();
    const id = btn.closest('.material').dataset.mid;
    const index = p.materials.findIndex((x) => x.id === id);
    const users = p.parts.filter((r) => r.material === id && !rowIsBlank(r)).length;
    const rest = p.materials.filter((x) => x.id !== id);
    const target = rest[0];
    if (users > 0) {
      const ok = confirm(
        `${users} part row(s) use ${materialName(p.materials[index], index)}. Remove it and move them to ${materialName(target, p.materials.indexOf(target))}?`,
      );
      if (!ok) {
        return;
      }
    }
    for (const r of p.parts) {
      if (r.material === id) {
        r.material = target.id;
      }
    }
    p.materials = rest;
    renderMaterials();
    renderRows();
    schedule();
  });
  $('add-material').addEventListener('click', () => {
    const p = current();
    const m = defaultMaterial(p.unit, `Material ${p.materials.length + 1}`);
    p.materials.push(m);
    renderMaterials();
    renderRows();
    schedule();
    box.querySelector(`.material[data-mid="${m.id}"] input[data-field="name"]`).select();
  });
}

// ===== Parts table =========================================================

function rowIsBlank(row) {
  return row.label.trim() === '' && row.length.trim() === '' && row.width.trim() === '';
}

function materialSelect(row, materials) {
  const options = materials
    .map((m, i) => {
      let selected = '';
      if (m.id === row.material) {
        selected = ' selected';
      }
      return `<option value="${esc(m.id)}"${selected}>${esc(materialName(m, i))}</option>`;
    })
    .join('');
  return `<td class="mat-col"><select data-field="material" aria-label="Material">${options}</select></td>`;
}

function renderRows() {
  const p = current();
  const many = p.materials.length > 1;
  $('parts').classList.toggle('many-materials', many);
  const tbody = $('parts').querySelector('tbody');
  tbody.innerHTML = p.parts
    .map((row) => {
      let checked = '';
      if (row.grain) {
        checked = ' checked';
      }
      let mat = '';
      if (many) {
        mat = materialSelect(row, p.materials);
      }
      return (
        `<tr data-id="${row.id}">` +
        `<td><input data-field="label" value="${esc(row.label)}" aria-label="Label" autocomplete="off"></td>` +
        `<td><input data-field="length" value="${esc(row.length)}" aria-label="Length" inputmode="decimal" autocomplete="off"></td>` +
        `<td><input data-field="width" value="${esc(row.width)}" aria-label="Width" inputmode="decimal" autocomplete="off"></td>` +
        `<td><input data-field="qty" value="${esc(row.qty)}" aria-label="Quantity" inputmode="numeric" class="qty" autocomplete="off"></td>` +
        mat +
        `<td class="center"><input type="checkbox" data-field="grain" aria-label="Grain locked"${checked}></td>` +
        '<td><button type="button" class="icon remove" aria-label="Remove part" title="Remove part">×</button></td>' +
        '</tr>'
      );
    })
    .join('');
}

function findRow(id) {
  return current().parts.find((r) => r.id === id);
}

function addRow(focus) {
  const p = current();
  let grain = true;
  let material = p.materials[0].id;
  if (p.parts.length > 0) {
    grain = p.parts[p.parts.length - 1].grain;
    material = p.parts[p.parts.length - 1].material;
  }
  p.parts.push(blankPart(material, { grain }));
  renderRows();
  if (focus) {
    const rows = $('parts').querySelectorAll('tbody tr');
    rows[rows.length - 1].querySelector('input[data-field="label"]').focus();
  }
}

function bindTable() {
  const tbody = $('parts').querySelector('tbody');
  const onEdit = (e) => {
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
  };
  tbody.addEventListener('input', onEdit);
  tbody.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT') {
      onEdit(e);
    }
  });
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button.remove');
    if (!btn) {
      return;
    }
    const p = current();
    const tr = btn.closest('tr');
    p.parts = p.parts.filter((r) => r.id !== tr.dataset.id);
    if (p.parts.length === 0) {
      p.parts.push(blankPart(p.materials[0].id));
    }
    renderRows();
    schedule();
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') {
      return;
    }
    e.preventDefault();
    const p = current();
    const tr = e.target.closest('tr');
    const field = e.target.dataset.field;
    const index = p.parts.findIndex((r) => r.id === tr.dataset.id);
    if (index === p.parts.length - 1) {
      addRow(false);
    }
    const next = tbody.querySelectorAll('tr')[index + 1];
    if (next) {
      next.querySelector(`[data-field="${field}"]`).focus();
    }
  });
  $('add-btn').addEventListener('click', () => addRow(true));
  $('clear-btn').addEventListener('click', () => {
    if (!confirm('Remove all parts from this project?')) {
      return;
    }
    const p = current();
    p.parts = [blankPart(p.materials[0].id)];
    renderRows();
    schedule();
  });
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

// Returns one solver job per material that has parts.
function collectJobs() {
  const p = current();
  const unit = p.unit;
  const errors = [];
  const fieldErrors = new Map();
  const mark = (selector, message) => {
    fieldErrors.set(selector, message);
    errors.push(message);
  };

  const kerf = parseLength(p.kerf, unit);
  if (kerf === null) {
    mark('#kerf', 'Enter a blade width (0 is allowed).');
  }

  const sheets = new Map();
  p.materials.forEach((m, i) => {
    const name = materialName(m, i);
    const sel = (field) => `.material[data-mid="${m.id}"] input[data-field="${field}"]`;
    const length = parseLength(m.length, unit);
    const width = parseLength(m.width, unit);
    const trim = parseLength(m.trim, unit);
    if (length === null || length <= 0) {
      mark(sel('length'), `${name}: enter a sheet length more than zero.`);
    }
    if (width === null || width <= 0) {
      mark(sel('width'), `${name}: enter a sheet width more than zero.`);
    }
    if (trim === null) {
      mark(sel('trim'), `${name}: enter an edge trim (0 is allowed).`);
    } else if (length > 0 && width > 0 && (2 * trim >= length || 2 * trim >= width)) {
      mark(sel('trim'), `${name}: edge trim removes the full sheet.`);
    }
    sheets.set(m.id, { material: m, name, index: i, sheet: { length, width }, trim, parts: [] });
  });

  let total = 0;
  p.parts.forEach((row, index) => {
    if (rowIsBlank(row)) {
      return;
    }
    let label = row.label.trim();
    if (label === '') {
      label = `Part ${index + 1}`;
    }
    const sel = (field) => `tr[data-id="${row.id}"] input[data-field="${field}"]`;
    const length = parseLength(row.length, unit);
    const width = parseLength(row.width, unit);
    const qty = parseQty(row.qty);
    if (length === null || length <= 0) {
      mark(sel('length'), `${label}: enter a length more than zero.`);
    }
    if (width === null || width <= 0) {
      mark(sel('width'), `${label}: enter a width more than zero.`);
    }
    if (qty === null) {
      mark(sel('qty'), `${label}: quantity must be a whole number, 1 or more.`);
    } else {
      total += qty;
    }
    let target = sheets.get(row.material);
    if (!target) {
      target = sheets.get(p.materials[0].id);
    }
    target.parts.push({ id: row.id, label, length, width, qty, grain: row.grain, hueIndex: index });
  });
  if (total > MAX_ITEMS) {
    errors.push(`Total quantity is ${total}. The limit is ${MAX_ITEMS}.`);
  }

  const jobs = [];
  for (const s of sheets.values()) {
    if (s.parts.length === 0) {
      continue;
    }
    jobs.push({
      materialId: s.material.id,
      name: s.name,
      input: { sheet: s.sheet, kerf, trim: s.trim, sheetGrain: s.material.grain, parts: s.parts },
    });
  }
  return { jobs, errors, fieldErrors };
}

function showFieldErrors(fieldErrors) {
  for (const el of document.querySelectorAll('.invalid')) {
    el.classList.remove('invalid');
    el.removeAttribute('title');
  }
  for (const [selector, message] of fieldErrors) {
    const el = document.querySelector(selector);
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
    document.body.classList.remove('solving');
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

function schedule() {
  saveStore();
  clearTimeout(timer);
  timer = setTimeout(runSolve, DEBOUNCE_MS);
}

function runSolve() {
  clearTimeout(timer);
  const { jobs, errors, fieldErrors } = collectJobs();
  showFieldErrors(fieldErrors);
  $('input-errors').innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
  cancelWorker();
  document.body.classList.remove('solving');
  if (errors.length > 0) {
    setStatus('Fix the marked fields to see a plan.', 'error');
    clearResults();
    return;
  }
  if (jobs.length === 0) {
    setStatus('Add parts to see a plan.', '');
    clearResults();
    return;
  }
  jobId++;
  pending = { id: jobId, jobs, unit: current().unit };
  setStatus('Optimizing…', 'busy');
  document.body.classList.add('solving');
  const budget = Math.max(MIN_JOB_MS, Math.round(EFFORT_MS[current().effort] / jobs.length));
  const options = { timeLimitMs: budget };
  const payload = jobs.map((j) => ({ materialId: j.materialId, input: j.input }));
  const w = ensureWorker();
  if (w) {
    w.postMessage({ id: jobId, jobs: payload, options });
    return;
  }
  // No worker support: solve on the page with a short budget so it stays responsive.
  const id = jobId;
  setTimeout(() => {
    const results = payload.map((job) => {
      const result = solve(job.input, { timeLimitMs: Math.min(budget, 400) });
      let problems = [];
      if (!result.errors) {
        problems = verifySolution(job.input, result);
      }
      return { materialId: job.materialId, result, problems };
    });
    onWorkerMessage({ data: { id, results } });
  }, 0);
}

function onWorkerMessage(event) {
  const { id, results, failure } = event.data;
  if (!pending || id !== pending.id) {
    return;
  }
  document.body.classList.remove('solving');
  if (failure) {
    setStatus(`The optimizer failed: ${failure}`, 'error');
    return;
  }
  const errors = [];
  for (const r of results) {
    if (r.result.errors) {
      errors.push(...r.result.errors);
    }
  }
  if (errors.length > 0) {
    setStatus('Fix the input problems to see a plan.', 'error');
    $('input-errors').innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
    clearResults();
    return;
  }
  renderResults(pending, results);
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

function cutLengthText(u, unit) {
  const n = u / UNITS[unit].scale;
  if (unit === 'in') {
    return `${(n / 12).toFixed(1)} ft`;
  }
  return `${(n / 1000).toFixed(1)} m`;
}

function sheetCards(job, result, unit, hues, prefix) {
  const fmt = (v) => formatLength(v, unit);
  const input = job.input;
  return groupSheets(result.sheets)
    .map((g, gi) => {
      const s = g.sheet;
      let title = `Sheet ${g.indexes[0] + 1}`;
      let badge = '';
      if (g.indexes.length > 1) {
        title = `Sheets ${g.indexes.map((i) => i + 1).join(', ')}`;
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
        '<article class="sheet-card">' +
        `<header><h3>${esc(title)} ${badge}</h3><span class="muted">${used}% used · ${s.placements.length} parts · ${s.cuts.length} cuts</span></header>` +
        sheetSvg(s, input, unit, hues, `${prefix}-${gi}`) +
        `<ul class="legend">${legend}</ul>` +
        offcutLine +
        `<details class="cut-details"><summary>Cut sequence (${s.cuts.length})</summary>${cutTable(s, input, unit)}</details>` +
        '</article>'
      );
    })
    .join('');
}

function renderResults(run, results) {
  const unit = run.unit;
  const fmt = (v) => formatLength(v, unit);
  const hues = new Map();
  for (const job of run.jobs) {
    for (const part of job.input.parts) {
      hues.set(part.id, partHue(part.hueIndex));
    }
  }

  let sheetsTotal = 0;
  let boundTotal = 0;
  let placed = 0;
  let requested = 0;
  let cuts = 0;
  let cutLength = 0;
  let partArea = 0;
  let stockArea = 0;
  let trials = 0;
  let elapsed = 0;
  let allAtBound = true;
  const perMaterial = [];
  for (const r of results) {
    const st = r.result.stats;
    sheetsTotal += st.sheetCount;
    boundTotal += st.lowerBound;
    placed += st.placedCount;
    cuts += st.cutCount;
    cutLength += st.cutLength;
    partArea += st.partArea;
    stockArea += st.sheetArea * st.sheetCount;
    trials += st.trials;
    elapsed += st.elapsedMs;
    if (st.sheetCount > st.lowerBound) {
      allAtBound = false;
    }
    const job = run.jobs.find((j) => j.materialId === r.materialId);
    requested += job.input.parts.reduce((n, p) => n + p.qty, 0);
    perMaterial.push(`${job.name}: ${st.sheetCount}`);
  }
  let efficiency = 0;
  if (stockArea > 0) {
    efficiency = partArea / stockArea;
  }

  let sheetsNote = perMaterial.join(', ');
  if (results.length === 1) {
    sheetsNote = '';
  }
  $('summary').innerHTML =
    tile(String(sheetsTotal), 'sheets', sheetsNote) +
    tile(String(boundTotal), 'area minimum', 'Sheets needed if parts could be any shape. No plan can use fewer.') +
    tile(`${(efficiency * 100).toFixed(1)}%`, 'yield') +
    tile(`${placed}/${requested}`, 'parts placed') +
    tile(String(cuts), 'cuts') +
    tile(cutLengthText(cutLength, unit), 'total cut length');

  let status = `Done in ${(elapsed / 1000).toFixed(1)} s, ${trials} layouts tried.`;
  if (allAtBound && sheetsTotal > 0) {
    status += ' This is the minimum sheet count.';
  }
  if (flashStatus) {
    status = `${flashStatus} ${status}`;
    flashStatus = '';
  }
  setStatus(status, 'done');
  $('warnings').innerHTML = '';

  const many = results.length > 1;
  $('sheets').innerHTML = results
    .map((r, mi) => {
      const job = run.jobs.find((j) => j.materialId === r.materialId);
      const st = r.result.stats;
      let warn = '';
      if (r.problems.length > 0) {
        warn +=
          '<div class="alert error"><strong>The layout check found a problem. Do not cut from this plan.</strong><ul>' +
          r.problems.map((p) => `<li>${esc(p)}</li>`).join('') +
          '</ul></div>';
      }
      if (r.result.unplaced.length > 0) {
        let where = '';
        if (many) {
          where = ` on ${esc(job.name)}`;
        }
        warn +=
          `<div class="alert warn"><strong>Some parts do not fit${where}:</strong><ul>` +
          r.result.unplaced.map((u) => `<li>${esc(u.label)} × ${u.count}: ${esc(u.reason)}</li>`).join('') +
          '</ul></div>';
      }
      let plural = 's';
      if (st.sheetCount === 1) {
        plural = '';
      }
      const head =
        '<header class="material-title">' +
        `<h2>${esc(job.name)}</h2>` +
        `<span class="muted">${esc(fmt(job.input.sheet.length))} × ${esc(fmt(job.input.sheet.width))} · ${st.sheetCount} sheet${plural} · ${(st.efficiency * 100).toFixed(1)}% yield</span>` +
        '</header>';
      return `<section class="material-group">${head}${warn}${sheetCards(job, r.result, unit, hues, mi)}</section>`;
    })
    .join('');
}

// ===== Settings and units ==================================================

function updateUnitHint() {
  let hint = 'Enter millimeters, for example 2440 or 3.2.';
  if (current().unit === 'in') {
    hint = `Enter inches as 23.5, 23 1/2, 23-1/2 or 1' 11 1/2". Feet with ' are allowed.`;
  }
  $('unit-hint').textContent = hint;
}

function changeUnit(next) {
  const p = current();
  const prev = p.unit;
  if (prev === next) {
    return;
  }
  p.kerf = convertText(p.kerf, prev, next);
  for (const m of p.materials) {
    m.length = convertText(m.length, prev, next);
    m.width = convertText(m.width, prev, next);
    m.trim = convertText(m.trim, prev, next);
  }
  for (const row of p.parts) {
    row.length = convertText(row.length, prev, next);
    row.width = convertText(row.width, prev, next);
  }
  p.unit = next;
  renderProject();
  schedule();
}

function bindSettings() {
  $('kerf').addEventListener('input', (e) => {
    current().kerf = e.target.value;
    schedule();
  });
  $('effort').addEventListener('change', (e) => {
    current().effort = e.target.value;
    schedule();
  });
  $('unit').addEventListener('change', (e) => changeUnit(e.target.value));
}

function renderProject() {
  const p = current();
  renderProjectSelect();
  $('project-name').value = p.name;
  $('unit').value = p.unit;
  $('effort').value = p.effort;
  $('kerf').value = p.kerf;
  updateUnitHint();
  renderMaterials();
  renderRows();
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
    const p = current();
    const byName = new Map();
    p.materials.forEach((m, i) => byName.set(materialName(m, i).toLowerCase(), m));
    let fallback = p.materials[0];
    const lastFilled = p.parts.filter((r) => !rowIsBlank(r)).pop();
    if (lastFilled) {
      fallback = p.materials.find((m) => m.id === lastFilled.material) || fallback;
    }
    const lines = $('paste-text').value.split(/\r?\n/).filter((l) => l.trim() !== '');
    const rows = [];
    const bad = [];
    const unknown = [];
    lines.forEach((line, i) => {
      const parsed = parsePasteLine(line);
      if (!parsed) {
        bad.push(i + 1);
        return;
      }
      let material = fallback;
      if (parsed.material !== '') {
        material = byName.get(parsed.material.toLowerCase());
        if (!material) {
          unknown.push(i + 1);
          return;
        }
      }
      let grain = material.grain;
      if (parsed.grain !== null) {
        grain = parsed.grain;
      }
      const { length, width, qty, label } = parsed;
      rows.push(blankPart(material.id, { length, width, qty, label, grain }));
    });
    const messages = [];
    if (bad.length > 0) {
      messages.push(`Lines ${bad.join(', ')} have no length and width.`);
    }
    if (unknown.length > 0) {
      messages.push(`Lines ${unknown.join(', ')} name a material that is not in this project.`);
    }
    if (messages.length > 0) {
      $('paste-error').textContent = `${messages.join(' ')} Nothing was added.`;
      return;
    }
    if ($('paste-replace').checked) {
      p.parts = rows;
    } else {
      p.parts = p.parts.filter((r) => !rowIsBlank(r)).concat(rows);
    }
    if (p.parts.length === 0) {
      p.parts = [blankPart(p.materials[0].id)];
    }
    renderRows();
    dialog.close();
    $('paste-text').value = '';
    schedule();
  });
}

// ===== Top bar and page ====================================================

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1800);
}

function bindTopbar() {
  $('print-btn').addEventListener('click', () => {
    for (const d of document.querySelectorAll('.cut-details')) {
      d.open = true;
    }
    window.print();
  });
  $('share-btn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#s=${encodeShare(serializeProject(current()))}`;
    try {
      await navigator.clipboard.writeText(url);
      flash($('share-btn'), 'Link copied');
    } catch {
      prompt('Copy this link:', url);
    }
  });
}

function bindCutHighlight() {
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
  $('sheets').addEventListener('mouseover', (e) => toggle(e, true));
  $('sheets').addEventListener('mouseout', (e) => toggle(e, false));
}

function init() {
  store = loadStore();
  importShareLink();
  saveStore();
  bindProjects();
  bindSettings();
  bindMaterials();
  bindTable();
  bindPaste();
  bindTopbar();
  bindCutHighlight();
  window.addEventListener('beforeprint', () => {
    for (const d of document.querySelectorAll('.cut-details')) {
      d.open = true;
    }
  });
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#s=')) {
      return;
    }
    importShareLink();
    saveStore();
    renderProject();
    runSolve();
  });
  renderProject();
  runSolve();
}

init();
