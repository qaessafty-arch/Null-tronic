import { getDef } from '../component-library/library';
import { componentPrimitives, wirePolyline } from '../project-model/geometry';
import { attachmentCounts } from '../project-model/connectivity';
import type { Id, Project } from '../project-model/types';
import { transformPoint, text, type Primitive } from './primitives';

/**
 * Converts the project model into per-entity primitive groups. Used by the 2D canvas (with
 * interaction overlays) and by every drawing exporter, so screen and paper are identical.
 */

export type EntityKind = 'component' | 'wire' | 'junction' | 'room' | 'cable' | 'annotation';

export interface EntityPrims {
  id: Id;
  kind: EntityKind;
  layer: string;
  prims: Primitive[];
}

export interface SceneOptions {
  /** Draw ref/value labels. */
  labels?: boolean;
  /** Restrict to these layers (default: visible layers). */
  layers?: Set<string>;
  /** Plan-type filter for installation sheets. */
  filter?: 'all' | 'lighting' | 'power' | 'cables';
}

export function scenePrimitives(project: Project, opts: SceneOptions = {}): EntityPrims[] {
  const labels = opts.labels ?? true;
  const visible = opts.layers ?? new Set(project.layers.filter((l) => l.visible).map((l) => l.name));
  const out: EntityPrims[] = [];
  const isInst = project.type === 'installation';
  const filter = opts.filter ?? 'all';

  for (const r of Object.values(project.rooms)) {
    if (!visible.has('architecture') && isInst) continue;
    const prims: Primitive[] = [{ k: 'poly', pts: r.polygon, closed: true, w: r.wallThickness }];
    const cx = r.polygon.reduce((a, p) => a + p.x, 0) / r.polygon.length;
    const cy = r.polygon.reduce((a, p) => a + p.y, 0) / r.polygon.length;
    if (labels) prims.push(text(cx, cy + 350, r.name.toUpperCase(), 160));
    out.push({ id: r.id, kind: 'room', layer: 'architecture', prims });
  }

  for (const a of Object.values(project.annotations)) {
    if (!visible.has(a.layer) && project.layers.some((l) => l.name === a.layer)) continue;
    const prims: Primitive[] = [];
    switch (a.kind) {
      case 'line':
      case 'polyline':
        prims.push({ k: 'poly', pts: a.points, closed: a.closed });
        break;
      case 'circle':
        prims.push({ k: 'circle', c: a.points[0], r: a.radius ?? 1 });
        break;
      case 'arc':
        prims.push({ k: 'arc', c: a.points[0], r: a.radius ?? 1, a0: a.startAngle ?? 0, a1: a.endAngle ?? 90 });
        break;
      case 'text':
        prims.push({ ...text(a.points[0].x, a.points[0].y, a.text ?? '', a.textHeight ?? 2.5, 'start'), baseline: 'bottom' });
        break;
      case 'dimension': {
        const [p1, p2] = a.points;
        if (!p1 || !p2) break;
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const ux = (p2.x - p1.x) / (len || 1);
        const uy = (p2.y - p1.y) / (len || 1);
        const off = (a.textHeight ?? 2.5) * 0.6;
        const tick = (a.textHeight ?? 2.5) * 0.5;
        prims.push({ k: 'line', a: p1, b: p2 });
        for (const q of [p1, p2]) prims.push({ k: 'line', a: { x: q.x - (ux + uy) * tick, y: q.y - (uy - ux) * tick }, b: { x: q.x + (ux + uy) * tick, y: q.y + (uy - ux) * tick } });
        const unit = project.settings.displayUnit;
        const label = unit === 'm' ? `${(len / 1000).toFixed(2)}` : unit === 'cm' ? `${(len / 10).toFixed(1)}` : `${len.toFixed(1)}`;
        prims.push(text((p1.x + p2.x) / 2 + uy * off, (p1.y + p2.y) / 2 - ux * off, a.text || label, a.textHeight ?? 2.5));
        break;
      }
    }
    out.push({ id: a.id, kind: 'annotation', layer: a.layer, prims });
  }

  if (isInst && visible.has('cables')) {
    for (const cb of Object.values(project.cables)) {
      const circuit = project.circuits[cb.circuitId];
      if (!circuit) continue;
      if (filter === 'lighting' && circuit.category !== 'lighting') continue;
      if (filter === 'power' && circuit.category !== 'power') continue;
      const prims: Primitive[] = [{ k: 'poly', pts: cb.path, w: 25, dash: [150, 80] }];
      if (labels && cb.path.length >= 2) {
        // label the longest segment
        let best = 1;
        let bestLen = -1;
        for (let i = 1; i < cb.path.length; i++) {
          const l = Math.hypot(cb.path[i].x - cb.path[i - 1].x, cb.path[i].y - cb.path[i - 1].y);
          if (l > bestLen) {
            bestLen = l;
            best = i;
          }
        }
        const m = { x: (cb.path[best].x + cb.path[best - 1].x) / 2, y: (cb.path[best].y + cb.path[best - 1].y) / 2 };
        if (bestLen > 600) prims.push({ ...text(m.x, m.y - 90, circuit.name, 120), baseline: 'bottom' });
      }
      out.push({ id: cb.id, kind: 'cable', layer: 'cables', prims });
    }
  }

  if (visible.has('wires')) {
    const counts = attachmentCounts(project);
    for (const w of Object.values(project.wires)) {
      const pts = wirePolyline(project, w);
      if (pts.length < 2) continue;
      out.push({ id: w.id, kind: 'wire', layer: 'wires', prims: [{ k: 'poly', pts }] });
    }
    for (const j of Object.values(project.junctions)) {
      const n = counts.get(`j:${j.id}`) ?? 0;
      const prims: Primitive[] = n >= 3 ? [{ k: 'circle', c: j.position, r: 0.6, fill: true }] : n <= 1 ? [{ k: 'circle', c: j.position, r: 0.5 }] : [];
      out.push({ id: j.id, kind: 'junction', layer: 'wires', prims });
    }
    // pins with three or more connections get a junction dot too
    const pinCounts = new Map<string, number>();
    for (const w of Object.values(project.wires)) for (const e of [w.a, w.b]) if (e.kind === 'pin') pinCounts.set(`${e.componentId}:${e.pinId}`, (pinCounts.get(`${e.componentId}:${e.pinId}`) ?? 0) + 1);
    for (const [key, n] of pinCounts) {
      if (n < 2) continue;
      const [cid, pid] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const c = project.components[cid];
      if (!c) continue;
      const pd = getDef(c.type).pins.find((p) => p.id === pid);
      if (!pd) continue;
      out.push({ id: `dot:${key}`, kind: 'junction', layer: 'wires', prims: [{ k: 'circle', c: transformPoint(pd, c), r: 0.6, fill: true }] });
    }
  }

  if (visible.has('components')) {
    for (const c of Object.values(project.components)) {
      if (c.hidden) continue;
      const def = getDef(c.type);
      if (isInst && filter === 'lighting' && !['light', 'switch_1way', 'db', 'junction_box'].includes(c.type)) continue;
      if (isInst && filter === 'power' && ['light', 'switch_1way'].includes(c.type)) continue;
      const prims = componentPrimitives(c);
      if (labels && c.type !== 'label' && c.type !== 'ground') {
        const lo = transformPoint(def.labelOffset, { position: { x: 0, y: 0 }, rotation: c.rotation, mirror: c.mirror });
        const size = isInst ? 120 : 1.6;
        const base = { x: c.position.x + lo.x, y: c.position.y + lo.y };
        const value = def.valueLabel ? def.valueLabel(c.properties) : '';
        const vertical = Math.abs(lo.x) > Math.abs(lo.y);
        const anchor = vertical ? (lo.x > 0 ? 'start' : 'end') : 'middle';
        if (value) {
          prims.push({ ...text(base.x, base.y - size * 0.6, c.ref, size, anchor), bold: true });
          prims.push(text(base.x, base.y + size * 0.6, value, size * 0.9, anchor));
        } else prims.push({ ...text(base.x, base.y, c.ref, size, anchor), bold: true });
      }
      out.push({ id: c.id, kind: 'component', layer: c.layer, prims });
    }
  }
  return out;
}
