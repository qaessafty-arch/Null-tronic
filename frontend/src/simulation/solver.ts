import { solveComplex, solveReal, SingularMatrixError } from './linalg';
import { VT_300K, type CircuitModel, type Element } from './circuit';
import { scan, type PlcMemory } from './plc';

/**
 * Modified Nodal Analysis solver.
 *  - DC operating point: Newton–Raphson with SPICE-style junction limiting (pnjlim),
 *    gmin stepping and source stepping fallbacks.
 *  - Transient: trapezoidal companion models for C and L, NR at every time point.
 *  - AC: complex small-signal analysis linearised at the operating point.
 * References: Ho, Ruehli & Brennan, "The modified nodal approach to network analysis" (1975);
 * Nagel, "SPICE2: A computer program to simulate semiconductor circuits" (1975).
 */

const GMIN = 1e-12;
const GSHUNT = 1e-12;
const MAX_ITER = 150;
const RELTOL = 1e-4;
const VNTOL = 1e-6;
const ABSTOL = 1e-10;

export class ConvergenceError extends Error {}

interface Sys {
  G: Float64Array[];
  b: Float64Array;
}

interface ReactiveState {
  /** capacitor: previous voltage & current; inductor: previous current & voltage */
  v: Float64Array;
  i: Float64Array;
}

interface SolveContext {
  model: CircuitModel;
  states: Map<string, boolean>;
  sourceScale: number;
  gminExtra: number;
  time: number;
  /** null = DC (capacitor open, inductor short) */
  h: number | null;
  /** Backward-Euler step (used for the first step after t=0 to avoid trapezoidal start-up error). */
  be?: boolean;
  reactive: ReactiveState | null;
  /** junction voltage memory for limiting, keyed by element index */
  junction: Map<number, number[]>;
}

const sz = (m: CircuitModel) => m.numNodes + m.numBranches;

function newSys(n: number): Sys {
  return { G: Array.from({ length: n }, () => new Float64Array(n)), b: new Float64Array(n) };
}

function stampG(s: Sys, a: number, b: number, g: number) {
  if (a >= 0) s.G[a][a] += g;
  if (b >= 0) s.G[b][b] += g;
  if (a >= 0 && b >= 0) {
    s.G[a][b] -= g;
    s.G[b][a] -= g;
  }
}

/** Current source of value I flowing from node a through the source into node b (injects into b). */
function stampI(s: Sys, a: number, b: number, I: number) {
  if (a >= 0) s.b[a] -= I;
  if (b >= 0) s.b[b] += I;
}

const V = (x: Float64Array, n: number) => (n >= 0 ? x[n] : 0);

export function waveValue(e: Extract<Element, { kind: 'V' }>, t: number): number {
  if (!e.wave) return e.dc;
  const w = e.wave;
  return w.offset + w.amp * Math.sin(2 * Math.PI * w.freq * t + (w.phaseDeg * Math.PI) / 180);
}

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): { v: number; limited: boolean } {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return { v: arg > 0 ? vold + vt * Math.log(arg) : vcrit, limited: true };
    }
    return { v: vt * Math.log(vnew / vt), limited: true };
  }
  return { v: vnew, limited: false };
}

const safeExp = (x: number) => (x > 80 ? Math.exp(80) * (1 + x - 80) : Math.exp(x));
const safeExpD = (x: number) => (x > 80 ? Math.exp(80) : Math.exp(x));

/** Diode current & conductance including optional reverse breakdown. */
export function diodeIV(vd: number, is: number, n: number, bv?: number, ibv?: number): { id: number; gd: number } {
  const nvt = n * VT_300K;
  let id = is * (safeExp(vd / nvt) - 1);
  let gd = (is / nvt) * safeExpD(vd / nvt);
  if (bv !== undefined && ibv !== undefined) {
    const x = -(vd + bv) / nvt;
    id -= ibv * safeExp(x);
    gd += (ibv / nvt) * safeExpD(x);
  }
  return { id: id + GMIN * vd, gd: gd + GMIN };
}

export interface BjtOp {
  ic: number;
  ib: number;
  // derivatives w.r.t. vbe, vbc (internal, polarity-normalised)
  dIc_dVbe: number;
  dIc_dVbc: number;
  dIb_dVbe: number;
  dIb_dVbc: number;
}

