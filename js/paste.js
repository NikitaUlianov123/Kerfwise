// Parses one line of a pasted parts list. Returns null when the line has no length and width.
export function parsePasteLine(line) {
  let fields = line.split(/[\t,;]/).map((f) => f.trim());
  if (fields.length === 1) {
    const m = line.match(/^(.+?)\s*[x×]\s*([^x×]+?)(?:\s*[x×]\s*(\d+))?\s*$/i);
    if (!m) {
      return null;
    }
    fields = [m[1], m[2]];
    if (m[3]) {
      fields.push(m[3]);
    }
  }
  if (fields.length < 2 || fields[0] === '' || fields[1] === '') {
    return null;
  }
  let qty = '1';
  if (fields[2]) {
    qty = fields[2];
  }
  let grain = null;
  if (fields[4]) {
    grain = /^(y|yes|true|1|grain)$/i.test(fields[4]);
  }
  let material = '';
  if (fields[5]) {
    material = fields[5];
  }
  return { length: fields[0], width: fields[1], qty, label: fields[3] || '', grain, material };
}
