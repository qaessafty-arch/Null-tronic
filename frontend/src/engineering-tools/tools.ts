import { getDef } from '../component-library/library';
import { buildNetlist, pinKey } from '../project-model/connectivity';
import { makeComponent } from '../project-model/factory';
import { componentPrimitives, dist, endpointPosition, pinWorldPosition, snapPoint, wirePolyline } from '../project-model/geometry';
import { newId } from '../project-model/ids';
import { makeRoom, planCircuit } from '../project-model/installation';
import { addAnnotations, addCircuit, addComponent, addRoom, addWire, moveEntities, splitWire, updateCable, updateWire } from '../project-model/operations';
import type { Endpoint, Id, Project, Vec2, Wire } from '../project-model/types';
import { calculateCircuit } from '../calculations/installation';
import { scenePrimitives } from '../drawing/scene';
import { rect, type Primitive } from '../drawing/primitives';
import { execute, stage } from '../history/history';
import { log, store, type Preview, type ToolId } from '../state/store';
import { registerTool, getAdapter, type InputSource, type PointerInput, type Tool } from '../input-system/input';
import { entitiesInRect, hitPin, hitTest, type Hit } from './hit';

// ---------------------------------------------------------------- shared helpers

const P = () => store.get().project;
const grid = () => P().settings.gridMm;
export const snapW = (p: Vec2): Vec2 => (P().settings.snapToGrid ? snapPoint(p, grid()) : p);
const setPreview = (pv: Preview | null) => store.set({ preview: pv });

export function setTool(tool: ToolId, placeType: string | null = null): void {
  const s = store.get();
  for (const t of allTools) t.reset?.();
  store.set({ tool, placeType: placeType ?? (tool === 'place' ? s.placeType : null), preview: s.pending ? s.pending.preview : null });
}

/**
 * Completes an operation: invalid → refused (stays previewed); hand input, warnings or the
 * "always confirm" setting → staged for explicit confirmation; otherwise committed immediately.
 */
export function finishOperation(label: string, apply: (p: Project) => Project, preview: Preview, source: InputSource, after?: (p: Project) => void): void {
  if (preview.status === 'invalid') {
    log('warn', `${label} refused: ${preview.messages.join('; ')}`);
    setPreview(preview);
    return;
  }
  if (source === 'hand' || source === 'assistant' || preview.status === 'warning' || P().settings.alwaysConfirm) {
    stage({ label, apply, preview, after });
    if (preview.status === 'warning') log('warn', `${label}: ${preview.messages.join('; ')} — confirm (Enter / fist) or reject (Esc / V-sign).`);
    else log('info', `${label}: preview ready — confirm (Enter / fist) or reject (Esc / V-sign).`);
    return;
  }
  setPreview(null);
  if (execute(label, apply) && after) after(store.get().project);
}

const textPrim = (at: Vec2, s: string, size: number): Primitive => ({ k: 'text', p: at, text: s, size, anchor: 'start', baseline: 'bottom' });

function fmtLen(mm: number): string {
  const u = P().settings.displayUnit;
  return u === 'm' ? `${(mm / 1000).toFixed(2)} m` : u === 'cm' ? `${(mm / 10).toFixed(1)} cm` : `${mm.toFixed(1)} mm`;
}

const labelSize = () => (P().type === 'installation' ? 160 : 2);

// ---------------------------------------------------------------- select / move

class SelectTool implements Tool {
  id = 'select';
  private down: { at: Vec2; hit: Hit | null; moved: boolean; additive: boolean } | null = null;

  reset() {
    this.down = null;
  }

