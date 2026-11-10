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

describe('PLC timers and counters (TON / TOF / CTU)', () => {
  const run = (src: string, steps: [number, Record<string, boolean>][], out: string) => {
    const prog = compilePlc(src);
    const mem = new Map();
    const env = new Map<string, boolean>();
    return steps.map(([t, ins]) => {
      for (const [k, v] of Object.entries(ins)) env.set(k, v);
      scan(prog, env, t, mem);
      scan(prog, env, t, mem); // repeated scans at the same instant must not change the result
      return env.get(out) ?? false;
    });
  };

  it('TON: Q turns on after IN has been true for PT and drops with IN', () => {
    const q = run('VAR T1 : TON; END_VAR T1(IN := I0.0, PT := T#2s); Q0.0 := T1.Q;', [[0, { 'I0.0': false }], [1, { 'I0.0': true }], [2.9, {}], [3, {}], [5, {}], [5.1, { 'I0.0': false }], [6, { 'I0.0': true }], [7.9, {}], [8, {}]], 'Q0.0');
    expect(q).toEqual([false, false, false, true, true, false, false, false, true]);
  });

  it('TON: an input pulse shorter than PT never sets Q', () => {
    const q = run('VAR T1 : TON; END_VAR T1(IN := I0.0, PT := T#500ms); Q0.0 := T1.Q;', [[0, { 'I0.0': true }], [0.4, {}], [0.45, { 'I0.0': false }], [0.6, { 'I0.0': true }], [1.0, {}], [1.1, {}]], 'Q0.0');
    expect(q).toEqual([false, false, false, false, false, true]);
  });

  it('TOF: Q follows IN on and stays on for PT after IN drops', () => {
    const q = run('VAR T2 : TOF; END_VAR T2(IN := I0.0, PT := T#1s); Q0.0 := T2.Q;', [[0, { 'I0.0': false }], [1, { 'I0.0': true }], [2, { 'I0.0': false }], [2.9, {}], [3, {}], [4, {}]], 'Q0.0');
    expect(q).toEqual([false, true, true, true, false, false]);
  });

  it('CTU: counts rising edges only, Q at PV, R resets', () => {
    const src = 'VAR C1 : CTU; END_VAR C1(CU := I0.0, R := I0.1, PV := 3); Q0.0 := C1.Q;';
    const hi = { 'I0.0': true };
    const lo = { 'I0.0': false };
    const q = run(src, [[0, hi], [1, hi], [2, lo], [3, hi], [4, lo], [5, hi], [6, { 'I0.1': true }], [7, { 'I0.1': false, 'I0.0': false }], [8, hi]], 'Q0.0');
    expect(q).toEqual([false, false, false, false, false, true, false, false, false]);
  });

  it('time literals: ms, s, m, h and compound forms', () => {
    const pt = (lit: string) => (compilePlc(`VAR T : TON; END_VAR T(IN := TRUE, PT := ${lit});`).statements[0] as { pt: number }).pt;
    expect(pt('T#500ms')).toBeCloseTo(0.5, 12);
    expect(pt('T#2s')).toBe(2);
    expect(pt('TIME#1m30s')).toBe(90);
    expect(pt('t#1h')).toBe(3600);
    expect(pt('T#1.5s')).toBe(1.5);
  });

  it('precise errors for misuse', () => {
    expect(() => compilePlc('Q0.0 := T1.Q;')).toThrow(/unknown function block "T1"/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR T1(IN := I0.0);')).toThrow(/needs PT/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR T1(IN := I0.0, PT := 5);')).toThrow(/time literal/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR T1(PT := T#1s);')).toThrow(/needs IN/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR T1(IN := I0.0, PT := T#1s); Q0.0 := T1.ET;')).toThrow(/only the Boolean output T1.Q/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR T1.Q := TRUE;')).toThrow(/cannot assign/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR Q0.0 := T1;')).toThrow(/function block/);
    expect(() => compilePlc('VAR C1 : CTU; END_VAR C1(CU := I0.0, PV := 0);')).toThrow(/needs PV/);
    expect(() => compilePlc('VAR C1 : CTD; END_VAR')).toThrow(/unsupported type "CTD"/);
    expect(() => compilePlc('VAR T1 : TON; T1 : TOF; END_VAR')).toThrow(/declared twice/);
    expect(() => compilePlc('VAR T1 : TON; END_VAR T1(IN := I0.0, PT := T#1s, X := TRUE);')).toThrow(/no parameter "X"/);
  });

  it('example: on-delay lamp and pulse counter in a transient simulation', () => {
    const e = EXAMPLES.find((x) => x.id === 'plc-timer')!;
    const p = e.build();
    const r = runTransient(p, 1, 1000) as TranResultView;
    expect(r.ok).toBe(true);
    const cur = (ref: string) => r.traces.find((t) => t.name === `V(N_${ref}_X1)`)!.values; // lamp voltage
    const first = (v: Float64Array) => r.time[Array.from(v).findIndex((x) => Math.abs(x) > 1)];
    // H1: TON 300 ms after S1 (closed from t = 0); resolution is one 1 ms step
    expect(first(cur('H1'))).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(first(cur('H1'))).toBeLessThanOrEqual(0.301 + 1e-9);
    expect(cur('H1')[1000]).toBeCloseTo((24 * 480) / 480.1, 3);
    // H2: third rising crossing of 15 V by 12 + 12·sin(2π·5·t − 90°): t = 0.4 + (90° + asin(0.25)) / (360°·5)
    const expected = 0.4 + (Math.PI / 2 + Math.asin(0.25)) / (2 * Math.PI * 5);
    expect(first(cur('H2'))).toBeGreaterThanOrEqual(expected - 1e-9);
    expect(first(cur('H2'))).toBeLessThanOrEqual(expected + 0.0011);
  });

  it('operating point with a timer reports that no time has elapsed', () => {
    const p = EXAMPLES.find((x) => x.id === 'plc-timer')!.build();
    const r = op(p);
    expect(r.components[byRef(p, 'Q0').id].state).toBe(false);
    expect(r.findings.some((f) => f.code === 'PLC_TIMER_OP')).toBe(true);
  });

  it('opening S1 resets both: timer output drops and counter is held at zero', () => {
    const p = EXAMPLES.find((x) => x.id === 'plc-timer')!.build();
    const s1 = byRef(p, 'S1');
    const r = runTransient(p, 1, 1000, new Map([[`sw:${s1.id}`, false]])) as TranResultView;
    const max = (ref: string) => Math.max(...Array.from(r.traces.find((t) => t.name === `V(N_${ref}_X1)`)!.values).map(Math.abs));
    expect(max('H1')).toBeLessThan(1e-3);
    expect(max('H2')).toBeLessThan(1e-3);
  });
});
