import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/education/examples';
import { runAC, runOperatingPoint, runTransient, type OpResult, type TranResultView } from '../../src/simulation/simulate';
import { buildCircuit, ledSaturationCurrent, VT_300K } from '../../src/simulation/circuit';
import { ProjectBuilder } from '../../src/project-model/builder';
import type { Project } from '../../src/project-model/types';
import { setProperty } from '../../src/project-model/operations';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const byRef = (p: Project, ref: string) => Object.values(p.components).find((c) => c.ref === ref)!;
const op = (p: Project, states?: Map<string, boolean>) => {
  const r = runOperatingPoint(p, states);
  if (!r.ok) throw new Error(r.error);
  return r as OpResult;
};

describe('DC analysis against hand calculations', () => {
  it("Ohm's law: I = V/R", () => {
    const p = ex('ohms-law');
    const r = op(p);
    expect(r.components[byRef(p, 'AM1').id].current).toBeCloseTo(9 / 1000, 9);
    expect(r.components[byRef(p, 'R1').id].power).toBeCloseTo(0.081, 6);
  });

  it('series resistors: equal current and KVL', () => {
    const p = ex('series');
    const r = op(p);
    const i = 12 / 6000;
    for (const ref of ['R1', 'R2', 'R3']) expect(Math.abs(r.components[byRef(p, ref).id].current!)).toBeCloseTo(i, 9);
    const sum = ['R1', 'R2', 'R3'].reduce((s, ref) => s + r.components[byRef(p, ref).id].voltage!, 0);
    expect(sum).toBeCloseTo(12, 6);
    expect(r.components[byRef(p, 'P1').id].voltage).toBeCloseTo(10, 6);
  });

  it('parallel resistors: KCL', () => {
    const p = ex('parallel');
    const r = op(p);
    expect(r.components[byRef(p, 'AM1').id].current).toBeCloseTo(0.018, 9);
    expect(r.components[byRef(p, 'R1').id].current).toBeCloseTo(0.012, 9);
    expect(r.components[byRef(p, 'R2').id].current).toBeCloseTo(0.006, 9);
  });

  it('voltage divider', () => {
    const r = op(ex('divider'));
    expect(r.nodeVoltages['VOUT']).toBeCloseTo((10 * 4700) / 14700, 6);
  });

  it("Kirchhoff two-source network: VA = 75/11 V", () => {
    const p = ex('kirchhoff');
    const r = op(p);
    expect(r.components[byRef(p, 'P1').id].voltage).toBeCloseTo(75 / 11, 6);
  });

  it('LED current satisfies the diode equation self-consistently', () => {
    const p = ex('led');
    const r = op(p);
    const led = r.components[byRef(p, 'D1').id];
    const res = r.components[byRef(p, 'R1').id];
    // KVL: 9 = I·470 + Vd ; diode: I = Is (exp(Vd/(2Vt)) - 1)
    expect(res.voltage! + led.voltage!).toBeCloseTo(9, 6);
    const is = ledSaturationCurrent(1.9);
    expect(led.current!).toBeCloseTo(is * (Math.exp(led.voltage! / (2 * VT_300K)) - 1), 6);
    expect(led.current!).toBeGreaterThan(0.0145);
    expect(led.current!).toBeLessThan(0.0155);
    expect(r.findings.some((f) => f.code === 'OVER_CURRENT')).toBe(false);
  });

  it('LED over-current is reported as an error, not silently accepted', () => {
    let p = ex('led');
    p = setProperty(p, byRef(p, 'R1').id, 'resistance', 100);
    const r = op(p);
    expect(r.findings.find((f) => f.code === 'OVER_CURRENT')?.status).toBe('error');
  });

  it('NPN switch saturates', () => {
    const p = ex('bjt-switch');
    const r = op(p);
    const q = r.components[byRef(p, 'Q1').id];
    expect(q.extra?.region).toBe('saturation');
    expect(Number(q.extra?.Vce)).toBeLessThan(0.3);
    expect(q.current!).toBeGreaterThan(0.012);
  });

  it('NPN switch off when base switch opens', () => {
    const p = ex('bjt-switch');
    const sw = byRef(p, 'S1');
    const r = op(p, new Map([[`sw:${sw.id}`, false]]));
    expect(Math.abs(r.components[byRef(p, 'Q1').id].current!)).toBeLessThan(1e-6);
  });

  it('inverting op-amp DC gain = -Rf/Rin', () => {
    // replace AC source by a DC source for a static check
    const b = new ProjectBuilder('electronic');
    const v = b.add('vdc', { x: 0, y: 10 }, { voltage: 0.3 });
    const rin = b.add('resistor', { x: 15, y: 5 }, { resistance: 10000 });
    const rf = b.add('resistor', { x: 30, y: -5 }, { resistance: 100000 });
    const u = b.add('opamp', { x: 30, y: 7.5 });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v, '+', rin, '1').wire(rin, '2', u, '-').wire(u, '-', rf, '1').wire(rf, '2', u, 'OUT').wire(u, '+', g, '1').wire(v, '-', g, '1');
    const r = op(b.build());
    expect(r.components[u.id].voltage!).toBeCloseTo(-3, 3);
  });

  it('relay picks up only when the button is pressed', () => {
    const p = ex('relay');
    const k1 = byRef(p, 'K1');
    const s1 = byRef(p, 'S1');
    const off = op(p);
    expect(off.components[k1.id].state).toBe(false);
    expect(off.components[byRef(p, 'D1').id].current!).toBeLessThan(1e-6);
    const on = op(p, new Map([[`sw:${s1.id}`, true]]));
    expect(on.components[k1.id].state).toBe(true);
    expect(on.components[byRef(p, 'D1').id].current!).toBeGreaterThan(0.01);
    expect(Number(on.components[k1.id].extra?.coilCurrent)).toBeCloseTo(12 / 400, 3);
  });

  it('DOL starter seal-in: K1 stays energised after S1 is released, drops with S0', () => {
    const p = ex('dol-starter');
    const s1 = byRef(p, 'S1');
    const s0 = byRef(p, 'S0');
    const k1 = byRef(p, 'K1');
    const r0 = op(p);
    expect(r0.components[k1.id].state).toBe(false);
    const pressed = op(p, new Map([...Object.entries(r0.states), [`sw:${s1.id}`, true]]));
    expect(pressed.components[k1.id].state).toBe(true);
    const released = op(p, new Map([...Object.entries(pressed.states), [`sw:${s1.id}`, false]]));
    expect(released.components[k1.id].state).toBe(true);
    expect(released.components[byRef(p, 'H1').id].current!).toBeCloseTo(24 / 480, 2);
    const stopped = op(p, new Map([...Object.entries(released.states), [`sw:${s0.id}`, true]]));
    expect(stopped.components[k1.id].state).toBe(false);
  });

  it('PLC input reads ON only when the button is pressed', () => {
    const p = ex('plc-io');
    const i0 = byRef(p, 'I0');
    const s1 = byRef(p, 'S1');
    expect(op(p).components[i0.id].state).toBe(false);
    expect(op(p, new Map([[`sw:${s1.id}`, true]])).components[i0.id].state).toBe(true);
  });

  it('reports a missing ground instead of inventing a result', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vdc', { x: 0, y: 10 });
    const r = b.add('resistor', { x: 15, y: 5 });
    b.wire(v, '+', r, '1').wire(r, '2', v, '-');
    const res = runOperatingPoint(b.build());
    expect(res.ok).toBe(false);
    expect(res.findings.some((f) => f.code === 'NO_GROUND')).toBe(true);
  });

  it('reports a voltage-source loop as singular', () => {
    const b = new ProjectBuilder('electronic');
    const v1 = b.add('vdc', { x: 0, y: 10 }, { voltage: 5 });
    const v2 = b.add('vdc', { x: 20, y: 10 }, { voltage: 3 });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v1, '+', v2, '+').wire(v1, '-', v2, '-').wire(v1, '-', g, '1');
    const res = runOperatingPoint(b.build());
    expect(res.ok).toBe(false);
  });

  it('ideal transformer: Vs = Vp/n and power balance', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vdc', { x: 0, y: 10 }, { voltage: 230 });
    const t = b.add('transformer', { x: 20, y: 10 }, { ratio: 10 });
    const rl = b.add('resistor', { x: 40, y: 10 }, { resistance: 23 }, { rotation: 90 });
    const g = b.add('ground', { x: 0, y: 30 });
    const g2 = b.add('ground', { x: 40, y: 30 });
    b.wire(v, '+', t, 'P1').wire(t, 'P2', v, '-').wire(v, '-', g, '1').wire(t, 'S1', rl, '1').wire(rl, '2', t, 'S2').wire(t, 'S2', g2, '1');
    const r = op(b.build());
    expect(r.components[rl.id].voltage!).toBeCloseTo(23, 6);
    expect(r.components[v.id].current!).toBeCloseTo(0.1, 6); // 23 W / 230 V
  });
});

