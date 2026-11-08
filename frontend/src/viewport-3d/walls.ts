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
