import { scenePrimitives } from '../drawing/scene';
import type { Primitive } from '../drawing/primitives';
import { newId } from '../project-model/ids';
import type { Annotation, Project, Vec2 } from '../project-model/types';

/**
 * DXF exchange (AutoCAD R12 ASCII — the most widely readable dialect).
 * Export: model space at 1:1 in millimetres, one DXF layer per project layer.
 * Import: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, TEXT, MTEXT → annotations.
 * Limitations: blocks (INSERT), hatches, splines and dimensions are not imported; component
 * identity is preserved only as TEXT (reference designators) in the export.
 */

const g = (code: number, value: string | number) => `${code}\n${typeof value === 'number' ? fmt(value) : value}\n`;
const fmt = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${Number(v.toFixed(6))}`);

const ACI: Record<string, number> = { components: 7, wires: 3, cables: 30, architecture: 8, annotations: 9, underlay: 8 };

function dxfLayerName(n: string) {
  return n.toUpperCase().replace(/[^A-Z0-9_-]/g, '_') || '0';
}

function entitiesFor(prim: Primitive, layer: string): string {
  const L = dxfLayerName(layer);
  const Y = (y: number) => -y;
  switch (prim.k) {
    case 'line':
      return g(0, 'LINE') + g(8, L) + g(10, prim.a.x) + g(20, Y(prim.a.y)) + g(30, 0) + g(11, prim.b.x) + g(21, Y(prim.b.y)) + g(31, 0);
    case 'poly': {
      let s = g(0, 'POLYLINE') + g(8, L) + g(66, 1) + g(10, 0) + g(20, 0) + g(30, 0) + g(70, prim.closed ? 1 : 0);
      for (const q of prim.pts) s += g(0, 'VERTEX') + g(8, L) + g(10, q.x) + g(20, Y(q.y)) + g(30, 0);
      return s + g(0, 'SEQEND') + g(8, L);
    }
    case 'circle':
      return g(0, 'CIRCLE') + g(8, L) + g(10, prim.c.x) + g(20, Y(prim.c.y)) + g(30, 0) + g(40, prim.r);
    case 'arc':
      // y-down sweep a0→a1 equals y-up CCW sweep −a1 → −a0
      return g(0, 'ARC') + g(8, L) + g(10, prim.c.x) + g(20, Y(prim.c.y)) + g(30, 0) + g(40, prim.r) + g(50, norm(-prim.a1)) + g(51, norm(-prim.a0));
    case 'text': {
      const h = prim.anchor === 'start' || !prim.anchor ? 0 : prim.anchor === 'middle' ? 1 : 2;
      const v = prim.baseline === 'top' ? 3 : prim.baseline === 'bottom' ? 1 : 2;
      let s = g(0, 'TEXT') + g(8, L) + g(10, prim.p.x) + g(20, Y(prim.p.y)) + g(30, 0) + g(40, prim.size) + g(1, prim.text.replace(/\n/g, ' '));
      if (h || v) s += g(72, h) + g(73, v) + g(11, prim.p.x) + g(21, Y(prim.p.y)) + g(31, 0);
      return s;
    }
  }
}

const norm = (a: number) => ((a % 360) + 360) % 360;

export function exportDxf(project: Project): string {
  const ents = scenePrimitives(project);
  const layers = new Set<string>(['0']);
  let body = '';
  for (const e of ents) {
    layers.add(dxfLayerName(e.layer));
    for (const p of e.prims) body += entitiesFor(p, e.layer);
  }
  let tables = g(0, 'SECTION') + g(2, 'TABLES');
  tables += g(0, 'TABLE') + g(2, 'LTYPE') + g(70, 1) + g(0, 'LTYPE') + g(2, 'CONTINUOUS') + g(70, 0) + g(3, 'Solid line') + g(72, 65) + g(73, 0) + g(40, 0) + g(0, 'ENDTAB');
  tables += g(0, 'TABLE') + g(2, 'LAYER') + g(70, layers.size);
  for (const l of layers) tables += g(0, 'LAYER') + g(2, l) + g(70, 0) + g(62, ACI[l.toLowerCase()] ?? 7) + g(6, 'CONTINUOUS');
  tables += g(0, 'ENDTAB') + g(0, 'ENDSEC');
  const header = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009') + g(9, '$INSUNITS') + g(70, 4) + g(0, 'ENDSEC');
  return header + tables + g(0, 'SECTION') + g(2, 'ENTITIES') + body + g(0, 'ENDSEC') + g(0, 'EOF');
}

// ---------------------------------------------------------------- import

interface Pair {
  code: number;
  value: string;
}

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

export interface DxfImportResult {
  annotations: Annotation[];
  skipped: Record<string, number>;
  unitScale: number;
  layers: string[];
  closedPolylines: Vec2[][];
}

const UNIT_TO_MM: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

export function importDxf(text: string, targetLayer = 'underlay'): DxfImportResult {
  const ps = pairs(text);
  let unitScale = 1;
  for (let i = 0; i < ps.length - 1; i++) {
    if (ps[i].code === 9 && ps[i].value === '$INSUNITS') {
      unitScale = UNIT_TO_MM[parseInt(ps[i + 1].value, 10)] ?? 1;
      break;
    }
  }
  const start = ps.findIndex((p, i) => p.code === 2 && p.value === 'ENTITIES' && ps[i - 1]?.value === 'SECTION');
  const annotations: Annotation[] = [];
  const skipped: Record<string, number> = {};
  const layers = new Set<string>();
  const closedPolylines: Vec2[][] = [];
  if (start < 0) return { annotations, skipped, unitScale, layers: [], closedPolylines };
  const S = unitScale;
  const pt = (x: number, y: number): Vec2 => ({ x: x * S, y: -y * S });
  let i = start + 1;
  const readEntity = (): { type: string; data: Pair[] } | null => {
    if (i >= ps.length || ps[i].code !== 0) {
      i++;
      return null;
    }
    const type = ps[i].value;
    i++;
    const data: Pair[] = [];
    while (i < ps.length && ps[i].code !== 0) data.push(ps[i++]);
    return { type, data };
  };
  const num = (d: Pair[], code: number, def = 0) => {
    const p = d.find((x) => x.code === code);
    return p ? parseFloat(p.value) : def;
  };
  const str = (d: Pair[], code: number) => d.find((x) => x.code === code)?.value ?? '';
  while (i < ps.length) {
    const e = readEntity();
    if (!e) continue;
    if (e.type === 'ENDSEC') break;
    const layerName = str(e.data, 8) || '0';
    layers.add(layerName);
    const base = { id: newId('ann'), layer: targetLayer };
    switch (e.type) {
      case 'LINE':
        annotations.push({ ...base, kind: 'line', points: [pt(num(e.data, 10), num(e.data, 20)), pt(num(e.data, 11), num(e.data, 21))] });
        break;
      case 'LWPOLYLINE': {
        const pts: Vec2[] = [];
        let x: number | null = null;
        for (const p of e.data) {
          if (p.code === 10) x = parseFloat(p.value);
          if (p.code === 20 && x !== null) {
            pts.push(pt(x, parseFloat(p.value)));
            x = null;
          }
        }
        const closed = (num(e.data, 70) & 1) === 1;
        annotations.push({ ...base, kind: 'polyline', points: pts, closed });
        if (closed && pts.length >= 3) closedPolylines.push(pts);
        break;
      }
      case 'POLYLINE': {
        const closed = (num(e.data, 70) & 1) === 1;
        const pts: Vec2[] = [];
        while (i < ps.length) {
          const v = readEntity();
          if (!v) continue;
          if (v.type === 'VERTEX') pts.push(pt(num(v.data, 10), num(v.data, 20)));
          else if (v.type === 'SEQEND') break;
          else break;
        }
        annotations.push({ ...base, kind: 'polyline', points: pts, closed });
        if (closed && pts.length >= 3) closedPolylines.push(pts);
        break;
      }
      case 'CIRCLE':
        annotations.push({ ...base, kind: 'circle', points: [pt(num(e.data, 10), num(e.data, 20))], radius: num(e.data, 40) * S });
        break;
      case 'ARC':
        annotations.push({ ...base, kind: 'arc', points: [pt(num(e.data, 10), num(e.data, 20))], radius: num(e.data, 40) * S, startAngle: norm(-num(e.data, 51)), endAngle: norm(-num(e.data, 50)) });
        break;
      case 'TEXT':
      case 'MTEXT': {
        const t = e.type === 'MTEXT' ? (str(e.data, 3) + str(e.data, 1)).replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '') : str(e.data, 1);
        const aligned = e.type === 'TEXT' && (num(e.data, 72) || num(e.data, 73));
        const p = aligned ? pt(num(e.data, 11), num(e.data, 21)) : pt(num(e.data, 10), num(e.data, 20));
        annotations.push({ ...base, kind: 'text', points: [p], text: t, textHeight: num(e.data, 40, 2.5) * S });
        break;
      }
      default:
        skipped[e.type] = (skipped[e.type] ?? 0) + 1;
    }
  }
  return { annotations, skipped, unitScale, layers: [...layers], closedPolylines };
}
