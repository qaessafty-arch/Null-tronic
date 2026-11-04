import { getDef } from '../component-library/library';
import { newId } from './ids';
import { orthoRoute } from './geometry';
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
  const elev = defaultRouteElevation(project);
  const cables: Cable[] = [];
  let prev = board;
  for (const d of devs) {
    cables.push({ id: newId('cbl'), circuitId: circuit.id, fromId: prev.id, toId: d.id, path: autoRoute(prev.position, d.position), routeElevation: elev });
    prev = d;
  }
  return { circuit, cables };
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
