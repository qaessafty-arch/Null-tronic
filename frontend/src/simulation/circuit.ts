import { getDef, DIODE_PRESETS } from '../component-library/library';
import { buildNetlist, pinKey, type Netlist } from '../project-model/connectivity';
import type { ComponentInstance, Id, Project, PropertyValue } from '../project-model/types';

/**
 * Converts the authoritative project model into a flat element list for the MNA solver.
 * Each element keeps the id of the component it came from so results map back onto the model.
 */

/** Thermal voltage kT/q at 300.15 K (27 °C, the SPICE default TNOM); k = 1.380649e-23 J/K, q = 1.602176634e-19 C. */
export const VT_300K = (1.380649e-23 * 300.15) / 1.602176634e-19;

export interface Wave {
  amp: number;
  freq: number;
  offset: number;
  phaseDeg: number;
}

export type Element =
  | { kind: 'R'; name: string; cid: Id; a: number; b: number; r: number; role?: 'coil' | 'load' | 'rs' }
  | { kind: 'C'; name: string; cid: Id; a: number; b: number; c: number }
  | { kind: 'L'; name: string; cid: Id; a: number; b: number; l: number; br: number }
  | { kind: 'V'; name: string; cid: Id; a: number; b: number; dc: number; wave?: Wave; br: number; acMag: number; acPhase: number; meter?: boolean }
  | { kind: 'I'; name: string; cid: Id; a: number; b: number; dc: number }
  | { kind: 'D'; name: string; cid: Id; a: number; k: number; is: number; n: number; bv?: number; ibv?: number; rs: number; extAnode: number }
  | { kind: 'Q'; name: string; cid: Id; c: number; b: number; e: number; pol: 1 | -1; is: number; bf: number; br: number }
  | { kind: 'M'; name: string; cid: Id; d: number; g: number; s: number; pol: 1 | -1; vth: number; k: number; lambda: number }
  | { kind: 'OA'; name: string; cid: Id; p: number; n: number; out: number; gain: number; vpos: number; vneg: number; br: number }
  | { kind: 'XF'; name: string; cid: Id; p1: number; p2: number; s1: number; s2: number; ratio: number; br: number }
  | { kind: 'SW'; name: string; cid: Id; a: number; b: number; ron: number; roff: number; stateKey: string; invert: boolean };

export interface CoilInfo {
  cid: Id;
  stateKey: string;
  a: number;
  b: number;
  rated: number;
  pickup: number;
  dropout: number;
}

export interface CircuitModel {
  netlist: Netlist;
  /** net name -> node index (ground excluded, -1). */
  nodeOf: Map<string, number>;
  nodeNames: string[];
  /** Total node count including internal nodes. */
  numNodes: number;
  numBranches: number;
  elements: Element[];
  coils: CoilInfo[];
  /** Initial discrete states (switch positions, coil energisation). */
  initialStates: Map<string, boolean>;
  unsupported: { cid: Id; ref: string; reason: string }[];
  hasGround: boolean;
  plcInputs: { cid: Id; node: number; threshold: number }[];
}

const num = (v: PropertyValue | undefined, d: number): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : d;
  }
  return d;
};

export function ledSaturationCurrent(vf: number, n = 2, iRef = 0.02): number {
  return iRef / (Math.exp(vf / (n * VT_300K)) - 1);
}

