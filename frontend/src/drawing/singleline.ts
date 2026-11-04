import { getDef } from '../component-library/library';
import { calculateInstallation } from '../calculations/installation';
import type { Project } from '../project-model/types';
import { line, rect, text, type Primitive } from './primitives';

/**
 * Single-line diagram generated from the installation model (boards, circuits, protection,
 * cables, loads). Drawn not-to-scale in millimetre units.
 */
export function singleLinePrimitives(project: Project): Primitive[] {
  const rep = calculateInstallation(project);
  const prims: Primitive[] = [];
  const boards = Object.values(project.components).filter((c) => getDef(c.type).isBoard);
  let ox = 0;
  for (const b of boards) {
    const circuits = rep.circuits.filter((c) => project.circuits[c.circuitId]?.boardId === b.id);
    const pitch = 42;
    const width = Math.max(1, circuits.length) * pitch;
    const busY = 40;
    // supply & incomer
    const sx = ox + width / 2;
    prims.push({ k: 'circle', c: { x: sx, y: 4 }, r: 4, w: 0.35 }, text(sx, 4, '~', 4));
    prims.push(text(sx + 7, 4, `Supply ${project.settings.supplyPhases === 3 ? '3/N/PE' : '1/N/PE'} ${project.settings.supplyVoltage} V ${project.settings.frequencyHz} Hz`, 2.4, 'start'));
    prims.push(line(sx, 8, sx, 18, 0.35));
    prims.push(...breaker(sx, 18), text(sx + 5, 22, `Incomer ${String(b.properties.incomerA ?? '?')} A`, 2.2, 'start'));
    prims.push(line(sx, 26, sx, busY, 0.35));
    prims.push(line(ox, busY, ox + width, busY, 1.0));
    prims.push({ ...text(ox, busY - 3, `${b.ref}${b.properties.location ? ` (${String(b.properties.location)})` : ''}`, 3, 'start'), bold: true });
    circuits.forEach((c, i) => {
      const cc = project.circuits[c.circuitId];
      const x = ox + pitch * i + pitch / 2;
      prims.push(line(x, busY, x, busY + 8, 0.35));
      prims.push(...breaker(x, busY + 8));
      if (cc.protection.kind === 'RCBO') prims.push({ k: 'circle', c: { x: x + 3.4, y: busY + 12 }, r: 1.3, w: 0.25 }, text(x + 3.4, busY + 12, 'Δ', 1.6));
      prims.push(line(x, busY + 16, x, busY + 46, 0.35));
      // cable tick marks for conductors
      const cores = 1 + (cc.cable.hasNeutral ? 1 : 0) + (cc.cable.hasPE ? 1 : 0) + (cc.phase === 'L123' ? 2 : 0);
      for (let k = 0; k < cores; k++) prims.push(line(x - 1.5, busY + 26 + k * 1.2, x + 1.5, busY + 24.5 + k * 1.2, 0.25));
      prims.push(...vtext(x - 3, busY + 18, [`${cc.protection.kind} ${cc.protection.curve}${c.breakerA ?? '?'}A`, `${cc.cable.material} ${cores}×${c.csaMm2 ?? '?'} mm²`, `${c.totalLengthM.toFixed(1)} m  ΔU ${c.dropPct.toFixed(2)} %`]));
      prims.push(rect(x - 10, busY + 46, 20, 18, { w: 0.35 }));
      prims.push({ ...text(x, busY + 50, c.name, 3, 'middle'), bold: true }, text(x, busY + 55, c.phase, 2.2), text(x, busY + 59.5, `${(c.connectedW / 1000).toFixed(2)} kW`, 2.2), text(x, busY + 67, cc.notes.slice(0, 18), 1.8));
    });
    ox += width + 30;
  }
  if (boards.length === 0) prims.push(text(0, 0, 'No distribution board in the project', 4, 'start'));
  return prims;
}

function breaker(x: number, y: number): Primitive[] {
  return [line(x, y, x - 2.6, y + 6, 0.35), line(x, y + 8, x, y + 6.5, 0.35), line(x - 1, y - 0.8, x + 1, y + 0.8, 0.35), line(x - 1, y + 0.8, x + 1, y - 0.8, 0.35), line(x, y - 0.1, x, y, 0.35)];
}

function vtext(x: number, y: number, lines: string[]): Primitive[] {
  return lines.map((s, i) => text(x, y + i * 3.2, s, 1.8, 'end'));
}
