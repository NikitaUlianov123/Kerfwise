// Re-plans the cut sequence for parts whose positions are already fixed.
// The packer's own cuts follow the order it placed parts, so cuts that line up
// across several parts can come out as separate short cuts. The search finds the
// fewest through cuts that free every part, so aligned cuts merge into one.
// The returned list is in depth-first order (see orderDepthFirst).

const ABORT = Symbol('abort');

function axisKeys(axis) {
  if (axis === 'h') {
    return { p: 'y', s: 'h', q: 'x', t: 'w' };
  }
  return { p: 'x', s: 'w', q: 'y', t: 'h' };
}

// Positions where a cut of width `kerf` passes every rect. When two positions
// would overlap (kerf bands touch), the larger one is kept: the blade removes
// material on the + side, and leftover waste on the - side gets its own cut later.
function validPositions(region, rects, axis, kerf) {
  const { p, s } = axisKeys(axis);
  const start = region[p];
  const end = region[p] + region[s];
  const raw = new Set();
  for (const r of rects) {
    raw.add(r[p] + r[s]);
    raw.add(r[p] - kerf);
  }
  return [...raw]
    .filter((c) => c < end && (c > start || (c === start && kerf > 0)))
    .filter((c) => rects.every((r) => r[p] + r[s] <= c || r[p] >= c + kerf))
    .sort((a, b) => a - b);
}

function cutPositions(region, rects, axis, kerf) {
  const valid = validPositions(region, rects, axis, kerf);
  const chosen = [];
  for (const c of valid) {
    if (chosen.length > 0 && c < chosen[chosen.length - 1] + kerf) {
      chosen[chosen.length - 1] = c;
    } else {
      chosen.push(c);
    }
  }
  return chosen;
}

function better(a, b) {
  if (b === null) {
    return true;
  }
  if (a.count !== b.count) {
    return a.count < b.count;
  }
  return a.length < b.length;
}

function search(placements, W, H, kerf, maxNodes, exact) {
  const memo = new Map();
  let nodes = 0;

  function solvePieces(region, rects, axis, positions, result) {
    const { p, s, q, t } = axisKeys(axis);
    const end = region[p] + region[s];
    const cuts = [];
    const pieces = [];
    let pieceStart = region[p];
    for (const c of positions) {
      cuts.push({ axis, pos: c, from: region[q], to: region[q] + region[t], thickness: Math.min(kerf, end - c) });
      if (c > pieceStart) {
        pieces.push([pieceStart, c]);
      }
      pieceStart = c + kerf;
    }
    if (pieceStart < end) {
      pieces.push([pieceStart, end]);
    }
    let count = cuts.length;
    let length = cuts.length * region[t];
    const allCuts = [...cuts];
    const offcuts = [];
    for (const [a, b] of pieces) {
      const piece = { ...region };
      piece[p] = a;
      piece[s] = b - a;
      const inside = rects.filter((r) => r[p] >= a && r[p] + r[s] <= b);
      const sub = best(piece, inside);
      if (sub === null) {
        return result;
      }
      count += sub.count;
      length += sub.length;
      allCuts.push(...sub.cuts);
      offcuts.push(...sub.offcuts);
    }
    const candidate = { count, length, cuts: allCuts, offcuts };
    if (better(candidate, result)) {
      return candidate;
    }
    return result;
  }

  function best(region, rects) {
    if (rects.length === 0) {
      return { count: 0, length: 0, cuts: [], offcuts: [region] };
    }
    if (rects.length === 1) {
      const r = rects[0];
      if (r.x === region.x && r.y === region.y && r.w === region.w && r.h === region.h) {
        return { count: 0, length: 0, cuts: [], offcuts: [] };
      }
    }
    const key = `${region.x},${region.y},${region.w},${region.h}`;
    if (memo.has(key)) {
      return memo.get(key);
    }
    nodes++;
    if (nodes > maxNodes) {
      throw ABORT;
    }
    let result = null;
    for (const axis of ['h', 'v']) {
      if (exact) {
        // Any cut sequence starts with one through cut, so trying each one is exact.
        for (const c of validPositions(region, rects, axis, kerf)) {
          result = solvePieces(region, rects, axis, [c], result);
        }
      } else {
        const positions = cutPositions(region, rects, axis, kerf);
        if (positions.length > 0) {
          result = solvePieces(region, rects, axis, positions, result);
        }
      }
    }
    memo.set(key, result);
    return result;
  }

  try {
    const rects = placements.map((pl) => ({ x: pl.x, y: pl.y, w: pl.w, h: pl.h }));
    return best({ x: 0, y: 0, w: W, h: H }, rects);
  } catch (err) {
    if (err === ABORT) {
      return null;
    }
    throw err;
  }
}

// Orders a valid cut list depth first: after a cut splits a piece in two, every
// cut in the first piece comes before any cut in the second, at every level.
// The cut tree is rebuilt by replaying the list, so any valid order works as input.
export function orderDepthFirst(cuts, region, kerf) {
  const root = { ...region, cut: null, children: [] };
  let leaves = [root];
  for (const c of cuts) {
    const at = leaves.findIndex((pc) => {
      if (c.axis === 'h') {
        return pc.x === c.from && pc.x + pc.w === c.to && c.pos >= pc.y && c.pos < pc.y + pc.h;
      }
      return pc.y === c.from && pc.y + pc.h === c.to && c.pos >= pc.x && c.pos < pc.x + pc.w;
    });
    if (at === -1) {
      return cuts;
    }
    const pc = leaves[at];
    let parts = [];
    if (c.axis === 'h') {
      parts = [
        { x: pc.x, y: pc.y, w: pc.w, h: c.pos - pc.y },
        { x: pc.x, y: c.pos + kerf, w: pc.w, h: pc.y + pc.h - c.pos - kerf },
      ];
    } else {
      parts = [
        { x: pc.x, y: pc.y, w: c.pos - pc.x, h: pc.h },
        { x: c.pos + kerf, y: pc.y, w: pc.x + pc.w - c.pos - kerf, h: pc.h },
      ];
    }
    pc.cut = c;
    pc.children = parts.filter((n) => n.w > 0 && n.h > 0).map((n) => ({ ...n, cut: null, children: [] }));
    leaves.splice(at, 1, ...pc.children);
  }
  const out = [];
  const visit = (node) => {
    if (node.cut === null) {
      return;
    }
    out.push(node.cut);
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

// Exact search first; if the sheet is too complex for the node limit, the
// one-axis-at-a-time shortcut. Returns null when neither finishes.
export function recut(placements, W, H, kerf, maxNodes = 20000) {
  let plan = search(placements, W, H, kerf, maxNodes, true);
  if (plan === null) {
    plan = search(placements, W, H, kerf, maxNodes, false);
  }
  if (plan === null) {
    return null;
  }
  return { ...plan, cuts: orderDepthFirst(plan.cuts, { x: 0, y: 0, w: W, h: H }, kerf) };
}
