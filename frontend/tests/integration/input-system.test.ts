import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { store, initialState } from '../../src/state/store';
import { registerAllTools, setTool } from '../../src/engineering-tools/tools';
import { installGlobalCommands } from '../../src/input-system/commands';
import { dispatchCommand, dispatchNormalizedPointer, dispatchPointer, registerAdapter, type InputSource } from '../../src/input-system/input';
import { loadProject, undo, redo } from '../../src/history/history';
import { createProject } from '../../src/project-model/factory';
import { pinWorldPosition } from '../../src/project-model/geometry';
import { buildNetlist, pinKey } from '../../src/project-model/connectivity';
import { buildModel } from '../../src/viewport-3d/models';
import { getDef } from '../../src/component-library/library';
import { sampleInstallation, EXAMPLES } from '../../src/education/examples';
import type { Vec2 } from '../../src/project-model/types';

registerAllTools();
installGlobalCommands();

const ptr = (phase: 'down' | 'move' | 'up', world: Vec2, source: InputSource = 'mouse') => dispatchPointer({ phase, world, source, button: 0, shift: false, ctrl: false, alt: false, tolerance: 1, detail: 1 });
const click = (w: Vec2, source: InputSource = 'mouse') => {
  ptr('move', w, source);
  ptr('down', w, source);
  ptr('up', w, source);
};

function fresh() {
  store.reset({ ...initialState, toasts: [], log: [] });
  loadProject(createProject('electronic', 'test'), 't.json');
}

/** Places V1 + R1 + GND and wires V1+ → R1.1 using the given input source. */
function buildWithSource(source: InputSource) {
  fresh();
  const placeAt = (type: string, at: Vec2) => {
    setTool('place', type);
    store.set({ placeType: type });
    if (source === 'hand') {
      ptr('move', at, 'hand');
      ptr('down', at, 'hand');
      ptr('up', at, 'hand');
      dispatchCommand('confirm', 'hand'); // fist
    } else click(at, 'mouse');
  };
  placeAt('vdc', { x: 0, y: 10 });
  placeAt('resistor', { x: 15, y: 5 });
  placeAt('ground', { x: 0, y: 20 });
  setTool('wire');
  if (source === 'hand') {
    // pinch on V1+, drag, release on R1.1, then confirm with a fist
    ptr('move', { x: 0, y: 5 }, 'hand');
    ptr('down', { x: 0, y: 5 }, 'hand');
    ptr('move', { x: 6, y: 5 }, 'hand');
    ptr('move', { x: 10, y: 5 }, 'hand');
    ptr('up', { x: 10, y: 5 }, 'hand');
    expect(store.get().pending?.label).toBe('Add wire');
    dispatchCommand('confirm', 'hand');
  } else {
    click({ x: 0, y: 5 });
    ptr('move', { x: 10, y: 5 });
    click({ x: 10, y: 5 });
  }
  return store.get().project;
}