describe('transient analysis against analytic solutions', () => {
  it('RC charging follows 1 - exp(-t/RC)', () => {
    const p = ex('rc');
    const r = runTransient(p, 0.5, 1000, undefined, true) as TranResultView;
    expect(r.ok).toBe(true);
    const vc = r.traces.find((t) => t.name === 'V(VC)')!;
    for (const t of [0.05, 0.1, 0.2, 0.4]) {
      const k = Math.round(t / (0.5 / 1000));
      expect(vc.values[k]).toBeCloseTo(5 * (1 - Math.exp(-t / 0.1)), 3);
    }
  });

  it('RL current rise follows (V/R)(1 - exp(-tR/L))', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vdc', { x: 0, y: 10 }, { voltage: 10 });
    const r1 = b.add('resistor', { x: 15, y: 5 }, { resistance: 100 });
    const l1 = b.add('inductor', { x: 30, y: 5 }, { inductance: 0.1 });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v, '+', r1, '1').wire(r1, '2', l1, '1').wire(l1, '2', v, '-', [{ x: 35, y: 15 }, { x: 0, y: 15 }]).wire(v, '-', g, '1');
    const res = runTransient(b.build(), 0.005, 1000, undefined, true) as TranResultView;
    const il = res.traces.find((t) => t.name.startsWith('I(L'))!;
    const tau = 0.1 / 100;
    for (const t of [0.0005, 0.001, 0.003]) {
      const k = Math.round(t / (0.005 / 1000));
      expect(il.values[k]).toBeCloseTo(0.1 * (1 - Math.exp(-t / tau)), 4);
    }
  });

  it('half-wave rectifier output peaks near Vpk - Vf and ripples', () => {
    const r = runTransient(ex('rectifier'), 0.1, 2000) as TranResultView;
    const out = r.traces.find((t) => t.name === 'V(VOUT)')!;
    const last = Array.from(out.values.slice(1000));
    const max = Math.max(...last);
    const min = Math.min(...last);
    expect(max).toBeGreaterThan(10.8);
    expect(max).toBeLessThan(11.6);
    expect(max - min).toBeGreaterThan(0.3);
    expect(max - min).toBeLessThan(0.7);
  });
});

