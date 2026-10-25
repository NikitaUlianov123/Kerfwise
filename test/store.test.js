import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProject,
  normalizeStore,
  serializeProject,
  serializeStore,
  blankProject,
  exampleProject,
  cloneAsNew,
  uniqueName,
  makeFile,
  parseFile,
  fileName,
  defaultMaterial,
} from '../js/store.js';

const legacy = {
  unit: 'in',
  effort: 'quick',
  sheetLength: '97',
  sheetWidth: '49',
  kerf: '3/32',
  trim: '1/4',
  sheetGrain: false,
  parts: [{ label: 'Side', length: '72', width: '11 1/4', qty: '2', grain: true }],
};

test('v1 saved state becomes one project with one material', () => {
  const p = normalizeProject(legacy);
  assert.equal(p.name, 'My project');
  assert.equal(p.effort, 'quick');
  assert.equal(p.kerf, '3/32');
  assert.equal(p.materials.length, 1);
  assert.deepEqual(
    { ...p.materials[0], id: 'x' },
    { id: 'x', name: 'Plywood', length: '97', width: '49', trim: '1/4', grain: false },
  );
  assert.equal(p.parts.length, 1);
  assert.equal(p.parts[0].material, p.materials[0].id);
  assert.equal(p.parts[0].label, 'Side');
});

test('v1 with missing fields uses defaults', () => {
  const p = normalizeProject({ sheetLength: '96' });
  assert.equal(p.materials[0].width, '48');
  assert.equal(p.materials[0].grain, true);
  assert.equal(p.kerf, '1/8');
  assert.equal(p.parts.length, 1);
});

test('garbage input gives a blank project', () => {
  for (const bad of [null, undefined, 5, 'x']) {
    const p = normalizeProject(bad);
    assert.equal(p.materials.length, 1);
    assert.equal(p.parts.length, 1);
  }
});

test('bad fields are repaired', () => {
  const p = normalizeProject({
    name: '   ',
    unit: 'cm',
    effort: 'max',
    materials: [null, { id: 'a', name: 'A', length: 10, width: 'w' }, { id: 'a', name: 'B' }],
    parts: [{ length: 5, width: '2', material: 'missing' }, 7, { material: 'a', qty: 3, grain: false }],
  });
  assert.equal(p.name, 'Untitled project');
  assert.equal(p.unit, 'in');
  assert.equal(p.effort, 'normal');
  assert.equal(p.materials.length, 2);
  assert.notEqual(p.materials[0].id, p.materials[1].id);
  assert.equal(p.materials[0].length, '10');
  assert.equal(p.parts.length, 2);
  assert.equal(p.parts[0].material, 'a');
  assert.equal(p.parts[0].length, '5');
  assert.equal(p.parts[1].qty, '3');
  assert.equal(p.parts[1].grain, false);
});

test('a project with no materials gets one', () => {
  const p = normalizeProject({ name: 'X', materials: [], parts: [{ length: '1', width: '1' }] });
  assert.equal(p.materials.length, 1);
  assert.equal(p.parts[0].material, p.materials[0].id);
});

test('mm projects get metric default sheets', () => {
  const m = defaultMaterial('mm');
  assert.equal(m.length, '2440');
  assert.equal(m.width, '1220');
});

test('serialize and normalize round trip', () => {
  const p = exampleProject();
  const again = normalizeProject(JSON.parse(JSON.stringify(serializeProject(p))));
  assert.deepEqual(serializeProject(again), serializeProject(p));
  assert.equal(again.parts[0].id === p.parts[0].id, false);
});

test('serialized parts carry no row ids', () => {
  const s = serializeProject(blankProject('A'));
  assert.equal('id' in s.parts[0], false);
  assert.ok(typeof s.materials[0].id === 'string');
});

test('store keeps current project and fixes duplicate ids', () => {
  const a = serializeProject(blankProject('A'));
  const b = { ...serializeProject(blankProject('B')), id: a.id };
  const c = serializeProject(blankProject('C'));
  const store = normalizeStore({ currentId: c.id, projects: [a, b, c] });
  assert.equal(store.projects.length, 3);
  assert.equal(new Set(store.projects.map((p) => p.id)).size, 3);
  assert.equal(store.currentId, c.id);
  const fallback = normalizeStore({ currentId: 'gone', projects: [a] });
  assert.equal(fallback.currentId, a.id);
});

test('store rejects empty or invalid data', () => {
  assert.equal(normalizeStore(null), null);
  assert.equal(normalizeStore({}), null);
  assert.equal(normalizeStore({ projects: [] }), null);
});

test('store round trip', () => {
  const store = { currentId: '', projects: [exampleProject(), blankProject('B')] };
  store.currentId = store.projects[1].id;
  const again = normalizeStore(JSON.parse(JSON.stringify(serializeStore(store))));
  assert.equal(again.currentId, store.currentId);
  assert.deepEqual(again.projects.map(serializeProject), store.projects.map(serializeProject));
});

test('clones get new ids and keep content', () => {
  const p = exampleProject();
  const c = cloneAsNew(p, 'Copy');
  assert.notEqual(c.id, p.id);
  assert.equal(c.name, 'Copy');
  assert.deepEqual(c.parts.map((x) => x.label), p.parts.map((x) => x.label));
  c.parts[0].label = 'changed';
  assert.equal(p.parts[0].label, 'Side');
});

test('unique names', () => {
  const projects = [{ name: 'A' }, { name: 'A (2)' }, { name: 'B' }];
  assert.equal(uniqueName('C', projects), 'C');
  assert.equal(uniqueName('A', projects), 'A (3)');
  assert.equal(uniqueName('B', projects), 'B (2)');
  assert.equal(uniqueName('A', []), 'A');
});

test('file round trip with one and many projects', () => {
  const one = parseFile(JSON.stringify(makeFile([exampleProject()])));
  assert.equal(one.length, 1);
  assert.equal(one[0].name, 'Bookshelf');
  assert.equal(one[0].materials.length, 2);
  const many = parseFile(JSON.stringify(makeFile([exampleProject(), blankProject('X')])));
  assert.deepEqual(many.map((p) => p.name), ['Bookshelf', 'X']);
});

test('bad files are rejected with a message', () => {
  assert.throws(() => parseFile('not json'), /not a Kerfwise/);
  assert.throws(() => parseFile('{"format":"other","projects":[]}'), /not a Kerfwise/);
  assert.throws(() => parseFile('{"format":"kerfwise"}'), /not a Kerfwise/);
  assert.throws(() => parseFile('{"format":"kerfwise","projects":[]}'), /no projects/);
  assert.throws(() => parseFile('{"format":"kerfwise","projects":[1,2]}'), /no projects/);
  assert.throws(() => parseFile('{"format":"kerfwise","version":99,"projects":[{}]}'), /newer/);
  assert.throws(() => parseFile('null'), /not a Kerfwise/);
});

test('file names are safe', () => {
  assert.equal(fileName('Bookshelf'), 'Bookshelf.kerfwise.json');
  assert.equal(fileName('a/b:c*?'), 'a-b-c-.kerfwise.json');
  assert.equal(fileName('   '), 'project.kerfwise.json');
  assert.equal(fileName('3/4" ply  job'), '3-4- ply job.kerfwise.json');
});