  pointer(e: PointerInput) {
    const s = store.get();
    const project = s.project;
    if (e.phase === 'move' && !this.down) {
      const h = hitTest(project, e.world, e.tolerance, { pins: true, selected: new Set(s.selection) });
      store.set({ hover: { id: h?.id ?? null, pin: h?.kind === 'pin' ? { componentId: h.id, pinId: h.pinId! } : null } });
      return;
    }
    if (e.phase === 'down') {
      if (s.pending) return;
      const hit = hitTest(project, e.world, e.tolerance, { selected: new Set(s.selection) });
      this.down = { at: e.world, hit, moved: false, additive: e.shift || e.ctrl };
      if (hit && hit.kind !== 'cable-vertex' && hit.kind !== 'wire-vertex') {
        const id = hit.id;
        if (this.down.additive) store.set({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] });
        else if (!s.selection.includes(id)) store.set({ selection: [id] });
      }
      return;
    }
    if (!this.down) return;
    const d = this.down;
    const delta = { x: e.world.x - d.at.x, y: e.world.y - d.at.y };
    if (e.phase === 'move') {
      if (!d.moved && Math.hypot(delta.x, delta.y) < e.tolerance * 0.6) return;
      d.moved = true;
      if (!d.hit) {
        setPreview({ prims: [rect(Math.min(d.at.x, e.world.x), Math.min(d.at.y, e.world.y), Math.abs(delta.x), Math.abs(delta.y), { dash: [grid(), grid() / 2], w: 0 })], status: 'valid', messages: [] });
        return;
      }
      if (d.hit.kind === 'cable-vertex' || d.hit.kind === 'wire-vertex') {
        const q = snapW(e.world);
        setPreview({ prims: [{ k: 'circle', c: q, r: e.tolerance * 0.5 }], status: 'valid', messages: [], label: { at: q, text: `${fmtLen(q.x)}, ${fmtLen(q.y)}` } });
        return;
      }
      const sd = this.snappedDelta(delta);
      const moved = moveEntities(project, store.get().selection, sd);
      const sel = new Set(store.get().selection);
      const prims = scenePrimitives(moved, { labels: false }).filter((en) => sel.has(en.id) || (en.kind === 'wire' && touches(moved, en.id, sel))).flatMap((en) => en.prims);
      setPreview({ prims, status: 'valid', messages: [], label: { at: e.world, text: `Δ ${fmtLen(sd.x)}, ${fmtLen(sd.y)}` } });
      return;
    }
    // up
    this.down = null;
    setPreview(null);
    if (!d.moved) {
      if (!d.hit && !d.additive) store.set({ selection: [] });
      return;
    }
    if (!d.hit) {
      const ids = entitiesInRect(project, d.at, e.world);
      store.set({ selection: d.additive ? [...new Set([...s.selection, ...ids])] : ids });
      return;
    }
    if (d.hit.kind === 'cable-vertex') {
      const cb = project.cables[d.hit.id];
      const q = snapW(e.world);
      const idx = d.hit.index!;
      execute('Edit cable route', (p) => updateCable(p, cb.id, { path: cb.path.map((v, i) => (i === idx ? q : v)) }));
      return;
    }
    if (d.hit.kind === 'wire-vertex') {
      const w = project.wires[d.hit.id];
      const q = snapW(e.world);
      const idx = d.hit.index!;
      execute('Edit wire route', (p) => updateWire(p, w.id, { vertices: w.vertices.map((v, i) => (i === idx ? q : v)) }));
      return;
    }
    const sd = this.snappedDelta(delta);
    if (sd.x === 0 && sd.y === 0) return;
    const sel = store.get().selection;
    execute(`Move ${sel.length} item(s)`, (p) => moveEntities(p, sel, sd));
  }

  private snappedDelta(d: Vec2): Vec2 {
    if (!P().settings.snapToGrid) return d;
    const g = grid();
    return { x: Math.round(d.x / g) * g, y: Math.round(d.y / g) * g };
  }

  command(name: string): boolean {
    if (name === 'cancel' && this.down) {
      this.down = null;
      setPreview(null);
      return true;
    }
    return false;
  }
}

function touches(p: Project, wireId: Id, sel: Set<Id>): boolean {
  const w = p.wires[wireId];
  if (!w) return false;
  const ref = (e: Endpoint) => (e.kind === 'pin' ? e.componentId : e.junctionId);
  return sel.has(ref(w.a)) || sel.has(ref(w.b));
}

// ---------------------------------------------------------------- place component

class PlaceTool implements Tool {
  id = 'place';
  private last: Vec2 | null = null;
  reset() {
    this.last = null;
  }

