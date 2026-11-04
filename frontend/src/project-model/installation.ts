import { getDef } from '../component-library/library';
import { newId } from './ids';
import { orthoRoute } from './geometry';
import { routeViaContainment, traySegments } from './containment';
import type { Cable, Circuit, Id, Phase, Project, Room, Vec2 } from './types';

/** Helpers for creating installation circuits and rooms (used by tools, examples and the assistant). */

export function nextCircuitName(project: Project): string {
  let max = 0;
  for (const c of Object.values(project.circuits)) {
    const m = /^C(\d+)$/.exec(c.name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `C${max + 1}`;
}

/** Orthogonal plan route between two components. */
export function autoRoute(a: Vec2, b: Vec2): Vec2[] {
  return [{ ...a }, ...orthoRoute(a, b, true), { ...b }];
}

export function defaultRouteElevation(project: Project): number {
  const heights = Object.values(project.rooms).map((r) => r.height);
  const h = heights.length ? Math.min(...heights) : 3000;
  return Math.max(h - 100, 2400);
}

export interface PlannedCircuit {
  circuit: Circuit;
  cables: Cable[];
}

/** Build a daisy-chained circuit board -> d1 -> d2 ... with auto-routed cables (preview; not yet committed). */
export function planCircuit(project: Project, boardId: Id, deviceIds: Id[], opts: Partial<Circuit> = {}): PlannedCircuit {
  const board = project.components[boardId];
  if (!board || !getDef(board.type).isBoard) throw new Error('A circuit must start at a distribution board');
  const devs = deviceIds.map((id) => project.components[id]).filter(Boolean);
  const anyLighting = devs.some((d) => d.type === 'light' || d.type === 'switch_1way');
  const allLighting = devs.every((d) => d.type === 'light' || d.type === 'switch_1way');
  const circuit: Circuit = {
    id: newId('cct'),
    name: nextCircuitName(project),
    boardId,
    deviceIds: devs.map((d) => d.id),
    phase: (opts.phase as Phase) ?? 'L1',
    category: anyLighting && allLighting ? 'lighting' : 'power',
    protection: { kind: 'MCB', curve: 'B', ratingA: null, residualmA: null },
    cable: { material: 'Cu', csaMm2: null, hasNeutral: true, hasPE: true, insulation: 'PVC', installationMethod: 'B1' },
    demandFactor: 1,
    notes: '',
    ...opts,
  };
  const cables: Cable[] = [];
  let prev = board;
  for (const d of devs) {
    cables.push({ id: newId('cbl'), circuitId: circuit.id, fromId: prev.id, toId: d.id, ...routeBetween(project, prev.position, d.position) });
    prev = d;
  }
  return { circuit, cables };
}

/** Route one cable run: through cable trays when the project has any, otherwise an orthogonal L. */
export function routeBetween(project: Project, a: Vec2, b: Vec2): { path: Vec2[]; routeElevation: number } {
  const trays = traySegments(project);
  const r = routeViaContainment(trays, a, b);
  if (r && r.onTrayMm > 0) return { path: r.path, routeElevation: r.elevation ?? defaultRouteElevation(project) };
  return { path: autoRoute(a, b), routeElevation: defaultRouteElevation(project) };
}

/** Recompute every cable route of a circuit (e.g. after containment was added or devices moved). */
export function rerouteCircuit(project: Project, circuitId: Id): Project {
  const cables = { ...project.cables };
  for (const cb of Object.values(project.cables)) {
    if (cb.circuitId !== circuitId) continue;
    const from = project.components[cb.fromId];
    const to = project.components[cb.toId];
    if (!from || !to) continue;
    cables[cb.id] = { ...cb, ...routeBetween(project, from.position, to.position) };
  }
  return { ...project, cables, meta: { ...project.meta, modifiedAt: new Date().toISOString() } };
}

export function makeRoom(name: string, x: number, y: number, w: number, h: number, height = 3000): Room {
  return {
    id: newId('room'),
    name,
    polygon: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    floor: 0,
    height,
    wallThickness: 150,
  };
}