describe('shared input system', () => {
  beforeEach(fresh);

  it('mouse and hand produce the same engineering model', () => {
    const viaMouse = buildWithSource('mouse');
    const viaHand = buildWithSource('hand');
    const shape = (p: typeof viaMouse) => ({
      comps: Object.values(p.components).map((c) => [c.type, c.ref, c.position]).sort(),
      nets: buildNetlist(p).nets.map((n) => n.pins.map((x) => `${p.components[x.componentId].ref}.${x.pinId}`).sort().join('|')).sort(),
    });
    expect(Object.keys(viaHand.components)).toHaveLength(3);
    expect(Object.keys(viaHand.wires)).toHaveLength(1);
    expect(shape(viaHand)).toEqual(shape(viaMouse));
  });

  it('hand operations are previewed and only committed on confirm; V-sign rejects', () => {
    setTool('place', 'resistor');
    store.set({ placeType: 'resistor' });
    ptr('down', { x: 0, y: 0 }, 'hand');
    ptr('up', { x: 0, y: 0 }, 'hand');
    expect(Object.keys(store.get().project.components)).toHaveLength(0);
    expect(store.get().pending).not.toBeNull();
    dispatchCommand('reject', 'hand');
    expect(store.get().pending).toBeNull();
    expect(Object.keys(store.get().project.components)).toHaveLength(0);
  });

  it('invalid wires are refused, not committed', () => {
    buildWithSource('mouse');
    const before = store.get().project;
    setTool('wire');
    click({ x: 0, y: 5 });
    click({ x: 0, y: 5 }); // same pin
    expect(store.get().project).toBe(before);
    expect(store.get().preview?.status).toBe('invalid');
  });

  it('a wire that shorts a source needs explicit confirmation', () => {
    buildWithSource('mouse');
    setTool('wire');
    click({ x: 0, y: 15 }); // V1−
    click({ x: 10, y: 5 }); // R1.1 which is on V1+ net
    const pend = store.get().pending;
    expect(pend?.preview.status).toBe('warning');
    expect(pend?.preview.messages.join(' ')).toMatch(/short-circuits source V1/);
  });

  it('normalised hand coordinates go through the viewport adapter', () => {
    const unreg = registerAdapter({ kind: '2d', normalizedToWorld: (x, y) => ({ x: x * 100, y: y * 50 }), tolerance: () => 1, zoomAt: () => {}, panBy: () => {} });
    setTool('place', 'resistor');
    store.set({ placeType: 'resistor' });
    dispatchNormalizedPointer('down', 0.2, 0.1);
    dispatchNormalizedPointer('up', 0.2, 0.1);
    dispatchCommand('confirm', 'hand');
    const c = Object.values(store.get().project.components)[0];
    expect(c.position).toEqual({ x: 20, y: 5 });
    unreg();
  });

  it('undo / redo restore exact model states', () => {
    const built = buildWithSource('mouse');
    dispatchCommand('undo');
    expect(Object.keys(store.get().project.wires)).toHaveLength(0);
    undo();
    undo();
    expect(Object.keys(store.get().project.components)).toHaveLength(1);
    redo();
    redo();
    redo();
    expect(store.get().project).toBe(built);
  });

  it('moving a component keeps wires attached to its pins', () => {
    buildWithSource('mouse');
    const r1 = Object.values(store.get().project.components).find((c) => c.ref === 'R1')!;
    setTool('select');
    ptr('down', r1.position);
    ptr('move', { x: r1.position.x + 10, y: r1.position.y + 10 });
    ptr('up', { x: r1.position.x + 10, y: r1.position.y + 10 });
    const p = store.get().project;
    expect(p.components[r1.id].position).toEqual({ x: 25, y: 15 });
    const nl = buildNetlist(p);
    const v1 = Object.values(p.components).find((c) => c.ref === 'V1')!;
    expect(nl.pinNet.get(pinKey(r1.id, '1'))).toBe(nl.pinNet.get(pinKey(v1.id, '+')));
  });

  it('delete removes dependent wires; rotate keeps connectivity', () => {
    buildWithSource('mouse');
    const r1 = Object.values(store.get().project.components).find((c) => c.ref === 'R1')!;
    store.set({ selection: [r1.id] });
    dispatchCommand('rotate');
    expect(store.get().project.components[r1.id].rotation).toBe(90);
    expect(Object.keys(store.get().project.wires)).toHaveLength(1);
    dispatchCommand('delete');
    expect(store.get().project.components[r1.id]).toBeUndefined();
    expect(Object.keys(store.get().project.wires)).toHaveLength(0);
  });

  it('installation circuit tool: board then devices, confirm creates circuit + routed cables', () => {
    const p0 = sampleInstallation();
    const p = { ...p0, circuits: {}, cables: {} };
    loadProject(p, 'x');
    const db = Object.values(p.components).find((c) => c.type === 'db')!;
    const lights = Object.values(p.components).filter((c) => c.type === 'light').slice(0, 2);
    setTool('circuit');
    click(db.position);
    lights.forEach((l) => click(l.position));
    dispatchCommand('confirm'); // finish selection → staged preview
    expect(store.get().pending?.label).toBe('Create circuit');
    dispatchCommand('confirm'); // accept preview
    const q = store.get().project;
    expect(Object.keys(q.circuits)).toHaveLength(1);
    expect(Object.keys(q.cables)).toHaveLength(2);
  });
});

describe('2D ↔ 3D correspondence', () => {
  it('3D lead tips / terminals sit exactly on the 2D pin coordinates', () => {
    const p = EXAMPLES.find((e) => e.id === 'bjt-switch')!.build();
    for (const c of Object.values(p.components)) {
      const model = buildModel(c, { realistic: false });
      if (!model) continue;
      const g = new THREE.Group();
      g.add(model);
      g.position.set(c.position.x, c.elevation, c.position.y);
      g.rotation.y = (-c.rotation * Math.PI) / 180;
      if (c.mirror) g.scale.x = -1;
      g.updateMatrixWorld(true);
      // collect all vertices near board level
      const pts: THREE.Vector3[] = [];
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (v.y < 1.2) pts.push(v);
        }
      });
      for (const pd of getDef(c.type).pins) {
        const w = pinWorldPosition(c, pd.id);
        const nearest = Math.min(...pts.map((v) => Math.hypot(v.x - w.x, v.z - w.y)));
        expect(nearest, `${c.ref}.${pd.id}`).toBeLessThan(1.0);
      }
    }
  });
});
