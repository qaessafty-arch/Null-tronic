import { describe, expect, it } from 'vitest';
import { calculateCircuit, calculateInstallation, suggestBreaker, voltageDrop } from '../../src/calculations/installation';
import { buildBom } from '../../src/calculations/bom';
import { validateProject, overallStatus } from '../../src/calculations/validation';
import { ProjectBuilder } from '../../src/project-model/builder';
import { addCircuit, updateCircuit, updateSettings } from '../../src/project-model/operations';
import { planCircuit } from '../../src/project-model/installation';
import { sampleInstallation } from '../../src/education/examples';

function oneLoad(powerW: number, distanceMm: number, csa: number | null) {
  const b = new ProjectBuilder('installation');
  const db = b.add('db', { x: 0, y: 0 }, {}, { elevation: 2900 });
  const ld = b.add('water_heater', { x: distanceMm, y: 0 }, { power: powerW, powerFactor: 1 }, { elevation: 2900 });
  let p = b.build();
  const pc = planCircuit(p, db.id, [ld.id], { cable: { material: 'Cu', csaMm2: csa, hasNeutral: true, hasPE: true, insulation: 'PVC', installationMethod: 'B1' } });
  pc.cables.forEach((c) => (c.routeElevation = 2900));
  p = addCircuit(p, pc.circuit, pc.cables);
  return { p, circuit: p.circuits[pc.circuit.id] };
}

describe('installation calculations (independent hand calculation)', () => {
  it('voltage drop formula, single-phase, unity power factor', () => {
    // u = 2 · (1.25 · 0.017241 / 2.5) · 20 m · 8.6957 A = 2.9984 V
    const u = voltageDrop({ material: 'Cu', csaMm2: 2.5, lengthM: 20, currentA: 2000 / 230, powerFactor: 1, threePhase: false });
    expect(u).toBeCloseTo(2 * ((1.25 * 0.017241) / 2.5) * 20 * (2000 / 230), 9);
    expect(u).toBeCloseTo(2.9984, 3);
  });

  it('voltage drop includes reactance term when cos φ < 1', () => {
    const u = voltageDrop({ material: 'Cu', csaMm2: 2.5, lengthM: 30, currentA: 10, powerFactor: 0.8, threePhase: false });
    const expected = 2 * (((1.25 * 0.017241) / 2.5) * 30 * 0.8 + 0.00008 * 30 * 0.6) * 10;
    expect(u).toBeCloseTo(expected, 12);
  });

  it('circuit current, length from route, drop and suggested breaker', () => {
    const { p, circuit } = oneLoad(2000, 20000, 2.5);
    const r = calculateCircuit(p, circuit);
    expect(r.ibA).toBeCloseTo(2000 / 230, 9);
    expect(r.totalLengthM).toBeCloseTo(20, 9);
    expect(r.dropPct).toBeCloseTo((100 * 2.99837) / 230, 3);
    expect(r.breakerA).toBe(10); // smallest IEC 60898-1 rating >= 8.70 A
    expect(r.breakerSource).toBe('suggested');
    expect(r.izSource).toBe('not-evaluated');
  });

  it('vertical drops are added to cable length', () => {
    const b = new ProjectBuilder('installation');
    const db = b.add('db', { x: 0, y: 0 }, {}, { elevation: 1500 });
    const s = b.add('socket', { x: 5000, y: 0 }, {}, { elevation: 300 });
    let p = b.build();
    const pc = planCircuit(p, db.id, [s.id]);
    pc.cables[0].routeElevation = 2900;
    p = addCircuit(p, pc.circuit, pc.cables);
    const r = calculateCircuit(p, p.circuits[pc.circuit.id]);
    expect(r.totalLengthM).toBeCloseTo(5 + 1.4 + 2.6, 9);
  });

  it('suggests a larger conductor when the drop limit is exceeded', () => {
    const { p, circuit } = oneLoad(3000, 60000, null);
    const r = calculateCircuit(p, circuit);
    // 3000 W at 60 m: 2.5 mm² gives 2·0.00862·60·13.04 = 13.5 V = 5.87 % > 5 %  -> 4 mm²
    expect(r.csaMm2).toBe(4);
    expect(r.dropPct).toBeLessThanOrEqual(5);
  });

  it('reports a breaker below Ib as an error', () => {
    const { p, circuit } = oneLoad(3000, 10000, 2.5);
    const p2 = updateCircuit(p, circuit.id, { protection: { ...circuit.protection, ratingA: 10 } });
    const r = calculateCircuit(p2, p2.circuits[circuit.id]);
    expect(r.findings.find((f) => f.code === 'BREAKER_LT_IB')?.status).toBe('error');
  });

  it('uses the ampacity table only when the user provides it', () => {
    const { p, circuit } = oneLoad(3000, 10000, 1.5);
    const p2 = updateSettings(p, { ampacityTable: [{ csaMm2: 1.5, material: 'Cu', insulation: 'PVC', installationMethod: 'B1', ampacityA: 13.5, source: 'user test row' }] });
    const r = calculateCircuit(p2, p2.circuits[circuit.id]);
    expect(r.izA).toBe(13.5);
    expect(r.breakerA).toBe(16);
    expect(r.findings.find((f) => f.code === 'IN_GT_IZ')?.status).toBe('error');
  });

  it('missing PE is an error', () => {
    const { p, circuit } = oneLoad(1000, 5000, 2.5);
    const p2 = updateCircuit(p, circuit.id, { cable: { ...circuit.cable, hasPE: false } });
    expect(calculateCircuit(p2, p2.circuits[circuit.id]).findings.some((f) => f.code === 'NO_PE' && f.status === 'error')).toBe(true);
  });

  it('IEC 60898-1 breaker selection', () => {
    expect(suggestBreaker(0.5)).toBe(6);
    expect(suggestBreaker(16)).toBe(16);
    expect(suggestBreaker(16.1)).toBe(20);
    expect(suggestBreaker(200)).toBeNull();
  });

  it('sample flat: every circuit calculated, never labelled safe', () => {
    const p = sampleInstallation();
    const rep = calculateInstallation(p);
    expect(rep.circuits).toHaveLength(6);
    for (const c of rep.circuits) {
      expect(c.ibA).toBeGreaterThan(0);
      expect(c.totalLengthM).toBeGreaterThan(0);
      expect(c.findings.some((f) => f.code === 'SC_NE')).toBe(true);
    }
    const status = overallStatus(validateProject(p));
    expect(status.label.toLowerCase()).not.toContain('safe');
    const board = rep.boards[0];
    expect(board.totalDemandVA).toBeCloseTo(rep.circuits.reduce((a, c) => a + c.demandVA, 0), 6);
  });

  it('BOM counts devices and cable lengths, prices only from the table', () => {
    const p = sampleInstallation();
    const bom = buildBom(p);
    const lights = bom.lines.filter((l) => l.key.startsWith('light:')).reduce((a, l) => a + l.quantity, 0);
    expect(lights).toBe(6);
    expect(bom.lines.some((l) => l.unit === 'm' && l.quantity > 0)).toBe(true);
    expect(bom.total).toBeNull();
    const lightKey = bom.lines.find((l) => l.key.startsWith('light:'))!.key;
    const priced = buildBom(updateSettings(p, { unitPrices: { [lightKey]: 10 } }));
    expect(priced.lines.find((l) => l.key === lightKey)!.total).toBe(10 * priced.lines.find((l) => l.key === lightKey)!.quantity);
  });
});
