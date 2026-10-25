import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, packSheet, mulberry32 } from '../js/packer.js';
import { verifySolution, isGuillotine } from '../js/verify.js';
import { parseLength } from '../js/units.js';

const u = (text) => parseLength(String(text), 'in');

function makeInput(parts, opts = {}) {
  return {
    sheet: { length: u(opts.length ?? 96), width: u(opts.width ?? 48) },
    kerf: u(opts.kerf ?? '1/8'),
    trim: u(opts.trim ?? 0),
    sheetGrain: opts.sheetGrain ?? true,
    parts: parts.map((p, i) => ({
      id: `p${i}`,
      label: p.label ?? `P${i + 1}`,
      length: u(p.l),
      width: u(p.w),
      qty: p.qty ?? 1,
      grain: p.grain ?? false,
    })),
  };
}

function run(input, opts = {}) {
  const result = solve(input, { timeLimitMs: 150, ...opts });
  assert.equal(result.errors, undefined, `unexpected errors: ${result.errors}`);
  assert.deepEqual(verifySolution(input, result), []);
  assert.ok(result.stats.sheetCount >= result.stats.lowerBound);
  return result;
}

test('no parts gives no sheets', () => {
  const r = run(makeInput([]));
  assert.equal(r.stats.sheetCount, 0);
  assert.equal(r.stats.efficiency, 0);
  assert.deepEqual(r.unplaced, []);
});

test('a full-sheet part needs no cuts', () => {
  const r = run(makeInput([{ l: 96, w: 48 }]));
  assert.equal(r.stats.sheetCount, 1);
  assert.equal(r.stats.cutCount, 0);
  assert.equal(r.stats.efficiency, 1);
});

test('one small part needs two cuts', () => {
  const r = run(makeInput([{ l: 30, w: 20 }]));
  assert.equal(r.stats.sheetCount, 1);
  assert.equal(r.stats.cutCount, 2);
});

test('blade width decides whether parts share a sheet', () => {
  assert.equal(run(makeInput([{ l: 24, w: 24, qty: 8 }], { kerf: 0 })).stats.sheetCount, 1);
  // 24 + 1/8 + 24 is wider than 48, so only one row of three fits per sheet.
  assert.equal(run(makeInput([{ l: 24, w: 24, qty: 8 }], { kerf: '1/8' })).stats.sheetCount, 3);
});

test('exact fit with kerf between parts', () => {
  assert.equal(run(makeInput([{ l: 96, w: '23 15/16', qty: 2 }])).stats.sheetCount, 1);
  assert.equal(run(makeInput([{ l: 96, w: '23 15/16', qty: 4 }])).stats.sheetCount, 2);
  assert.equal(run(makeInput([{ l: 96, w: 24, qty: 2 }])).stats.sheetCount, 2);
});

test('sliver smaller than kerf is cut away, not reused', () => {
  const r = run(makeInput([{ l: 96, w: '47 15/16' }, { l: 10, w: '1/32' }]));
  assert.equal(r.stats.sheetCount, 2);
});

test('mixed sizes that tile a sheet exactly', () => {
  const r = run(makeInput([{ l: 96, w: 24 }, { l: 48, w: 24, qty: 2 }], { kerf: 0 }));
  assert.equal(r.stats.sheetCount, 1);
  assert.equal(r.stats.efficiency, 1);
});

test('nine-per-sheet tiling', () => {
  const r = run(makeInput([{ l: 32, w: 16, qty: 12 }], { kerf: 0 }));
  assert.equal(r.stats.sheetCount, 2);
  assert.equal(r.stats.lowerBound, 2);
});

test('rotation lets a part fit when grain is free', () => {
  const r = run(makeInput([{ l: 40, w: 60, grain: false }]));
  assert.equal(r.stats.sheetCount, 1);
  assert.equal(r.sheets[0].placements[0].rotated, true);
  assert.equal(r.sheets[0].placements[0].w, u(60));
});

test('grain lock blocks rotation and reports why', () => {
  const r = run(makeInput([{ l: 40, w: 60, grain: true, qty: 3 }]));
  assert.equal(r.stats.sheetCount, 0);
  assert.equal(r.unplaced.length, 1);
  assert.equal(r.unplaced[0].count, 3);
  assert.match(r.unplaced[0].reason, /grain/);
});

