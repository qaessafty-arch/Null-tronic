import type { Primitive } from '../drawing/primitives';

/**
 * Minimal, dependency-free PDF 1.4 writer producing true vector output (paths and Helvetica text).
 * Each composed sheet becomes one page at its exact paper size.
 */

const PT = 72 / 25.4; // points per millimetre

/** Map text to WinAnsi bytes; characters outside WinAnsi are transliterated. */
export function toWinAnsi(s: string): number[] {
  const map: Record<string, string> = { 'Ω': 'Ohm', '−': '-', '≥': '>=', '≤': '<=', 'φ': 'phi', 'Δ': 'd', '→': '->', '—': '\u0097', '–': '\u0096', '…': '\u0085', '·': '·', '✓': 'v' };
  const out: number[] = [];
  for (const ch of s) {
    const m = map[ch];
    const str = m ?? ch;
    for (const c of str) {
      const code = c.codePointAt(0)!;
      out.push(code < 256 ? code : 63);
    }
  }
  return out;
}

function pdfString(bytes: number[]): string {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

/** Approximate Helvetica advance width (1/1000 em) by character class. */
export function helveticaWidth(bytes: number[], bold = false): number {
  let w = 0;
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (c === ' ') w += 278;
    else if (/[0-9]/.test(c)) w += 556;
    else if (/[ilIj.,:;'!|]/.test(c)) w += 240;
    else if (/[mwMW]/.test(c)) w += 860;
    else if (/[A-Z]/.test(c)) w += bold ? 722 : 667;
    else if (/[a-z]/.test(c)) w += bold ? 556 : 520;
    else w += 584;
  }
  return w;
}

const f = (v: number) => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(3).replace(/\.?0+$/, ''));

function hexToRgb(c: string | undefined): [number, number, number] {
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return [0, 0, 0];
  return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
}

function arcBeziers(cx: number, cy: number, r: number, a0: number, a1: number): string {
  // angles in the PDF (y-up) frame, degrees, CCW from a0 to a1
  let sweep = a1 - a0;
  if (sweep <= 0) sweep += 360;
  const segs = Math.ceil(sweep / 90);
  const step = (sweep / segs) * (Math.PI / 180);
  let a = (a0 * Math.PI) / 180;
  let s = `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))} m\n`;
  for (let i = 0; i < segs; i++) {
    const k = (4 / 3) * Math.tan(step / 4);
    const x1 = cx + r * (Math.cos(a) - k * Math.sin(a));
    const y1 = cy + r * (Math.sin(a) + k * Math.cos(a));
    const a2 = a + step;
    const x2 = cx + r * (Math.cos(a2) + k * Math.sin(a2));
    const y2 = cy + r * (Math.sin(a2) - k * Math.cos(a2));
    s += `${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(cx + r * Math.cos(a2))} ${f(cy + r * Math.sin(a2))} c\n`;
    a = a2;
  }
  return s;
}

export interface PdfPage {
  width: number;
  height: number;
  prims: Primitive[];
}

function pageContent(page: PdfPage, monochrome: boolean): string {
  const H = page.height * PT;
  const X = (x: number) => x * PT;
  const Y = (y: number) => H - y * PT;
  let s = '1 J 1 j\n';
  const color = (c?: string) => {
    const [r, g, b] = monochrome ? (c && c.toLowerCase() === '#555555' ? [0.33, 0.33, 0.33] : [0, 0, 0]) : hexToRgb(c);
    return `${f(r)} ${f(g)} ${f(b)} RG ${f(r)} ${f(g)} ${f(b)} rg\n`;
  };
  for (const p of page.prims) {
    const w = 'w' in p && p.w !== undefined ? p.w : 0.25;
    if (p.k !== 'text') s += `${f(w * PT)} w\n` + ('dash' in p && p.dash ? `[${p.dash.map((d) => f(d * PT)).join(' ')}] 0 d\n` : '[] 0 d\n');
    s += color(p.color);
    switch (p.k) {
      case 'line':
        s += `${f(X(p.a.x))} ${f(Y(p.a.y))} m ${f(X(p.b.x))} ${f(Y(p.b.y))} l S\n`;
        break;
      case 'poly':
        if (p.pts.length < 2) break;
        s += `${f(X(p.pts[0].x))} ${f(Y(p.pts[0].y))} m\n`;
        for (const q of p.pts.slice(1)) s += `${f(X(q.x))} ${f(Y(q.y))} l\n`;
        s += p.closed ? (p.fill ? 'b\n' : 's\n') : 'S\n';
        break;
      case 'circle':
        s += arcBeziers(X(p.c.x), Y(p.c.y), p.r * PT, 0, 360) + (p.fill ? 'b\n' : 's\n');
        break;
      case 'arc':
        // y-down sweep a0→a1 becomes y-up CCW sweep from −a1 to −a0
        s += arcBeziers(X(p.c.x), Y(p.c.y), p.r * PT, -p.a1, -p.a0) + 'S\n';
        break;
      case 'text': {
        const bytes = toWinAnsi(p.text);
        const size = p.size * PT * 1.0;
        const width = (helveticaWidth(bytes, p.bold) / 1000) * size;
        let x = X(p.p.x);
        if ((p.anchor ?? 'middle') === 'middle') x -= width / 2;
        else if (p.anchor === 'end') x -= width;
        let y = Y(p.p.y);
        const base = p.baseline ?? 'middle';
        if (base === 'middle') y -= size * 0.35;
        else if (base === 'top') y -= size * 0.75;
        s += `BT /${p.bold ? 'F2' : 'F1'} ${f(size)} Tf ${f(x)} ${f(y)} Td ${pdfString(bytes)} Tj ET\n`;
        break;
      }
    }
  }
  return s;
}

export function buildPdf(pages: PdfPage[], opts: { title?: string; author?: string; monochrome?: boolean } = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const pg of pages) {
    const content = pageContent(pg, opts.monochrome ?? true);
    const contentId = add(`<< /Length ${latin1Length(content)} >>\nstream\n${content}endstream`);
    const pid = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(pg.width * PT)} ${f(pg.height * PT)}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pid);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Title ${pdfString(toWinAnsi(opts.title ?? 'Drawing'))} /Author ${pdfString(toWinAnsi(opts.author ?? ''))} /Producer (NULL-TECH CIRCUIT STUDIO) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(latin1Length(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = latin1Length(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

function latin1Length(s: string): number {
  return s.length; // all content is 8-bit (escaped), one byte per char
}