export function bjtEval(vbe: number, vbc: number, is: number, bf: number, br: number): BjtOp {
  const vt = VT_300K;
  const ef = safeExp(vbe / vt);
  const er = safeExp(vbc / vt);
  const If = is * (ef - 1);
  const Ir = is * (er - 1);
  const gf = (is / vt) * safeExpD(vbe / vt);
  const gr = (is / vt) * safeExpD(vbc / vt);
  return {
    ic: If - Ir - Ir / br + GMIN * (vbe - vbc),
    ib: If / bf + Ir / br + GMIN * vbe,
    dIc_dVbe: gf + GMIN,
    dIc_dVbc: -gr - gr / br - GMIN,
    dIb_dVbe: gf / bf + GMIN,
    dIb_dVbc: gr / br,
  };
}

export function mosEval(vgs: number, vds: number, vth: number, k: number, lambda: number): { id: number; gm: number; gds: number; region: string } {
  // assumes vds >= 0 (caller swaps)
  const vov = vgs - vth;
  if (vov <= 0) return { id: 0, gm: 0, gds: GMIN, region: 'cutoff' };
  const cl = 1 + lambda * vds;
  if (vds < vov) {
    const id = k * (vov * vds - 0.5 * vds * vds) * cl;
    return { id, gm: k * vds * cl, gds: k * (vov - vds) * cl + k * (vov * vds - 0.5 * vds * vds) * lambda + GMIN, region: 'linear' };
  }
  const id = 0.5 * k * vov * vov * cl;
  return { id, gm: k * vov * cl, gds: 0.5 * k * vov * vov * lambda + GMIN, region: 'saturation' };
}

function opampF(x: number, e: Extract<Element, { kind: 'OA' }>): { f: number; df: number } {
  const mid = (e.vpos + e.vneg) / 2;
  const half = Math.max((e.vpos - e.vneg) / 2, 1e-3);
  const u = (e.gain * x) / half;
  const t = Math.tanh(u);
  return { f: mid + half * t, df: e.gain * (1 - t * t) };
}

/** Stamp a nonlinear multi-terminal device: currents I[k] INTO the device at terminal k; J[k][j] = dI_k/dv_j. */
function stampNL(s: Sys, nodes: number[], I: number[], J: number[][], v0: number[]) {
  for (let k = 0; k < nodes.length; k++) {
    const nk = nodes[k];
    if (nk < 0) continue;
    let rhs = -I[k];
    for (let j = 0; j < nodes.length; j++) {
      rhs += J[k][j] * v0[j];
      const nj = nodes[j];
      if (nj >= 0) s.G[nk][nj] += J[k][j];
    }
    s.b[nk] += rhs;
  }
}

