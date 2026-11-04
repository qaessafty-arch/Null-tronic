import { getDef } from '../component-library/library';
import { formatSI } from '../calculations/units';
import type { Finding, Id, Project } from '../project-model/types';
import { buildCircuit, type CircuitModel, type Element } from './circuit';
import { ConvergenceError, diodeIV, bjtEval, mosEval, solveAC, solveOperatingPoint, solveTransient } from './solver';

export interface ComponentResult {
  /** Voltage across the component (first pin minus second pin), V. */
  voltage?: number;
  /** Current through the component (into first pin), A. */
  current?: number;
  /** Power absorbed, W (negative = delivering). */
  power?: number;
  /** Discrete state: switch closed / coil energised / PLC input on. */
  state?: boolean;
  /** Additional named quantities (Ic, Ib, Vce, region ...). */
  extra?: Record<string, number | string>;
}

export interface OpResult {
  kind: 'op';
  ok: true;
  nodeVoltages: Record<string, number>;
  components: Record<Id, ComponentResult>;
  iterations: number;
  method: string;
  findings: Finding[];
  states: Record<string, boolean>;
  timestamp: string;
}

export interface Trace {
  name: string;
  unit: 'V' | 'A';
  values: Float64Array;
}

export interface TranResultView {
  kind: 'tran';
  ok: true;
  time: Float64Array;
  traces: Trace[];
  findings: Finding[];
  timestamp: string;
}

export interface AcResultView {
  kind: 'ac';
  ok: true;
  freq: Float64Array;
  traces: { name: string; magDb: Float64Array; phaseDeg: Float64Array }[];
  findings: Finding[];
  timestamp: string;
}

export interface SimFailure {
  kind: 'op' | 'tran' | 'ac';
  ok: false;
  error: string;
  findings: Finding[];
  timestamp: string;
}

export type SimResult = OpResult | TranResultView | AcResultView | SimFailure;

const V = (x: Float64Array, n: number) => (n >= 0 ? x[n] : 0);

function preflight(project: Project, model: CircuitModel): Finding[] {
  const f: Finding[] = [];
  const simulatable = model.elements.length;
  if (simulatable === 0) f.push({ id: 'sim-empty', status: 'error', code: 'SIM_EMPTY', message: 'Nothing to simulate: the design contains no simulatable components.', refs: [] });
  if (!model.hasGround && simulatable > 0)
    f.push({ id: 'sim-gnd', status: 'error', code: 'NO_GROUND', message: 'No ground (0 V reference) symbol is connected. Add a Ground component.', refs: [], basis: 'Nodal analysis needs a reference node.' });
  if (!model.elements.some((e) => e.kind === 'V' || e.kind === 'I'))
    f.push({ id: 'sim-src', status: 'warning', code: 'NO_SOURCE', message: 'No independent source: every voltage will be 0 V.', refs: [] });
  for (const u of model.unsupported) f.push({ id: `sim-ns-${u.cid}`, status: 'not-evaluated', code: 'NOT_SIMULATED', message: `${u.ref}: ${u.reason}.`, refs: [u.cid] });
  for (const c of model.netlist.conflicts) f.push({ id: `sim-lbl-${c.net}`, status: 'warning', code: 'LABEL_CONFLICT', message: `Net ${c.net} has several labels (${c.labels.join(', ')}); they are shorted together.`, refs: [] });
  // floating subcircuits (no DC path to ground)
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  for (const e of model.elements) {
    switch (e.kind) {
      case 'R':
      case 'L':
      case 'V':
      case 'SW':
        link(e.a, e.b);
        break;
      case 'D':
        link(e.a, e.k);
        break;
      case 'Q':
        link(e.b, e.e);
        link(e.c, e.e);
        break;
      case 'M':
        link(e.d, e.s);
        break;
      case 'OA':
        link(e.out, -1);
        break;
      case 'XF':
        link(e.p1, e.p2);
        link(e.s1, e.s2);
        break;
      default:
        break;
    }
  }
  const seen = new Set<number>([-1]);
  const stack = [-1];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) {
      seen.add(m);
      stack.push(m);
    }
  }
  if (model.hasGround) {
    for (let i = 0; i < model.nodeNames.length; i++) {
      const name = model.nodeNames[i];
      if (name.includes('#')) continue;
      if (!seen.has(i)) {
        const net = model.netlist.byName.get(name);
        f.push({
          id: `sim-float-${name}`,
          status: 'warning',
          code: 'FLOATING_NODE',
          message: `Net ${name} has no DC path to ground; its voltage is set only by a 1 pΩ⁻¹ shunt and is not meaningful.`,
          refs: net ? net.pins.map((p) => p.componentId) : [],
          basis: 'Every node needs a DC path to the reference for a unique operating point.',
        });
      }
    }
  }
  void project;
  return f;
}