export function buildCircuit(project: Project): CircuitModel {
  const netlist = buildNetlist(project);
  const nodeOf = new Map<string, number>();
  const nodeNames: string[] = [];
  let hasGround = false;
  for (const net of netlist.nets) {
    if (net.isGround) {
      hasGround = true;
      nodeOf.set(net.name, -1);
      continue;
    }
    nodeOf.set(net.name, nodeNames.length);
    nodeNames.push(net.name);
  }
  let numNodes = nodeNames.length;
  let numBranches = 0;
  const elements: Element[] = [];
  const coils: CoilInfo[] = [];
  const unsupported: CircuitModel['unsupported'] = [];
  const initialStates = new Map<string, boolean>();
  const plcInputs: CircuitModel['plcInputs'] = [];

  const node = (c: ComponentInstance, pinId: string): number => {
    const net = netlist.pinNet.get(pinKey(c.id, pinId));
    if (net === undefined) return -1;
    return nodeOf.get(net) ?? -1;
  };
  const branch = () => numBranches++;

  const comps = Object.values(project.components).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  for (const c of comps) {
    let def;
    try {
      def = getDef(c.type);
    } catch {
      continue;
    }
    const pr = c.properties;
    const name = c.ref;
    switch (c.type) {
      case 'resistor':
        elements.push({ kind: 'R', name, cid: c.id, a: node(c, '1'), b: node(c, '2'), r: Math.max(num(pr.resistance, 1000), 1e-9) });
        break;
      case 'lamp':
        elements.push({ kind: 'R', name, cid: c.id, a: node(c, 'X1'), b: node(c, 'X2'), r: Math.max(num(pr.resistance, 240), 1e-9), role: 'load' });
        break;
      case 'motor':
        if (project.type !== 'installation') elements.push({ kind: 'R', name, cid: c.id, a: node(c, '1'), b: node(c, '2'), r: Math.max(num(pr.resistance, 50), 1e-9), role: 'load' });
        break;
      case 'capacitor':
        elements.push({ kind: 'C', name, cid: c.id, a: node(c, '1'), b: node(c, '2'), c: num(pr.capacitance, 1e-7) });
        break;
      case 'capacitor_polarized':
        elements.push({ kind: 'C', name, cid: c.id, a: node(c, '+'), b: node(c, '-'), c: num(pr.capacitance, 1e-4) });
        break;
      case 'inductor':
        elements.push({ kind: 'L', name, cid: c.id, a: node(c, '1'), b: node(c, '2'), l: num(pr.inductance, 1e-3), br: branch() });
        break;
      case 'vdc':
        elements.push({ kind: 'V', name, cid: c.id, a: node(c, '+'), b: node(c, '-'), dc: num(pr.voltage, 0), br: branch(), acMag: 0, acPhase: 0 });
        break;
      case 'vac': {
        const wave: Wave = { amp: num(pr.amplitude, 1), freq: num(pr.frequency, 50), offset: num(pr.offset, 0), phaseDeg: num(pr.phase, 0) };
        elements.push({ kind: 'V', name, cid: c.id, a: node(c, '+'), b: node(c, '-'), dc: wave.offset + wave.amp * Math.sin((wave.phaseDeg * Math.PI) / 180), wave, br: branch(), acMag: wave.amp, acPhase: wave.phaseDeg });
        break;
      }
      case 'idc':
        elements.push({ kind: 'I', name, cid: c.id, a: node(c, '+'), b: node(c, '-'), dc: num(pr.current, 0) });
        break;
      case 'ammeter':
        elements.push({ kind: 'V', name, cid: c.id, a: node(c, '+'), b: node(c, '-'), dc: 0, br: branch(), acMag: 0, acPhase: 0, meter: true });
        break;
      case 'diode':
      case 'led':
      case 'zener': {
        let is: number;
        let n: number;
        let rs = 0;
        let bv: number | undefined;
        let ibv: number | undefined;
        if (c.type === 'led') {
          n = 2;
          is = ledSaturationCurrent(num(pr.vf, 2), n);
        } else if (c.type === 'zener') {
          is = num(pr.is, 1e-14);
          n = num(pr.n, 1);
          bv = num(pr.vz, 5.1);
          ibv = num(pr.izt, 0.005);
        } else {
          const preset = DIODE_PRESETS[String(pr.model)];
          is = preset && pr.model !== 'custom' ? preset.is : num(pr.is, 1e-14);
          n = preset && pr.model !== 'custom' ? preset.n : num(pr.n, 1);
          rs = preset && pr.model !== 'custom' ? preset.rs : num(pr.rs, 0);
        }
        const anode = node(c, 'A');
        const cathode = node(c, 'K');
        let junctionAnode = anode;
        if (rs > 0) {
          junctionAnode = numNodes++;
          nodeNames.push(`${name}#int`);
          elements.push({ kind: 'R', name: `${name}.Rs`, cid: c.id, a: anode, b: junctionAnode, r: rs, role: 'rs' });
        }
        elements.push({ kind: 'D', name, cid: c.id, a: junctionAnode, k: cathode, is, n, bv, ibv, rs, extAnode: anode });
        break;
      }
      case 'npn':
      case 'pnp':
        elements.push({ kind: 'Q', name, cid: c.id, c: node(c, 'C'), b: node(c, 'B'), e: node(c, 'E'), pol: c.type === 'npn' ? 1 : -1, is: num(pr.is, 1e-14), bf: Math.max(num(pr.bf, 100), 1e-3), br: Math.max(num(pr.br, 1), 1e-3) });
        break;
      case 'nmos':
      case 'pmos':
        elements.push({ kind: 'M', name, cid: c.id, d: node(c, 'D'), g: node(c, 'G'), s: node(c, 'S'), pol: c.type === 'nmos' ? 1 : -1, vth: Math.abs(num(pr.vth, 2)), k: num(pr.k, 0.1), lambda: num(pr.lambda, 0) });
        break;
      case 'opamp':
        elements.push({ kind: 'OA', name, cid: c.id, p: node(c, '+'), n: node(c, '-'), out: node(c, 'OUT'), gain: num(pr.gain, 1e5), vpos: num(pr.vsatPos, 15), vneg: num(pr.vsatNeg, -15), br: branch() });
        break;
      case 'transformer':
        elements.push({ kind: 'XF', name, cid: c.id, p1: node(c, 'P1'), p2: node(c, 'P2'), s1: node(c, 'S1'), s2: node(c, 'S2'), ratio: Math.max(num(pr.ratio, 1), 1e-6), br: branch() });
        break;
      case 'switch':
      case 'pushbutton': {
        const key = `sw:${c.id}`;
        initialStates.set(key, c.type === 'switch' ? !!pr.closed : !!pr.pressed);
        elements.push({ kind: 'SW', name, cid: c.id, a: node(c, '1'), b: node(c, '2'), ron: num(pr.rOn, 0.01), roff: 1e9, stateKey: key, invert: false });
        break;
      }
      case 'mcb': {
        const key = `sw:${c.id}`;
        initialStates.set(key, !!pr.closed);
        elements.push({ kind: 'SW', name, cid: c.id, a: node(c, '1'), b: node(c, '2'), ron: 0.01, roff: 1e9, stateKey: key, invert: false });
        break;
      }
      case 'pb_no':
      case 'pb_nc':
      case 'estop':
      case 'limit_switch':
      case 'overload_nc': {
        const key = `sw:${c.id}`;
        initialStates.set(key, !!pr.pressed);
        const [p1, p2] = def.pins.map((pp) => pp.id);
        elements.push({ kind: 'SW', name, cid: c.id, a: node(c, p1), b: node(c, p2), ron: 0.01, roff: 1e9, stateKey: key, invert: c.type === 'pb_nc' || c.type === 'estop' || c.type === 'overload_nc' });
        break;
      }
      case 'relay': {
        const key = `coil:${c.id}`;
        initialStates.set(key, false);
        const rated = num(pr.coilVoltage, 12);
        elements.push({ kind: 'R', name: `${name}.coil`, cid: c.id, a: node(c, 'A1'), b: node(c, 'A2'), r: Math.max(num(pr.coilResistance, 400), 1e-3), role: 'coil' });
        coils.push({ cid: c.id, stateKey: key, a: node(c, 'A1'), b: node(c, 'A2'), rated, pickup: (num(pr.pickupPercent, 75) / 100) * rated, dropout: (num(pr.dropoutPercent, 30) / 100) * rated });
        elements.push({ kind: 'SW', name: `${name}.NO`, cid: c.id, a: node(c, 'COM'), b: node(c, 'NO'), ron: 0.01, roff: 1e9, stateKey: key, invert: false });
        elements.push({ kind: 'SW', name: `${name}.NC`, cid: c.id, a: node(c, 'COM'), b: node(c, 'NC'), ron: 0.01, roff: 1e9, stateKey: key, invert: true });
        break;
      }
      case 'coil': {
        const key = `tag:${String(pr.tag).trim()}`;
        initialStates.set(key, false);
        const rated = num(pr.coilVoltage, 24);
        elements.push({ kind: 'R', name: `${name}.coil`, cid: c.id, a: node(c, 'A1'), b: node(c, 'A2'), r: Math.max(num(pr.coilResistance, 200), 1e-3), role: 'coil' });
        coils.push({ cid: c.id, stateKey: key, a: node(c, 'A1'), b: node(c, 'A2'), rated, pickup: (num(pr.pickupPercent, 80) / 100) * rated, dropout: (num(pr.dropoutPercent, 30) / 100) * rated });
        break;
      }
      case 'contact_no':
      case 'contact_nc': {
        const key = `tag:${String(pr.tag).trim()}`;
        if (!initialStates.has(key)) initialStates.set(key, false);
        const [p1, p2] = def.pins.map((pp) => pp.id);
        elements.push({ kind: 'SW', name, cid: c.id, a: node(c, p1), b: node(c, p2), ron: 0.01, roff: 1e9, stateKey: key, invert: c.type === 'contact_nc' });
        break;
      }
      case 'plc_input':
        plcInputs.push({ cid: c.id, node: node(c, '1'), threshold: num(pr.threshold, 15) });
        break;
      case 'plc_output':
        if (pr.state) elements.push({ kind: 'V', name, cid: c.id, a: node(c, '1'), b: -1, dc: num(pr.voltage, 24), br: branch(), acMag: 0, acPhase: 0 });
        break;
      case 'ground':
      case 'label':
      case 'terminal':
      case 'connector2':
      case 'probe':
        break;
      default:
        if (def.simulation === 'none' && def.modes.some((m) => m === 'electronic' || m === 'control')) {
          unsupported.push({ cid: c.id, ref: c.ref, reason: `${def.name}: behaviour is not simulated` });
        }
    }
  }
  // contacts whose tag has no coil
  for (const e of elements) {
    if (e.kind === 'SW' && e.stateKey.startsWith('tag:') && !coils.some((k) => k.stateKey === e.stateKey)) {
      unsupported.push({ cid: e.cid, ref: e.name, reason: `contact operated by "${e.stateKey.slice(4)}" but no coil with that tag exists (contact held in its normal position)` });
    }
  }
  return { netlist, nodeOf, nodeNames, numNodes, numBranches, elements, coils, initialStates, unsupported, hasGround, plcInputs };
}
