import { describe, expect, it } from 'vitest';
import { compilePlc, scan, PlcSyntaxError } from '../../src/simulation/plc';
import { EXAMPLES } from '../../src/education/examples';
import { runOperatingPoint, runTransient, type OpResult, type TranResultView } from '../../src/simulation/simulate';
import { ProjectBuilder } from '../../src/project-model/builder';
import { logicLevels } from '../../src/simulation/circuit';
import { setProperty, updateSettings } from '../../src/project-model/operations';
import type { Project } from '../../src/project-model/types';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const byRef = (p: Project, ref: string) => Object.values(p.components).find((c) => c.ref === ref)!;
const op = (p: Project, states?: Map<string, boolean>) => {
  const r = runOperatingPoint(p, states);
  if (!r.ok) throw new Error(r.error);
  return r as OpResult;
};

describe('Structured Text interpreter', () => {
  it('evaluates precedence NOT > AND > XOR > OR', () => {
    const prog = compilePlc('M1 := I0.0 OR I0.1 AND NOT I0.2; M2 := I0.0 XOR I0.1;');
    const run = (a: boolean, b: boolean, c: boolean) => {
      const env = new Map([['I0.0', a], ['I0.1', b], ['I0.2', c]]);
      scan(prog, env);
      return [env.get('M1'), env.get('M2')];
    };
    expect(run(false, true, false)).toEqual([true, true]);
    expect(run(false, true, true)).toEqual([false, true]);
    expect(run(true, true, true)).toEqual([true, false]);
  });

  it('supports IF / ELSIF / ELSE, comments and %-addresses', () => {
    const prog = compilePlc(`(* set / reset latch *)
      IF %I0.1 THEN Q0.0 := FALSE;   // stop has priority
      ELSIF %I0.0 THEN Q0.0 := TRUE;
      ELSE Q0.0 := Q0.0;
      END_IF;`);
    const env = new Map<string, boolean>([['I0.0', true], ['I0.1', false]]);
    scan(prog, env);
    expect(env.get('Q0.0')).toBe(true);
    env.set('I0.0', false);
    scan(prog, env);
    expect(env.get('Q0.0')).toBe(true);
    env.set('I0.1', true);
    scan(prog, env);
    expect(env.get('Q0.0')).toBe(false);
  });

  it('reports syntax errors with line numbers and refuses writes to inputs', () => {
    expect(() => compilePlc('Q0.0 := I0.0 AND ;')).toThrow(PlcSyntaxError);
    expect(() => compilePlc('\n\nQ0.0 = I0.0;')).toThrow(/line 3/);
    expect(() => compilePlc('I0.0 := TRUE;')).toThrow(/cannot assign to input/);
    expect(() => compilePlc('T1 := 5;')).toThrow(/numbers are not supported/);
  });
});

describe('PLC program in the circuit simulation', () => {
  it('start / stop with seal-in through real input voltages', () => {
    const p = ex('plc-io');
    const s1 = byRef(p, 'S1');
    const s2 = byRef(p, 'S2');
    const q0 = byRef(p, 'Q0');
    const h1 = byRef(p, 'H1');
    const idle = op(p);
    expect(idle.components[q0.id].state).toBe(false);
    const started = op(p, new Map([[`sw:${s1.id}`, true]]));
    expect(started.components[q0.id].state).toBe(true);
    expect(started.components[h1.id].current!).toBeCloseTo(24 / 480.1, 3);
    const released = op(p, new Map([...Object.entries(started.states), [`sw:${s1.id}`, false]]));
    expect(released.components[q0.id].state).toBe(true); // seal-in held by the program
    const stopped = op(p, new Map([...Object.entries(released.states), [`sw:${s2.id}`, true]]));
    expect(stopped.components[q0.id].state).toBe(false);
  });

  it('a syntax error blocks simulation with an error finding', () => {
    const p = updateSettings(ex('plc-io'), { plcProgram: 'Q0.0 := (I0.0 OR ;' });
    const r = runOperatingPoint(p);
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.code === 'PLC_SYNTAX')?.status).toBe('error');
  });

  it('warns about program addresses without wired I/O', () => {
    const p = updateSettings(ex('plc-io'), { plcProgram: 'Q0.0 := I0.0; Q0.7 := I0.5;' });
    const r = op(p);
    expect(r.findings.filter((f) => f.code === 'PLC_UNWIRED_IO')).toHaveLength(2);
  });

  it('without a program the output follows the forced state', () => {
    let p = updateSettings(ex('plc-io'), { plcProgram: '' });
    const q0 = byRef(p, 'Q0');
    expect(op(p).components[q0.id].state).toBe(false);
    p = setProperty(p, q0.id, 'state', true);
    expect(op(p).components[q0.id].state).toBe(true);
  });
});

