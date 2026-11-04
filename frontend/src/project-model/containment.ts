import type { Project, Vec2 } from './types';

/**
 * Cable routing through containment (cable trays). Trays are axis-aligned segments derived from
 * `cable_tray` components (rotation 0 = along x, 90 = along y). A graph is built from tray
 * endpoints, tray–tray intersections and the perpendicular feet of the two terminals on every
 * tray; Dijkstra finds the cheapest path, where running OFF a tray costs `offTrayPenalty` × length.
 * The result is an orthogonal polyline that follows the trays wherever they lead.
 */

export interface TraySegment {
  id: string;
  a: Vec2;
  b: Vec2;
  elevation: number;
}

export function traySegments(project: Project): TraySegment[] {
  const out: TraySegment[] = [];
  for (const c of Object.values(project.components)) {
    if (c.type !== 'cable_tray') continue;
    const r = ((c.rotation % 360) + 360) % 360;
    if (r % 90 !== 0) continue;
    const half = (Number(c.properties.length) || 3000) / 2;
    const horiz = r === 0 || r === 180;
    out.push({
      id: c.id,
      a: horiz ? { x: c.position.x - half, y: c.position.y } : { x: c.position.x, y: c.position.y - half },
      b: horiz ? { x: c.position.x + half, y: c.position.y } : { x: c.position.x, y: c.position.y + half },
      elevation: c.elevation,
    });
  }
  return out;
}

const key = (p: Vec2) => `${Math.round(p.x)},${Math.round(p.y)}`;
const d = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function onSeg(p: Vec2, s: TraySegment, tol = 1): boolean {
  const minX = Math.min(s.a.x, s.b.x) - tol;
  const maxX = Math.max(s.a.x, s.b.x) + tol;
  const minY = Math.min(s.a.y, s.b.y) - tol;
  const maxY = Math.max(s.a.y, s.b.y) + tol;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function foot(p: Vec2, s: TraySegment): Vec2 {
  if (Math.abs(s.a.y - s.b.y) < 1e-6) return { x: Math.min(Math.max(p.x, Math.min(s.a.x, s.b.x)), Math.max(s.a.x, s.b.x)), y: s.a.y };
  return { x: s.a.x, y: Math.min(Math.max(p.y, Math.min(s.a.y, s.b.y)), Math.max(s.a.y, s.b.y)) };
}

export interface ContainmentRoute {
  path: Vec2[];
  onTrayMm: number;
  offTrayMm: number;
  elevation: number | null;
}

export function routeViaContainment(trays: TraySegment[], from: Vec2, to: Vec2, offTrayPenalty = 3): ContainmentRoute | null {
  if (!trays.length) return null;
  const pts = new Map<string, Vec2>();
  const add = (p: Vec2) => {
    const k = key(p);
    if (!pts.has(k)) pts.set(k, { x: Math.round(p.x), y: Math.round(p.y) });
    return k;
  };
  const A = add(from);
  const B = add(to);
  const perTray: Map<string, string[]> = new Map(trays.map((t) => [t.id, [add(t.a), add(t.b)]]));
  // terminal feet
  const feet: [string, string, TraySegment][] = [];
  for (const t of trays) {
    for (const term of [from, to]) {
      const f = foot(term, t);
      // only perpendicular drops (foot must be the true perpendicular, i.e. orthogonal)
      if (Math.abs(f.x - term.x) > 1 && Math.abs(f.y - term.y) > 1) continue;
      const kf = add(f);
      perTray.get(t.id)!.push(kf);
      feet.push([key(term), kf, t]);
    }
  }
  // tray–tray intersections / touching ends
  for (let i = 0; i < trays.length; i++)
    for (let j = i + 1; j < trays.length; j++) {
      const s = trays[i];
      const t = trays[j];
      const hs = Math.abs(s.a.y - s.b.y) < 1e-6;
      const ht = Math.abs(t.a.y - t.b.y) < 1e-6;
      const cand: Vec2[] = hs !== ht ? [hs ? { x: t.a.x, y: s.a.y } : { x: s.a.x, y: t.a.y }] : [s.a, s.b, t.a, t.b];
      for (const c of cand)
        if (onSeg(c, s) && onSeg(c, t)) {
          const k = add(c);
          perTray.get(s.id)!.push(k);
          perTray.get(t.id)!.push(k);
        }
    }
  // edges
  const adj = new Map<string, { to: string; w: number; on: boolean }[]>();
  const edge = (a: string, b: string, w: number, on: boolean) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, w, on });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, w, on });
  };
  for (const t of trays) {
    const horiz = Math.abs(t.a.y - t.b.y) < 1e-6;
    const ks = [...new Set(perTray.get(t.id)!)].sort((p, q) => (horiz ? pts.get(p)!.x - pts.get(q)!.x : pts.get(p)!.y - pts.get(q)!.y));
    for (let i = 1; i < ks.length; i++) edge(ks[i - 1], ks[i], d(pts.get(ks[i - 1])!, pts.get(ks[i])!), true);
  }
  for (const [kt, kf] of feet) edge(kt, kf, d(pts.get(kt)!, pts.get(kf)!) * offTrayPenalty, false);
  edge(A, B, d(from, to) * offTrayPenalty, false); // direct fallback
  // Dijkstra
  const dist = new Map<string, number>([[A, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < best) {
      best = v;
      u = k;
    }
    if (u === null || u === B) break;
    done.add(u);
    for (const e of adj.get(u) ?? []) {
      const nd = best + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
      }
    }
  }
  if (!dist.has(B)) return null;
  const seq: string[] = [B];
  while (seq[0] !== A) seq.unshift(prev.get(seq[0])!);
  const nodes = seq.map((k) => pts.get(k)!);
  // expand the direct fallback into an orthogonal L and accumulate on/off-tray lengths
  const path: Vec2[] = [{ ...from }];
  let on = 0;
  let off = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const isOn = (adj.get(seq[i - 1]) ?? []).some((e) => e.to === seq[i] && e.on);
    if (a.x !== b.x && a.y !== b.y) path.push({ x: b.x, y: a.y });
    path.push(i === nodes.length - 1 ? { ...to } : b);
    if (isOn) on += d(a, b);
    else off += d(a, b);
  }
  // drop collinear points
  const simple = path.filter((p, i) => {
    if (i === 0 || i === path.length - 1) return true;
    const a = path[i - 1];
    const c = path[i + 1];
    return !((a.x === p.x && p.x === c.x) || (a.y === p.y && p.y === c.y)) && !(a.x === p.x && a.y === p.y);
  });
  const used = trays.filter((t) => nodes.some((n) => onSeg(n, t)));
  return { path: simple, onTrayMm: on, offTrayMm: off, elevation: on > 0 && used.length ? Math.min(...used.map((t) => t.elevation)) : null };
}
