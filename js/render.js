import { formatLength, UNITS } from './units.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function partHue(index) {
  return Math.round((index * 137.508 + 25) % 360);
}

// Sheets with the same layout are shown once with a count.
export function groupSheets(sheets) {
  const groups = [];
  const bySignature = new Map();
  sheets.forEach((sheet, index) => {
    const sig = sheet.placements.map((p) => `${p.partId}:${p.x},${p.y},${p.w},${p.h}`).join('|');
    const existing = bySignature.get(sig);
    if (existing) {
      existing.indexes.push(index);
    } else {
      const group = { sheet, indexes: [index] };
      bySignature.set(sig, group);
      groups.push(group);
    }
  });
  return groups;
}

function partSize(p) {
  if (p.rotated) {
    return { length: p.h, width: p.w };
  }
  return { length: p.w, width: p.h };
}

function partText(p, g, fmt, base, minSize) {
  const size = partSize(p);
  const label = p.label;
  const dims = `${fmt(size.length)} × ${fmt(size.width)}`;
  let across = g.w;
  let tall = g.h;
  let rotate = false;
  if (g.h > g.w * 1.6) {
    across = g.h;
    tall = g.w;
    rotate = true;
  }
  const chars = Math.max(label.length, dims.length, 1);
  let fs = Math.min(base, (across * 0.9) / (chars * 0.58), tall / 2.8);
  let lines = [label, dims];
  if (fs < minSize) {
    const oneLine = Math.min(base, (across * 0.9) / (Math.max(label.length, 1) * 0.58), tall / 1.4);
    if (oneLine < minSize) {
      return '';
    }
    fs = oneLine;
    lines = [label];
  }
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  let transform = '';
  if (rotate) {
    transform = ` transform="rotate(-90 ${cx} ${cy})"`;
  }
  let out = `<text x="${cx}" y="${cy}" font-size="${fs}"${transform}>`;
  if (lines.length === 2) {
    out += `<tspan x="${cx}" dy="-0.15em" class="pl">${esc(lines[0])}</tspan>`;
    out += `<tspan x="${cx}" dy="1.15em" class="pd">${esc(lines[1])}</tspan>`;
  } else {
    out += `<tspan x="${cx}" dy="0.35em" class="pl">${esc(lines[0])}</tspan>`;
  }
  return `${out}</text>`;
}

function cutRect(c) {
  if (c.axis === 'h') {
    return { x: c.from, y: c.pos, w: c.to - c.from, h: c.thickness };
  }
  return { x: c.pos, y: c.from, w: c.thickness, h: c.to - c.from };
}