test('grain lock is ignored when the sheet has no grain', () => {
  const r = run(makeInput([{ l: 40, w: 60, grain: true }], { sheetGrain: false }));
  assert.equal(r.stats.sheetCount, 1);
  assert.equal(r.sheets[0].placements[0].rotated, true);
});

test('grain-locked parts are never rotated', () => {
  const r = run(makeInput([{ l: 20, w: 40, grain: true, qty: 7 }, { l: 30, w: 10, grain: false, qty: 9 }]));
  for (const s of r.sheets) {
    for (const p of s.placements) {
      if (p.partId === 'p0') {
        assert.equal(p.rotated, false);
        assert.equal(p.w, u(20));
      }
    }
  }
});

test('square grain-locked parts are fine', () => {
  const r = run(makeInput([{ l: 30, w: 30, grain: true, qty: 2 }]));
  assert.equal(r.stats.sheetCount, 1);
});

test('oversize parts are reported, others still placed', () => {
  const r = run(makeInput([{ l: 100, w: 10, label: 'Long' }, { l: 50, w: 50 }, { l: 10, w: 10, qty: 2 }]));
  assert.equal(r.stats.placedCount, 2);
  assert.equal(r.unplaced.length, 2);
  assert.match(r.unplaced.find((x) => x.label === 'Long').reason, /Larger/);
});

test('edge trim reduces the usable area', () => {
  const full = run(makeInput([{ l: 96, w: 48 }], { trim: '1/2' }));
  assert.equal(full.stats.sheetCount, 0);
  assert.equal(full.unplaced.length, 1);
  const r = run(makeInput([{ l: 95, w: 47 }], { trim: '1/2' }));
  assert.equal(r.stats.sheetCount, 1);
  assert.equal(r.sheets[0].placements[0].x, u('1/2'));
  assert.equal(r.sheets[0].placements[0].y, u('1/2'));
  assert.equal(r.stats.cutCount, 0);
});

test('custom sheet sizes', () => {
  const r = run(makeInput([{ l: 30, w: 30, qty: 4 }], { length: 60, width: 60, kerf: 0 }));
  assert.equal(r.stats.sheetCount, 1);
});

test('input errors are reported, not solved', () => {
  const zeroSheet = makeInput([{ l: 1, w: 1 }], { length: 0 });
  assert.ok(solve(zeroSheet).errors.length > 0);
  const negKerf = makeInput([{ l: 1, w: 1 }]);
  negKerf.kerf = -1;
  assert.ok(solve(negKerf).errors.length > 0);
  assert.ok(solve(makeInput([{ l: 1, w: 1 }], { trim: 24 })).errors.length > 0);
  assert.ok(solve(makeInput([{ l: 1, w: 1, qty: 0 }])).errors.length > 0);
  assert.ok(solve(makeInput([{ l: 0, w: 1 }])).errors.length > 0);
  const nullDim = makeInput([{ l: 1, w: 1 }]);
  nullDim.parts[0].width = null;
  assert.ok(solve(nullDim).errors.length > 0);
  const fracQty = makeInput([{ l: 1, w: 1 }]);
  fracQty.parts[0].qty = 1.5;
  assert.ok(solve(fracQty).errors.length > 0);
});

test('zero time budget still returns a valid plan', () => {
  const r = run(makeInput([{ l: 20, w: 15, qty: 30 }]), { timeLimitMs: 0 });
  assert.equal(r.stats.placedCount, 30);
});

test('same input gives the same plan', () => {
  const input = makeInput([{ l: 23, w: 11, qty: 15 }, { l: 31, w: 17, qty: 6 }, { l: 9, w: 7, qty: 20 }]);
  const a = solve(input, { timeLimitMs: 60000, maxTrials: 280 });
  const b = solve(input, { timeLimitMs: 60000, maxTrials: 280 });
  assert.deepEqual(a.sheets, b.sheets);
});

test('a layout with every part one size beats naive shelf packing', () => {
  // 15 1/2 x 11 3/4 cabinet sides: 6 across x 4 down = 24 per sheet with 1/8 kerf.
  const r = run(makeInput([{ l: '15 1/2', w: '11 3/4', qty: 48 }]), { timeLimitMs: 500 });
  assert.equal(r.stats.sheetCount, 2);
});

