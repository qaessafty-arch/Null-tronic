/** SI formatting / parsing helpers shared by UI, drawings and the simulator. */

const PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

export function formatSI(value: number, unit = '', digits = 3): string {
  if (!Number.isFinite(value)) return `${value} ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  for (const [scale, prefix] of PREFIXES) {
    if (abs >= scale * 0.9999999) {
      const scaled = value / scale;
      return `${trimNumber(scaled, digits)} ${prefix}${unit}`.trim();
    }
  }
  const [scale, prefix] = PREFIXES[PREFIXES.length - 1];
  return `${trimNumber(value / scale, digits)} ${prefix}${unit}`.trim();
}

function trimNumber(v: number, digits: number): string {
  const s = Number(v.toPrecision(digits)).toString();
  return s;
}

const SUFFIX: Record<string, number> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  'µ': 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

/**
 * Parse engineering notation: "4.7k", "4k7", "100n", "10u", "1meg", "2.2M" (M = mega when uppercase,
 * as engineers usually mean in component values; "m" lowercase = milli, SPICE "meg" = mega).
 * Trailing unit letters (Ω, ohm, F, H, V, A, W) are ignored.
 */
export function parseSI(input: string | number): number {
  if (typeof input === 'number') return input;
  let s = input.trim().replace(/\s+/g, '');
  s = s.replace(/(ohms?|Ω|F|H|V|A|W|Hz)$/i, (m) => (/^[mMkKuUnNpPgGtT]$/.test(m) ? m : ''));
  if (s === '') return NaN;
  // 4k7 style
  const infix = /^(-?\d+)([kKmMuUµnNpPgGtTrR])(\d+)$/.exec(s);
  if (infix) {
    const mult = infix[2] === 'R' || infix[2] === 'r' ? 1 : suffixValue(infix[2]);
    return parseFloat(`${infix[1]}.${infix[3]}`) * mult;
  }
  const m = /^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)(meg|[a-zA-Zµ]*)$/i.exec(s);
  if (!m) return NaN;
  const base = parseFloat(m[1]);
  if (!m[2]) return base;
  const mult = m[2].toLowerCase() === 'meg' ? 1e6 : suffixValue(m[2][0]);
  return Number.isNaN(mult) ? NaN : base * mult;
}

function suffixValue(ch: string): number {
  if (ch === 'M') return 1e6;
  if (ch === 'G') return 1e9;
  if (ch === 'T') return 1e12;
  if (ch === 'K') return 1e3;
  const v = SUFFIX[ch.toLowerCase()] ?? SUFFIX[ch];
  return v === undefined ? NaN : v;
}

export function mmToDisplay(mm: number, unit: 'mm' | 'cm' | 'm'): string {
  if (unit === 'm') return `${(mm / 1000).toFixed(2)} m`;
  if (unit === 'cm') return `${(mm / 10).toFixed(1)} cm`;
  return `${mm.toFixed(1)} mm`;
}