function assemble(ctx: SolveContext, x: Float64Array): { sys: Sys; limited: boolean } {
  const m = ctx.model;
  const n = sz(m);
  const s = newSys(n);
  let limited = false;
  const gsh = GSHUNT + ctx.gminExtra;
  for (let i = 0; i < m.numNodes; i++) s.G[i][i] += gsh;

  m.elements.forEach((e, idx) => {
    switch (e.kind) {
      case 'R':
        stampG(s, e.a, e.b, 1 / e.r);
        break;
      case 'SW': {
        const st = ctx.states.get(e.stateKey) ?? false;
        const closed = e.invert ? !st : st;
        stampG(s, e.a, e.b, 1 / (closed ? e.ron : e.roff));
        break;
      }
      case 'C': {
        if (ctx.h === null || !ctx.reactive) break; // open at DC (gshunt keeps nodes defined)
        const vPrev = ctx.reactive.v[idx];
        const iPrev = ctx.reactive.i[idx];
        // trapezoidal: i = (2C/h)·v − ((2C/h)·vPrev + iPrev); backward Euler: i = (C/h)·(v − vPrev)
        const geq = ctx.be ? e.c / ctx.h : (2 * e.c) / ctx.h;
        const hist = ctx.be ? geq * vPrev : geq * vPrev + iPrev;
        stampG(s, e.a, e.b, geq);
        stampI(s, e.b, e.a, hist);
        break;
      }
      case 'L': {
        const br = m.numNodes + e.br;
        if (e.a >= 0) {
          s.G[e.a][br] += 1;
          s.G[br][e.a] += 1;
        }
        if (e.b >= 0) {
          s.G[e.b][br] -= 1;
          s.G[br][e.b] -= 1;
        }
        if (ctx.h !== null && ctx.reactive) {
          const req = ctx.be ? e.l / ctx.h : (2 * e.l) / ctx.h;
          s.G[br][br] -= req;
          s.b[br] = ctx.be ? -req * ctx.reactive.i[idx] : -req * ctx.reactive.i[idx] - ctx.reactive.v[idx];
        }
        break;
      }
      case 'V': {
        const br = m.numNodes + e.br;
        if (e.a >= 0) {
          s.G[e.a][br] += 1;
          s.G[br][e.a] += 1;
        }
        if (e.b >= 0) {
          s.G[e.b][br] -= 1;
          s.G[br][e.b] -= 1;
        }
        s.b[br] = (e.stateKey !== undefined ? ((ctx.states.get(e.stateKey) ?? false) ? e.dc : (e.vOff ?? 0)) : waveValue(e, ctx.time)) * ctx.sourceScale;
        break;
      }
      case 'I':
        // current flows out of terminal a ("+") into the external circuit
        stampI(s, e.b, e.a, e.dc * ctx.sourceScale);
        break;
      case 'D': {
        const vdRaw = V(x, e.a) - V(x, e.k);
        const mem = ctx.junction.get(idx) ?? [0];
        const nvt = e.n * VT_300K;
        const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * e.is));
        let vd = vdRaw;
        const r = pnjlim(vdRaw, mem[0], nvt, vcrit);
        vd = r.v;
        if (r.limited) limited = true;
        if (e.bv !== undefined) {
          // mirror limiting for reverse breakdown
          const rr = pnjlim(-vd - e.bv, -mem[0] - e.bv, nvt, vcrit);
          if (rr.limited) {
            vd = -rr.v - e.bv;
            limited = true;
          }
        }
        ctx.junction.set(idx, [vd]);
        const { id, gd } = diodeIV(vd, e.is, e.n, e.bv, e.ibv);
        stampG(s, e.a, e.k, gd);
        stampI(s, e.a, e.k, id - gd * vd);
        break;
      }
      case 'Q': {
        const p = e.pol;
        const vb = V(x, e.b);
        const vc = V(x, e.c);
        const ve = V(x, e.e);
        const mem = ctx.junction.get(idx) ?? [0, 0];
        const vt = VT_300K;
        const vcrit = vt * Math.log(vt / (Math.SQRT2 * e.is));
        const r1 = pnjlim(p * (vb - ve), mem[0], vt, vcrit);
        const r2 = pnjlim(p * (vb - vc), mem[1], vt, vcrit);
        if (r1.limited || r2.limited) limited = true;
        const vbe = r1.v;
        const vbc = r2.v;
        ctx.junction.set(idx, [vbe, vbc]);
        const o = bjtEval(vbe, vbc, e.is, e.bf, e.br);
        // terminal order [c, b, e]; currents into device; polarity applied
        const Ic = p * o.ic;
        const Ib = p * o.ib;
        const Ie = -(Ic + Ib);
        // d/d(vc, vb, ve): vbe = p(vb-ve), vbc = p(vb-vc); I = p f  -> dI/dv = p*p*df = df
        const dIc = [-o.dIc_dVbc, o.dIc_dVbe + o.dIc_dVbc, -o.dIc_dVbe];
        const dIb = [-o.dIb_dVbc, o.dIb_dVbe + o.dIb_dVbc, -o.dIb_dVbe];
        const dIe = dIc.map((d, i) => -(d + dIb[i]));
        // linearisation point uses limited internal voltages mapped back to terminal voltages
        const v0 = [vb - p * vbc, vb, vb - p * vbe];
        stampNL(s, [e.c, e.b, e.e], [Ic, Ib, Ie], [dIc, dIb, dIe], v0);
        break;
      }
      case 'M': {
        const p = e.pol;
        let vd = V(x, e.d);
        const vg = V(x, e.g);
        let vs = V(x, e.s);
        const mem = ctx.junction.get(idx) ?? [0, 0];
        let swapped = false;
        if (p * (vd - vs) < 0) {
          [vd, vs] = [vs, vd];
          swapped = true;
        }
        let vgs = p * (vg - vs);
        let vds = p * (vd - vs);
        // simple fetlim-style step limiting
        const lim = (nv: number, ov: number, max: number) => {
          if (Math.abs(nv - ov) > max) {
            limited = true;
            return ov + Math.sign(nv - ov) * max;
          }
          return nv;
        };
        vgs = lim(vgs, mem[0], 2);
        vds = lim(vds, mem[1], 4);
        ctx.junction.set(idx, [vgs, vds]);
        const o = mosEval(vgs, vds, e.vth, e.k, e.lambda);
        const dN = swapped ? e.s : e.d;
        const sN = swapped ? e.d : e.s;
        // current into drain = p*id; d/dvd = gds, d/dvg = gm, d/dvs = -(gm+gds)
        const Id = p * o.id;
        const J = [
          [o.gds, o.gm, -(o.gm + o.gds)],
          [0, 0, 0],
          [-o.gds, -o.gm, o.gm + o.gds],
        ];
        const vsLin = vg - p * vgs;
        const v0 = [vsLin + p * vds, vg, vsLin];
        stampNL(s, [dN, e.g, sN], [Id, 0, -Id], J, v0);
        break;
      }
      case 'OA': {
        const br = m.numNodes + e.br;
        // branch current flows from ground into the output node (ideal output stage)
        if (e.out >= 0) {
          s.G[e.out][br] -= 1;
          s.G[br][e.out] += 1;
        }
        const xin = V(x, e.p) - V(x, e.n);
        const mem = ctx.junction.get(idx) ?? [0];
        // limit input step to keep the tanh linearisation well-behaved
        const half = Math.max((e.vpos - e.vneg) / 2, 1e-3);
        const maxStep = (10 * half) / e.gain;
        let xl = xin;
        if (Math.abs(xin - mem[0]) > maxStep && Math.abs(xin) > maxStep) {
          xl = mem[0] + Math.sign(xin - mem[0]) * maxStep;
          limited = true;
        }
        ctx.junction.set(idx, [xl]);
        const { f, df } = opampF(xl, e);
        if (e.p >= 0) s.G[br][e.p] -= df;
        if (e.n >= 0) s.G[br][e.n] += df;
        s.b[br] = f - df * xl;
        break;
      }
      case 'XF': {
        const br = m.numNodes + e.br;
        const nn = e.ratio;
        const add = (r: number, c: number, v: number) => {
          if (r >= 0 && c >= 0) s.G[r][c] += v;
        };
        add(e.p1, br, 1);
        add(e.p2, br, -1);
        // ideal transformer: Vp = n·Vs and Is = −n·Ip (power conserving)
        add(e.s1, br, -nn);
        add(e.s2, br, nn);
        if (e.p1 >= 0) s.G[br][e.p1] += 1;
        if (e.p2 >= 0) s.G[br][e.p2] -= 1;
        if (e.s1 >= 0) s.G[br][e.s1] -= nn;
        if (e.s2 >= 0) s.G[br][e.s2] += nn;
        break;
      }
    }
  });
  return { sys: s, limited };
}

