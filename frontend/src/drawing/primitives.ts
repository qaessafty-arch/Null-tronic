import type { Rotation, Vec2 } from '../project-model/types';

/**
 * Device-independent vector primitives. Symbols, plans and drawing sheets are expressed as
 * primitives once and rendered by the canvas, SVG, PDF and DXF back-ends, so every output is
 * generated from the same geometry.
 *
 * Coordinate convention: millimetres, +y points DOWN (screen convention). Exporters that use a
 * y-up system (PDF, DXF) flip during export. Arc angles are degrees measured in this y-down
 * frame: point = c + r * (cos a, sin a), sweeping from a0 to a1 with increasing angle.
 */
export type Primitive =
  | { k: 'line'; a: Vec2; b: Vec2; w?: number; color?: string; dash?: number[] }
  | { k: 'poly'; pts: Vec2[]; closed?: boolean; fill?: boolean; w?: number; color?: string; dash?: number[] }
  | { k: 'circle'; c: Vec2; r: number; fill?: boolean; w?: number; color?: string }
  | { k: 'arc'; c: Vec2; r: number; a0: number; a1: number; w?: number; color?: string }
  | {
      k: 'text';
      p: Vec2;
      text: string;
      size: number;
      anchor?: 'start' | 'middle' | 'end';
      baseline?: 'top' | 'middle' | 'bottom';
      color?: string;
      bold?: boolean;
    };

export interface LayeredPrimitive {
  layer: string;
  prim: Primitive;
}

export interface Transform2D {
  position: Vec2;
  rotation: Rotation | number;
  mirror: boolean;
}

export function transformPoint(p: Vec2, t: Transform2D): Vec2 {
  const x = t.mirror ? -p.x : p.x;
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(rad) * 1e12) / 1e12;
  const s = Math.round(Math.sin(rad) * 1e12) / 1e12;
  return { x: t.position.x + x * c - p.y * s, y: t.position.y + x * s + p.y * c };
}

/** Transform a primitive from component-local space to world space. Text stays upright. */
export function transformPrimitive(p: Primitive, t: Transform2D): Primitive {
  switch (p.k) {
    case 'line':
      return { ...p, a: transformPoint(p.a, t), b: transformPoint(p.b, t) };
    case 'poly':
      return { ...p, pts: p.pts.map((q) => transformPoint(q, t)) };
    case 'circle':
      return { ...p, c: transformPoint(p.c, t) };
    case 'arc': {
      let a0 = p.a0;
      let a1 = p.a1;
      if (t.mirror) {
        // mirror x: angle a -> 180 - a, sweep direction reverses
        const n0 = 180 - a1;
        const n1 = 180 - a0;
        a0 = n0;
        a1 = n1;
      }
      return { ...p, c: transformPoint(p.c, t), a0: a0 + t.rotation, a1: a1 + t.rotation };
    }
    case 'text':
      return { ...p, p: transformPoint(p.p, t) };
  }
}

export function rect(x: number, y: number, w: number, h: number, extra: Partial<Extract<Primitive, { k: 'poly' }>> = {}): Primitive {
  return {
    k: 'poly',
    pts: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    closed: true,
    ...extra,
  };
}

export function line(x1: number, y1: number, x2: number, y2: number, w?: number): Primitive {
  return { k: 'line', a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, w };
}

export function text(x: number, y: number, s: string, size = 1.8, anchor: 'start' | 'middle' | 'end' = 'middle', baseline: 'top' | 'middle' | 'bottom' = 'middle'): Primitive {
  return { k: 'text', p: { x, y }, text: s, size, anchor, baseline };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBounds(b: Bounds, p: Vec2, pad = 0): void {
  b.minX = Math.min(b.minX, p.x - pad);
  b.minY = Math.min(b.minY, p.y - pad);
  b.maxX = Math.max(b.maxX, p.x + pad);
  b.maxY = Math.max(b.maxY, p.y + pad);
}

export function primitiveBounds(prims: Primitive[], into: Bounds = emptyBounds()): Bounds {
  for (const p of prims) {
    switch (p.k) {
      case 'line':
        extendBounds(into, p.a);
        extendBounds(into, p.b);
        break;
      case 'poly':
        p.pts.forEach((q) => extendBounds(into, q));
        break;
      case 'circle':
      case 'arc':
        extendBounds(into, p.c, p.r);
        break;
      case 'text': {
        const w = p.text.length * p.size * 0.6;
        extendBounds(into, { x: p.p.x - w / 2, y: p.p.y - p.size });
        extendBounds(into, { x: p.p.x + w / 2, y: p.p.y + p.size });
        break;
      }
    }
  }
  return into;
}

export function isEmptyBounds(b: Bounds): boolean {
  return !Number.isFinite(b.minX) || b.maxX < b.minX;
}
