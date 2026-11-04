import { getDef } from '../component-library/library';
import { nextRef } from './factory';
import { pinWorldPosition, pointSegment } from './geometry';
import { newId } from './ids';
import type {
  Annotation,
  Cable,
  Circuit,
  ComponentInstance,
  DrawingSheet,
  Endpoint,
  Id,
  Junction,
  Project,
  ProjectMeta,
  ProjectSettings,
  PropertyValue,
  Room,
  Rotation,
  Vec2,
  Wire,
} from './types';

/**
 * Pure, immutable model operations. Every edit of the engineering model goes through one of
 * these functions (wrapped in a history command), regardless of whether it originated from
 * mouse, keyboard, hand tracking or the assistant.
 */

const touch = (p: Project): Project => ({ ...p, meta: { ...p.meta, modifiedAt: new Date().toISOString() } });

export function addComponent(p: Project, c: ComponentInstance): Project {
  return touch({ ...p, components: { ...p.components, [c.id]: c } });
}

export function updateComponent(p: Project, id: Id, patch: Partial<ComponentInstance>): Project {
  const c = p.components[id];
  if (!c) return p;
  return touch({ ...p, components: { ...p.components, [id]: { ...c, ...patch } } });
}

export function setProperty(p: Project, id: Id, key: string, value: PropertyValue): Project {
  const c = p.components[id];
  if (!c) return p;
  return updateComponent(p, id, { properties: { ...c.properties, [key]: value } });
}

export function addWire(p: Project, w: Wire, junctions: Junction[] = []): Project {
  const js = { ...p.junctions };
  junctions.forEach((j) => (js[j.id] = j));
  return touch({ ...p, wires: { ...p.wires, [w.id]: w }, junctions: js });
}

export function updateWire(p: Project, id: Id, patch: Partial<Wire>): Project {
  const w = p.wires[id];
  if (!w) return p;
  return touch({ ...p, wires: { ...p.wires, [id]: { ...w, ...patch } } });
}

/**
 * Split a wire at a point, inserting a junction. Returns the new project and junction id.
 * The point is projected onto the wire polyline.
 */
export function splitWire(p: Project, wireId: Id, at: Vec2, polyline: Vec2[]): { project: Project; junctionId: Id } {
  const w = p.wires[wireId];
  if (!w || polyline.length < 2) throw new Error('Cannot split wire');
  let best = { d: Infinity, seg: 0, q: at };
  for (let i = 1; i < polyline.length; i++) {
    const r = pointSegment(at, polyline[i - 1], polyline[i]);
    if (r.d < best.d) best = { d: r.d, seg: i - 1, q: r.q };
  }
  const j: Junction = { id: newId('jn'), position: best.q };
  // polyline = [a, ...vertices, b]; segment index s spans polyline[s]..polyline[s+1]
  const verts = w.vertices;
  const firstVerts = verts.slice(0, best.seg);
  const secondVerts = verts.slice(best.seg);
  const w1: Wire = { ...w, id: newId('w'), b: { kind: 'junction', junctionId: j.id }, vertices: firstVerts };
  const w2: Wire = { ...w, id: newId('w'), a: { kind: 'junction', junctionId: j.id }, vertices: secondVerts };
  const wires = { ...p.wires };
  delete wires[wireId];
  wires[w1.id] = w1;
  wires[w2.id] = w2;
  return { project: touch({ ...p, wires, junctions: { ...p.junctions, [j.id]: j } }), junctionId: j.id };
}

const endpointRefs = (e: Endpoint, id: Id) => (e.kind === 'pin' ? e.componentId === id : e.junctionId === id);

/** Delete entities and everything that depends on them (attached wires, cables, circuit membership). */
export function removeEntities(p: Project, ids: Iterable<Id>): Project {
  const del = new Set(ids);
  const components = { ...p.components };
  const wires = { ...p.wires };
  const junctions = { ...p.junctions };
  const rooms = { ...p.rooms };
  const annotations = { ...p.annotations };
  let circuits = { ...p.circuits };
  const cables = { ...p.cables };

  for (const id of del) {
    delete components[id];
    delete junctions[id];
    delete wires[id];
    delete rooms[id];
    delete annotations[id];
    if (circuits[id]) {
      for (const cb of Object.values(cables)) if (cb.circuitId === id) delete cables[cb.id];
      delete circuits[id];
    }
    delete cables[id];
  }
  // wires attached to deleted components / junctions
  for (const w of Object.values(wires)) {
    if ([...del].some((id) => endpointRefs(w.a, id) || endpointRefs(w.b, id))) delete wires[w.id];
  }
  // orphan junctions (no wires left)
  const used = new Set<Id>();
  for (const w of Object.values(wires)) {
    if (w.a.kind === 'junction') used.add(w.a.junctionId);
    if (w.b.kind === 'junction') used.add(w.b.junctionId);
  }
  for (const j of Object.keys(junctions)) if (!used.has(j)) delete junctions[j];

  // circuits: drop removed devices / boards, rebuild cable chain consistency
  const nextCircuits: Record<Id, Circuit> = {};
  for (const c of Object.values(circuits)) {
    if (!components[c.boardId]) {
      for (const cb of Object.values(cables)) if (cb.circuitId === c.id) delete cables[cb.id];
      continue;
    }
    const deviceIds = c.deviceIds.filter((d) => components[d]);
    nextCircuits[c.id] = deviceIds.length === c.deviceIds.length ? c : { ...c, deviceIds };
  }
  circuits = nextCircuits;
  for (const cb of Object.values(cables)) {
    if (!components[cb.fromId] || !components[cb.toId] || !circuits[cb.circuitId]) delete cables[cb.id];
  }
  return touch({ ...p, components, wires, junctions, rooms, annotations, circuits, cables });
}

