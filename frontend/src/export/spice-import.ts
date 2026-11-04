import { ProjectBuilder } from '../project-model/builder';
import { pinWorldPosition } from '../project-model/geometry';
import type { ComponentInstance, Project, PropertyValue } from '../project-model/types';

/**
 * SPICE netlist import (subset): R, C, L, V (DC / SIN / AC), I (DC), D, Q, M and their .model cards.
 * Each component is placed on a grid and every pin receives a net label (node "0" → ground), so the
 * imported connectivity is exact even though the schematic layout is automatic.
 * Unsupported lines (subcircuits, controlled sources, other analyses) are reported, not guessed.
 */

export interface SpiceImportResult {
  project: Project;
  imported: number;
  skipped: { line: number; text: string; reason: string }[];
}

/** SPICE numbers: case-insensitive suffixes, "m" = milli, "meg" = mega. */
export function spiceNumber(tok: string): number {
  const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(meg|mil|[tgkmunpf])?[a-z]*$/i.exec(tok.trim());
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const s = (m[2] ?? '').toLowerCase();
  const mult: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, '': 1 };
  return v * (mult[s] ?? 1);
}

interface ModelCard {
  type: string;
  params: Record<string, number>;
}

export function importSpice(text: string, name = 'Imported SPICE netlist'): SpiceImportResult {
  const raw = text.split(/\r?\n/);
  // join continuation lines
  const lines: { n: number; text: string }[] = [];
  raw.forEach((l, idx) => {
    if (idx === 0) return; // title line
    const t = l.replace(/;.*$/, '').trim();
    if (!t || t.startsWith('*')) return;
    if (t.startsWith('+') && lines.length) lines[lines.length - 1].text += ' ' + t.slice(1).trim();
    else lines.push({ n: idx + 1, text: t });
  });
  const models = new Map<string, ModelCard>();
  for (const l of lines) {
    const m = /^\.model\s+(\S+)\s+(\w+)\s*\(?(.*?)\)?\s*$/i.exec(l.text);
    if (!m) continue;
    const params: Record<string, number> = {};
    for (const kv of m[3].split(/[\s,]+/)) {
      const [k, v] = kv.split('=');
      if (k && v) params[k.toLowerCase()] = spiceNumber(v);
    }
    models.set(m[1].toLowerCase(), { type: m[2].toLowerCase(), params });
  }
  const b = new ProjectBuilder('electronic', name);
  const skipped: SpiceImportResult['skipped'] = [];
  const placed: { comp: ComponentInstance; nodes: Record<string, string> }[] = [];
  let k = 0;
  const pos = () => {
    const col = k % 4;
    const row = Math.floor(k / 4);
    k++;
    return { x: col * 35, y: row * 30 };
  };
  const add = (type: string, props: Record<string, PropertyValue>, nodes: Record<string, string>, ref: string) => {
    const c = b.add(type, pos(), props, { ref, rotation: type === 'vdc' || type === 'vac' || type === 'idc' ? 0 : 0 });
    placed.push({ comp: c, nodes });
  };
  for (const l of lines) {
    if (l.text.startsWith('.')) {
      if (!/^\.(model|end|op|tran|ac|dc|options|option|temp|ends?)\b/i.test(l.text)) skipped.push({ line: l.n, text: l.text, reason: 'directive not supported' });
      continue;
    }
    const tok = l.text.split(/\s+/);
    const ref = tok[0];
    const letter = ref[0].toUpperCase();
    try {
      switch (letter) {
        case 'R':
          add('resistor', { resistance: spiceNumber(tok[3]) }, { '1': tok[1], '2': tok[2] }, ref);
          break;
        case 'C':
          add('capacitor', { capacitance: spiceNumber(tok[3]) }, { '1': tok[1], '2': tok[2] }, ref);
          break;
        case 'L':
          add('inductor', { inductance: spiceNumber(tok[3]) }, { '1': tok[1], '2': tok[2] }, ref);
          break;
        case 'V': {
          const rest = tok.slice(3).join(' ');
          const sin = /SIN\s*\(\s*([^)]*)\)/i.exec(rest);
          if (sin) {
            const a = sin[1].split(/[\s,]+/).map(spiceNumber);
            add('vac', { offset: a[0] || 0, amplitude: a[1] || 0, frequency: a[2] || 0, phase: a[5] || 0 }, { '+': tok[1], '-': tok[2] }, ref);
          } else {
            const dcm = /(?:DC\s+)?([-+]?[\d.]+(?:e[-+]?\d+)?[a-z]*)/i.exec(rest.replace(/AC\s+\S+(\s+\S+)?/i, ''));
            add('vdc', { voltage: dcm ? spiceNumber(dcm[1]) : 0 }, { '+': tok[1], '-': tok[2] }, ref);
          }
          break;
        }
        case 'I': {
          const dcm = /(?:DC\s+)?([-+]?[\d.]+(?:e[-+]?\d+)?[a-z]*)/i.exec(tok.slice(3).join(' '));
          // SPICE: current flows n+ → source → n-, i.e. out of n- into the circuit
          add('idc', { current: dcm ? spiceNumber(dcm[1]) : 0 }, { '+': tok[2], '-': tok[1] }, ref);
          break;
        }
        case 'D': {
          const mc = models.get((tok[3] ?? '').toLowerCase());
          if (mc?.params.bv !== undefined) add('zener', { vz: mc.params.bv, izt: mc.params.ibv ?? 1e-3, is: mc.params.is ?? 1e-14, n: mc.params.n ?? 1 }, { A: tok[1], K: tok[2] }, ref);
          else add('diode', { model: 'custom', is: mc?.params.is ?? 1e-14, n: mc?.params.n ?? 1, rs: mc?.params.rs ?? 0 }, { A: tok[1], K: tok[2] }, ref);
          break;
        }
        case 'Q': {
          const mc = models.get((tok[4] ?? '').toLowerCase());
          const type = mc?.type === 'pnp' ? 'pnp' : 'npn';
          add(type, { bf: mc?.params.bf ?? 100, br: mc?.params.br ?? 1, is: mc?.params.is ?? 1e-14 }, { C: tok[1], B: tok[2], E: tok[3] }, ref);
          break;
        }
        case 'M': {
          const mc = models.get((tok[5] ?? '').toLowerCase());
          const type = mc?.type === 'pmos' ? 'pmos' : 'nmos';
          add(type, { vth: Math.abs(mc?.params.vto ?? 2), k: mc?.params.kp ?? 2e-5, lambda: mc?.params.lambda ?? 0 }, { D: tok[1], G: tok[2], S: tok[3] }, ref);
          break;
        }
        default:
          skipped.push({ line: l.n, text: l.text, reason: `element type "${letter}" not supported` });
      }
    } catch (e) {
      skipped.push({ line: l.n, text: l.text, reason: (e as Error).message });
    }
  }
  // net labels / grounds on every pin, connected with a short wire
  for (const { comp, nodes } of placed) {
    for (const [pinId, node] of Object.entries(nodes)) {
      const c = b.project.components[comp.id];
      const pp = pinWorldPosition(c, pinId);
      const dx = pp.x - c.position.x;
      const dy = pp.y - c.position.y;
      const len = Math.hypot(dx, dy) || 1;
      const at = { x: pp.x + (dx / len) * 5, y: pp.y + (dy / len) * 5 };
      if (node === '0' || node.toLowerCase() === 'gnd') {
        const g = b.add('ground', { x: at.x, y: at.y + 2.5 });
        b.wire(c, pinId, g, '1');
      } else {
        const lab = b.add('label', at, { net: node.replace(/[^A-Za-z0-9_.]/g, '_') });
        b.wire(c, pinId, lab, '1');
      }
    }
  }
  return { project: b.build(), imported: placed.length, skipped };
}