function newtonSolve(ctx: SolveContext, x0: Float64Array): { x: Float64Array; iterations: number } {
  let x: Float64Array = Float64Array.from(x0);
  const m = ctx.model;
  for (let it = 1; it <= MAX_ITER; it++) {
    const { sys, limited } = assemble(ctx, x);
    let xn: Float64Array;
    try {
      xn = solveReal(sys.G, sys.b);
    } catch (err) {
      if (err instanceof SingularMatrixError) {
        const what = err.row < m.numNodes ? `node "${m.nodeNames[err.row]}"` : 'a voltage-source/inductor loop';
        throw new ConvergenceError(`Circuit matrix is singular near ${what}. Check for loops of voltage sources or inductors, or sources in parallel.`);
      }
      throw err;
    }
    let converged = !limited;
    for (let i = 0; i < xn.length && converged; i++) {
      const tol = i < m.numNodes ? RELTOL * Math.max(Math.abs(xn[i]), Math.abs(x[i])) + VNTOL : RELTOL * Math.max(Math.abs(xn[i]), Math.abs(x[i])) + ABSTOL;
      if (Math.abs(xn[i] - x[i]) > tol) converged = false;
    }
    if (xn.some((v) => !Number.isFinite(v))) throw new ConvergenceError('Numerical overflow during Newton iteration.');
    x = xn;
    if (converged && it > 1) return { x, iterations: it };
  }
  throw new ConvergenceError('Newton–Raphson did not converge');
}

