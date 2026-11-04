import { getDef } from '../component-library/library';
import { transformPoint, transformPrimitive, type Primitive } from '../drawing/primitives';
import type { ComponentInstance, Endpoint, Project, Vec2, Wire } from './types';

export function pinWorldPosition(c: ComponentInstance, pinId: string): Vec2 {
  const def = getDef(c.type);
  const pd = def.pins.find((pp) => pp.id === pinId);
  if (!pd) throw new Error(`Component ${c.ref} has no pin ${pinId}`);
  return transformPoint({ x: pd.x, y: pd.y }, c);
}

export function endpointPosition(project: Project, e: Endpoint): Vec2 | null {
  if (e.kind === 'pin') {
    const c = project.components[e.componentId];
    if (!c) return null;
    try {
      return pinWorldPosition(c, e.pinId);
    } catch {
      return null;
    }
  }
  const j = project.junctions[e.junctionId];
  return j ? j.position : null;
}

/** Full polyline of a wire, endpoints resolved from the live model (so wires follow moved parts). */
export function wirePolyline(project: Project, w: Wire): Vec2[] {
  const a = endpointPosition(project, w.a);
  const b = endpointPosition(project, w.b);
  const pts: Vec2[] = [];
  if (a) pts.push(a);
  pts.push(...w.vertices);
  if (b) pts.push(b);
  return pts;
}

export function componentPrimitives(c: ComponentInstance): Primitive[] {
  const def = getDef(c.type);
  return def.symbol(c.properties).map((p) => transformPrimitive(p, c));
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polylineLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Distance from point p to segment ab, plus the closest point. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; q: Vec2; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: dist(p, q), q, t };
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

export function snapPoint(p: Vec2, grid: number): Vec2 {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/** Orthogonal (L-shaped) route between two points: horizontal first. */
export function orthoRoute(a: Vec2, b: Vec2, horizontalFirst = true): Vec2[] {
  if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) return [];
  return horizontalFirst ? [{ x: b.x, y: a.y }] : [{ x: a.x, y: b.y }];
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}
