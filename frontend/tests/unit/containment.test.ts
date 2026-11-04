import { describe, expect, it } from 'vitest';
import { routeViaContainment, type TraySegment } from '../../src/project-model/containment';
import { ProjectBuilder } from '../../src/project-model/builder';
import { planCircuit, rerouteCircuit } from '../../src/project-model/installation';
import { addCircuit } from '../../src/project-model/operations';
import { calculateCircuit } from '../../src/calculations/installation';
import { polylineLength } from '../../src/project-model/geometry';

const tray = (id: string, ax: number, ay: number, bx: number, by: number): TraySegment => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, elevation: 2900 });

describe('routing through containment', () => {
  it('follows an L-shaped tray network and stays orthogonal', () => {
    // tray along y=0 from x 0..6000, then down x=6000 from y 0..5000
    const trays = [tray('t1', 0, 0, 6000, 0), tray('t2', 6000, 0, 6000, 5000)];
    const r = routeViaContainment(trays, { x: 1000, y: 500 }, { x: 5500, y: 4000 })!;
    expect(r.onTrayMm).toBeGreaterThan(0);
    for (let i = 1; i < r.path.length; i++) {
      const a = r.path[i - 1];
      const b = r.path[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    // drop 500 to tray, 5000 along t1, 4000 down t2, 500 across to the device
    expect(polylineLength(r.path)).toBeCloseTo(500 + 5000 + 4000 + 500, 6);
    expect(r.elevation).toBe(2900);
  });

  it('prefers the direct route when the trays are a long detour', () => {
    const trays = [tray('t1', 0, 20000, 10000, 20000)];
    const r = routeViaContainment(trays, { x: 0, y: 0 }, { x: 1000, y: 0 })!;
    expect(r.onTrayMm).toBe(0);
  });

  it('planned circuits use trays and cable lengths follow the route', () => {
    const b = new ProjectBuilder('installation');
    const db = b.add('db', { x: 0, y: 0 }, {}, { elevation: 1500 });
    const l1 = b.add('light', { x: 8000, y: 3000 }, {}, { elevation: 2700 });
    let p = b.build();
    const before = planCircuit(p, db.id, [l1.id]);
    expect(before.cables[0].path).toHaveLength(3); // plain L-route
    b.project = p;
    b.add('cable_tray', { x: 4000, y: 1000 }, { length: 8000 }, { elevation: 2900 });
    b.add('cable_tray', { x: 8000, y: 2000 }, { length: 2000 }, { elevation: 2900, rotation: 90 });
    p = b.build();
    const plan = planCircuit(p, db.id, [l1.id]);
    expect(plan.cables[0].routeElevation).toBe(2900);
    p = addCircuit(p, plan.circuit, plan.cables);
    const calc = calculateCircuit(p, p.circuits[plan.circuit.id]);
    expect(calc.totalLengthM).toBeCloseTo(polylineLength(plan.cables[0].path) / 1000 + (2900 - 1500 + 2900 - 2700) / 1000, 9);
    // re-routing an existing circuit is idempotent
    const again = rerouteCircuit(p, plan.circuit.id);
    expect(Object.values(again.cables)[0].path).toEqual(plan.cables[0].path);
  });
});
