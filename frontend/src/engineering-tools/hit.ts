import { getDef } from '../component-library/library';
import { primitiveBounds, transformPoint } from '../drawing/primitives';
import { dist, pinWorldPosition, pointInPolygon, pointSegment, wirePolyline } from '../project-model/geometry';
import type { ComponentInstance, Id, Project, Vec2 } from '../project-model/types';

/** Geometric hit testing against the authoritative model (shared by all tools and input sources). */

export type HitKind = 'pin' | 'junction' | 'component' | 'wire' | 'cable' | 'annotation' | 'room' | 'cable-vertex' | 'wire-vertex';

export interface Hit {
  kind: HitKind;
  id: Id;
  pinId?: string;
  point: Vec2;
  /** vertex / segment index for wires & cables */
  index?: number;
}

const localBoundsCache = new WeakMap<object, { minX: number; minY: number; maxX: number; maxY: number }>();

export function componentWorldBounds(c: ComponentInstance): { minX: number; minY: number; maxX: number; maxY: number } {
  let lb = localBoundsCache.get(c.properties);
  if (!lb) {
    const def = getDef(c.type);
    lb = primitiveBounds(def.symbol(c.properties).filter((p) => p.k !== 'text'));
    for (const pd of def.pins) {
      lb.minX = Math.min(lb.minX, pd.x);
      lb.maxX = Math.max(lb.maxX, pd.x);
      lb.minY = Math.min(lb.minY, pd.y);
      lb.maxY = Math.max(lb.maxY, pd.y);
    }
    localBoundsCache.set(c.properties, lb);
  }
  const corners = [
    { x: lb.minX, y: lb.minY },
    { x: lb.maxX, y: lb.minY },
    { x: lb.maxX, y: lb.maxY },
    { x: lb.minX, y: lb.maxY },
  ].map((q) => transformPoint(q, c));
  return {
    minX: Math.min(...corners.map((q) => q.x)),
    maxX: Math.max(...corners.map((q) => q.x)),
    minY: Math.min(...corners.map((q) => q.y)),
    maxY: Math.max(...corners.map((q) => q.y)),
  };
}

export function hitPin(project: Project, p: Vec2, tol: number): Hit | null {
  let best: Hit | null = null;
  let bd = tol;
  for (const c of Object.values(project.components)) {
    const def = getDef(c.type);
    for (const pd of def.pins) {
      const q = pinWorldPosition(c, pd.id);
      const d = dist(p, q);
      if (d <= bd) {
        bd = d;
        best = { kind: 'pin', id: c.id, pinId: pd.id, point: q };
      }
    }
  }
  return best;
}

export function hitTest(project: Project, p: Vec2, tol: number, opts: { pins?: boolean; selected?: Set<Id> } = {}): Hit | null {
  if (opts.pins) {
    const pin = hitPin(project, p, tol);
    if (pin) return pin;
  }
  // vertex handles of selected wires / cables
  if (opts.selected?.size === 1) {
    const id = [...opts.selected][0];
    const cb = project.cables[id];
    if (cb) {
      for (let i = 1; i < cb.path.length - 1; i++) if (dist(p, cb.path[i]) <= tol) return { kind: 'cable-vertex', id, index: i, point: cb.path[i] };
    }
    const w = project.wires[id];
    if (w) for (let i = 0; i < w.vertices.length; i++) if (dist(p, w.vertices[i]) <= tol) return { kind: 'wire-vertex', id, index: i, point: w.vertices[i] };
  }
  for (const j of Object.values(project.junctions)) if (dist(p, j.position) <= tol) return { kind: 'junction', id: j.id, point: j.position };
  // components: smallest containing bounds wins
  let comp: Hit | null = null;
  let area = Infinity;
  for (const c of Object.values(project.components)) {
    const b = componentWorldBounds(c);
    const pad = tol * 0.5;
    if (p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad) {
      const a = (b.maxX - b.minX + 1e-6) * (b.maxY - b.minY + 1e-6);
      if (a < area) {
        area = a;
        comp = { kind: 'component', id: c.id, point: c.position };
      }
    }
  }
  if (comp) return comp;
  let best: Hit | null = null;
  let bd = tol;
  for (const w of Object.values(project.wires)) {
    const pts = wirePolyline(project, w);
    for (let i = 1; i < pts.length; i++) {
      const r = pointSegment(p, pts[i - 1], pts[i]);
      if (r.d <= bd) {
        bd = r.d;
        best = { kind: 'wire', id: w.id, point: r.q, index: i - 1 };
      }
    }
  }
  if (best) return best;
  for (const cb of Object.values(project.cables)) {
    for (let i = 1; i < cb.path.length; i++) {
      const r = pointSegment(p, cb.path[i - 1], cb.path[i]);
      if (r.d <= bd) {
        bd = r.d;
        best = { kind: 'cable', id: cb.id, point: r.q, index: i - 1 };
      }
    }
  }
  if (best) return best;
  for (const a of Object.values(project.annotations)) {
    if (a.kind === 'text' && a.points[0] && dist(p, a.points[0]) <= Math.max(tol, (a.textHeight ?? 2.5) * 2)) return { kind: 'annotation', id: a.id, point: a.points[0] };
    if (a.kind === 'circle' || a.kind === 'arc') {
      if (a.points[0] && Math.abs(dist(p, a.points[0]) - (a.radius ?? 0)) <= tol) return { kind: 'annotation', id: a.id, point: p };
      continue;
    }
    const pts = a.closed ? [...a.points, a.points[0]] : a.points;
    for (let i = 1; i < pts.length; i++) if (pointSegment(p, pts[i - 1], pts[i]).d <= tol) return { kind: 'annotation', id: a.id, point: p };
  }
  for (const r of Object.values(project.rooms)) {
    const pts = [...r.polygon, r.polygon[0]];
    for (let i = 1; i < pts.length; i++) if (pointSegment(p, pts[i - 1], pts[i]).d <= Math.max(tol, r.wallThickness / 2)) return { kind: 'room', id: r.id, point: p };
  }
  for (const r of Object.values(project.rooms)) if (pointInPolygon(p, r.polygon)) return { kind: 'room', id: r.id, point: p };
  return null;
}

/** Entities fully inside a rectangle (rubber-band selection). */
export function entitiesInRect(project: Project, a: Vec2, b: Vec2): Id[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const inside = (q: Vec2) => q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY;
  const ids: Id[] = [];
  for (const c of Object.values(project.components)) {
    const bb = componentWorldBounds(c);
    if (inside({ x: bb.minX, y: bb.minY }) && inside({ x: bb.maxX, y: bb.maxY })) ids.push(c.id);
  }
  for (const j of Object.values(project.junctions)) if (inside(j.position)) ids.push(j.id);
  for (const w of Object.values(project.wires)) if (wirePolyline(project, w).every(inside)) ids.push(w.id);
  for (const r of Object.values(project.rooms)) if (r.polygon.every(inside)) ids.push(r.id);
  for (const an of Object.values(project.annotations)) if (an.points.every(inside)) ids.push(an.id);
  return ids;
}
