// Independent checks on a solved layout. The app runs these on every result and
// shows an error instead of a wrong plan.

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function separatedByKerf(a, b, kerf) {
  return (
    a.x + a.w + kerf <= b.x ||
    b.x + b.w + kerf <= a.x ||
    a.y + a.h + kerf <= b.y ||
    b.y + b.h + kerf <= a.y
  );
}

function cutRect(c) {
  if (c.axis === 'h') {
    return { x: c.from, y: c.pos, w: c.to - c.from, h: c.thickness };
  }
  return { x: c.pos, y: c.from, w: c.thickness, h: c.to - c.from };
}

// True when the rects can be separated by straight edge-to-edge cuts, each `kerf` wide.
export function isGuillotine(rects, kerf) {
  if (rects.length <= 1) {
    return true;
  }
  for (const [axis, size] of [['x', 'w'], ['y', 'h']]) {
    const ends = [...new Set(rects.map((r) => r[axis] + r[size]))].sort((a, b) => a - b);
    for (const cut of ends) {
      const before = [];
      const after = [];
      let valid = true;
      for (const r of rects) {
        if (r[axis] + r[size] <= cut) {
          before.push(r);
        } else if (r[axis] >= cut + kerf) {
          after.push(r);
        } else {
          valid = false;
          break;
        }
      }
      if (valid && before.length > 0 && after.length > 0) {
        return isGuillotine(before, kerf) && isGuillotine(after, kerf);
      }
    }
  }
  return false;
}

// Replays the cut list on the sheet. Each cut must run fully across one current
// piece; at the end every part must be a piece of its own.
export function checkCutSequence(region, placements, cuts, kerf) {
  const problems = [];
  let pieces = [region];
  cuts.forEach((c, i) => {
    const index = pieces.findIndex((pc) => {
      if (c.axis === 'h') {
        return pc.x === c.from && pc.x + pc.w === c.to && c.pos >= pc.y && c.pos < pc.y + pc.h;
      }
      return pc.y === c.from && pc.y + pc.h === c.to && c.pos >= pc.x && c.pos < pc.x + pc.w;
    });
    if (index === -1) {
      problems.push(`cut ${i + 1} does not run fully across one piece.`);
      return;
    }
    const pc = pieces[index];
    const next = [];
    if (c.axis === 'h') {
      const end = pc.y + pc.h;
      if (c.thickness !== Math.min(kerf, end - c.pos)) {
        problems.push(`cut ${i + 1} has the wrong width.`);
      }
      next.push({ x: pc.x, y: pc.y, w: pc.w, h: c.pos - pc.y });
      next.push({ x: pc.x, y: c.pos + kerf, w: pc.w, h: end - c.pos - kerf });
    } else {
      const end = pc.x + pc.w;
      if (c.thickness !== Math.min(kerf, end - c.pos)) {
        problems.push(`cut ${i + 1} has the wrong width.`);
      }
      next.push({ x: pc.x, y: pc.y, w: c.pos - pc.x, h: pc.h });
      next.push({ x: c.pos + kerf, y: pc.y, w: end - c.pos - kerf, h: pc.h });
    }
    pieces.splice(index, 1, ...next.filter((n) => n.w > 0 && n.h > 0));
  });
  for (const p of placements) {
    const free = pieces.some((pc) => pc.x === p.x && pc.y === p.y && pc.w === p.w && pc.h === p.h);
    if (!free) {
      problems.push(`"${p.label}" is not cut free by the cut list.`);
    }
  }
  return problems;
}

export function verifySolution(input, result) {
  const problems = [];
  const { sheet, kerf, trim, sheetGrain } = input;
  const partsById = new Map(input.parts.map((p) => [p.id, p]));
  const counts = new Map();

  result.sheets.forEach((s, si) => {
    const tag = `Sheet ${si + 1}`;
    for (const p of s.placements) {
      const part = partsById.get(p.partId);
      if (!part) {
        problems.push(`${tag}: unknown part ${p.partId}.`);
        continue;
      }
      counts.set(p.partId, (counts.get(p.partId) || 0) + 1);
      const normal = p.w === part.length && p.h === part.width && !p.rotated;
      const turned = p.w === part.width && p.h === part.length && p.rotated;
      if (!normal && !turned) {
        problems.push(`${tag}: "${part.label}" has the wrong size.`);
      }
      if (p.rotated && sheetGrain && part.grain && part.length !== part.width) {
        problems.push(`${tag}: "${part.label}" is turned against the grain.`);
      }
      if (p.x < trim || p.y < trim || p.x + p.w > sheet.length - trim || p.y + p.h > sheet.width - trim) {
        problems.push(`${tag}: "${part.label}" is outside the usable sheet area.`);
      }
    }
    for (let i = 0; i < s.placements.length; i++) {
      for (let j = i + 1; j < s.placements.length; j++) {
        if (!separatedByKerf(s.placements[i], s.placements[j], kerf)) {
          problems.push(
            `${tag}: "${s.placements[i].label}" and "${s.placements[j].label}" have less than one blade width between them.`,
          );
        }
      }
    }
    for (const c of s.cuts) {
      const r = cutRect(c);
      for (const p of s.placements) {
        if (overlaps(r, p)) {
          problems.push(`${tag}: a cut goes through "${p.label}".`);
        }
      }
    }
    const region = { x: trim, y: trim, w: sheet.length - 2 * trim, h: sheet.width - 2 * trim };
    for (const message of checkCutSequence(region, s.placements, s.cuts, kerf)) {
      problems.push(`${tag}: ${message}`);
    }
    if (!isGuillotine(s.placements, kerf)) {
      problems.push(`${tag}: the layout cannot be cut with straight through cuts.`);
    }
  });

  const missing = new Map();
  for (const u of result.unplaced) {
    missing.set(u.partId, (missing.get(u.partId) || 0) + u.count);
  }
  for (const part of input.parts) {
    const total = (counts.get(part.id) || 0) + (missing.get(part.id) || 0);
    if (total !== part.qty) {
      problems.push(`"${part.label}": ${total} accounted for, ${part.qty} requested.`);
    }
  }
  return problems;
}