describe('AC analysis', () => {
  it('RC low-pass is −3.01 dB at fc = 1/(2πRC)', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vac', { x: 0, y: 10 }, { amplitude: 1 });
    const r1 = b.add('resistor', { x: 15, y: 5 }, { resistance: 1000 });
    const c1 = b.add('capacitor', { x: 25, y: 15 }, { capacitance: 1e-6 }, { rotation: 90 });
    const pr = b.add('probe', { x: 25, y: 5 }, { name: 'OUT' });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v, '+', r1, '1').wire(r1, '2', c1, '1').wire(pr, '1', c1, '1').wire(c1, '2', g, '1').wire(v, '-', g, '1');
    const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
    const res = runAC(b.build(), fc, fc * 10, 10);
    if (!res.ok) throw new Error(res.error);
    if (res.kind !== 'ac') throw new Error('expected ac');
    const t = res.traces[0];
    expect(t.magDb[0]).toBeCloseTo(-3.0103, 3);
    expect(t.phaseDeg[0]).toBeCloseTo(-45, 2);
    expect(t.magDb[t.magDb.length - 1]).toBeCloseTo(-20.043, 2); // 10·fc: 1/sqrt(1+100)
  });
});

describe('circuit model', () => {
  it('excludes unsupported parts and reports them as not evaluated', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vdc', { x: 0, y: 10 });
    const u = b.add('ic8', { x: 30, y: 10 });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v, '+', u, '1').wire(v, '-', g, '1');
    const m = buildCircuit(b.build());
    expect(m.unsupported.map((x) => x.ref)).toContain(u.ref);
    const r = runOperatingPoint(b.build());
    expect(r.findings.some((f) => f.status === 'not-evaluated')).toBe(true);
  });
});