  private ghost(at: Vec2) {
    const s = store.get();
    if (!s.placeType) return null;
    const c = makeComponent(s.project, s.placeType, snapW(at), { rotation: s.placeRotation });
    return c;
  }

  private validate(project: Project, type: string, at: Vec2): Preview {
    const def = getDef(type);
    const c = makeComponent(project, type, at, { rotation: store.get().placeRotation });
    const msgs: string[] = [];
    let status: Preview['status'] = 'valid';
    if (!def.modes.includes(project.type)) {
      status = 'invalid';
      msgs.push(`${def.name} is not available in ${project.type} projects`);
    }
    // pins landing on existing pins connect implicitly — warn
    for (const pd of def.pins) {
      const q = pinWorldPosition(c, pd.id);
      const h = hitPin(project, q, 1e-3);
      if (h) {
        if (status === 'valid') status = 'warning';
        msgs.push(`pin ${pd.name} will connect to ${project.components[h.id].ref}.${h.pinId}`);
      }
    }
    return { prims: componentPrimitives(c), status, messages: msgs, label: { at: { x: at.x, y: at.y }, text: `${c.ref}` } };
  }

  pointer(e: PointerInput) {
    const s = store.get();
    if (!s.placeType || s.pending) return;
    const at = snapW(e.world);
    this.last = at;
    if (e.phase === 'move') {
      setPreview(this.validate(s.project, s.placeType, at));
      return;
    }
    const commitPhase = e.source === 'hand' ? 'up' : 'down';
    if (e.phase !== commitPhase) return;
    const type = s.placeType;
    const pv = this.validate(s.project, type, at);
    const rotation = s.placeRotation;
    let createdId: Id | null = null;
    finishOperation(
      `Place ${getDef(type).name}`,
      (p) => {
        const c = makeComponent(p, type, at, { rotation });
        createdId = c.id;
        return addComponent(p, c);
      },
      pv,
      e.source,
      () => createdId && store.set({ selection: [createdId] }),
    );
  }

  command(name: string): boolean {
    if (name === 'rotate') {
      store.set((s) => ({ placeRotation: (((s.placeRotation + 90) % 360) as 0 | 90 | 180 | 270) }));
      if (this.last) this.pointer({ phase: 'move', world: this.last, source: 'mouse', button: 0, shift: false, ctrl: false, alt: false, tolerance: 1, detail: 0 });
      return true;
    }
    if (name === 'cancel' && !store.get().pending) {
      setTool('select');
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- wire

type Target =
  | { type: 'pin'; componentId: Id; pinId: string; pos: Vec2 }
  | { type: 'junction'; id: Id; pos: Vec2 }
  | { type: 'wire'; wireId: Id; pos: Vec2 }
  | { type: 'free'; pos: Vec2 };

function resolveTarget(project: Project, at: Vec2, tol: number): Target {
  const pin = hitPin(project, at, tol);
  if (pin) return { type: 'pin', componentId: pin.id, pinId: pin.pinId!, pos: pin.point };
  const h = hitTest(project, at, tol);
  if (h?.kind === 'junction') return { type: 'junction', id: h.id, pos: h.point };
  if (h?.kind === 'wire') return { type: 'wire', wireId: h.id, pos: P().settings.snapToGrid ? snapOnto(h.point, project, h.id) : h.point };
  return { type: 'free', pos: snapW(at) };
}

function snapOnto(q: Vec2, project: Project, wireId: Id): Vec2 {
  // snap along the wire to the grid where possible
  const s = snapW(q);
  const pts = wirePolyline(project, project.wires[wireId]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(q.y - a.y) < 1e-6) return { x: s.x, y: a.y };
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(q.x - a.x) < 1e-6) return { x: a.x, y: s.y };
  }
  return q;
}

class WireTool implements Tool {
  id = 'wire';
  private start: Target | null = null;
  private vertices: Vec2[] = [];
  private lastTarget: Target | null = null;
  private downAt: Vec2 | null = null;

  reset() {
    this.start = null;
    this.vertices = [];
    this.lastTarget = null;
    this.downAt = null;
    setPreview(store.get().pending?.preview ?? null);
  }

