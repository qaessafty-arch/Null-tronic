import { getDef } from '../component-library/library';
import { attachmentCounts, buildNetlist, endpointExists, pinKey } from '../project-model/connectivity';
import type { CheckStatus, Finding, Project } from '../project-model/types';
import { calculateInstallation } from './installation';

/**
 * Design-rule validation that does not need simulation. Produces findings with the status
 * vocabulary valid / warning / error / not-evaluated / review. The absence of findings means
 * "valid within supported checks" — never "safe".
 */

export function validateProject(project: Project): Finding[] {
  const f: Finding[] = [];
  const refs = new Map<string, string[]>();
  for (const c of Object.values(project.components)) refs.set(c.ref, [...(refs.get(c.ref) ?? []), c.id]);
  for (const [ref, ids] of refs) if (ids.length > 1) f.push({ id: `dup-${ref}`, status: 'error', code: 'DUPLICATE_REF', message: `Reference designator ${ref} is used ${ids.length} times.`, refs: ids });

  for (const w of Object.values(project.wires)) {
    if (!endpointExists(project, w.a) || !endpointExists(project, w.b)) f.push({ id: `wire-${w.id}`, status: 'error', code: 'BROKEN_WIRE', message: 'Wire references a missing pin or junction.', refs: [w.id] });
  }

  if (project.type !== 'installation') {
    const netlist = buildNetlist(project);
    const counts = attachmentCounts(project);
    // open pins: not wired and not coincident with another pin
    for (const c of Object.values(project.components)) {
      const def = getDef(c.type);
      if (!def.modes.includes(project.type)) continue;
      for (const pd of def.pins) {
        const key = pinKey(c.id, pd.id);
        const netName = netlist.pinNet.get(key);
        const net = netName ? netlist.byName.get(netName) : undefined;
        const alone = !net || (net.pins.length <= 1 && net.junctions.length === 0 && !counts.get(key));
        if (alone && c.type !== 'ground') {
          f.push({ id: `open-${key}`, status: c.type === 'probe' || c.type === 'terminal' ? 'warning' : 'warning', code: 'OPEN_PIN', message: `${c.ref} pin ${pd.name} is not connected.`, refs: [c.id], basis: 'Every pin should belong to a net with at least two connections.' });
        } else if (net && net.pins.length === 1 && net.labels.length === 0 && c.type !== 'probe') {
          f.push({ id: `dangle-${key}`, status: 'warning', code: 'SINGLE_PIN_NET', message: `${c.ref} pin ${pd.name} connects only to wire ends (open circuit).`, refs: [c.id] });
        }
      }
    }
    // dangling junctions (wire end not connected to anything else)
    for (const j of Object.values(project.junctions)) {
      if ((counts.get(`j:${j.id}`) ?? 0) < 2) f.push({ id: `jopen-${j.id}`, status: 'warning', code: 'OPEN_WIRE_END', message: 'Wire ends without a connection (open wire end).', refs: [j.id] });
    }
    // shorted sources
    for (const c of Object.values(project.components)) {
      if (c.type !== 'vdc' && c.type !== 'vac') continue;
      const a = netlist.pinNet.get(pinKey(c.id, '+'));
      const b = netlist.pinNet.get(pinKey(c.id, '-'));
      if (a && a === b && (counts.get(pinKey(c.id, '+')) || counts.get(pinKey(c.id, '-')))) f.push({ id: `short-${c.id}`, status: 'error', code: 'SHORTED_SOURCE', message: `${c.ref} terminals are connected together (short circuit).`, refs: [c.id] });
    }
    if (Object.keys(project.components).length > 0 && !netlist.nets.some((n) => n.isGround)) f.push({ id: 'no-ground', status: 'warning', code: 'NO_GROUND', message: 'The schematic has no ground (0 V) reference.', refs: [] });
    for (const c of netlist.conflicts) f.push({ id: `lbl-${c.net}`, status: 'warning', code: 'LABEL_CONFLICT', message: `Labels ${c.labels.join(', ')} are on the same net.`, refs: [] });
    const notSim = Object.values(project.components).filter((c) => getDef(c.type).simulation === 'none');
    if (notSim.length) f.push({ id: 'not-sim', status: 'not-evaluated', code: 'NOT_SIMULATED', message: `${notSim.map((c) => c.ref).join(', ')}: behaviour not simulated.`, refs: notSim.map((c) => c.id) });
  } else {
    const inCircuit = new Map<string, string[]>();
    for (const c of Object.values(project.circuits)) for (const d of c.deviceIds) inCircuit.set(d, [...(inCircuit.get(d) ?? []), c.name]);
    for (const c of Object.values(project.components)) {
      const def = getDef(c.type);
      const circuits = inCircuit.get(c.id) ?? [];
      if (circuits.length > 1) f.push({ id: `multi-${c.id}`, status: 'error', code: 'DEVICE_IN_SEVERAL', message: `${c.ref} is in several circuits (${circuits.join(', ')}).`, refs: [c.id] });
      if ((def.isLoad || c.type === 'switch_1way') && circuits.length === 0) f.push({ id: `unc-${c.id}`, status: 'warning', code: 'UNCONNECTED_DEVICE', message: `${c.ref} (${def.name}) is not connected to any circuit.`, refs: [c.id] });
    }
    if (!Object.values(project.components).some((c) => getDef(c.type).isBoard) && Object.keys(project.components).length) f.push({ id: 'no-db', status: 'warning', code: 'NO_BOARD', message: 'No distribution board placed.', refs: [] });
    f.push(...calculateInstallation(project).findings);
  }
  return f;
}

export function overallStatus(findings: Finding[]): { status: CheckStatus; label: string } {
  if (findings.some((x) => x.status === 'error')) return { status: 'error', label: 'Errors found' };
  if (findings.some((x) => x.status === 'warning')) return { status: 'warning', label: 'Warnings' };
  if (findings.some((x) => x.status === 'review')) return { status: 'review', label: 'Valid within supported checks — requires engineering review' };
  if (findings.some((x) => x.status === 'not-evaluated')) return { status: 'not-evaluated', label: 'Valid within supported checks — some items not evaluated' };
  return { status: 'valid', label: 'Valid within supported checks' };
}