function hasNonlinear(m: CircuitModel) {
  return m.elements.some((e) => e.kind === 'D' || e.kind === 'Q' || e.kind === 'M' || e.kind === 'OA');
}

/** DC solve with continuation fallbacks. */
function dcSolve(model: CircuitModel, states: Map<string, boolean>, time: number, x0?: Float64Array): { x: Float64Array; iterations: number; method: string } {
  const base: Omit<SolveContext, 'sourceScale' | 'gminExtra'> = { model, states, time, h: null, reactive: null, junction: new Map() };
  const start = x0 ?? new Float64Array(sz(model));
  try {
    const r = newtonSolve({ ...base, junction: new Map(), sourceScale: 1, gminExtra: 0 }, start);
    return { ...r, method: 'newton' };
  } catch (e) {
    if (!(e instanceof ConvergenceError) || !hasNonlinear(model)) throw e;
  }
  // gmin stepping
  try {
    let x: Float64Array = Float64Array.from(start);
    let total = 0;
    const junction = new Map<number, number[]>();
    for (let g = 1e-2; g >= 1e-13; g /= 10) {
      const r = newtonSolve({ ...base, junction, sourceScale: 1, gminExtra: g < 1e-12 ? 0 : g }, x);
      x = r.x;
      total += r.iterations;
    }
    return { x, iterations: total, method: 'gmin-stepping' };
  } catch {
    /* fall through */
  }
  // source stepping
  let x: Float64Array = new Float64Array(sz(model));
  let total = 0;
  const junction = new Map<number, number[]>();
  for (let k = 1; k <= 20; k++) {
    const r = newtonSolve({ ...base, junction, sourceScale: k / 20, gminExtra: 0 }, x);
    x = r.x;
    total += r.iterations;
  }
  return { x, iterations: total, method: 'source-stepping' };
}

export function hasDiscrete(model: CircuitModel): boolean {
  return model.coils.length > 0 || model.gates.length > 0 || model.plc !== null;
}

/** Logic level of a node with input hysteresis memory; records undefined (between VIL and VIH) inputs. */
function logicIn(states: Map<string, boolean>, key: string, v: number, vih: number, vil: number): boolean {
  if (v >= vih) return true;
  if (v <= vil) return false;
  states.set(`undef:${key}`, true);
  return states.get(key) ?? false;
}

/**
 * Discrete-state update after a continuous solve: relay/contactor coils, digital gates
 * (zero-delay combinational evaluation) and one PLC scan. Returns true if anything changed,
 * in which case the caller re-solves; the loop detects oscillation.
 */
function updateDiscrete(model: CircuitModel, states: Map<string, boolean>, x: Float64Array, time = 0, mem: PlcMemory = new Map()): boolean {
  let changed = updateCoils(model, states, x);
  for (const g of model.gates) {
    const ins = g.inputs.map((n, i) => {
      const key = `gin:${g.cid}:${i}`;
      const b = logicIn(states, key, V(x, n), g.vih, g.vil);
      states.set(key, b);
      return b;
    });
    const a = ins[0];
    const b = ins[1] ?? false;
    const out = { and: a && b, or: a || b, nand: !(a && b), nor: !(a || b), xor: a !== b, not: !a }[g.fn];
    if ((states.get(g.stateKey) ?? false) !== out) {
      states.set(g.stateKey, out);
      changed = true;
    }
  }
  if (model.plc) {
    const env = new Map<string, boolean>();
    for (const [k, v] of states) if (k.startsWith('plcm:')) env.set(k.slice(5), v);
    for (const o of model.plcOutputs) env.set(o.address, states.get(o.stateKey) ?? false);
    for (const i of model.plcInputs) env.set(i.address, V(x, i.node) >= i.threshold);
    scan(model.plc, env, time, mem);
    const outKeys = new Map(model.plcOutputs.map((o) => [o.address, o.stateKey]));
    for (const name of model.plc.written) {
      const key = outKeys.get(name) ?? `plcm:${name}`;
      const v = env.get(name) ?? false;
      if ((states.get(key) ?? false) !== v) {
        states.set(key, v);
        changed = true;
      }
    }
  }
  return changed;
}

