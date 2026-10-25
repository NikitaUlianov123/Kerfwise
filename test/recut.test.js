import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recut } from '../js/recut.js';
import { packSheet, ORDERS, CHOICES, SPLITS, sortItems, mulberry32 } from '../js/packer.js';
import { checkCutSequence } from '../js/verify.js';

const rect = (x, y, w, h, label = 'P') => ({ x, y, w, h, label });

test('aligned crosscuts across two rows become one cut each', () => {
  // The screenshot case: two rows of two shelves, waste on the right.
  // Rip first costs 1 + 2 + 2 = 5 cuts; crosscut first costs 2 + 1 + 1 = 4.
  const parts = [rect(0, 0, 30, 20), rect(31, 0, 30, 20), rect(0, 21, 30, 20), rect(31, 21, 30, 20)];
  const plan = recut(parts, 70, 41, 1);
  assert.equal(plan.count, 4);
  assert.deepEqual(plan.cuts.slice(0, 2).map((c) => [c.axis, c.pos, c.from, c.to]), [['v', 30, 0, 41], ['v', 61, 0, 41]]);
  assert.deepEqual(checkCutSequence({ x: 0, y: 0, w: 70, h: 41 }, parts, plan.cuts, 1), []);
  assert.deepEqual(plan.offcuts, [{ x: 62, y: 0, w: 8, h: 41 }]);
});

test('empty sheet needs no cuts and is one offcut', () => {
  const plan = recut([], 10, 5, 1);
  assert.equal(plan.count, 0);
  assert.deepEqual(plan.offcuts, [{ x: 0, y: 0, w: 10, h: 5 }]);
});

test('a part that fills the sheet needs no cuts', () => {
  const plan = recut([rect(0, 0, 10, 5)], 10, 5, 1);
  assert.equal(plan.count, 0);
  assert.deepEqual(plan.offcuts, []);
});

test('one part in a corner needs two cuts', () => {
  const parts = [rect(0, 0, 4, 3)];
  const plan = recut(parts, 10, 5, 1);
  assert.equal(plan.count, 2);
  assert.deepEqual(checkCutSequence({ x: 0, y: 0, w: 10, h: 5 }, parts, plan.cuts, 1), []);
});

test('waste thinner than the blade is eaten by the cut', () => {
  const parts = [rect(0, 0, 10, 4)];
  const plan = recut(parts, 10, 5, 2);
  assert.equal(plan.count, 1);
  assert.equal(plan.cuts[0].thickness, 1);
  assert.deepEqual(plan.offcuts, []);
});

test('zero kerf works and does not loop', () => {
  const parts = [rect(0, 0, 5, 5), rect(5, 0, 5, 5), rect(0, 5, 10, 5)];
  const plan = recut(parts, 10, 10, 0);
  assert.equal(plan.count, 2);
  assert.deepEqual(checkCutSequence({ x: 0, y: 0, w: 10, h: 10 }, parts, plan.cuts, 0), []);
});

test('waste before a part gets its own cut', () => {
  const parts = [rect(0, 0, 10, 5), rect(15, 0, 10, 5)];
  const plan = recut(parts, 25, 5, 1);
  assert.equal(plan.count, 2);
  assert.deepEqual(checkCutSequence({ x: 0, y: 0, w: 25, h: 5 }, parts, plan.cuts, 1), []);
});

test('overlapping blade bands keep the cut nearest the next part', () => {
  // A ends at 10, B starts at 11.5 (x2 scale: 20 and 23), kerf 2: positions 20 and 21 overlap.
  const parts = [rect(0, 0, 20, 5), rect(23, 0, 10, 5)];
  const plan = recut(parts, 33, 5, 2);
  assert.notEqual(plan, null);
  assert.deepEqual(checkCutSequence({ x: 0, y: 0, w: 33, h: 5 }, parts, plan.cuts, 2), []);
});

test('non-guillotine layouts return null', () => {
  const pinwheel = [rect(0, 0, 2, 1), rect(2, 0, 1, 2), rect(1, 2, 2, 1), rect(0, 1, 1, 2)];
  assert.equal(recut(pinwheel, 3, 3, 0), null);
});

test('node limit aborts with null', () => {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(rect(i * 11, 0, 10, 10));
  }
  assert.equal(recut(parts, 70, 20, 1, 1), null);
  assert.notEqual(recut(parts, 70, 20, 1, 20000), null);
});

test('re-planned cuts are valid and never more than the packer cuts', () => {
  const rng = mulberry32(7);
  for (let t = 0; t < 60; t++) {
    const items = [];
    const n = 2 + Math.floor(rng() * 25);
    for (let i = 0; i < n; i++) {
      const l = 2 + Math.floor(rng() * 40);
      const w = 2 + Math.floor(rng() * 20);
      items.push({ seq: i, partId: 'p', label: 'P', l, w, area: l * w, orients: [{ w: l, h: w, rotated: false }, { w, h: l, rotated: true }] });
    }
    const kerf = t % 3;
    const order = sortItems(items, ORDERS[t % ORDERS.length], null, 0);
    const s = packSheet(order, 96, 48, kerf, CHOICES[t % CHOICES.length], SPLITS[t % SPLITS.length]);
    const placed = s.placements.map((p) => rect(p.x, p.y, p.w, p.h));
    const region = { x: 0, y: 0, w: 96, h: 48 };
    assert.deepEqual(checkCutSequence(region, placed, s.cuts, kerf), [], `packer cuts, trial ${t}`);
    const plan = recut(placed, 96, 48, kerf);
    assert.notEqual(plan, null);
    assert.deepEqual(checkCutSequence(region, placed, plan.cuts, kerf), [], `recut, trial ${t}`);
    assert.ok(plan.count <= s.cuts.length, `trial ${t}: ${plan.count} > ${s.cuts.length}`);
  }
});

test('cut replay catches bad cut lists', () => {
  const parts = [rect(0, 0, 4, 3)];
  const region = { x: 0, y: 0, w: 10, h: 5 };
  assert.match(checkCutSequence(region, parts, [], 1)[0], /not cut free/);
  const partial = [{ axis: 'v', pos: 4, from: 0, to: 3, thickness: 1 }];
  assert.match(checkCutSequence(region, parts, partial, 1)[0], /fully across/);
  const thick = [{ axis: 'v', pos: 4, from: 0, to: 5, thickness: 2 }, { axis: 'h', pos: 3, from: 0, to: 4, thickness: 1 }];
  assert.match(checkCutSequence(region, parts, thick, 1)[0], /wrong width/);
  const good = [{ axis: 'v', pos: 4, from: 0, to: 5, thickness: 1 }, { axis: 'h', pos: 3, from: 0, to: 4, thickness: 1 }];
  assert.deepEqual(checkCutSequence(region, parts, good, 1), []);
});