/** Translate selected entities. Wires follow pins automatically; cable ends follow devices. */
export function moveEntities(p: Project, ids: Iterable<Id>, d: Vec2): Project {
  const set = new Set(ids);
  const components = { ...p.components };
  const junctions = { ...p.junctions };
  const wires = { ...p.wires };
  const rooms = { ...p.rooms };
  const annotations = { ...p.annotations };
  const cables = { ...p.cables };
  const mv = (v: Vec2): Vec2 => ({ x: v.x + d.x, y: v.y + d.y });
  for (const id of set) {
    if (components[id]) components[id] = { ...components[id], position: mv(components[id].position) };
    if (junctions[id]) junctions[id] = { ...junctions[id], position: mv(junctions[id].position) };
    if (rooms[id]) rooms[id] = { ...rooms[id], polygon: rooms[id].polygon.map(mv) };
    if (annotations[id]) annotations[id] = { ...annotations[id], points: annotations[id].points.map(mv) };
  }
  for (const w of Object.values(wires)) {
    const aMoves = w.a.kind === 'pin' ? set.has(w.a.componentId) : set.has(w.a.junctionId);
    const bMoves = w.b.kind === 'pin' ? set.has(w.b.componentId) : set.has(w.b.junctionId);
    if (set.has(w.id) || (aMoves && bMoves)) wires[w.id] = { ...w, vertices: w.vertices.map(mv) };
  }
  for (const cb of Object.values(cables)) {
    const fromMoves = set.has(cb.fromId);
    const toMoves = set.has(cb.toId);
    if (fromMoves && toMoves) cables[cb.id] = { ...cb, path: cb.path.map(mv) };
    else if (fromMoves || toMoves) cables[cb.id] = { ...cb, path: moveCableEnd(cb.path, fromMoves ? 0 : cb.path.length - 1, d) };
  }
  return touch({ ...p, components, junctions, wires, rooms, annotations, cables });
}

/** Move one end of an orthogonal route while keeping the adjacent segment orthogonal. */
function moveCableEnd(path: Vec2[], index: number, d: Vec2): Vec2[] {
  const out = path.map((q) => ({ ...q }));
  const old = out[index];
  out[index] = { x: old.x + d.x, y: old.y + d.y };
  const ni = index === 0 ? 1 : out.length - 2;
  if (ni > 0 && ni < out.length - 1) {
    const n = out[ni];
    if (Math.abs(n.x - old.x) < 1e-6) n.x = out[index].x;
    else if (Math.abs(n.y - old.y) < 1e-6) n.y = out[index].y;
  }
  return out;
}

export function rotateComponents(p: Project, ids: Iterable<Id>, delta = 90): Project {
  let out = p;
  for (const id of ids) {
    const c = out.components[id];
    if (!c) continue;
    out = updateComponent(out, id, { rotation: (((c.rotation + delta) % 360) + 360) % 360 as Rotation });
  }
  return out;
}

export function mirrorComponents(p: Project, ids: Iterable<Id>): Project {
  let out = p;
  for (const id of ids) {
    const c = out.components[id];
    if (c) out = updateComponent(out, id, { mirror: !c.mirror });
  }
  return out;
}

/**
 * Duplicate components, junctions and the wires fully between them with an offset.
 * `source` may be another project snapshot (clipboard paste). Returns the new ids.
 */