/** Update coil states from a solution; returns true if any state changed. */
function updateCoils(model: CircuitModel, states: Map<string, boolean>, x: Float64Array): boolean {
  let changed = false;
  // a tag may have several coils (unusual) – energised if any coil is
  const byKey = new Map<string, boolean>();
  for (const c of model.coils) {
    const v = Math.abs(V(x, c.a) - V(x, c.b));
    const cur = states.get(c.stateKey) ?? false;
    const next = cur ? v > c.dropout : v >= c.pickup;
    byKey.set(c.stateKey, (byKey.get(c.stateKey) ?? false) || next);
  }
  for (const [k, v] of byKey) {
    if ((states.get(k) ?? false) !== v) {
      states.set(k, v);
      changed = true;
    }
  }
  return changed;
}

export interface OpSolution {
  x: Float64Array;
  states: Map<string, boolean>;
  iterations: number;
  method: string;
  relayIterations: number;
  oscillation: boolean;
}

export function solveOperatingPoint(model: CircuitModel, states?: Map<string, boolean>, time = 0, mem: PlcMemory = new Map()): OpSolution {
  const st = new Map([...model.initialStates, ...(states ?? [])]);
  let sol = dcSolve(model, st, time);
  let relayIterations = 0;
  let oscillation = false;
  const seen = new Set<string>();
  while (hasDiscrete(model) && updateDiscrete(model, st, sol.x, time, mem)) {
    relayIterations++;
    const sig = [...st.entries()].map(([k, v]) => `${k}=${v}`).join(',');
    if (seen.has(sig) || relayIterations > 30) {
      oscillation = true;
      break;
    }
    seen.add(sig);
    sol = dcSolve(model, st, time, sol.x);
  }
  return { x: sol.x, states: st, iterations: sol.iterations, method: sol.method, relayIterations, oscillation };
}

export interface TranResult {
  time: Float64Array;
  /** x vectors per time point */
  xs: Float64Array[];
  states: Map<string, boolean>[];
}

/**
 * @param uic "use initial conditions" (SPICE UIC): skip the operating point and start with all
 *            capacitor voltages and inductor currents at zero, sources at their t=0+ values.
 */
export function solveTransient(model: CircuitModel, tstop: number, steps: number, states?: Map<string, boolean>, uic = false): TranResult {
  if (!(tstop > 0) || steps < 2) throw new Error('Transient requires tstop > 0 and at least 2 steps');
  const h = tstop / steps;
  const mem: PlcMemory = new Map(); // PLC timer / counter state, retained over the whole run
  const op: OpSolution = uic
    ? { x: new Float64Array(sz(model)), states: new Map([...model.initialStates, ...(states ?? [])]), iterations: 0, method: 'uic', relayIterations: 0, oscillation: false }
    : solveOperatingPoint(model, states, 0, mem);
  const st = op.states;
  const n = model.elements.length;
  const reactive: ReactiveState = { v: new Float64Array(n), i: new Float64Array(n) };
  // initialise reactive history from operating point (zero for UIC)
  if (!uic) model.elements.forEach((e, idx) => {
    if (e.kind === 'C') {
      reactive.v[idx] = V(op.x, e.a) - V(op.x, e.b);
      reactive.i[idx] = 0;
    } else if (e.kind === 'L') {
      reactive.i[idx] = op.x[model.numNodes + e.br];
      reactive.v[idx] = 0;
    }
  });
  const time = new Float64Array(steps + 1);
  const xs: Float64Array[] = [op.x];
  const stateLog: Map<string, boolean>[] = [new Map(st)];
  let x = op.x;
  const junction = new Map<number, number[]>();
  for (let k = 1; k <= steps; k++) {
    const t = k * h;
    time[k] = t;
    const be = k === 1;
    const ctx: SolveContext = { model, states: st, sourceScale: 1, gminExtra: 0, time: t, h, reactive, junction, be };
    let r = newtonSolve(ctx, x);
    let guard = 0;
    while (hasDiscrete(model) && updateDiscrete(model, st, r.x, t, mem) && guard++ < 10) r = newtonSolve(ctx, r.x);
    x = r.x;
    // update histories
    model.elements.forEach((e, idx) => {
      if (e.kind === 'C') {
        const v = V(x, e.a) - V(x, e.b);
        const i = be ? (e.c / h) * (v - reactive.v[idx]) : ((2 * e.c) / h) * (v - reactive.v[idx]) - reactive.i[idx];
        reactive.v[idx] = v;
        reactive.i[idx] = i;
      } else if (e.kind === 'L') {
        reactive.i[idx] = x[model.numNodes + e.br];
        reactive.v[idx] = V(x, e.a) - V(x, e.b);
      }
    });
    xs.push(x);
    stateLog.push(new Map(st));
  }
  return { time, xs, states: stateLog };
}

