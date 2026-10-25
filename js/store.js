// Project data: shapes, migration from the single-list v1 format, and file import/export.
// All lengths are kept as the text the user typed, in the project's unit.

export const STORAGE_KEY = 'kerfwise-v2';
export const LEGACY_KEY = 'kerfwise-v1';
export const FILE_FORMAT = 'kerfwise';
export const FILE_VERSION = 2;

const EFFORTS = ['quick', 'normal', 'thorough'];
let idSeq = 0;

export function newId(prefix) {
  idSeq++;
  return `${prefix}${Date.now().toString(36)}${idSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function text(value, fallback) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

export function defaultMaterial(unit, name) {
  let length = '96';
  let width = '48';
  if (unit === 'mm') {
    length = '2440';
    width = '1220';
  }
  return { id: newId('m'), name: name || 'Plywood', length, width, trim: '0', grain: true };
}

export function blankPart(materialId, values) {
  return { id: newId('r'), label: '', length: '', width: '', qty: '1', grain: true, material: materialId, ...values };
}

export function blankProject(name) {
  const material = defaultMaterial('in');
  return {
    id: newId('p'),
    name: name || 'Untitled project',
    unit: 'in',
    effort: 'normal',
    kerf: '1/8',
    materials: [material],
    parts: [blankPart(material.id)],
  };
}

export function exampleProject() {
  const carcass = defaultMaterial('in', '3/4" plywood');
  const back = defaultMaterial('in', '1/4" plywood');
  const p = (label, length, width, qty, grain, material) => blankPart(material.id, { label, length, width, qty, grain });
  return {
    id: newId('p'),
    name: 'Bookshelf',
    unit: 'in',
    effort: 'normal',
    kerf: '1/8',
    materials: [carcass, back],
    parts: [
      p('Side', '72', '11 1/4', '2', true, carcass),
      p('Shelf', '34 1/2', '11 1/4', '5', true, carcass),
      p('Top', '36', '12', '1', true, carcass),
      p('Drawer side', '16', '4 1/2', '8', false, carcass),
      p('Back', '72', '35', '1', true, back),
      p('Drawer bottom', '15 1/2', '11', '4', false, back),
    ],
  };
}

function normalizeMaterial(raw, unit) {
  const base = defaultMaterial(unit);
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  let id = base.id;
  if (typeof raw.id === 'string' && raw.id !== '') {
    id = raw.id;
  }
  let grain = true;
  if (raw.grain === false) {
    grain = false;
  }
  return {
    id,
    name: text(raw.name, base.name),
    length: text(raw.length, base.length),
    width: text(raw.width, base.width),
    trim: text(raw.trim, base.trim),
    grain,
  };
}

// v1 saves and share links held one sheet and one list at the top level.
function fromLegacy(raw) {
  let unit = 'in';
  if (raw.unit === 'mm') {
    unit = 'mm';
  }
  const material = normalizeMaterial(
    { name: 'Plywood', length: raw.sheetLength, width: raw.sheetWidth, trim: raw.trim, grain: raw.sheetGrain },
    unit,
  );
  let parts = [];
  if (Array.isArray(raw.parts)) {
    parts = raw.parts.map((part) => ({ ...part, material: material.id }));
  }
  return { name: 'My project', unit, effort: raw.effort, kerf: raw.kerf, materials: [material], parts };
}

function isLegacy(raw) {
  return !Array.isArray(raw.materials) && ('sheetLength' in raw || 'sheetWidth' in raw);
}

export function normalizeProject(input) {
  if (!input || typeof input !== 'object') {
    return blankProject();
  }
  let raw = input;
  if (isLegacy(input)) {
    raw = fromLegacy(input);
  }
  let unit = 'in';
  if (raw.unit === 'mm') {
    unit = 'mm';
  }
  let effort = 'normal';
  if (EFFORTS.includes(raw.effort)) {
    effort = raw.effort;
  }
  let materials = [];
  if (Array.isArray(raw.materials)) {
    materials = raw.materials.filter((m) => m && typeof m === 'object').map((m) => normalizeMaterial(m, unit));
  }
  const seen = new Set();
  for (const m of materials) {
    if (seen.has(m.id)) {
      m.id = newId('m');
    }
    seen.add(m.id);
  }
  if (materials.length === 0) {
    materials.push(defaultMaterial(unit));
  }
  let parts = [];
  if (Array.isArray(raw.parts)) {
    parts = raw.parts
      .filter((p) => p && typeof p === 'object')
      .map((p) => {
        let material = materials[0].id;
        if (seen.has(p.material)) {
          material = p.material;
        }
        return blankPart(material, {
          label: text(p.label, ''),
          length: text(p.length, ''),
          width: text(p.width, ''),
          qty: text(p.qty, '1'),
          grain: p.grain !== false,
        });
      });
  }
  if (parts.length === 0) {
    parts.push(blankPart(materials[0].id));
  }
  let id = newId('p');
  if (typeof raw.id === 'string' && raw.id !== '') {
    id = raw.id;
  }
  let name = text(raw.name, '').trim();
  if (name === '') {
    name = 'Untitled project';
  }
  return { id, name, unit, effort, kerf: text(raw.kerf, '1/8'), materials, parts };
}

// Strips runtime-only row ids. Material ids stay: parts refer to them.
export function serializeProject(p) {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    effort: p.effort,
    kerf: p.kerf,
    materials: p.materials.map(({ id, name, length, width, trim, grain }) => ({ id, name, length, width, trim, grain })),
    parts: p.parts.map(({ label, length, width, qty, grain, material }) => ({ label, length, width, qty, grain, material })),
  };
}

export function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) {
    return null;
  }
  const projects = raw.projects.map((p) => normalizeProject(p));
  if (projects.length === 0) {
    return null;
  }
  const ids = new Set();
  for (const p of projects) {
    if (ids.has(p.id)) {
      p.id = newId('p');
    }
    ids.add(p.id);
  }
  let currentId = projects[0].id;
  if (ids.has(raw.currentId)) {
    currentId = raw.currentId;
  }
  return { currentId, projects };
}

export function serializeStore(store) {
  return { version: FILE_VERSION, currentId: store.currentId, projects: store.projects.map(serializeProject) };
}

export function uniqueName(name, projects) {
  const taken = new Set(projects.map((p) => p.name));
  if (!taken.has(name)) {
    return name;
  }
  let n = 2;
  while (taken.has(`${name} (${n})`)) {
    n++;
  }
  return `${name} (${n})`;
}

// Copies get new ids so they never collide with projects already in the store.
export function cloneAsNew(project, name) {
  const copy = normalizeProject(serializeProject(project));
  copy.id = newId('p');
  copy.name = name;
  return copy;
}

export function makeFile(projects) {
  return { format: FILE_FORMAT, version: FILE_VERSION, projects: projects.map(serializeProject) };
}

export function parseFile(contents) {
  let data = null;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error('The file is not a Kerfwise project file.');
  }
  if (!data || data.format !== FILE_FORMAT || !Array.isArray(data.projects)) {
    throw new Error('The file is not a Kerfwise project file.');
  }
  if (typeof data.version === 'number' && data.version > FILE_VERSION) {
    throw new Error('The file is from a newer version of Kerfwise.');
  }
  const projects = data.projects.filter((p) => p && typeof p === 'object').map((p) => normalizeProject(p));
  if (projects.length === 0) {
    throw new Error('The file has no projects.');
  }
  return projects;
}

export function fileName(name) {
  let base = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  if (base === '') {
    base = 'project';
  }
  return `${base}.kerfwise.json`;
}