// Drawn in display units (inches or mm): browsers clamp huge font sizes, so raw units cannot be used.
export function sheetSvg(sheet, input, unit, hues, key) {
  const fmt = (v) => formatLength(v, unit);
  const k = 1 / UNITS[unit].scale;
  const sc = (r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  const L = input.sheet.length * k;
  const W = input.sheet.width * k;
  const pad = Math.max(L, W) * 0.05;
  const base = Math.min(L, W) * 0.045;
  const minSize = Math.min(L, W) * 0.016;
  const hairline = Math.max(L, W) * 0.0015;
  const parts = [];

  parts.push(`<svg class="sheet-svg" viewBox="${-pad} ${-pad} ${L + pad * 1.2} ${W + pad * 1.2}" role="img" aria-label="Sheet layout">`);
  parts.push('<defs>');
  parts.push(
    `<pattern id="grain-${key}" patternUnits="userSpaceOnUse" width="${L}" height="${W / 16}">` +
      `<line x1="0" y1="${W / 32}" x2="${L}" y2="${W / 32}" class="grain-line" stroke-width="${hairline}"/></pattern>`,
  );
  parts.push(
    `<pattern id="hatch-${key}" patternUnits="userSpaceOnUse" width="${base}" height="${base}" patternTransform="rotate(45)">` +
      `<line x1="0" y1="0" x2="0" y2="${base}" class="hatch-line" stroke-width="${hairline * 1.5}"/></pattern>`,
  );
  parts.push('</defs>');

  parts.push(`<rect class="sheet-bg" x="0" y="0" width="${L}" height="${W}"/>`);
  if (input.sheetGrain) {
    parts.push(`<rect x="0" y="0" width="${L}" height="${W}" fill="url(#grain-${key})"/>`);
  }
  for (const o of sheet.offcuts) {
    parts.push(`<rect class="offcut" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="url(#hatch-${key})"><title>Offcut ${esc(fmt(o.w))} × ${esc(fmt(o.h))}</title></rect>`);
  }
  const t = input.trim;
  if (t > 0) {
    parts.push(`<path class="trim" fill-rule="evenodd" d="M0 0H${L}V${W}H0Z M${t} ${t}V${W - t}H${L - t}V${t}Z"><title>Edge trim</title></path>`);
  }
  for (const p of sheet.placements) {
    const size = partSize(p);
    const g = sc(p);
    let note = '';
    if (p.rotated) {
      note = ' (turned 90°)';
    }
    parts.push(
      `<g class="part" style="--h:${hues.get(p.partId)}">` +
        `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" stroke-width="${hairline}"/>` +
        partText(p, g, fmt, base, minSize) +
        `<title>${esc(p.label)}: ${esc(fmt(size.length))} × ${esc(fmt(size.width))}${note}</title></g>`,
    );
  }
  sheet.cuts.forEach((c, i) => {
    const r = sc(cutRect(c));
    const minVisible = hairline * 2;
    let w = r.w;
    let h = r.h;
    let x = r.x;
    let y = r.y;
    if (c.axis === 'h' && h < minVisible) {
      y -= (minVisible - h) / 2;
      h = minVisible;
    }
    if (c.axis === 'v' && w < minVisible) {
      x -= (minVisible - w) / 2;
      w = minVisible;
    }
    parts.push(`<rect class="cut" data-cut="${i}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
  });
  parts.push(`<rect class="sheet-edge" x="0" y="0" width="${L}" height="${W}" stroke-width="${hairline * 2}"/>`);

  const dimFs = base * 0.85;
  parts.push(`<text class="dim" x="${L / 2}" y="${-pad * 0.35}" font-size="${dimFs}">${esc(fmt(input.sheet.length))}</text>`);
  parts.push(`<text class="dim" x="${-pad * 0.35}" y="${W / 2}" font-size="${dimFs}" transform="rotate(-90 ${-pad * 0.35} ${W / 2})">${esc(fmt(input.sheet.width))}</text>`);
  if (input.sheetGrain) {
    parts.push(`<text class="dim grain-tag" x="${L}" y="${-pad * 0.35}" font-size="${dimFs * 0.8}">grain →</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

export function cutTable(sheet, input, unit) {
  const fmt = (v) => formatLength(v, unit);
  if (sheet.cuts.length === 0) {
    return '<p class="hint">No cuts. The part is the full sheet.</p>';
  }
  const rows = sheet.cuts.map((c, i) => {
    let kind = 'Crosscut';
    let where = `${fmt(c.pos)} from left`;
    let runFrom = 'top';
    if (c.axis === 'h') {
      kind = 'Rip';
      where = `${fmt(c.pos)} from top`;
      runFrom = 'left';
    }
    return (
      `<tr data-cut="${i}"><td>${i + 1}</td><td>${kind}</td><td>${esc(where)}</td>` +
      `<td>${esc(fmt(c.from))} → ${esc(fmt(c.to))} <span class="muted">(from ${runFrom})</span></td>` +
      `<td>${esc(fmt(c.to - c.from))}</td></tr>`
    );
  });
  let trimNote = '';
  if (input.trim > 0) {
    trimNote = `<p class="hint">First trim ${esc(fmt(input.trim))} from each edge. Positions are from the untrimmed sheet edges.</p>`;
  }
  return (
    trimNote +
    '<table class="cuts"><thead><tr><th>#</th><th>Cut</th><th>Blade edge at</th><th>Run</th><th>Length</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table>` +
    '<p class="hint">Rips run along the sheet length. The blade edge is the side of the cut nearest the part. Put the blade on the waste side of that line.</p>'
  );
}

export function partCounts(sheet) {
  const counts = new Map();
  for (const p of sheet.placements) {
    const entry = counts.get(p.partId);
    if (entry) {
      entry.count++;
    } else {
      counts.set(p.partId, { label: p.label, count: 1 });
    }
  }
  return counts;
}

export function usefulOffcuts(sheet, unit, limit) {
  const minSide = UNITS[unit].scale;
  let min = minSide;
  if (unit === 'mm') {
    min = minSide * 25;
  }
  return sheet.offcuts.filter((o) => o.w >= min && o.h >= min).slice(0, limit);
}
