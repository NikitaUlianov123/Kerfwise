// Guillotine sheet packer. Every layout it returns can be cut with straight
// edge-to-edge cuts (table saw / panel saw), and every cut removes `kerf` of material.
//
// Coordinates: x runs along the sheet length (the grain), y along the sheet width.
// A part with grain locked keeps its length along x.

export const ORDERS = ['area', 'long', 'short', 'x', 'y', 'perim'];
export const CHOICES = ['baf', 'bssf', 'blsf', 'tl', 'lt'];
export const SPLITS = ['sla', 'lla', 'minas', 'maxas', 'sa', 'la', 'h', 'v'];

const EFFORT_MS = { quick: 400, normal: 2000, thorough: 8000 };

function now() {
  return globalThis.performance.now();
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function orderKey(item, order) {
  switch (order) {
    case 'area':
      return item.area;
    case 'long':
      return Math.max(item.l, item.w);
    case 'short':
      return Math.min(item.l, item.w);
    case 'x':
      return item.l;
    case 'y':
      return item.w;
    default:
      return item.l + item.w;
  }
}

export function sortItems(items, order, rng, noise) {
  const keyed = items.map((item) => {
    let key = orderKey(item, order);
    if (rng) {
      key = key * (1 + (rng() - 0.5) * noise);
    }
    return { item, key };
  });
  keyed.sort((a, b) => {
    if (b.key !== a.key) {
      return b.key - a.key;
    }
    if (b.item.area !== a.item.area) {
      return b.item.area - a.item.area;
    }
    return a.item.seq - b.item.seq;
  });
  return keyed.map((k) => k.item);
}

function score(choice, f, w, h) {
  const lw = f.w - w;
  const lh = f.h - h;
  if (lw === 0 && lh === 0) {
    return [-Infinity, -Infinity];
  }
  switch (choice) {
    case 'baf':
      return [f.w * f.h - w * h, Math.min(lw, lh)];
    case 'bssf':
      return [Math.min(lw, lh), Math.max(lw, lh)];
    case 'blsf':
      return [Math.max(lw, lh), Math.min(lw, lh)];
    case 'tl':
      return [f.y, f.x];
    default:
      return [f.x, f.y];
  }
}

function lessScore(a, b) {
  if (a[0] !== b[0]) {
    return a[0] < b[0];
  }
  return a[1] < b[1];
}

function splitHorizontal(split, f, w, h) {
  const lw = f.w - w;
  const lh = f.h - h;
  switch (split) {
    case 'sla':
      return lw <= lh;
    case 'lla':
      return lw > lh;
    case 'minas':
      return w * lh > lw * h;
    case 'maxas':
      return w * lh <= lw * h;
    case 'sa':
      return f.w <= f.h;
    case 'la':
      return f.w > f.h;
    case 'h':
      return true;
    default:
      return false;
  }
}

function hCut(cuts, y, x1, x2, room, kerf) {
  cuts.push({ axis: 'h', pos: y, from: x1, to: x2, thickness: Math.min(kerf, room) });
}

function vCut(cuts, x, y1, y2, room, kerf) {
  cuts.push({ axis: 'v', pos: x, from: y1, to: y2, thickness: Math.min(kerf, room) });
}

// Packs as many items from `order` as possible onto one sheet of W x H.
export function packSheet(order, W, H, kerf, choice, split) {
  const free = [{ x: 0, y: 0, w: W, h: H }];
  const placements = [];
  const cuts = [];
  const remaining = [];
  let usedArea = 0;
  for (const item of order) {
    let best = null;
    for (let fi = 0; fi < free.length; fi++) {
      const f = free[fi];
      for (const o of item.orients) {
        if (o.w <= f.w && o.h <= f.h) {
          const s = score(choice, f, o.w, o.h);
          if (best === null || lessScore(s, best.s)) {
            best = { fi, o, s };
          }
        }
      }
    }
    if (best === null) {
      remaining.push(item);
      continue;
    }
    const f = free[best.fi];
    free.splice(best.fi, 1);
    const { w, h } = best.o;
    placements.push({ item, x: f.x, y: f.y, w, h, rotated: best.o.rotated });
    usedArea += w * h;
    const roomW = f.w - w;
    const roomH = f.h - h;
    const rw = roomW - kerf;
    const bh = roomH - kerf;
    if (splitHorizontal(split, f, w, h)) {
      if (roomH > 0) {
        hCut(cuts, f.y + h, f.x, f.x + f.w, roomH, kerf);
        if (bh > 0) {
          free.push({ x: f.x, y: f.y + h + kerf, w: f.w, h: bh });
        }
      }
      if (roomW > 0) {
        vCut(cuts, f.x + w, f.y, f.y + h, roomW, kerf);
        if (rw > 0) {
          free.push({ x: f.x + w + kerf, y: f.y, w: rw, h });
        }
      }
    } else {
      if (roomW > 0) {
        vCut(cuts, f.x + w, f.y, f.y + f.h, roomW, kerf);
        if (rw > 0) {
          free.push({ x: f.x + w + kerf, y: f.y, w: rw, h: f.h });
        }
      }
      if (roomH > 0) {
        hCut(cuts, f.y + h, f.x, f.x + w, roomH, kerf);
        if (bh > 0) {
          free.push({ x: f.x, y: f.y + h + kerf, w, h: bh });
        }
      }
    }
  }
  return { placements, cuts, free, remaining, usedArea };
}

function largestFree(sheet) {
  let best = 0;
  for (const f of sheet.free) {
    if (f.w * f.h > best) {
      best = f.w * f.h;
    }
  }
  return best;
}

function betterSheet(a, b) {
  if (b === null) {
    return true;
  }
  if (a.usedArea !== b.usedArea) {
    return a.usedArea > b.usedArea;
  }
  if (a.cuts.length !== b.cuts.length) {
    return a.cuts.length < b.cuts.length;
  }
  return largestFree(a) > largestFree(b);
}

function minUsed(sol) {
  let m = Infinity;
  for (const s of sol.sheets) {
    if (s.usedArea < m) {
      m = s.usedArea;
    }
  }
  return m;
}

function cutCount(sol) {
  let n = 0;
  for (const s of sol.sheets) {
    n += s.cuts.length;
  }
  return n;
}

// Fewest sheets first; then the emptiest sheet as empty as possible (one big reusable
// offcut beats scraps spread over every sheet); then fewest cuts.
export function betterSolution(a, b) {
  if (b === null) {
    return true;
  }
  if (a.sheets.length !== b.sheets.length) {
    return a.sheets.length < b.sheets.length;
  }
  const ma = minUsed(a);
  const mb = minUsed(b);
  if (ma !== mb) {
    return ma < mb;
  }
  return cutCount(a) < cutCount(b);
}

function runFixed(items, ctx, combo) {
  const sheets = [];
  let remaining = sortItems(items, combo.order, null, 0);
  while (remaining.length > 0) {
    const s = packSheet(remaining, ctx.W, ctx.H, ctx.kerf, combo.choice, combo.split);
    if (s.placements.length === 0) {
      break;
    }
    sheets.push(s);
    remaining = s.remaining;
  }
  return { sheets };
}

// Builds each sheet with whichever combo fills it best, then moves on.
function runGreedy(items, ctx, combos, rng, noise) {
  const sheets = [];
  let remaining = items;
  while (remaining.length > 0) {
    let best = null;
    for (const c of combos) {
      const order = sortItems(remaining, c.order, rng, noise);
      const s = packSheet(order, ctx.W, ctx.H, ctx.kerf, c.choice, c.split);
      if (betterSheet(s, best)) {
        best = s;
      }
    }
    if (best === null || best.placements.length === 0) {
      break;
    }
    sheets.push(best);
    remaining = best.remaining;
  }
  return { sheets };
}

function allCombos() {
  const combos = [];
  for (const order of ORDERS) {
    for (const choice of CHOICES) {
      for (const split of SPLITS) {
        combos.push({ order, choice, split });
      }
    }
  }
  return combos;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

export function expandParts(input) {
  const { sheet, trim, sheetGrain } = input;
  const W = sheet.length - 2 * trim;
  const H = sheet.width - 2 * trim;
  const items = [];
  const unplaced = [];
  let seq = 0;
  for (const part of input.parts) {
    const canRotate = !(sheetGrain && part.grain);
    const fitsNormal = part.length <= W && part.width <= H;
    const fitsRotated = part.width <= W && part.length <= H;
    if (!fitsNormal && !(canRotate && fitsRotated)) {
      let reason = 'Larger than the usable sheet area.';
      if (fitsRotated) {
        reason = 'Fits only across the grain, and its grain is locked.';
      }
      unplaced.push({ partId: part.id, label: part.label, count: part.qty, reason });
      continue;
    }
    const orients = [];
    if (fitsNormal) {
      orients.push({ w: part.length, h: part.width, rotated: false });
    }
    if (canRotate && fitsRotated && part.length !== part.width) {
      orients.push({ w: part.width, h: part.length, rotated: true });
    }
    for (let i = 0; i < part.qty; i++) {
      items.push({
        seq: seq++,
        partId: part.id,
        label: part.label,
        l: part.length,
        w: part.width,
        area: part.length * part.width,
        orients,
      });
    }
  }
  return { items, unplaced, W, H };
}

export function validateInput(input) {
  const errors = [];
  const { sheet, kerf, trim } = input;
  if (!(sheet.length > 0) || !(sheet.width > 0)) {
    errors.push('Sheet length and width must be more than zero.');
  }
  if (!(kerf >= 0)) {
    errors.push('Blade width must be zero or more.');
  }
  if (!(trim >= 0)) {
    errors.push('Edge trim must be zero or more.');
  }
  if (errors.length === 0 && (sheet.length - 2 * trim <= 0 || sheet.width - 2 * trim <= 0)) {
    errors.push('Edge trim removes the full sheet.');
  }
  for (const part of input.parts) {
    if (!(part.length > 0) || !(part.width > 0)) {
      errors.push(`Part "${part.label}" needs a length and width more than zero.`);
    }
    if (!Number.isInteger(part.qty) || part.qty < 1) {
      errors.push(`Part "${part.label}" needs a quantity of 1 or more.`);
    }
  }
  return errors;
}

function finish(best, input, ctx, unplaced, startedAt, trials) {
  const { trim } = input;
  const sheets = [];
  let partArea = 0;
  let totalCuts = 0;
  let cutLength = 0;
  if (best) {
    for (const s of best.sheets) {
      const placements = s.placements.map((p) => ({
        partId: p.item.partId,
        label: p.item.label,
        x: p.x + trim,
        y: p.y + trim,
        w: p.w,
        h: p.h,
        rotated: p.rotated,
      }));
      const cuts = s.cuts.map((c) => ({ ...c, pos: c.pos + trim, from: c.from + trim, to: c.to + trim }));
      const offcuts = s.free
        .map((f) => ({ x: f.x + trim, y: f.y + trim, w: f.w, h: f.h }))
        .sort((a, b) => b.w * b.h - a.w * a.h);
      for (const c of cuts) {
        cutLength += c.to - c.from;
      }
      totalCuts += cuts.length;
      partArea += s.usedArea;
      sheets.push({ placements, cuts, offcuts, usedArea: s.usedArea });
    }
  }
  const sheetArea = input.sheet.length * input.sheet.width;
  let placedCount = 0;
  for (const s of sheets) {
    placedCount += s.placements.length;
  }
  let efficiency = 0;
  if (sheets.length > 0) {
    efficiency = partArea / (sheetArea * sheets.length);
  }
  return {
    sheets,
    unplaced,
    stats: {
      sheetCount: sheets.length,
      lowerBound: ctx.lowerBound,
      placedCount,
      partArea,
      sheetArea,
      efficiency,
      cutCount: totalCuts,
      cutLength,
      trials,
      elapsedMs: Math.round(now() - startedAt),
    },
  };
}

export function solve(input, options = {}) {
  const startedAt = now();
  const errors = validateInput(input);
  if (errors.length > 0) {
    return { errors };
  }
  let budget = EFFORT_MS.normal;
  if (options.effort && EFFORT_MS[options.effort] !== undefined) {
    budget = EFFORT_MS[options.effort];
  }
  if (typeof options.timeLimitMs === 'number') {
    budget = options.timeLimitMs;
  }
  const deadline = startedAt + budget;
  const rng = mulberry32(options.seed ?? 12345);

  const { items, unplaced, W, H } = expandParts(input);
  let itemArea = 0;
  for (const it of items) {
    itemArea += it.area;
  }
  const ctx = { W, H, kerf: input.kerf, lowerBound: Math.ceil(itemArea / (W * H)) };
  if (items.length === 0) {
    return finish(null, input, ctx, unplaced, startedAt, 0);
  }

  const combos = allCombos();
  let best = null;
  let trials = 0;
  const atBound = () => best !== null && best.sheets.length <= ctx.lowerBound;

  // The first fixed combo always runs so a result exists even with a zero budget.
  for (const combo of combos) {
    const sol = runFixed(items, ctx, combo);
    trials++;
    if (betterSolution(sol, best)) {
      best = sol;
    }
    if (now() > deadline) {
      break;
    }
  }

  if (now() <= deadline) {
    const sol = runGreedy(items, ctx, combos, null, 0);
    trials++;
    if (betterSolution(sol, best)) {
      best = sol;
    }
  }

  // At the lower bound the sheet count is optimal; spend a short time on offcut quality only.
  let randomDeadline = deadline;
  if (atBound()) {
    randomDeadline = Math.min(deadline, now() + budget * 0.15);
  }
  const maxTrials = options.maxTrials ?? Infinity;
  while (now() < randomDeadline && trials < maxTrials) {
    const sample = [];
    const n = 4 + Math.floor(rng() * 12);
    for (let i = 0; i < n; i++) {
      sample.push({ order: pick(ORDERS, rng), choice: pick(CHOICES, rng), split: pick(SPLITS, rng) });
    }
    const sol = runGreedy(items, ctx, sample, rng, 0.05 + rng() * 0.4);
    trials++;
    if (betterSolution(sol, best)) {
      best = sol;
    }
  }

  return finish(best, input, ctx, unplaced, startedAt, trials);
}