function componentResults(project: Project, model: CircuitModel, x: Float64Array, states: Map<string, boolean>): Record<Id, ComponentResult> {
  const out: Record<Id, ComponentResult> = {};
  const get = (cid: Id) => (out[cid] ??= {});
  for (const e of model.elements) {
    const r = get(e.cid);
    switch (e.kind) {
      case 'R': {
        const v = V(x, e.a) - V(x, e.b);
        const i = v / e.r;
        if (e.role === 'rs') {
          r.power = (r.power ?? 0) + v * i;
          break;
        }
        if (e.role === 'coil') {
          r.extra = { ...(r.extra ?? {}), coilVoltage: v, coilCurrent: i };
          r.voltage = v;
          r.current = i;
          r.power = v * i;
          break;
        }
        r.voltage = v;
        r.current = i;
        r.power = v * i;
        break;
      }
      case 'C':
        r.voltage = V(x, e.a) - V(x, e.b);
        r.current = 0;
        r.power = 0;
        break;
      case 'L': {
        const i = x[model.numNodes + e.br];
        r.voltage = V(x, e.a) - V(x, e.b);
        r.current = i;
        r.power = r.voltage * i;
        break;
      }
      case 'V': {
        const i = x[model.numNodes + e.br];
        r.voltage = V(x, e.a) - V(x, e.b);
        if (e.meter) {
          r.current = i;
          r.power = 0;
        } else {
          r.current = -i; // current delivered out of "+"
          r.power = r.voltage * i;
        }
        break;
      }
      case 'I': {
        const v = V(x, e.a) - V(x, e.b);
        r.voltage = v;
        r.current = e.dc;
        r.power = -v * e.dc;
        break;
      }
      case 'D': {
        const vd = V(x, e.a) - V(x, e.k);
        const { id } = diodeIV(vd, e.is, e.n, e.bv, e.ibv);
        r.voltage = V(x, e.extAnode) - V(x, e.k);
        r.current = id;
        r.power = (r.power ?? 0) + vd * id;
        break;
      }
      case 'Q': {
        const vb = V(x, e.b);
        const vc = V(x, e.c);
        const ve = V(x, e.e);
        const o = bjtEval(e.pol * (vb - ve), e.pol * (vb - vc), e.is, e.bf, e.br);
        const ic = e.pol * o.ic;
        const ib = e.pol * o.ib;
        const vce = vc - ve;
        const vbe = vb - ve;
        const region = e.pol * vbe < 0.4 ? 'cut-off' : e.pol * (vb - vc) > 0.4 ? 'saturation' : 'active';
        r.current = ic;
        r.voltage = vce;
        r.power = vce * ic + vbe * ib;
        r.extra = { Ic: ic, Ib: ib, Ie: -(ic + ib), Vbe: vbe, Vce: vce, region };
        break;
      }
      case 'M': {
        let vd = V(x, e.d);
        let vs = V(x, e.s);
        const vg = V(x, e.g);
        let sign = 1;
        if (e.pol * (vd - vs) < 0) {
          [vd, vs] = [vs, vd];
          sign = -1;
        }
        const o = mosEval(e.pol * (vg - vs), e.pol * (vd - vs), e.vth, e.k, e.lambda);
        const id = sign * e.pol * o.id;
        r.current = id;
        r.voltage = V(x, e.d) - V(x, e.s);
        r.power = r.voltage * id;
        r.extra = { Id: id, Vgs: V(x, e.g) - V(x, e.s), Vds: r.voltage, region: o.region };
        break;
      }
      case 'OA': {
        const i = x[model.numNodes + e.br];
        r.voltage = V(x, e.out);
        r.current = i;
        r.extra = { Vout: V(x, e.out), Vdiff: V(x, e.p) - V(x, e.n), saturated: Math.abs(V(x, e.out) - e.vpos) < 0.05 || Math.abs(V(x, e.out) - e.vneg) < 0.05 ? 'yes' : 'no' };
        break;
      }
      case 'XF': {
        const ip = x[model.numNodes + e.br];
        r.voltage = V(x, e.p1) - V(x, e.p2);
        r.current = ip;
        r.extra = { Vs: V(x, e.s1) - V(x, e.s2), Is: -e.ratio * ip };
        break;
      }
      case 'SW': {
        const st = states.get(e.stateKey) ?? false;
        const closed = e.invert ? !st : st;
        const v = V(x, e.a) - V(x, e.b);
        if (e.name.includes('.')) {
          r.extra = { ...(r.extra ?? {}), [`${e.name.split('.')[1]} contact`]: closed ? 'closed' : 'open' };
        } else {
          r.voltage = v;
          r.current = v / (closed ? e.ron : e.roff);
          r.state = closed;
        }
        break;
      }
    }
  }
  for (const c of model.coils) get(c.cid).state = states.get(c.stateKey) ?? false;
  for (const p of model.plcInputs) {
    const v = V(x, p.node);
    get(p.cid).voltage = v;
    get(p.cid).state = v >= p.threshold;
  }
  // probes report their net voltage
  for (const c of Object.values(project.components)) {
    if (c.type !== 'probe') continue;
    const net = model.netlist.pinNet.get(`p:${c.id}:1`);
    const n = net === undefined ? undefined : model.nodeOf.get(net);
    if (n !== undefined) get(c.id).voltage = V(x, n);
  }
  return out;
}

