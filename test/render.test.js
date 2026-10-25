import { test } from 'node:test';
import assert from 'node:assert/strict';
import { borderMarks, sheetSvg } from '../js/render.js';

const cut = (axis, pos) => ({ axis, pos, from: 0, to: 10, thickness: 1 });

test('border marks are distinct, sorted and per axis', () => {
  const marks = borderMarks([cut('v', 30), cut('h', 5), cut('v', 10), cut('v', 30)], 'v', 1, 2);
  assert.deepEqual(marks.map((m) => m.u), [10, 30]);
  assert.deepEqual(marks.map((m) => m.label), [10, 30]);
  assert.deepEqual(borderMarks([], 'v', 1, 2), []);
});

test('close labels are pushed apart but keep the true position', () => {
  const marks = borderMarks([cut('h', 10), cut('h', 11), cut('h', 12), cut('h', 40)], 'h', 1, 3);
  assert.deepEqual(marks.map((m) => m.at), [10, 11, 12, 40]);
  assert.deepEqual(marks.map((m) => m.label), [10, 13, 16, 40]);
});

test('border marks use display units', () => {
  const marks = borderMarks([cut('v', 64000 * 72)], 'v', 1 / 64000, 1);
  assert.equal(marks[0].at, 72);
});

test('sheet drawing labels every cut position on the border', () => {
  const IN = 64000;
  const sheet = {
    placements: [{ partId: 'a', label: 'A', x: 0, y: 0, w: 72 * IN, h: 24 * IN, rotated: false }],
    cuts: [
      { axis: 'h', pos: 24 * IN, from: 0, to: 96 * IN, thickness: IN / 8 },
      { axis: 'v', pos: 72 * IN, from: 0, to: 24 * IN, thickness: IN / 8 },
    ],
    offcuts: [{ x: 0, y: 24 * IN + IN / 8, w: 96 * IN, h: 23 * IN + (7 * IN) / 8 }],
    usedArea: 72 * 24 * IN * IN,
  };
  const input = { sheet: { length: 96 * IN, width: 48 * IN }, kerf: IN / 8, trim: 0, sheetGrain: true, parts: [] };
  const svg = sheetSvg(sheet, input, 'in', new Map([['a', 10]]), 'k');
  assert.match(svg, /class="dim-mark"[^>]*>72</);
  assert.match(svg, /class="dim-mark"[^>]*>24</);
  assert.doesNotMatch(svg, /width="6144000"/);
});
