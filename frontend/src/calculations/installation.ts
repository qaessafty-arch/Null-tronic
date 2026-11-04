import { getDef } from '../component-library/library';
import { polylineLength } from '../project-model/geometry';
import type { Cable, Circuit, ComponentInstance, Finding, Id, Project } from '../project-model/types';
import ref from '@shared/engineering-rules/installation-reference.json';

/**
 * Installation calculation engine (no UI, no rendering).
 * Every result records its inputs, the formula used and the assumptions behind it.
 * Reference data and sources: shared/engineering-rules/installation-reference.json.
 */

export interface Assumption {
  text: string;
  source?: string;
}

export interface SegmentCalc {
  cableId: Id;
  fromRef: string;
  toRef: string;
  horizontalM: number;
  verticalM: number;
  lengthM: number;
  currentA: number;
  dropV: number;
}

export type ValueSource = 'user' | 'calculated' | 'suggested' | 'not-evaluated';

export interface CircuitCalc {
  circuitId: Id;
  name: string;
  boardRef: string;
  phase: Circuit['phase'];
  category: Circuit['category'];
  deviceCount: number;
  connectedW: number;
  apparentVA: number;
  demandVA: number;
  powerFactor: number;
  ibA: number;
  totalLengthM: number;
  segments: SegmentCalc[];
  dropV: number;
  dropPct: number;
  dropLimitPct: number;
  csaMm2: number | null;
  csaSource: ValueSource;
  breakerA: number | null;
  breakerSource: ValueSource;
  izA: number | null;
  izSource: ValueSource;
  status: Finding['status'];
  findings: Finding[];
  assumptions: Assumption[];
  formulae: string[];
}

export interface BoardCalc {
  boardId: Id;
  ref: string;
  circuits: Id[];
  phaseVA: Record<'L1' | 'L2' | 'L3', number>;
  phaseA: Record<'L1' | 'L2' | 'L3', number>;
  totalDemandVA: number;
  imbalancePct: number | null;
  incomerA: number;
  findings: Finding[];
  balanceSuggestion: Record<Id, 'L1' | 'L2' | 'L3'> | null;
}