  private corner(from: Vec2, to: Vec2): Vec2[] {
    if (Math.abs(from.x - to.x) < 1e-9 || Math.abs(from.y - to.y) < 1e-9) return [];
    return [{ x: to.x, y: from.y }];
  }

  private path(end: Vec2): Vec2[] {
    if (!this.start) return [];
    const pts = [this.start.pos, ...this.vertices];
    const last = pts[pts.length - 1];
    return [...pts, ...this.corner(last, end), end];
  }

  private validate(end: Target): Preview {
    const project = P();
    const pts = this.path(end.pos);
    const msgs: string[] = [];
    let status: Preview['status'] = 'valid';
    const s = this.start!;
    if (s.type === 'pin' && end.type === 'pin' && s.componentId === end.componentId && s.pinId === end.pinId) {
      return { prims: [{ k: 'poly', pts }], status: 'invalid', messages: ['a wire cannot start and end on the same pin'] };
    }
    if (pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6 && this.vertices.length === 0) return { prims: [], status: 'invalid', messages: ['zero-length wire'] };
    const netlist = buildNetlist(project);
    const netOf = (t: Target): string | null => {
      if (t.type === 'pin') return netlist.pinNet.get(pinKey(t.componentId, t.pinId)) ?? null;
      if (t.type === 'junction') return netlist.junctionNet.get(t.id) ?? null;
      if (t.type === 'wire') return netlist.wireNet.get(t.wireId) ?? null;
      return null;
    };
    const na = netOf(s);
    const nb = netOf(end);
    if (na && nb && na === nb) {
      status = 'warning';
      msgs.push(`already connected (net ${na}) — redundant wire`);
    } else if (na && nb) {
      for (const c of Object.values(project.components)) {
        if (c.type !== 'vdc' && c.type !== 'vac' && c.type !== 'ammeter') continue;
        const p1 = netlist.pinNet.get(pinKey(c.id, '+'));
        const p2 = netlist.pinNet.get(pinKey(c.id, '-'));
        if ((p1 === na && p2 === nb) || (p1 === nb && p2 === na)) {
          status = 'warning';
          msgs.push(c.type === 'ammeter' ? `bypasses ammeter ${c.ref}` : `short-circuits source ${c.ref}`);
        }
      }
      const ga = netlist.byName.get(na)?.isGround;
      const gb = netlist.byName.get(nb)?.isGround;
      if ((ga || gb) && !(ga && gb)) msgs.push(`connects net ${ga ? nb : na} to ground`);
    }
    if (end.type === 'free') {
      if (status === 'valid') status = 'warning';
      msgs.push('wire ends in free space (open wire end)');
    }
    const len = pts.reduce((a, q, i) => (i ? a + dist(pts[i - 1], q) : 0), 0);
    return { prims: [{ k: 'poly', pts, w: 0.35 }, ...(end.type !== 'free' ? [{ k: 'circle', c: end.pos, r: 0.9 } as Primitive] : [])], status, messages: msgs, label: { at: end.pos, text: `${fmtLen(len)}${na && nb && na !== nb ? `  ${na} ⇄ ${nb}` : ''}` } };
  }

  private finish(end: Target, source: InputSource) {
    if (!this.start) return;
    const start = this.start;
    const vertices = [...this.vertices, ...this.corner(this.vertices.length ? this.vertices[this.vertices.length - 1] : start.pos, end.pos)];
    const pv = this.validate(end);
    const apply = (p0: Project): Project => {
      let p = p0;
      const junctions: { id: Id; position: Vec2 }[] = [];
      const toEndpoint = (t: Target): Endpoint => {
        if (t.type === 'pin') return { kind: 'pin', componentId: t.componentId, pinId: t.pinId };
        if (t.type === 'junction') return { kind: 'junction', junctionId: t.id };
        if (t.type === 'wire') {
          const w = p.wires[t.wireId];
          if (!w) throw new Error('wire no longer exists');
          const r = splitWire(p, t.wireId, t.pos, wirePolyline(p, w));
          p = r.project;
          return { kind: 'junction', junctionId: r.junctionId };
        }
        const j = { id: newId('jn'), position: t.pos };
        junctions.push(j);
        return { kind: 'junction', junctionId: j.id };
      };
      const a = toEndpoint(start);
      const b = toEndpoint(end.type === 'wire' && start.type === 'wire' && end.wireId === start.wireId ? { type: 'free', pos: end.pos } : end);
      const w: Wire = { id: newId('w'), a, b, vertices, role: 'auto', layer: 'wires' };
      return addWire(p, w, junctions);
    };
    finishOperation('Add wire', apply, pv, source);
    this.start = null;
    this.vertices = [];
    if (pv.status === 'invalid') return;
  }