/** Engineering checks that need simulation results (ratings, polarity). */
function ratingFindings(project: Project, res: Record<Id, ComponentResult>): Finding[] {
  const f: Finding[] = [];
  for (const [cid, r] of Object.entries(res)) {
    const c = project.components[cid];
    if (!c) continue;
    const pr = c.properties;
    if (c.type === 'resistor' && typeof pr.powerRating === 'number' && r.power !== undefined && pr.powerRating > 0) {
      const ratio = Math.abs(r.power) / pr.powerRating;
      if (ratio > 1)
        f.push({ id: `rate-${cid}`, status: 'error', code: 'OVER_POWER', message: `${c.ref} dissipates ${formatSI(Math.abs(r.power), 'W')}, above its ${formatSI(pr.powerRating, 'W')} rating.`, refs: [cid], basis: 'P = I²R compared with the entered power rating.' });
      else if (ratio > 0.5)
        f.push({ id: `rate-${cid}`, status: 'warning', code: 'POWER_MARGIN', message: `${c.ref} dissipates ${formatSI(Math.abs(r.power), 'W')} (${Math.round(ratio * 100)} % of rating). Consider a 50 % derating margin.`, refs: [cid], basis: 'Common design practice of operating resistors at ≤ 50 % of rated power (assumption).' });
    }
    if ((c.type === 'led' || c.type === 'diode') && typeof pr.maxCurrent === 'number' && r.current !== undefined) {
      if (pr.maxCurrent <= 0) {
        if (Math.abs(r.current) > 1e-6) f.push({ id: `rate-${cid}`, status: 'not-evaluated', code: 'NO_RATING', message: `${c.ref}: maximum current not entered; current ${formatSI(r.current, 'A')} not checked.`, refs: [cid] });
      } else if (r.current > pr.maxCurrent) {
        f.push({ id: `rate-${cid}`, status: 'error', code: 'OVER_CURRENT', message: `${c.ref} forward current ${formatSI(r.current, 'A')} exceeds the entered maximum ${formatSI(pr.maxCurrent, 'A')}.`, refs: [cid], basis: 'Simulated current compared with the entered rating.' });
      }
    }
    if (c.type === 'zener' && typeof pr.powerRating === 'number' && r.power !== undefined && Math.abs(r.power) > pr.powerRating)
      f.push({ id: `rate-${cid}`, status: 'error', code: 'OVER_POWER', message: `${c.ref} dissipates ${formatSI(Math.abs(r.power), 'W')}, above ${formatSI(pr.powerRating, 'W')}.`, refs: [cid] });
    if ((c.type === 'capacitor' || c.type === 'capacitor_polarized') && typeof pr.voltageRating === 'number' && r.voltage !== undefined && Math.abs(r.voltage) > pr.voltageRating)
      f.push({ id: `rate-${cid}`, status: 'error', code: 'OVER_VOLTAGE', message: `${c.ref} sees ${formatSI(r.voltage, 'V')}, above its ${formatSI(pr.voltageRating, 'V')} rating.`, refs: [cid] });
    if (c.type === 'capacitor_polarized' && r.voltage !== undefined && r.voltage < -0.5)
      f.push({ id: `pol-${cid}`, status: 'error', code: 'REVERSE_POLARITY', message: `${c.ref} is reverse biased (${formatSI(r.voltage, 'V')}).`, refs: [cid] });
    if (c.type === 'opamp' && r.extra?.saturated === 'yes')
      f.push({ id: `oa-${cid}`, status: 'warning', code: 'OPAMP_SATURATED', message: `${c.ref} output is at its limit (${formatSI(r.voltage ?? 0, 'V')}).`, refs: [cid] });
    if (c.type === 'relay' || c.type === 'coil') {
      const v = Math.abs(Number(r.extra?.coilVoltage ?? 0));
      const rated = Number(pr.coilVoltage);
      if (rated > 0 && v > rated * 1.1)
        f.push({ id: `coil-${cid}`, status: 'warning', code: 'COIL_OVERVOLTAGE', message: `${c.ref} coil voltage ${formatSI(v, 'V')} exceeds rated ${formatSI(rated, 'V')} by more than 10 %.`, refs: [cid] });
    }
  }
  return f;
}

