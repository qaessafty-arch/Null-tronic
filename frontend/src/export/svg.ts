import type { Primitive } from '../drawing/primitives';

/** Vector SVG writer for composed sheets or raw primitive lists (units: millimetres). */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Number(v.toFixed(3));

export interface SvgOptions {
  monochrome?: boolean;
  background?: string;
  defaultColor?: string;
}

function arcPath(c: { x: number; y: number }, r: number, a0: number, a1: number): string {
  let sweep = a1 - a0;
  if (sweep <= 0) sweep += 360;
  if (sweep >= 359.999) {
    return `M ${n(c.x + r)} ${n(c.y)} A ${n(r)} ${n(r)} 0 1 1 ${n(c.x - r)} ${n(c.y)} A ${n(r)} ${n(r)} 0 1 1 ${n(c.x + r)} ${n(c.y)}`;
  }
  const s = { x: c.x + r * Math.cos((a0 * Math.PI) / 180), y: c.y + r * Math.sin((a0 * Math.PI) / 180) };
  const e = { x: c.x + r * Math.cos(((a0 + sweep) * Math.PI) / 180), y: c.y + r * Math.sin(((a0 + sweep) * Math.PI) / 180) };
  // y-down frame: increasing angle = clockwise on screen = SVG sweep-flag 1
  return `M ${n(s.x)} ${n(s.y)} A ${n(r)} ${n(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${n(e.x)} ${n(e.y)}`;
}

export function primitivesToSvgElements(prims: Primitive[], opts: SvgOptions = {}): string {
  const def = opts.defaultColor ?? '#000000';
  const col = (c?: string) => (opts.monochrome || !c ? def : c);
  const out: string[] = [];
  for (const p of prims) {
    const w = 'w' in p && p.w !== undefined ? p.w : 0.25;
    switch (p.k) {
      case 'line':
        out.push(`<line x1="${n(p.a.x)}" y1="${n(p.a.y)}" x2="${n(p.b.x)}" y2="${n(p.b.y)}" stroke="${col(p.color)}" stroke-width="${n(w)}" stroke-linecap="round"${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}/>`);
        break;
      case 'poly': {
        const pts = p.pts.map((q) => `${n(q.x)},${n(q.y)}`).join(' ');
        const tag = p.closed ? 'polygon' : 'polyline';
        out.push(`<${tag} points="${pts}" fill="${p.fill ? col(p.color) : 'none'}" stroke="${col(p.color)}" stroke-width="${n(w)}" stroke-linejoin="round" stroke-linecap="round"${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}/>`);
        break;
      }
      case 'circle':
        out.push(`<circle cx="${n(p.c.x)}" cy="${n(p.c.y)}" r="${n(p.r)}" fill="${p.fill ? col(p.color) : 'none'}" stroke="${col(p.color)}" stroke-width="${n(w)}"/>`);
        break;
      case 'arc':
        out.push(`<path d="${arcPath(p.c, p.r, p.a0, p.a1)}" fill="none" stroke="${col(p.color)}" stroke-width="${n(w)}"/>`);
        break;
      case 'text': {
        const anchor = p.anchor ?? 'middle';
        const base = p.baseline === 'top' ? 'hanging' : p.baseline === 'bottom' ? 'alphabetic' : 'central';
        out.push(`<text x="${n(p.p.x)}" y="${n(p.p.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(p.size)}" text-anchor="${anchor}" dominant-baseline="${base}" fill="${col(p.color)}"${p.bold ? ' font-weight="bold"' : ''}>${esc(p.text)}</text>`);
        break;
      }
    }
  }
  return out.join('\n');
}

export function sheetToSvg(sheet: { width: number; height: number; prims: Primitive[] }, opts: SvgOptions = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}mm" height="${sheet.height}mm" viewBox="0 0 ${sheet.width} ${sheet.height}">
<rect x="0" y="0" width="${sheet.width}" height="${sheet.height}" fill="${opts.background ?? '#ffffff'}"/>
${primitivesToSvgElements(sheet.prims, opts)}
</svg>
`;
}