test('random inputs always give valid guillotine plans', () => {
  const rng = mulberry32(99);
  const dim = (max) => Math.max(1, Math.round(rng() * max * 16)) / 16;
  for (let t = 0; t < 40; t++) {
    const parts = [];
    const n = 1 + Math.floor(rng() * 8);
    for (let i = 0; i < n; i++) {
      parts.push({ l: dim(100), w: dim(50), qty: 1 + Math.floor(rng() * 6), grain: rng() < 0.5 });
    }
    const kerfs = [0, '1/16', '1/8', '3/16'];
    let trim = 0;
    if (t % 3 === 0) {
      trim = '1/4';
    }
    const input = makeInput(parts, { kerf: kerfs[t % 4], trim, sheetGrain: t % 5 !== 0 });
    run(input, { timeLimitMs: 40, seed: t });
  }
});

test('packSheet cut list never cuts through a part', () => {
  const items = [];
  for (let i = 0; i < 10; i++) {
    items.push({ seq: i, partId: 'a', label: 'A', l: 10, w: 7, area: 70, orients: [{ w: 10, h: 7, rotated: false }] });
  }
  for (const split of ['h', 'v', 'sla', 'lla']) {
    const s = packSheet(items, 50, 20, 1, 'baf', split);
    assert.ok(s.placements.length > 0);
    for (const c of s.cuts) {
      assert.ok(c.thickness <= 1 && c.thickness > 0);
      for (const p of s.placements) {
        if (c.axis === 'h') {
          const crosses = c.from < p.x + p.w && p.x < c.to && c.pos < p.y + p.h && p.y < c.pos + c.thickness;
          assert.equal(crosses, false);
        } else {
          const crosses = c.from < p.y + p.h && p.y < c.to && c.pos < p.x + p.w && p.x < c.pos + c.thickness;
          assert.equal(crosses, false);
        }
      }
    }
  }
});

test('isGuillotine detects pinwheel layouts', () => {
  const pinwheel = [
    { x: 0, y: 0, w: 2, h: 1 },
    { x: 2, y: 0, w: 1, h: 2 },
    { x: 1, y: 2, w: 2, h: 1 },
    { x: 0, y: 1, w: 1, h: 2 },
  ];
  assert.equal(isGuillotine(pinwheel, 0), false);
  assert.equal(isGuillotine([{ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }], 0), true);
  assert.equal(isGuillotine([{ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }], 1), false);
  assert.equal(isGuillotine([], 0), true);
});

test('verifySolution catches broken plans', () => {
  const input = makeInput([{ l: 10, w: 5, grain: true, qty: 2 }]);
  const good = run(input);
  const clone = () => JSON.parse(JSON.stringify(good));

  const overlap = clone();
  overlap.sheets[0].placements[1].x = overlap.sheets[0].placements[0].x;
  overlap.sheets[0].placements[1].y = overlap.sheets[0].placements[0].y;
  assert.ok(verifySolution(input, overlap).some((m) => /blade width/.test(m)));

  const turned = clone();
  const p = turned.sheets[0].placements[0];
  [p.w, p.h, p.rotated] = [p.h, p.w, true];
  assert.ok(verifySolution(input, turned).some((m) => /grain/.test(m)));

  const outside = clone();
  outside.sheets[0].placements[0].x = u(95);
  assert.ok(verifySolution(input, outside).some((m) => /outside/.test(m)));

  const missing = clone();
  missing.sheets[0].placements.pop();
  assert.ok(verifySolution(input, missing).some((m) => /accounted/.test(m)));

  const resized = clone();
  resized.sheets[0].placements[0].w = u(11);
  assert.ok(verifySolution(input, resized).some((m) => /wrong size/.test(m)));

  const badCut = clone();
  const q = badCut.sheets[0].placements[0];
  badCut.sheets[0].cuts.push({ axis: 'v', pos: q.x + 1, from: q.y, to: q.y + q.h, thickness: 1 });
  assert.ok(verifySolution(input, badCut).some((m) => /cut goes through/.test(m)));
});