const stamp = () => new Date().toISOString();

export function runOperatingPoint(project: Project, states?: Map<string, boolean>): OpResult | SimFailure {
  const model = buildCircuit(project);
  const findings = preflight(project, model);
  if (findings.some((f) => f.status === 'error')) return { kind: 'op', ok: false, error: findings.find((f) => f.status === 'error')!.message, findings, timestamp: stamp() };
  try {
    const sol = solveOperatingPoint(model, states);
    const nodeVoltages: Record<string, number> = {};
    model.nodeNames.forEach((n, i) => {
      if (!n.includes('#')) nodeVoltages[n] = sol.x[i];
    });
    for (const net of model.netlist.nets) if (net.isGround) nodeVoltages[net.name] = 0;
    const comps = componentResults(project, model, sol.x, sol.states);
    findings.push(...ratingFindings(project, comps));
    if (sol.oscillation) findings.push({ id: 'sim-osc', status: 'warning', code: 'RELAY_OSCILLATION', message: 'Relay states do not settle (the circuit oscillates, e.g. a relay that interrupts its own coil). Showing the last state.', refs: [] });
    if (sol.method !== 'newton') findings.push({ id: 'sim-method', status: 'review', code: 'CONTINUATION', message: `Operating point found with ${sol.method}; verify the result.`, refs: [] });
    if (Object.values(project.components).some((c) => c.type === 'opamp'))
      findings.push({ id: 'sim-oa-model', status: 'review', code: 'MODEL_LIMIT', message: 'Op-amps use an ideal high-gain macro-model (no input bias, offset, bandwidth or slew-rate limits).', refs: [] });
    return { kind: 'op', ok: true, nodeVoltages, components: comps, iterations: sol.iterations, method: sol.method, findings, states: Object.fromEntries(sol.states), timestamp: stamp() };
  } catch (e) {
    const msg = e instanceof ConvergenceError ? e.message : `Simulation failed: ${(e as Error).message}`;
    return { kind: 'op', ok: false, error: msg, findings: [...findings, { id: 'sim-fail', status: 'error', code: 'SIM_FAILED', message: msg, refs: [] }], timestamp: stamp() };
  }
}

function elementTraceSources(project: Project, model: CircuitModel): { name: string; unit: 'V' | 'A'; get: (x: Float64Array) => number }[] {
  const traces: { name: string; unit: 'V' | 'A'; get: (x: Float64Array) => number }[] = [];
  const probeNets = new Set<string>();
  for (const c of Object.values(project.components)) {
    if (c.type !== 'probe') continue;
    const net = model.netlist.pinNet.get(`p:${c.id}:1`);
    if (!net) continue;
    const n = model.nodeOf.get(net);
    if (n === undefined) continue;
    probeNets.add(net);
    traces.push({ name: `V(${String(c.properties.name || net)})`, unit: 'V', get: (x) => V(x, n) });
  }
  if (traces.length === 0) {
    model.nodeNames.forEach((name, i) => {
      if (!name.includes('#')) traces.push({ name: `V(${name})`, unit: 'V', get: (x) => x[i] });
    });
  }
  for (const e of model.elements) {
    if (e.kind === 'V' && e.meter) traces.push({ name: `I(${e.name})`, unit: 'A', get: (x) => x[model.numNodes + e.br] });
    if (e.kind === 'L') traces.push({ name: `I(${e.name})`, unit: 'A', get: (x) => x[model.numNodes + e.br] });
    if (e.kind === 'V' && !e.meter && e.wave) traces.push({ name: `I(${e.name})`, unit: 'A', get: (x) => -x[model.numNodes + e.br] });
  }
  return traces;
}

