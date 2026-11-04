import { getDef } from '../component-library/library';
import type { Project } from '../project-model/types';
import { calculateInstallation } from './installation';

export interface BomLine {
  key: string;
  description: string;
  quantity: number;
  unit: 'pcs' | 'm';
  refs: string[];
  unitPrice: number | null;
  total: number | null;
}

/**
 * Bill of materials derived from the model. Prices come only from the project's unit-price table;
 * missing prices are reported as null (never invented).
 */
export function buildBom(project: Project): { lines: BomLine[]; total: number | null; missingPrices: number } {
  const map = new Map<string, BomLine>();
  const add = (key: string, description: string, qty: number, unit: 'pcs' | 'm', ref?: string) => {
    const l = map.get(key) ?? { key, description, quantity: 0, unit, refs: [], unitPrice: null, total: null };
    l.quantity += qty;
    if (ref) l.refs.push(ref);
    map.set(key, l);
  };
  for (const c of Object.values(project.components)) {
    const def = getDef(c.type);
    if (['ground', 'label', 'probe', 'contact_no', 'contact_nc'].includes(c.type)) continue;
    const value = def.valueLabel ? def.valueLabel(c.properties) : '';
    add(`${c.type}:${value}`, `${def.name}${value ? ` — ${value}` : ''}`, 1, 'pcs', c.ref);
  }
  if (project.type === 'installation') {
    const rep = calculateInstallation(project);
    for (const cc of rep.circuits) {
      const c = project.circuits[cc.circuitId];
      const cores = 1 + (c.cable.hasNeutral ? 1 : 0) + (c.cable.hasPE ? 1 : 0) + (c.phase === 'L123' ? 2 : 0);
      if (cc.csaMm2) add(`cable:${c.cable.material}-${cc.csaMm2}-${cores}C-${c.cable.insulation}`, `Cable ${c.cable.material} ${cores}×${cc.csaMm2} mm² ${c.cable.insulation}`, Math.round(cc.totalLengthM * 10) / 10, 'm', c.name);
      if (cc.breakerA) {
        const desc = c.protection.kind === 'RCBO' ? `RCBO ${c.protection.curve}${cc.breakerA} ${c.protection.residualmA ?? 30} mA` : `MCB ${c.protection.curve}${cc.breakerA}${c.phase === 'L123' ? ' 3P' : ' 1P'}`;
        add(`prot:${desc}`, desc, 1, 'pcs', c.name);
      }
    }
  }
  let total = 0;
  let missing = 0;
  const lines = [...map.values()].sort((a, b) => a.description.localeCompare(b.description));
  for (const l of lines) {
    const price = project.settings.unitPrices[l.key];
    if (typeof price === 'number') {
      l.unitPrice = price;
      l.total = price * l.quantity;
      total += l.total;
    } else missing++;
  }
  return { lines, total: missing === lines.length ? null : total, missingPrices: missing };
}