  pointer(e: PointerInput) {
    if (store.get().pending) return;
    const project = P();
    const target = resolveTarget(project, e.world, e.tolerance);
    this.lastTarget = target;
    if (e.phase === 'move') {
      store.set({ hover: { id: target.type === 'pin' ? target.componentId : null, pin: target.type === 'pin' ? { componentId: target.componentId, pinId: target.pinId } : null } });
      if (this.start) setPreview(this.validate(target));
      else setPreview({ prims: [{ k: 'circle', c: target.pos, r: target.type === 'free' ? 0.4 : 0.9 }], status: 'valid', messages: [] });
      return;
    }
    if (e.phase === 'down') {
      this.downAt = e.world;
      if (!this.start) {
        this.start = target;
        this.vertices = [];
        setPreview(this.validate(target));
        return;
      }
      if (target.type !== 'free' || e.detail >= 2) {
        this.finish(target, e.source);
        return;
      }
      const last = this.vertices.length ? this.vertices[this.vertices.length - 1] : this.start.pos;
      this.vertices.push(...this.corner(last, target.pos), target.pos);
      return;
    }
    // up: press-drag-release completes a wire (natural for pinch gestures)
    if (this.start && this.downAt && dist(this.downAt, e.world) > e.tolerance * 2) {
      if (this.vertices.length === 0 || e.source === 'hand') this.finish(target, e.source);
    }
    this.downAt = null;
  }

