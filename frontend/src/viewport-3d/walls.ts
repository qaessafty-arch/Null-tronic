import type { Id, Room } from '../project-model/types';

export type WallSegment = [number, number, number, number];

/**
 * Wall segments for 3D extrusion without overlaps: every room edge is split at every room
 * corner lying on it, then identical sub-segments are kept once (first room wins). This removes
 * coplanar duplicate walls where rooms share only part of an edge (z-fighting in renderers).
 */
export function wallSegments(rooms: Room[], tol = 0.5): Map<Id, WallSegment[]> {
  const corners = rooms.flatMap((r) => r.polygon);
  const seen = new Set<string>();
  const out = new Map<Id, WallSegment[]>();
  const k = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  for (const r of rooms) {
    const segs: WallSegment[] = [];
    for (let i = 0; i < r.polygon.length; i++) {
      const a = r.polygon[i];
      const b = r.polygon[(i + 1) % r.polygon.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < tol * tol) continue;
      // split points: the edge ends plus every room corner lying on the edge (exact coordinates)
      const pts: { t: number; x: number; y: number }[] = [{ t: 0, x: a.x, y: a.y }, { t: 1, x: b.x, y: b.y }];
      for (const c of corners) {
        const t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const cross = Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) / Math.sqrt(len2);
        if (cross <= tol) pts.push({ t, x: c.x, y: c.y });
      }
      pts.sort((p, q) => p.t - q.t);
      for (let j = 1; j < pts.length; j++) {
        const { x: x1, y: y1 } = pts[j - 1];
        const { x: x2, y: y2 } = pts[j];
        if (Math.hypot(x2 - x1, y2 - y1) < tol) continue;
        const key = [k(x1, y1), k(x2, y2)].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push([x1, y1, x2, y2]);
      }
    }
    out.set(r.id, segs);
  }
  return out;
}

export interface WallBox {
  /** centre in plan (mm) */
  cx: number;
  cy: number;
  length: number;
  thickness: number;
  /** angle of the wall axis in the plan (radians, atan2(dy, dx)) */
  angle: number;
}

/**
 * Solid wall boxes without overlaps. At each end of a segment:
 *  - continues collinearly into another segment → no extension (avoids coplanar overlap);
 *  - meets a crossing wall → a horizontal wall extends by t/2 to fill the corner, a vertical wall
 *    is trimmed by t/2 so it stops at the face of the horizontal wall;
 *  - free end → extended by t/2 (square end cap).
 */
export function wallBoxes(segments: WallSegment[], thickness: number, context: WallSegment[] = segments): WallBox[] {
  const t = thickness;
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const at = new Map<string, WallSegment[]>();
  for (const s of context) {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) at.set(k, [...(at.get(k) ?? []), s]);
  }
  const dir = (s: WallSegment) => {
    const l = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1;
    return [(s[2] - s[0]) / l, (s[3] - s[1]) / l];
  };
  const horizontal = (s: WallSegment) => Math.abs(s[3] - s[1]) <= Math.abs(s[2] - s[0]);
  return segments.map((s) => {
    const [ux, uy] = dir(s);
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
    const ext = [0, 0];
    [key(s[0], s[1]), key(s[2], s[3])].forEach((k, end) => {
      const others = (at.get(k) ?? []).filter((o) => o !== s && !(o[0] === s[0] && o[1] === s[1] && o[2] === s[2] && o[3] === s[3]));
      const collinear = others.some((o) => {
        const [vx, vy] = dir(o);
        return Math.abs(ux * vy - uy * vx) < 1e-6;
      });
      const crossing = others.some((o) => {
        const [vx, vy] = dir(o);
        return Math.abs(ux * vy - uy * vx) >= 1e-6;
      });
      // does another wall pass straight through this point (two collinear others)?
      const through = others.some((o, i) =>
        others.some((q, j) => {
          if (j <= i) return false;
          const [ax, ay] = dir(o);
          const [bx, by] = dir(q);
          return Math.abs(ax * by - ay * bx) < 1e-6 && Math.abs(ux * ay - uy * ax) >= 1e-6;
        }),
      );
      if (collinear) ext[end] = 0;
      else if (through) ext[end] = -t / 2; // the through-wall owns the junction square
      else if (crossing) ext[end] = horizontal(s) ? t / 2 : -t / 2;
      else ext[end] = t / 2;
    });
    // a crossing horizontal wall at a T-junction where this horizontal wall continues: nothing to add
    const total = Math.max(len + ext[0] + ext[1], 1);
    const shift = (ext[1] - ext[0]) / 2;
    return {
      cx: (s[0] + s[2]) / 2 + ux * shift,
      cy: (s[1] + s[3]) / 2 + uy * shift,
      length: total,
      thickness: t,
      angle: Math.atan2(s[3] - s[1], s[2] - s[0]),
    };
  });
}
