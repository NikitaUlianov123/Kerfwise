// All geometry is integer "units" so fit checks are exact.
// 1 in = 64000 u (1/64" = 1000 u), 1 mm = 1000 u.
export const UNITS = {
  in: { scale: 64000, label: 'in' },
  mm: { scale: 1000, label: 'mm' },
};

const DECIMAL = /^(\d+(?:\.\d*)?|\.\d+)$/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)$/;
const MIXED = /^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/;
const FEET = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*-?\s*(.*)$/;
const INCH_SUFFIX = /\s*(?:"|''|inches|inch|in)$/;
const MM_SUFFIX = /\s*mm$/;

function parseMixedNumber(s) {
  let m = s.match(DECIMAL);
  if (m) {
    return Number(s);
  }
  m = s.match(FRACTION);
  if (m) {
    const den = Number(m[2]);
    if (den === 0) {
      return null;
    }
    return Number(m[1]) / den;
  }
  m = s.match(MIXED);
  if (m) {
    const den = Number(m[3]);
    if (den === 0) {
      return null;
    }
    return Number(m[1]) + Number(m[2]) / den;
  }
  return null;
}

function parseInches(text) {
  let s = text.trim().toLowerCase().replace(INCH_SUFFIX, '').trim();
  let feet = 0;
  const ft = s.match(FEET);
  if (ft) {
    feet = Number(ft[1]);
    s = ft[2].trim().replace(INCH_SUFFIX, '').trim();
    if (s === '') {
      return feet * 12;
    }
  }
  if (s === '') {
    return null;
  }
  const inches = parseMixedNumber(s);
  if (inches === null) {
    return null;
  }
  return feet * 12 + inches;
}

function parseMillimeters(text) {
  const s = text.trim().toLowerCase().replace(MM_SUFFIX, '').trim();
  if (!DECIMAL.test(s)) {
    return null;
  }
  return Number(s);
}

// Returns integer units, or null when the text is not a valid non-negative length.
export function parseLength(text, unit) {
  if (typeof text === 'number') {
    if (!Number.isFinite(text) || text < 0) {
      return null;
    }
    return Math.round(text * UNITS[unit].scale);
  }
  if (typeof text !== 'string') {
    return null;
  }
  let value = null;
  if (unit === 'in') {
    value = parseInches(text);
  } else {
    value = parseMillimeters(text);
  }
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * UNITS[unit].scale);
}

function gcd(a, b) {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function trimDecimal(n, places) {
  return String(Number(n.toFixed(places)));
}

// Inches are shown as reduced 1/64 fractions when exact, otherwise as decimals.
export function formatLength(u, unit) {
  const sign = u < 0;
  const abs = Math.abs(u);
  let text = '';
  if (unit === 'mm') {
    text = trimDecimal(abs / 1000, 2);
  } else if (abs % 1000 === 0) {
    const n = abs / 1000;
    const whole = Math.floor(n / 64);
    const rem = n % 64;
    if (rem === 0) {
      text = String(whole);
    } else {
      const g = gcd(rem, 64);
      const frac = `${rem / g}/${64 / g}`;
      if (whole === 0) {
        text = frac;
      } else {
        text = `${whole} ${frac}`;
      }
    }
  } else {
    text = trimDecimal(abs / 64000, 3);
  }
  if (sign) {
    return `-${text}`;
  }
  return text;
}

export function convertText(text, fromUnit, toUnit) {
  const u = parseLength(text, fromUnit);
  if (u === null) {
    return text;
  }
  const value = u / UNITS[fromUnit].scale;
  let converted = 0;
  if (fromUnit === 'in' && toUnit === 'mm') {
    converted = value * 25.4;
  } else if (fromUnit === 'mm' && toUnit === 'in') {
    converted = value / 25.4;
  } else {
    converted = value;
  }
  let rounded = Math.round(converted * UNITS[toUnit].scale);
  if (toUnit === 'in') {
    rounded = Math.round(rounded / 1000) * 1000;
  } else {
    rounded = Math.round(rounded / 100) * 100;
  }
  return formatLength(rounded, toUnit);
}