export interface InstallationReport {
  circuits: CircuitCalc[];
  boards: BoardCalc[];
  findings: Finding[];
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function deviceLoad(c: ComponentInstance): { w: number; va: number; pf: number } {
  const def = getDef(c.type);
  if (!def.isLoad) return { w: 0, va: 0, pf: 1 };
  const w = Math.max(num(c.properties.power, 0), 0);
  const pf = Math.min(Math.max(num(c.properties.powerFactor, 1), 0.05), 1);
  return { w, va: w / pf, pf };
}

/** Phase-conductor resistance per metre in normal service (Ω/m), IEC 60364-5-52 G.52.2. */
export function serviceResistancePerM(material: 'Cu' | 'Al', csaMm2: number): number {
  const rho20 = ref.conductorResistivity20C[material].value;
  return (ref.voltageDropMethod.serviceResistivityFactor * rho20) / csaMm2;
}

/** Voltage drop u (V) for one cable run: u = b(ρ1·L/S·cosφ + λ·L·sinφ)·I. */
export function voltageDrop(opts: { material: 'Cu' | 'Al'; csaMm2: number; lengthM: number; currentA: number; powerFactor: number; threePhase: boolean }): number {
  const b = opts.threePhase ? ref.voltageDropMethod.b.threePhase : ref.voltageDropMethod.b.singlePhase;
  const cos = opts.powerFactor;
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const lambda = ref.voltageDropMethod.reactancePerMetre_mOhm / 1000;
  return b * (serviceResistancePerM(opts.material, opts.csaMm2) * opts.lengthM * cos + lambda * opts.lengthM * sin) * opts.currentA;
}

export function cableLengths(project: Project, cable: Cable): { horizontalM: number; verticalM: number; lengthM: number } {
  const a = project.components[cable.fromId];
  const b = project.components[cable.toId];
  const horizontal = polylineLength(cable.path) / 1000;
  const vertical = ((a ? Math.abs(cable.routeElevation - a.elevation) : 0) + (b ? Math.abs(cable.routeElevation - b.elevation) : 0)) / 1000;
  return { horizontalM: horizontal, verticalM: vertical, lengthM: horizontal + vertical };
}

export function suggestBreaker(ib: number): number | null {
  return ref.mcbRatedCurrents.values.find((v) => v >= ib - 1e-9) ?? null;
}

export function lookupAmpacity(project: Project, c: Circuit, csa: number): number | null {
  const row = project.settings.ampacityTable.find(
    (r) => r.material === c.cable.material && r.insulation === c.cable.insulation && r.installationMethod.trim().toUpperCase() === c.cable.installationMethod.trim().toUpperCase() && Math.abs(r.csaMm2 - csa) < 1e-9,
  );
  return row ? row.ampacityA : null;
}

function worst(fs: Finding[]): Finding['status'] {
  const order: Finding['status'][] = ['error', 'warning', 'review', 'not-evaluated', 'valid'];
  for (const s of order) if (fs.some((f) => f.status === s)) return s;
  return 'valid';
}

export function calculateCircuit(project: Project, c: Circuit): CircuitCalc {
  const s = project.settings;
  const findings: Finding[] = [];
  const assumptions: Assumption[] = [];
  const formulae: string[] = [];
  const board = project.components[c.boardId];
  const devices = c.deviceIds.map((id) => project.components[id]).filter(Boolean);
  const threePhase = c.phase === 'L123';
  const U0 = s.supplyVoltage;
  const F = (code: string, status: Finding['status'], message: string, basis?: string, refs: Id[] = [c.id]) => findings.push({ id: `${c.id}-${code}`, status, code, message, refs, basis });

  let connectedW = 0;
  let apparentVA = 0;
  const loads = devices.map((d) => deviceLoad(d));
  loads.forEach((l) => {
    connectedW += l.w;
    apparentVA += l.va;
  });
  const df = Math.min(Math.max(c.demandFactor, 0), 1);
  const demandVA = apparentVA * df;
  const pf = apparentVA > 0 ? connectedW / apparentVA : 1;
  const divisor = threePhase ? 3 * U0 : U0;
  const ibA = demandVA / divisor;
  formulae.push(threePhase ? 'Ib = S_demand / (√3 · U_LL) = S_demand / (3 · U0)' : 'Ib = S_demand / U0');
  formulae.push(`S_demand = Σ(P/cosφ) × demand factor = ${apparentVA.toFixed(0)} VA × ${df}`);
  assumptions.push({ text: 'Apparent powers of devices are added arithmetically (conservative).' });
  if (df !== 1) assumptions.push({ text: `Demand factor ${df} entered by the user.` });
  else assumptions.push({ text: 'Demand factor 1.0 (all connected load simultaneous) — conservative default.' });
  if (devices.some((d) => getDef(d.type).properties.some((p) => p.assumption && (p.key === 'power' || p.key === 'powerFactor'))))
    assumptions.push({ text: 'Some device powers / power factors are typical defaults marked as assumptions; confirm them.' });

  if (devices.length === 0) F('EMPTY', 'warning', `${c.name} has no connected devices.`);
  if (loads.every((l) => l.w === 0) && devices.length) F('NO_LOAD', 'warning', `${c.name} has devices but no load (switches / boxes only).`);
  if (threePhase && s.supplyPhases !== 3) F('3PH_ON_1PH', 'error', `${c.name} is three-phase but the supply is single-phase.`, 'Project supply settings.');

  // cable runs in chain order; downstream current for each segment
  const cables = Object.values(project.cables).filter((k) => k.circuitId === c.id);
  const chain: Cable[] = [];
  let prevId = c.boardId;
  for (const d of devices) {
    const k = cables.find((x) => x.fromId === prevId && x.toId === d.id) ?? cables.find((x) => x.toId === d.id);
    if (k) chain.push(k);
    else F('NO_ROUTE', 'error', `No cable route to ${d.ref} in ${c.name}.`, 'Cable length must come from a defined route.', [c.id, d.id]);
    prevId = d.id;
  }

  // conductor size
  let csa = c.cable.csaMm2;
  let csaSource: ValueSource = csa ? 'user' : 'suggested';
  const limitPct = c.category === 'lighting' ? s.voltageDropLimitLighting : s.voltageDropLimitOther;
  const segmentsFor = (size: number): { segs: SegmentCalc[]; drop: number } => {
    let drop = 0;
    const segs: SegmentCalc[] = chain.map((k) => {
      const idx = devices.findIndex((d) => d.id === k.toId);
      const downstreamVA = loads.slice(Math.max(idx, 0)).reduce((acc, l) => acc + l.va, 0) * df;
      const i = downstreamVA / divisor;
      const lens = cableLengths(project, k);
      const u = voltageDrop({ material: c.cable.material, csaMm2: size, lengthM: lens.lengthM, currentA: i, powerFactor: pf, threePhase });
      drop += u;
      return { cableId: k.id, fromRef: project.components[k.fromId]?.ref ?? '?', toRef: project.components[k.toId]?.ref ?? '?', ...lens, currentA: i, dropV: u };
    });
    return { segs, drop };
  };
  const minCsa = c.cable.material === 'Cu' ? ref.minimumCrossSection.Cu.powerAndLighting : ref.nominalCrossSections.values[0];
  if (!csa) {
    csa = null;
    for (const size of ref.nominalCrossSections.values) {
      if (size < minCsa) continue;
      const r = segmentsFor(size);
      const iz = lookupAmpacity(project, c, size);
      const brk = c.protection.ratingA ?? suggestBreaker(ibA);
      const ampOk = iz === null || brk === null || brk <= iz;
      if ((100 * r.drop) / U0 <= limitPct && ampOk) {
        csa = size;
        break;
      }
    }
    if (csa === null) {
      csa = ref.nominalCrossSections.values[ref.nominalCrossSections.values.length - 1];
      F('NO_SIZE', 'error', `No standard size up to ${csa} mm² meets the ${limitPct} % voltage-drop limit.`, ref.nominalCrossSections.source);
    }
    assumptions.push({ text: `Conductor size suggested as the smallest IEC 60228 size ≥ ${minCsa} mm² that meets the voltage-drop limit${project.settings.ampacityTable.length ? ' and the configured ampacity table' : ''}.`, source: ref.minimumCrossSection.source });
  } else if (c.cable.material === 'Cu' && csa < minCsa) {
    F('MIN_CSA', 'error', `${csa} mm² is below the ${minCsa} mm² minimum for copper power/lighting circuits.`, ref.minimumCrossSection.source);
  }
  const { segs, drop } = segmentsFor(csa);
  const dropPct = U0 > 0 ? (100 * drop) / U0 : 0;
  formulae.push('u = b·(ρ1·L/S·cosφ + λ·L·sinφ)·I per segment, I = downstream load current; ΔU% = 100·Σu/U0');
  assumptions.push({ text: `ρ1 = ${ref.voltageDropMethod.serviceResistivityFactor} × ρ20, λ = ${ref.voltageDropMethod.reactancePerMetre_mOhm} mΩ/m, b = ${threePhase ? 1 : 2}.`, source: ref.voltageDropMethod.source });
  assumptions.push({ text: 'Cable length = plan route length + vertical drops between route height and device mounting heights.' });
  if (dropPct > limitPct) F('VDROP', 'error', `${c.name} voltage drop ${dropPct.toFixed(2)} % exceeds the ${limitPct} % limit.`, ref.voltageDropLimits.source);
  else if (dropPct > 0.8 * limitPct) F('VDROP_MARGIN', 'warning', `${c.name} voltage drop ${dropPct.toFixed(2)} % is within 20 % of the ${limitPct} % limit.`, ref.voltageDropLimits.source);

  // protection
  let breaker = c.protection.ratingA;
  let breakerSource: ValueSource = breaker ? 'user' : 'suggested';
  if (!breaker) {
    breaker = suggestBreaker(ibA);
    if (breaker === null) {
      breakerSource = 'not-evaluated';
      F('NO_BREAKER', 'error', `Ib = ${ibA.toFixed(1)} A exceeds the largest tabulated MCB rating.`, ref.mcbRatedCurrents.source);
    }
  } else if (breaker < ibA) {
    F('BREAKER_LT_IB', 'error', `Protective device ${breaker} A is below the design current Ib = ${ibA.toFixed(1)} A.`, 'IEC 60364-4-43, 433.1: Ib ≤ In ≤ Iz.');
  }
  if (breakerSource === 'suggested' && breaker !== null) assumptions.push({ text: `Breaker suggested as the smallest IEC 60898-1 rating ≥ Ib (${breaker} A).`, source: ref.mcbRatedCurrents.source });

  // current-carrying capacity
  const iz = lookupAmpacity(project, c, csa);
  let izSource: ValueSource = iz === null ? 'not-evaluated' : 'user';
  if (iz === null) {
    F('IZ_NE', 'not-evaluated', `Current-carrying capacity of ${csa} mm² (${c.cable.material}/${c.cable.insulation}, method ${c.cable.installationMethod}) not evaluated: no matching row in the project ampacity table.`, ref.ampacityTable.source);
  } else if (breaker !== null && breaker > iz) {
    F('IN_GT_IZ', 'error', `In = ${breaker} A exceeds Iz = ${iz} A for ${csa} mm².`, 'IEC 60364-4-43, 433.1: In ≤ Iz.');
  }
  if (iz !== null) izSource = 'user';

  // protective conductor & additional protection
  if (!c.cable.hasPE) F('NO_PE', 'error', `${c.name} cable has no protective conductor (PE).`, 'Fault protection by automatic disconnection requires a protective conductor (IEC 60364-4-41, 411.3.1.1).');
  if (!threePhase && !c.cable.hasNeutral) F('NO_N', 'warning', `${c.name} is single-phase without a neutral conductor.`);
  const hasSockets = devices.some((d) => d.type === 'socket');
  if (hasSockets && !(c.protection.kind === 'RCBO' && (c.protection.residualmA ?? 999) <= ref.rcdAdditionalProtection.residualCurrent_mA))
    F('RCD', 'review', `${c.name} supplies socket-outlets without ≤ 30 mA residual-current protection recorded.`, ref.rcdAdditionalProtection.source);
  F('SC_NE', 'not-evaluated', 'Fault-loop impedance and disconnection time are not evaluated (supply impedance not modelled).', 'IEC 60364-4-41 Table 41.1 requires verification of disconnection times.');

  if (!board) F('NO_BOARD', 'error', `${c.name} has no distribution board.`);
  return {
    circuitId: c.id,
    name: c.name,
    boardRef: board?.ref ?? '?',
    phase: c.phase,
    category: c.category,
    deviceCount: devices.length,
    connectedW,
    apparentVA,
    demandVA,
    powerFactor: pf,
    ibA,
    totalLengthM: segs.reduce((a, x) => a + x.lengthM, 0),
    segments: segs,
    dropV: drop,
    dropPct,
    dropLimitPct: limitPct,
    csaMm2: csa,
    csaSource,
    breakerA: breaker,
    breakerSource,
    izA: iz,
    izSource,
    status: worst(findings),
    findings,
    assumptions,
    formulae,
  };
}

export function calculateInstallation(project: Project): InstallationReport {
  const circuits = Object.values(project.circuits)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((c) => calculateCircuit(project, c));
  const findings: Finding[] = [];
  const boards: BoardCalc[] = [];
  const U0 = project.settings.supplyVoltage;
  for (const b of Object.values(project.components).filter((c) => getDef(c.type).isBoard)) {
    const mine = circuits.filter((c) => project.circuits[c.circuitId]?.boardId === b.id);
    const phaseVA = { L1: 0, L2: 0, L3: 0 };
    for (const c of mine) {
      if (c.phase === 'L123') {
        phaseVA.L1 += c.demandVA / 3;
        phaseVA.L2 += c.demandVA / 3;
        phaseVA.L3 += c.demandVA / 3;
      } else phaseVA[c.phase] += c.demandVA;
    }
    const phaseA = { L1: phaseVA.L1 / U0, L2: phaseVA.L2 / U0, L3: phaseVA.L3 / U0 };
    const total = phaseVA.L1 + phaseVA.L2 + phaseVA.L3;
    const fb: Finding[] = [];
    const incomer = num(b.properties.incomerA, 0);
    const maxA = Math.max(phaseA.L1, phaseA.L2, phaseA.L3);
    if (incomer > 0 && maxA > incomer) fb.push({ id: `${b.id}-OVER`, status: 'error', code: 'BOARD_OVERLOAD', message: `${b.ref}: demand current ${maxA.toFixed(1)} A exceeds the ${incomer} A incoming device.`, refs: [b.id], basis: 'Sum of circuit demand currents per phase.' });
    const ways = num(b.properties.ways, 0);
    if (ways > 0 && mine.length > ways) fb.push({ id: `${b.id}-WAYS`, status: 'error', code: 'BOARD_WAYS', message: `${b.ref} has ${mine.length} circuits but only ${ways} ways.`, refs: [b.id] });
    let imbalance: number | null = null;
    let suggestion: BoardCalc['balanceSuggestion'] = null;
    if (project.settings.supplyPhases === 3) {
      const avg = total / 3;
      imbalance = avg > 0 ? (100 * (Math.max(phaseVA.L1, phaseVA.L2, phaseVA.L3) - Math.min(phaseVA.L1, phaseVA.L2, phaseVA.L3))) / avg : 0;
      // greedy longest-processing-time assignment of single-phase circuits
      const acc = { L1: 0, L2: 0, L3: 0 } as Record<'L1' | 'L2' | 'L3', number>;
      suggestion = {};
      for (const c of mine.filter((x) => x.phase === 'L123')) (['L1', 'L2', 'L3'] as const).forEach((p) => (acc[p] += c.demandVA / 3));
      for (const c of [...mine].filter((x) => x.phase !== 'L123').sort((a, b) => b.demandVA - a.demandVA)) {
        const p = (['L1', 'L2', 'L3'] as const).reduce((m, q) => (acc[q] < acc[m] ? q : m), 'L1' as const);
        acc[p] += c.demandVA;
        suggestion[c.circuitId] = p;
      }
      if (imbalance > 20) fb.push({ id: `${b.id}-IMB`, status: 'warning', code: 'PHASE_IMBALANCE', message: `${b.ref} phase imbalance ${imbalance.toFixed(0)} % (see suggested phase allocation).`, refs: [b.id], basis: 'Imbalance = (max − min) / mean phase demand. 20 % threshold is a design assumption.' });
    }
    boards.push({ boardId: b.id, ref: b.ref, circuits: mine.map((c) => c.circuitId), phaseVA, phaseA, totalDemandVA: total, imbalancePct: imbalance, incomerA: incomer, findings: fb, balanceSuggestion: suggestion });
    findings.push(...fb);
  }
  for (const c of circuits) findings.push(...c.findings);
  return { circuits, boards, findings };
}