export function runTransient(project: Project, tstop: number, steps: number, states?: Map<string, boolean>, uic = false): TranResultView | SimFailure {
  const model = buildCircuit(project);
  const findings = preflight(project, model);
  if (findings.some((f) => f.status === 'error')) return { kind: 'tran', ok: false, error: findings.find((f) => f.status === 'error')!.message, findings, timestamp: stamp() };
  try {
    const r = solveTransient(model, tstop, steps, states, uic);
    const srcs = elementTraceSources(project, model);
    const traces: Trace[] = srcs.map((s) => ({ name: s.name, unit: s.unit, values: Float64Array.from(r.xs.map((x) => s.get(x))) }));
    findings.push({ id: 'tran-method', status: 'review', code: 'TRAN_METHOD', message: `Fixed-step trapezoidal integration, h = ${formatSI(tstop / steps, 's')}. Reduce the step if waveforms look under-resolved.`, refs: [] });
    return { kind: 'tran', ok: true, time: r.time, traces, findings, timestamp: stamp() };
  } catch (e) {
    const msg = (e as Error).message;
    return { kind: 'tran', ok: false, error: msg, findings: [...findings, { id: 'sim-fail', status: 'error', code: 'SIM_FAILED', message: msg, refs: [] }], timestamp: stamp() };
  }
}

export function runAC(project: Project, fStart: number, fStop: number, ppd: number): AcResultView | SimFailure {
  const model = buildCircuit(project);
  const findings = preflight(project, model);
  if (!model.elements.some((e) => e.kind === 'V' && e.acMag > 0)) findings.push({ id: 'ac-src', status: 'error', code: 'NO_AC_SOURCE', message: 'AC analysis needs a sine source (its amplitude is the AC excitation).', refs: [] });
  if (findings.some((f) => f.status === 'error')) return { kind: 'ac', ok: false, error: findings.find((f) => f.status === 'error')!.message, findings, timestamp: stamp() };
  try {
    const r = solveAC(model, fStart, fStop, ppd);
    const nodes = traceNodes(project, model);
    const traces = nodes.map(({ name, idx }) => {
      const mag = new Float64Array(r.freq.length);
      const ph = new Float64Array(r.freq.length);
      for (let k = 0; k < r.freq.length; k++) {
        const re = r.re[k][idx];
        const im = r.im[k][idx];
        mag[k] = 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-30));
        ph[k] = (Math.atan2(im, re) * 180) / Math.PI;
      }
      return { name: `V(${name})`, magDb: mag, phaseDeg: ph };
    });
    findings.push({ id: 'ac-lin', status: 'review', code: 'AC_LINEAR', message: 'Small-signal analysis linearised at the operating point (device capacitances not modelled).', refs: [] });
    return { kind: 'ac', ok: true, freq: r.freq, traces, findings, timestamp: stamp() };
  } catch (e) {
    const msg = (e as Error).message;
    return { kind: 'ac', ok: false, error: msg, findings: [...findings, { id: 'sim-fail', status: 'error', code: 'SIM_FAILED', message: msg, refs: [] }], timestamp: stamp() };
  }
}

function traceNodes(project: Project, model: CircuitModel): { name: string; idx: number }[] {
  const out: { name: string; idx: number }[] = [];
  for (const c of Object.values(project.components)) {
    if (c.type !== 'probe') continue;
    const net = model.netlist.pinNet.get(`p:${c.id}:1`);
    const n = net ? model.nodeOf.get(net) : undefined;
    if (net && n !== undefined && n >= 0) out.push({ name: String(c.properties.name || net), idx: n });
  }
  if (out.length) return out;
  model.nodeNames.forEach((name, i) => {
    if (!name.includes('#')) out.push({ name, idx: i });
  });
  return out;
}

/** Helper for UI: describe which components are simulated. */
export function simulationCoverage(project: Project): { simulated: number; notSimulated: string[] } {
  let simulated = 0;
  const notSimulated: string[] = [];
  for (const c of Object.values(project.components)) {
    const d = getDef(c.type);
    if (d.simulation === 'none') notSimulated.push(c.ref);
    else simulated++;
  }
  return { simulated, notSimulated };
}

export type { Element };