export interface AcResult {
  freq: Float64Array;
  re: Float64Array[];
  im: Float64Array[];
}

/** Small-signal AC sweep around the operating point. AC excitation = every sine source's amplitude/phase. */
export function solveAC(model: CircuitModel, fStart: number, fStop: number, pointsPerDecade: number, states?: Map<string, boolean>): AcResult {
  const op = solveOperatingPoint(model, states, 0);
  const x0 = op.x;
  const decades = Math.log10(fStop / fStart);
  const nPts = Math.max(2, Math.round(decades * pointsPerDecade) + 1);
  const freq = new Float64Array(nPts);
  const re: Float64Array[] = [];
  const im: Float64Array[] = [];
  const n = sz(model);
  // linearised conductances at OP: reuse assemble() Jacobian with sources zeroed
  const ctx: SolveContext = { model, states: op.states, sourceScale: 0, gminExtra: 0, time: 0, h: null, reactive: null, junction: new Map() };
  // seed junction memory with OP values so limiting does not alter the linearisation
  const { sys: base } = assemble(primeJunctions(ctx, x0), x0);
  for (let k = 0; k < nPts; k++) {
    const f = fStart * Math.pow(10, (k / (nPts - 1)) * decades);
    freq[k] = f;
    const w = 2 * Math.PI * f;
    const Gr = base.G.map((r) => Float64Array.from(r));
    const Gi = Array.from({ length: n }, () => new Float64Array(n));
    const br = new Float64Array(n);
    const bi = new Float64Array(n);
    model.elements.forEach((e) => {
      if (e.kind === 'C') {
        const y = w * e.c;
        if (e.a >= 0) Gi[e.a][e.a] += y;
        if (e.b >= 0) Gi[e.b][e.b] += y;
        if (e.a >= 0 && e.b >= 0) {
          Gi[e.a][e.b] -= y;
          Gi[e.b][e.a] -= y;
        }
      } else if (e.kind === 'L') {
        Gi[model.numNodes + e.br][model.numNodes + e.br] -= w * e.l;
      } else if (e.kind === 'V') {
        const row = model.numNodes + e.br;
        const ph = (e.acPhase * Math.PI) / 180;
        br[row] = e.acMag * Math.cos(ph);
        bi[row] = e.acMag * Math.sin(ph);
      }
    });
    const sol = solveComplex(Gr, Gi, br, bi);
    re.push(sol.re);
    im.push(sol.im);
  }
  return { freq, re, im };
}

function primeJunctions(ctx: SolveContext, x: Float64Array): SolveContext {
  ctx.model.elements.forEach((e, idx) => {
    if (e.kind === 'D') ctx.junction.set(idx, [V(x, e.a) - V(x, e.k)]);
    if (e.kind === 'Q') ctx.junction.set(idx, [e.pol * (V(x, e.b) - V(x, e.e)), e.pol * (V(x, e.b) - V(x, e.c))]);
    if (e.kind === 'M') {
      let vd = V(x, e.d);
      let vs = V(x, e.s);
      if (e.pol * (vd - vs) < 0) [vd, vs] = [vs, vd];
      ctx.junction.set(idx, [e.pol * (V(x, e.g) - vs), e.pol * (vd - vs)]);
    }
    if (e.kind === 'OA') ctx.junction.set(idx, [V(x, e.p) - V(x, e.n)]);
  });
  return ctx;
}
