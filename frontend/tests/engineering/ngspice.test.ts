import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/education/examples';
import { runOperatingPoint, runTransient, type OpResult, type TranResultView } from '../../src/simulation/simulate';
import { toSpice } from '../../src/simulation/spice';
import { hasNgspice, interp, ngspiceOp, ngspiceTran } from './helpers';
import { buildNetlist } from '../../src/project-model/connectivity';
import type { Project } from '../../src/project-model/types';

/** SPICE vector for the net a named probe sits on. */
function probeVector(p: Project, probeName: string): string {
  const probe = Object.values(p.components).find((c) => c.type === 'probe' && c.properties.name === probeName)!;
  const net = buildNetlist(p).pinNet.get(`p:${probe.id}:1`)!;
  return `v(${net.toLowerCase()})`;
}

/**
 * Independent reference: every DC example is exported to a SPICE netlist and solved by ngspice;
 * node voltages must agree with the built-in MNA solver. Skipped (not passed) when ngspice is absent.
 */
const available = hasNgspice();
const suite = available ? describe : describe.skip;

suite('cross-validation with ngspice', () => {
  const dcExamples = EXAMPLES.filter((e) => e.type !== 'installation' && e.analysis.kind === 'op');
  for (const exDef of dcExamples) {
    it(`operating point matches ngspice: ${exDef.title}`, () => {
      const p = exDef.build();
      const ours = runOperatingPoint(p) as OpResult;
      expect(ours.ok).toBe(true);
      const ref = ngspiceOp(toSpice(p, { analysis: { kind: 'op' } }));
      let compared = 0;
      for (const [net, v] of Object.entries(ours.nodeVoltages)) {
        if (net === '0') continue;
        const r = ref[net.toLowerCase()] ?? ref[`v(${net.toLowerCase()})`];
        if (r === undefined) continue;
        expect(Math.abs(v - r)).toBeLessThan(1e-4 + 1e-4 * Math.abs(r));
        compared++;
      }
      expect(compared).toBeGreaterThan(0);
    });
  }

  it('relay energised state matches ngspice (states exported)', () => {
    const exDef = EXAMPLES.find((e) => e.id === 'relay')!;
    const p = exDef.build();
    const s1 = Object.values(p.components).find((c) => c.ref === 'S1')!;
    const states = new Map([[`sw:${s1.id}`, true]]);
    const ours = runOperatingPoint(p, states) as OpResult;
    const ref = ngspiceOp(toSpice(p, { analysis: { kind: 'op' }, states: new Map(Object.entries(ours.states)) }));
    for (const [net, v] of Object.entries(ours.nodeVoltages)) {
      const r = ref[net.toLowerCase()];
      if (r !== undefined) expect(Math.abs(v - r)).toBeLessThan(1e-4 + 1e-4 * Math.abs(r));
    }
  });

  it('rectifier transient matches ngspice within 2 %', () => {
    const p = EXAMPLES.find((e) => e.id === 'rectifier')!.build();
    const ours = runTransient(p, 0.1, 4000) as TranResultView;
    const vec = probeVector(p, 'VOUT');
    const ref = ngspiceTran(toSpice(p, { analysis: { kind: 'tran', tstop: 0.1, step: 2.5e-5 } }), [vec]);
    const out = ours.traces.find((t) => t.name === 'V(VOUT)')!;
    for (const t of [0.012, 0.03, 0.055, 0.08, 0.099]) {
      const a = interp(ours.time, out.values, t);
      const b = interp(ref.time, ref.data[vec], t);
      expect(Math.abs(a - b)).toBeLessThan(0.02 * Math.max(Math.abs(b), 1));
    }
  });

  it('inverting amplifier transient matches ngspice', () => {
    const p = EXAMPLES.find((e) => e.id === 'inverting-amp')!.build();
    const ours = runTransient(p, 0.002, 400) as TranResultView;
    const vec = probeVector(p, 'VOUT');
    const ref = ngspiceTran(toSpice(p, { analysis: { kind: 'tran', tstop: 0.002, step: 5e-6 } }), [vec]);
    const out = ours.traces.find((t) => t.name === 'V(VOUT)')!;
    for (const t of [0.00025, 0.0005, 0.00125, 0.0019]) {
      expect(interp(ours.time, out.values, t)).toBeCloseTo(interp(ref.time, ref.data[vec], t), 2);
    }
  });
});