  command(name: string, source: InputSource): boolean {
    if (store.get().pending) return false;
    if (name === 'confirm' && this.start && this.lastTarget) {
      this.finish(this.lastTarget, source);
      return true;
    }
    if (name === 'cancel' || name === 'reject') {
      if (this.start) {
        this.reset();
        return true;
      }
      if (name === 'cancel') {
        setTool('select');
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------- rooms

class RoomTool implements Tool {
  id = 'room';
  private start: Vec2 | null = null;
  reset() {
    this.start = null;
  }
  private preview(a: Vec2, b: Vec2): Preview {
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const msgs: string[] = [];
    let status: Preview['status'] = w >= 500 && h >= 500 ? 'valid' : 'invalid';
    if (status === 'invalid') msgs.push('rooms must be at least 0.5 m × 0.5 m');
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    for (const r of Object.values(P().rooms)) {
      const xs = r.polygon.map((q) => q.x);
      const ys = r.polygon.map((q) => q.y);
      const overlapX = Math.min(minX + w, Math.max(...xs)) - Math.max(minX, Math.min(...xs));
      const overlapY = Math.min(minY + h, Math.max(...ys)) - Math.max(minY, Math.min(...ys));
      if (overlapX > 1 && overlapY > 1 && status === 'valid') {
        status = 'warning';
        msgs.push(`overlaps ${r.name}`);
      }
    }
    return { prims: [rect(minX, minY, w, h, { w: 150 })], status, messages: msgs, label: { at: b, text: `${fmtLen(w)} × ${fmtLen(h)} (${((w * h) / 1e6).toFixed(1)} m²)` } };
  }
  pointer(e: PointerInput) {
    if (store.get().pending) return;
    if (P().type !== 'installation') {
      if (e.phase === 'down') log('warn', 'Rooms are available in installation projects.');
      return;
    }
    const q = snapW(e.world);
    if (e.phase === 'down') {
      this.start = q;
      return;
    }
    if (!this.start) return;
    if (e.phase === 'move') {
      setPreview(this.preview(this.start, q));
      return;
    }
    const a = this.start;
    this.start = null;
    const pv = this.preview(a, q);
    const n = Object.keys(P().rooms).length + 1;
    const room = makeRoom(`Room ${n}`, Math.min(a.x, q.x), Math.min(a.y, q.y), Math.abs(q.x - a.x), Math.abs(q.y - a.y));
    finishOperation('Add room', (p) => addRoom(p, room), pv, e.source, () => store.set({ selection: [room.id] }));
  }
  command(name: string) {
    if (name === 'cancel' && this.start) {
      this.start = null;
      setPreview(null);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- installation circuit

class CircuitTool implements Tool {
  id = 'circuit';
  private board: Id | null = null;
  private devices: Id[] = [];
  reset() {
    this.board = null;
    this.devices = [];
  }

  private preview(): Preview {
    const project = P();
    if (!this.board) return { prims: [], status: 'invalid', messages: ['click a distribution board first'] };
    const plan = planCircuit(project, this.board, this.devices);
    const tmp = addCircuit(project, plan.circuit, plan.cables);
    const calc = calculateCircuit(tmp, tmp.circuits[plan.circuit.id]);
    const msgs: string[] = [];
    let status: Preview['status'] = this.devices.length ? 'valid' : 'invalid';
    if (!this.devices.length) msgs.push('add at least one device');
    const used = new Map<Id, string>();
    for (const c of Object.values(project.circuits)) for (const d of c.deviceIds) used.set(d, c.name);
    for (const d of this.devices) {
      if (used.has(d)) {
        status = 'invalid';
        msgs.push(`${project.components[d].ref} already belongs to ${used.get(d)}`);
      }
    }
    if (status === 'valid' && calc.findings.some((f) => f.status === 'error')) {
      status = 'warning';
      msgs.push(...calc.findings.filter((f) => f.status === 'error').map((f) => f.message));
    }
    const prims: Primitive[] = plan.cables.map((c) => ({ k: 'poly', pts: c.path, w: 40, dash: [150, 80] }));
    const at = project.components[this.devices[this.devices.length - 1] ?? this.board].position;
    return {
      prims,
      status,
      messages: msgs,
      label: { at, text: `${plan.circuit.name}: ${this.devices.length} device(s), Ib ${calc.ibA.toFixed(2)} A, L ${calc.totalLengthM.toFixed(1)} m, ΔU ${calc.dropPct.toFixed(2)} %` },
    };
  }

  pointer(e: PointerInput) {
    const s = store.get();
    if (s.pending) return;
    if (s.project.type !== 'installation') {
      if (e.phase === 'down') log('warn', 'Circuits are created in installation projects.');
      return;
    }
    const commitPhase = e.source === 'hand' ? 'up' : 'down';
    if (e.phase === 'move') {
      const h = hitTest(s.project, e.world, e.tolerance);
      store.set({ hover: { id: h?.kind === 'component' ? h.id : null, pin: null } });
      if (this.board) setPreview(this.preview());
      return;
    }
    if (e.phase !== commitPhase) return;
    const h = hitTest(s.project, e.world, e.tolerance);
    if (!h || h.kind !== 'component') return;
    const c = s.project.components[h.id];
    const def = getDef(c.type);
    if (!this.board) {
      if (!def.isBoard) {
        log('warn', 'Start the circuit at a distribution board.');
        return;
      }
      this.board = c.id;
      log('info', `Circuit from ${c.ref}: now click devices in feed order; Enter / fist / click the board again to finish.`);
      setPreview(this.preview());
      return;
    }
    if (c.id === this.board || e.detail >= 2) {
      this.finish(e.source);
      return;
    }
    if (def.isBoard) {
      log('warn', 'A circuit is fed from one board.');
      return;
    }
    if (!this.devices.includes(c.id)) this.devices.push(c.id);
    setPreview(this.preview());
  }

  private finish(source: InputSource) {
    if (!this.board) return;
    const pv = this.preview();
    const board = this.board;
    const devices = [...this.devices];
    let cid: Id | null = null;
    finishOperation(
      'Create circuit',
      (p) => {
        const plan = planCircuit(p, board, devices);
        cid = plan.circuit.id;
        return addCircuit(p, plan.circuit, plan.cables);
      },
      pv,
      source === 'mouse' ? 'assistant' : source, // circuits are always previewed for confirmation
      () => cid && store.set({ selection: [cid] }),
    );
    if (pv.status !== 'invalid') this.reset();
  }

  command(name: string, source: InputSource) {
    if (store.get().pending) return false;
    if (name === 'confirm' && this.board) {
      this.finish(source);
      return true;
    }
    if ((name === 'cancel' || name === 'reject') && this.board) {
      this.reset();
      setPreview(null);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- dimension / measure / text

class TwoPointTool implements Tool {
  private a: Vec2 | null = null;
  constructor(public id: string, private commit: boolean) {}
  reset() {
    this.a = null;
  }
  pointer(e: PointerInput) {
    if (store.get().pending) return;
    const pin = hitPin(P(), e.world, e.tolerance);
    const q = pin ? pin.point : snapW(e.world);
    const commitPhase = e.source === 'hand' ? 'up' : 'down';
    if (e.phase === 'move') {
      if (this.a) {
        const len = dist(this.a, q);
        setPreview({ prims: [{ k: 'line', a: this.a, b: q, w: 0.2, dash: [1, 1] }], status: 'valid', messages: [], label: { at: q, text: fmtLen(len) } });
      }
      return;
    }
    if (e.phase !== commitPhase) return;
    if (!this.a) {
      this.a = q;
      return;
    }
    const a = this.a;
    this.a = null;
    if (!this.commit) {
      log('info', `Measured distance: ${fmtLen(dist(a, q))} (Δx ${fmtLen(q.x - a.x)}, Δy ${fmtLen(q.y - a.y)})`, true);
      return;
    }
    if (dist(a, q) < 1e-6) return;
    const ann = { id: newId('ann'), kind: 'dimension' as const, points: [a, q], textHeight: labelSize(), layer: 'annotations' };
    finishOperation('Add dimension', (p) => addAnnotations(p, [ann]), { prims: [{ k: 'line', a, b: q }], status: 'valid', messages: [] }, e.source);
  }
  command(name: string) {
    if (name === 'cancel' && this.a) {
      this.a = null;
      setPreview(null);
      return true;
    }
    return false;
  }
}

class TextTool implements Tool {
  id = 'text';
  pointer(e: PointerInput) {
    if (store.get().pending) return;
    const commitPhase = e.source === 'hand' ? 'up' : 'down';
    if (e.phase !== commitPhase) return;
    const q = snapW(e.world);
    const content = e.source === 'mouse' && typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt('Annotation text', 'Note') : 'Note';
    if (!content) return;
    const ann = { id: newId('ann'), kind: 'text' as const, points: [q], text: content, textHeight: labelSize() * 1.2, layer: 'annotations' };
    finishOperation('Add text', (p) => addAnnotations(p, [ann]), { prims: [textPrim(q, content, ann.textHeight)], status: 'valid', messages: [] }, e.source, () => store.set({ selection: [ann.id] }));
  }
}

class PanTool implements Tool {
  id = 'pan';
  private last: Vec2 | null = null;
  pointer(e: PointerInput) {
    const a = getAdapter('2d');
    if (!a) return;
    if (e.phase === 'down') this.last = e.world;
    else if (e.phase === 'up') this.last = null;
    else if (this.last) {
      const d = { x: e.world.x - this.last.x, y: e.world.y - this.last.y };
      // world delta → shift the camera opposite to the motion
      const o = a.normalizedToWorld(0, 0)!;
      const o2 = a.normalizedToWorld(1, 1)!;
      a.panBy(-d.x / (o2.x - o.x), -d.y / (o2.y - o.y));
    }
  }
}

const allTools: Tool[] = [new SelectTool(), new PlaceTool(), new WireTool(), new RoomTool(), new CircuitTool(), new TwoPointTool('dimension', true), new TwoPointTool('measure', false), new TextTool(), new PanTool()];
export function registerAllTools(): void {
  allTools.forEach(registerTool);
}
export const _toolsForTest = allTools;
export { endpointPosition };
