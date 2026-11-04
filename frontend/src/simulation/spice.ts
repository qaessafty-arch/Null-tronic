import { buildCircuit, type CircuitModel } from './circuit';
import type { Project } from '../project-model/types';

/**
 * SPICE netlist export (ngspice dialect). The netlist is generated from the same CircuitModel
 * the built-in solver uses, so the two can be cross-checked (see tests/engineering/ngspice.test.ts).
 */

const fmt = (v: number) => {
  if (v === 0) return '0';
  return Number(v.toPrecision(10)).toExponential().replace('e+', 'e');
};

export interface SpiceOptions {
  analysis?: { kind: 'op' } | { kind: 'tran'; tstop: number; step: number } | { kind: 'ac'; fstart: number; fstop: number; ppd: number };
  states?: Map<string, boolean>;
}

export function toSpice(project: Project, opts: SpiceOptions = {}): string {
  const model = buildCircuit(project);
  return modelToSpice(project, model, opts);
}

export function nodeName(model: CircuitModel, n: number): string {
  if (n < 0) return '0';
  return model.nodeNames[n].replace(/#/g, '_');
}

export function modelToSpice(project: Project, model: CircuitModel, opts: SpiceOptions = {}): string {
  const states = opts.states ?? model.initialStates;
  const N = (n: number) => nodeName(model, n);
  const lines: string[] = [`* ${project.meta.name} — exported by NULL-TECH CIRCUIT STUDIO`, `* ${new Date().toISOString()}`];
  const models: string[] = [];
  const uid = (prefix: string, name: string) => `${prefix}${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
  for (const e of model.elements) {
    switch (e.kind) {
      case 'R':
        lines.push(`${uid('R', e.name)} ${N(e.a)} ${N(e.b)} ${fmt(e.r)}`);
        break;
      case 'C':
        lines.push(`${uid('C', e.name)} ${N(e.a)} ${N(e.b)} ${fmt(e.c)}`);
        break;
      case 'L':
        lines.push(`${uid('L', e.name)} ${N(e.a)} ${N(e.b)} ${fmt(e.l)}`);
        break;
      case 'V':
        if (e.wave) {
          const w = e.wave;
          const delay = 0;
          lines.push(`${uid('V', e.name)} ${N(e.a)} ${N(e.b)} DC ${fmt(e.dc)} AC ${fmt(e.acMag)} ${fmt(e.acPhase)} SIN(${fmt(w.offset)} ${fmt(w.amp)} ${fmt(w.freq)} ${delay} 0 ${fmt(w.phaseDeg)})`);
        } else if (e.stateKey !== undefined) {
          const on = states.get(e.stateKey) ?? false;
          lines.push(`${uid('V', e.name)} ${N(e.a)} ${N(e.b)} DC ${fmt(on ? e.dc : e.vOff ?? 0)} ; logic state ${on ? 'HIGH' : 'LOW'}`);
        } else lines.push(`${uid('V', e.name)} ${N(e.a)} ${N(e.b)} DC ${fmt(e.dc)}`);
        break;
      case 'I':
        // SPICE: current flows from n+ through the source to n-; our "+" terminal sources current
        lines.push(`${uid('I', e.name)} ${N(e.b)} ${N(e.a)} DC ${fmt(e.dc)}`);
        break;
      case 'D': {
        const m = `D_${e.name.replace(/[^A-Za-z0-9_]/g, '_')}`;
        const bv = e.bv !== undefined ? ` BV=${fmt(e.bv)} IBV=${fmt(e.ibv ?? 1e-3)}` : '';
        models.push(`.model ${m} D(IS=${fmt(e.is)} N=${fmt(e.n)}${bv})`);
        lines.push(`${uid('D', e.name)} ${N(e.a)} ${N(e.k)} ${m}`);
        break;
      }
      case 'Q': {
        const m = `Q_${e.name}`;
        models.push(`.model ${m} ${e.pol === 1 ? 'NPN' : 'PNP'}(IS=${fmt(e.is)} BF=${fmt(e.bf)} BR=${fmt(e.br)})`);
        lines.push(`${uid('Q', e.name)} ${N(e.c)} ${N(e.b)} ${N(e.e)} ${m}`);
        break;
      }
      case 'M': {
        const m = `M_${e.name}`;
        models.push(`.model ${m} ${e.pol === 1 ? 'NMOS' : 'PMOS'}(LEVEL=1 VTO=${fmt(e.pol * e.vth)} KP=${fmt(e.k)} LAMBDA=${fmt(e.lambda)})`);
        lines.push(`${uid('M', e.name)} ${N(e.d)} ${N(e.g)} ${N(e.s)} ${N(e.s)} ${m} W=1u L=1u`);
        break;
      }
      case 'OA': {
        const mid = (e.vpos + e.vneg) / 2;
        const half = (e.vpos - e.vneg) / 2;
        lines.push(`${uid('B', e.name)} ${N(e.out)} 0 V = ${fmt(mid)} + ${fmt(half)}*tanh(${fmt(e.gain / half)}*(V(${N(e.p)})-V(${N(e.n)})))`);
        break;
      }
      case 'XF': {
        const en = uid('E', e.name);
        lines.push(`${en} ${N(e.p1)} ${N(e.p2)} ${N(e.s1)} ${N(e.s2)} ${fmt(e.ratio)}`);
        lines.push(`${uid('F', e.name)} ${N(e.s2)} ${N(e.s1)} ${en} ${fmt(e.ratio)}`);
        break;
      }
      case 'SW': {
        const st = states.get(e.stateKey) ?? false;
        const closed = e.invert ? !st : st;
        lines.push(`${uid('R', e.name)} ${N(e.a)} ${N(e.b)} ${fmt(closed ? e.ron : e.roff)} ; switch ${closed ? 'closed' : 'open'}`);
        break;
      }
    }
  }
  // match the built-in solver's 1e-12 S node shunts so floating nodes behave identically
  model.nodeNames.forEach((_, i) => lines.push(`RSH${i} ${N(i)} 0 1e12`));
  for (const u of model.unsupported) lines.push(`* not exported: ${u.ref} (${u.reason})`);
  lines.push(...[...new Set(models)]);
  const a = opts.analysis ?? { kind: 'op' };
  if (a.kind === 'op') lines.push('.op');
  if (a.kind === 'tran') lines.push(`.tran ${fmt(a.step)} ${fmt(a.tstop)}`);
  if (a.kind === 'ac') lines.push(`.ac dec ${a.ppd} ${fmt(a.fstart)} ${fmt(a.fstop)}`);
  lines.push('.end');
  return lines.join('\n') + '\n';
}