describe('digital logic simulation', () => {
  it('AND gate truth table drives the LED', () => {
    const p = ex('logic-and');
    const sa = byRef(p, 'SA');
    const sb = byRef(p, 'SB');
    const u1 = byRef(p, 'U1');
    const d1 = byRef(p, 'D1');
    for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const r = op(p, new Map([[`sw:${sa.id}`, a], [`sw:${sb.id}`, b]]));
      expect(r.components[u1.id].state).toBe(a && b);
      if (a && b) expect(r.components[d1.id].current!).toBeGreaterThan(0.006);
      else expect(r.components[d1.id].current!).toBeLessThan(1e-6);
    }
  });

  it('family thresholds: CMOS scales with Vcc, 74LS uses TTL levels', () => {
    expect(logicLevels('74HC', 5)).toEqual({ vih: 3.5, vil: 1.5, voh: 5, vol: 0 });
    expect(logicLevels('74HC', 3.3).vih).toBeCloseTo(2.31, 9);
    expect(logicLevels('74LS', 5)).toMatchObject({ vih: 2.0, vil: 0.8 });
  });

  it('an inverter ring oscillator is detected instead of producing a fake steady state', () => {
    const b = new ProjectBuilder('electronic');
    const u1 = b.add('gate_not', { x: 0, y: 0 });
    const g = b.add('ground', { x: 0, y: 30 });
    b.wire(u1, 'Y', u1, 'A', [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: -10, y: 10 }, { x: -10, y: 0 }]);
    void g;
    const r = op(b.build());
    expect(r.findings.some((f) => f.code === 'RELAY_OSCILLATION')).toBe(true);
  });

  it('undefined input levels are reported', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vdc', { x: 0, y: 10 }, { voltage: 2.5 });
    const u1 = b.add('gate_not', { x: 20, y: 5 });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v, '+', u1, 'A').wire(v, '-', g, '1');
    const r = op(b.build());
    expect(r.findings.some((f) => f.code === 'LOGIC_UNDEFINED')).toBe(true);
  });

  it('gates switch during a transient (square-wave input from a sine source)', () => {
    const b = new ProjectBuilder('electronic');
    const v = b.add('vac', { x: 0, y: 10 }, { amplitude: 2.5, offset: 2.5, frequency: 1000 });
    const u1 = b.add('gate_not', { x: 20, y: 5 });
    const pr = b.add('probe', { x: 35, y: 5 }, { name: 'Y' });
    const g = b.add('ground', { x: 0, y: 25 });
    b.wire(v, '+', u1, 'A').wire(u1, 'Y', pr, '1').wire(v, '-', g, '1');
    const r = runTransient(b.build(), 0.002, 400) as TranResultView;
    expect(r.ok).toBe(true);
    const y = r.traces.find((t) => t.name === 'V(Y)')!.values;
    const highs = Array.from(y).filter((v) => v > 4.9).length;
    const lows = Array.from(y).filter((v) => v < 0.1).length;
    expect(highs).toBeGreaterThan(100);
    expect(lows).toBeGreaterThan(100);
  });
});