export function duplicateEntities(p: Project, ids: Iterable<Id>, offset: Vec2, source: Project = p): { project: Project; newIds: Id[] } {
  const set = new Set(ids);
  let out = p;
  const map = new Map<Id, Id>();
  const newIds: Id[] = [];
  for (const id of set) {
    const c = source.components[id];
    if (!c) continue;
    const def = getDef(c.type);
    const copy: ComponentInstance = {
      ...c,
      id: newId('cmp'),
      ref: nextRef(out, def.refPrefix),
      position: { x: c.position.x + offset.x, y: c.position.y + offset.y },
      properties: { ...c.properties },
    };
    out = addComponent(out, copy);
    map.set(id, copy.id);
    newIds.push(copy.id);
  }
  const jmap = new Map<Id, Id>();
  for (const id of set) {
    const j = source.junctions[id];
    if (!j) continue;
    const nj: Junction = { id: newId('jn'), position: { x: j.position.x + offset.x, y: j.position.y + offset.y } };
    jmap.set(id, nj.id);
    out = { ...out, junctions: { ...out.junctions, [nj.id]: nj } };
    newIds.push(nj.id);
  }
  const remap = (e: Endpoint): Endpoint | null => {
    if (e.kind === 'pin') return map.has(e.componentId) ? { ...e, componentId: map.get(e.componentId)! } : null;
    return jmap.has(e.junctionId) ? { kind: 'junction', junctionId: jmap.get(e.junctionId)! } : null;
  };
  for (const w of Object.values(source.wires)) {
    const a = remap(w.a);
    const b = remap(w.b);
    if (!a || !b) continue;
    const nw: Wire = { ...w, id: newId('w'), a, b, vertices: w.vertices.map((v) => ({ x: v.x + offset.x, y: v.y + offset.y })) };
    out = addWire(out, nw);
    newIds.push(nw.id);
  }
  return { project: out, newIds };
}

export function addRoom(p: Project, r: Room): Project {
  return touch({ ...p, rooms: { ...p.rooms, [r.id]: r } });
}

export function updateRoom(p: Project, id: Id, patch: Partial<Room>): Project {
  const r = p.rooms[id];
  if (!r) return p;
  return touch({ ...p, rooms: { ...p.rooms, [id]: { ...r, ...patch } } });
}

export function addCircuit(p: Project, c: Circuit, cables: Cable[]): Project {
  const cb = { ...p.cables };
  cables.forEach((k) => (cb[k.id] = k));
  return touch({ ...p, circuits: { ...p.circuits, [c.id]: c }, cables: cb });
}

export function updateCircuit(p: Project, id: Id, patch: Partial<Circuit>): Project {
  const c = p.circuits[id];
  if (!c) return p;
  return touch({ ...p, circuits: { ...p.circuits, [id]: { ...c, ...patch } } });
}

export function updateCable(p: Project, id: Id, patch: Partial<Cable>): Project {
  const c = p.cables[id];
  if (!c) return p;
  return touch({ ...p, cables: { ...p.cables, [id]: { ...c, ...patch } } });
}

export function addAnnotations(p: Project, list: Annotation[]): Project {
  const a = { ...p.annotations };
  list.forEach((x) => (a[x.id] = x));
  return touch({ ...p, annotations: a });
}

export function updateSettings(p: Project, patch: Partial<ProjectSettings>): Project {
  return touch({ ...p, settings: { ...p.settings, ...patch } });
}

export function updateMeta(p: Project, patch: Partial<ProjectMeta>): Project {
  return touch({ ...p, meta: { ...p.meta, ...patch } });
}

export function updateSheet(p: Project, id: Id, patch: Partial<DrawingSheet>): Project {
  return touch({ ...p, sheets: p.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

export function addSheet(p: Project, s: DrawingSheet): Project {
  return touch({ ...p, sheets: [...p.sheets, s] });
}

export function setLayerVisibility(p: Project, name: string, visible: boolean): Project {
  return touch({ ...p, layers: p.layers.map((l) => (l.name === name ? { ...l, visible } : l)) });
}

/** Convenience used by examples, the assistant and importers: connect two pins with an orthogonal wire. */
export function connectPins(p: Project, a: { componentId: Id; pinId: string }, b: { componentId: Id; pinId: string }, vertices?: Vec2[]): Project {
  const ca = p.components[a.componentId];
  const cb = p.components[b.componentId];
  if (!ca || !cb) throw new Error('connectPins: unknown component');
  const pa = pinWorldPosition(ca, a.pinId);
  const pb = pinWorldPosition(cb, b.pinId);
  const verts = vertices ?? (Math.abs(pa.x - pb.x) > 1e-6 && Math.abs(pa.y - pb.y) > 1e-6 ? [{ x: pb.x, y: pa.y }] : []);
  const w: Wire = {
    id: newId('w'),
    a: { kind: 'pin', ...a },
    b: { kind: 'pin', ...b },
    vertices: verts,
    role: 'auto',
    layer: 'wires',
  };
  return addWire(p, w);
}
