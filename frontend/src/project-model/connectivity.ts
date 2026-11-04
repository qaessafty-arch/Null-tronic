import { getDef } from '../component-library/library';
import { pinWorldPosition } from './geometry';
import type { Endpoint, Id, Project } from './types';

/**
 * Electrical connectivity. Nets are DERIVED from the authoritative model (wires, junctions,
 * coincident pins, net labels, ground symbols) — they are never stored separately, so the
 * schematic, 3D view, simulator and exports always agree.
 */

export interface PinRef {
  componentId: Id;
  pinId: string;
}

export interface Net {
  /** Stable net name: label name, "0" for ground, else derived from its first pin. */
  name: string;
  pins: PinRef[];
  junctions: Id[];
  wires: Id[];
  isGround: boolean;
  labels: string[];
}

export interface Netlist {
  nets: Net[];
  byName: Map<string, Net>;
  pinNet: Map<string, string>;
  wireNet: Map<Id, string>;
  junctionNet: Map<Id, string>;
  conflicts: { net: string; labels: string[] }[];
}

export const pinKey = (componentId: Id, pinId: string): string => `p:${componentId}:${pinId}`;
export const endpointKey = (e: Endpoint): string => (e.kind === 'pin' ? pinKey(e.componentId, e.pinId) : `j:${e.junctionId}`);

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

export function buildNetlist(project: Project): Netlist {
  const uf = new UnionFind();
  const pinPos = new Map<string, string>(); // rounded position -> pin key (coincident pins connect)
  const labelOf = new Map<string, string>(); // pin key -> label
  const groundPins = new Set<string>();

  for (const c of Object.values(project.components)) {
    let def;
    try {
      def = getDef(c.type);
    } catch {
      continue;
    }
    if (project.type === 'installation' && !['electronic', 'control'].some((m) => def.modes.includes(m as never))) continue;
    for (const pd of def.pins) {
      const key = pinKey(c.id, pd.id);
      uf.find(key);
      const pos = pinWorldPosition(c, pd.id);
      const pk = `${pos.x.toFixed(3)},${pos.y.toFixed(3)}`;
      const other = pinPos.get(pk);
      if (other) uf.union(key, other);
      else pinPos.set(pk, key);
      if (c.type === 'ground') {
        groundPins.add(key);
        uf.union(key, '#GND');
      }
      if (c.type === 'label') {
        const name = String(c.properties.net ?? '').trim();
        if (name) {
          labelOf.set(key, name);
          uf.union(key, `#L:${name}`);
        }
      }
    }
  }
  for (const j of Object.values(project.junctions)) uf.find(`j:${j.id}`);
  for (const w of Object.values(project.wires)) {
    if (!endpointExists(project, w.a) || !endpointExists(project, w.b)) continue;
    uf.union(endpointKey(w.a), endpointKey(w.b));
  }

  // group
  const groups = new Map<string, { pins: PinRef[]; junctions: Id[]; wires: Id[]; isGround: boolean; labels: Set<string> }>();
  const g = (root: string) => {
    let v = groups.get(root);
    if (!v) {
      v = { pins: [], junctions: [], wires: [], isGround: false, labels: new Set() };
      groups.set(root, v);
    }
    return v;
  };
  for (const key of uf.parent.keys()) {
    if (key.startsWith('#')) continue;
    const root = uf.find(key);
    const grp = g(root);
    if (key.startsWith('p:')) {
      const [, componentId, pinId] = splitPinKey(key);
      grp.pins.push({ componentId, pinId });
      if (groundPins.has(key)) grp.isGround = true;
      const l = labelOf.get(key);
      if (l) grp.labels.add(l);
    } else if (key.startsWith('j:')) {
      grp.junctions.push(key.slice(2));
    }
  }
  if (uf.parent.has('#GND')) {
    const root = uf.find('#GND');
    if (groups.has(root)) g(root).isGround = true;
  }
  for (const w of Object.values(project.wires)) {
    if (!endpointExists(project, w.a)) continue;
    const root = uf.find(endpointKey(w.a));
    g(root).wires.push(w.id);
  }

  const nets: Net[] = [];
  const byName = new Map<string, Net>();
  const pinNet = new Map<string, string>();
  const wireNet = new Map<Id, string>();
  const junctionNet = new Map<Id, string>();
  const conflicts: Netlist['conflicts'] = [];
  const used = new Set<string>();

  const refOf = (id: Id) => project.components[id]?.ref ?? id;
  for (const grp of groups.values()) {
    if (grp.pins.length === 0 && grp.junctions.length === 0) continue;
    const labels = [...grp.labels].sort();
    let name: string;
    if (grp.isGround) name = '0';
    else if (labels.length > 0) name = labels[0];
    else {
      const first = [...grp.pins].sort((a, b) => (refOf(a.componentId) + ':' + a.pinId).localeCompare(refOf(b.componentId) + ':' + b.pinId))[0];
      name = first ? `N_${refOf(first.componentId)}_${first.pinId}` : `N_J_${grp.junctions.sort()[0]}`;
    }
    name = name.replace(/\+/g, 'P').replace(/-/g, 'M').replace(/[^A-Za-z0-9_.]/g, '_');
    let unique = name;
    let k = 2;
    while (used.has(unique)) unique = `${name}_${k++}`;
    used.add(unique);
    if (labels.length > 1) conflicts.push({ net: unique, labels });
    const net: Net = { name: unique, pins: grp.pins, junctions: grp.junctions, wires: grp.wires, isGround: grp.isGround, labels };
    nets.push(net);
    byName.set(unique, net);
    grp.pins.forEach((pp) => pinNet.set(pinKey(pp.componentId, pp.pinId), unique));
    grp.wires.forEach((w) => wireNet.set(w, unique));
    grp.junctions.forEach((j) => junctionNet.set(j, unique));
  }
  nets.sort((a, b) => a.name.localeCompare(b.name));
  return { nets, byName, pinNet, wireNet, junctionNet, conflicts };
}

function splitPinKey(key: string): [string, string, string] {
  const first = key.indexOf(':');
  const second = key.indexOf(':', first + 1);
  return ['p', key.slice(first + 1, second), key.slice(second + 1)];
}

export function endpointExists(project: Project, e: Endpoint): boolean {
  if (e.kind === 'junction') return !!project.junctions[e.junctionId];
  const c = project.components[e.componentId];
  if (!c) return false;
  try {
    return getDef(c.type).pins.some((p) => p.id === e.pinId);
  } catch {
    return false;
  }
}

/** Number of wire ends attached to each pin / junction key. */
export function attachmentCounts(project: Project): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of Object.values(project.wires)) {
    for (const e of [w.a, w.b]) {
      const k = endpointKey(e);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}
