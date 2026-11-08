import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { getDef } from '../component-library/library';
import { buildNetlist, pinKey } from '../project-model/connectivity';
import { wirePolyline } from '../project-model/geometry';
import type { Id, Project } from '../project-model/types';
import type { SimResult } from '../simulation/simulate';
import { buildModel, mat } from './models';
import { wallBoxes, wallSegments } from './walls';

/**
 * Three.js scene synchronised incrementally from the authoritative project.
 * Every object carries userData.entityId so picking maps straight back to the model.
 * Mapping: 2D (x, y) → 3D (X = x, Z = y), Y = elevation. All units millimetres.
 */

export interface SyncOptions {
  realistic: boolean;
  exploded: number;
  hidden: Set<Id>;
  section: number | null;
  sim: SimResult | null;
  selection: Set<Id>;
}

interface Entry {
  hash: string;
  obj: THREE.Object3D;
}

const NET_COLORS = ['#2bd97a', '#5cc8ff', '#f2b84b', '#c084fc', '#f472b6', '#22d3ee', '#a3e635', '#fb923c'];
const hashStr = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  root = new THREE.Group();
  perspective: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  controls: OrbitControls;
  transform: TransformControls;
  private entries = new Map<Id, Entry>();
  private board: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  private selectionHelpers = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  private lastProject: Project | null = null;
  private raycaster = new THREE.Raycaster();
  measureLine: THREE.Line | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    this.camera = this.perspective;
    this.perspective.position.set(60, 80, 90);
    this.controls = new OrbitControls(this.perspective, canvas);
    this.controls.enableDamping = true;
    this.transform = new TransformControls(this.perspective, canvas);
    this.scene.add(this.transform.getHelper());
    this.scene.add(this.root, this.selectionHelpers);
    const hemi = new THREE.HemisphereLight('#ffffff', '#3a3f47', 1.1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(hemi, this.sun, this.sun.target);
    const axes = new THREE.AxesHelper(1);
    axes.name = 'axes';
    this.scene.add(axes);
  }

  setBackground(color: string) {
    this.scene.background = new THREE.Color(color);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / Math.max(h, 1);
    this.perspective.updateProjectionMatrix();
    this.updateOrtho(w, h);
  }

  private updateOrtho(w = this.canvas.clientWidth, h = this.canvas.clientHeight) {
    const dist = this.perspective.position.distanceTo(this.controls.target);
    const halfH = Math.tan((this.perspective.fov * Math.PI) / 360) * dist;
    const halfW = halfH * (w / Math.max(h, 1));
    Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
  }

  setOrtho(on: boolean) {
    const target = this.controls.target.clone();
    const from = this.camera;
    const to = on ? this.ortho : this.perspective;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.controls.object = to;
    this.transform.camera = to;
    this.controls.target.copy(target);
    if (on) this.updateOrtho();
    this.controls.update();
  }

  render() {
    this.controls.update();
    if (this.camera === this.ortho) {
      // keep orthographic frustum in step with orbit distance
      this.perspective.position.copy(this.ortho.position);
      this.updateOrtho();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Incremental synchronisation: only changed entities are rebuilt. */
  sync(project: Project, opts: SyncOptions) {
    const wanted = new Map<Id, { hash: string; build: () => THREE.Object3D | null }>();
    const isInst = project.type === 'installation';
    const simOp = opts.sim && opts.sim.ok && opts.sim.kind === 'op' ? opts.sim : null;
    const netlist = isInst ? null : buildNetlist(project);

    // components
    let k = 0;
    for (const c of Object.values(project.components)) {
      if (opts.hidden.has(c.id) || c.hidden) continue;
      const res = simOp?.components[c.id];
      const active = c.type === 'led' ? (res?.current ?? 0) > 1e-3 : c.type === 'lamp' ? Math.abs(res?.current ?? 0) > 1e-3 : c.type === 'relay' || c.type === 'coil' ? !!res?.state : false;
      const intensity = c.type === 'led' ? Math.min(1, (res?.current ?? 0) / Math.max(Number(c.properties.maxCurrent) || 0.02, 1e-3)) : 1;
      const lift = opts.exploded * (isInst ? 0 : 12 + (k++ % 3) * 6);
      const hash = JSON.stringify([c.type, c.position, c.rotation, c.mirror, c.elevation, c.properties, opts.realistic, active, Math.round(intensity * 10), lift]);
      wanted.set(c.id, {
        hash,
        build: () => {
          const m = buildModel(c, { realistic: opts.realistic, active, intensity });
          if (!m) return null;
          const g = new THREE.Group();
          g.add(m);
          g.position.set(c.position.x, c.elevation + lift, c.position.y);
          g.rotation.y = (-c.rotation * Math.PI) / 180;
          if (c.mirror) g.scale.x = -1;
          const def = getDef(c.type);
          const nets = netlist ? def.pins.map((p) => `${p.id}:${netlist.pinNet.get(pinKey(c.id, p.id)) ?? ''}`) : [];
          g.userData = { entityId: c.id, kind: 'component', ref: c.ref, type: c.type, name: def.name, nets, properties: c.properties };
          g.name = c.ref;
          return g;
        },
      });
    }
    // wires
    if (netlist) {
      for (const w of Object.values(project.wires)) {
        const pts = wirePolyline(project, w);
        if (pts.length < 2) continue;
        const netName = netlist.wireNet.get(w.id) ?? '';
        const net = netlist.byName.get(netName);
        const color = net?.isGround ? '#8f9aa6' : NET_COLORS[hashStr(netName) % NET_COLORS.length];
        const hash = JSON.stringify([pts, color, opts.realistic]);
        wanted.set(w.id, {
          hash,
          build: () => {
            const curve = new THREE.CurvePath<THREE.Vector3>();
            for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(new THREE.Vector3(pts[i - 1].x, 0.35, pts[i - 1].y), new THREE.Vector3(pts[i].x, 0.35, pts[i].y)));
            const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, pts.length * 8, 0.32, 8, false), mat(color, { rough: 0.5, realistic: opts.realistic }));
            mesh.userData = { entityId: w.id, kind: 'wire', net: netName };
            mesh.castShadow = true;
            return mesh;
          },
        });
      }
    }
    // rooms (walls de-duplicated along shared edges) and cables
    if (isInst) {
      const wallsByRoom = wallSegments(Object.values(project.rooms));
      const allSegs = [...wallsByRoom.values()].flat();
      for (const r of Object.values(project.rooms)) {
        const segs = wallsByRoom.get(r.id) ?? [];
        const hash = JSON.stringify([r.polygon, r.height, r.wallThickness, segs, opts.realistic, opts.section]);
        wanted.set(r.id, {
          hash,
          build: () => {
            const g = new THREE.Group();
            const shape = new THREE.Shape(r.polygon.map((q) => new THREE.Vector2(q.x, -q.y)));
            const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat('#c9ccd0', { rough: 0.9, realistic: opts.realistic }));
            floor.rotation.x = -Math.PI / 2;
            floor.receiveShadow = true;
            g.add(floor);
            const wallMat = mat('#e8e6e1', { rough: 0.85, realistic: opts.realistic, opacity: 0.55 });
            for (const b of wallBoxes(segs, r.wallThickness, allSegs)) {
              const wall = new THREE.Mesh(new THREE.BoxGeometry(b.length, r.height, b.thickness), wallMat);
              wall.position.set(b.cx, r.height / 2, b.cy);
              wall.rotation.y = -b.angle;
              wall.castShadow = true;
              wall.receiveShadow = true;
              g.add(wall);
            }
            g.userData = { entityId: r.id, kind: 'room', name: r.name };
            return g;
          },
        });
      }
      const cc = project.settings.conductorColors;
      for (const cb of Object.values(project.cables)) {
        const circuit = project.circuits[cb.circuitId];
        if (!circuit) continue;
        const from = project.components[cb.fromId];
        const to = project.components[cb.toId];
        if (!from || !to) continue;
        const color = circuit.phase === 'L123' ? '#e5534b' : cc[circuit.phase];
        const hash = JSON.stringify([cb.path, cb.routeElevation, from.elevation, to.elevation, color, opts.realistic]);
        wanted.set(cb.id, {
          hash,
          build: () => {
            const e = cb.routeElevation;
            const pts = [new THREE.Vector3(cb.path[0].x, from.elevation, cb.path[0].y), ...cb.path.map((q) => new THREE.Vector3(q.x, e, q.y)), new THREE.Vector3(cb.path[cb.path.length - 1].x, to.elevation, cb.path[cb.path.length - 1].y)];
            const curve = new THREE.CurvePath<THREE.Vector3>();
            for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-3) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
            const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, pts.length * 6, 12, 8, false), mat(color, { rough: 0.6, realistic: opts.realistic }));
            mesh.userData = { entityId: cb.id, kind: 'cable', circuit: circuit.name, phase: circuit.phase };
            mesh.castShadow = true;
            return mesh;
          },
        });
      }
    }

    // apply diff
    for (const [id, e] of this.entries) {
      const w = wanted.get(id);
      if (!w || w.hash !== e.hash) {
        this.root.remove(e.obj);
        disposeTree(e.obj);
        this.entries.delete(id);
      }
    }
    for (const [id, w] of wanted) {
      if (this.entries.has(id)) continue;
      const obj = w.build();
      if (!obj) continue;
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).castShadow = true;
          (o as THREE.Mesh).receiveShadow = true;
          const m = (o as THREE.Mesh).material as THREE.Material;
          if (opts.section !== null) {
            const cloned = m.clone();
            cloned.clippingPlanes = [this.clip];
            (o as THREE.Mesh).material = cloned;
          }
        }
        if (!o.userData.entityId) o.userData.entityId = obj.userData.entityId;
      });
      this.root.add(obj);
      this.entries.set(id, { hash: w.hash, obj });
    }
    this.clip.constant = opts.section ?? 1e9;
    this.updateGround(project);
    this.updateSelection(opts.selection);
    this.lastProject = project;
  }

  private updateGround(project: Project) {
    const box = new THREE.Box3().setFromObject(this.root);
    const isInst = project.type === 'installation';
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.z) * 1.3 + (isInst ? 2000 : 20);
    const key = `${Math.round(extent)}:${Math.round(center.x)}:${Math.round(center.z)}:${isInst}`;
    if (this.board?.userData.key !== key) {
      if (this.board) {
        this.scene.remove(this.board);
        disposeTree(this.board);
      }
      if (this.grid) {
        this.scene.remove(this.grid);
        disposeTree(this.grid);
      }
      const geo = new THREE.PlaneGeometry(extent, extent);
      this.board = new THREE.Mesh(geo, isInst ? mat('#6b7178', { rough: 1 }) : mat('#1d3b2a', { rough: 0.85 }));
      this.board.rotation.x = -Math.PI / 2;
      this.board.position.set(center.x, isInst ? -2 : -0.05, center.z);
      this.board.receiveShadow = true;
      this.board.userData = { key, kind: 'ground' };
      this.scene.add(this.board);
      const step = isInst ? 500 : 2.54;
      const div = Math.min(400, Math.round(extent / step));
      this.grid = new THREE.GridHelper(div * step, div, isInst ? '#80868d' : '#2f5a40', isInst ? '#757b82' : '#264a35');
      this.grid.position.set(center.x, isInst ? -1 : 0, center.z);
      this.scene.add(this.grid);
      const s = extent * 0.6;
      this.sun.position.set(center.x + s * 0.6, s, center.z + s * 0.4);
      this.sun.target.position.copy(center);
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      Object.assign(cam, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 4 });
      cam.updateProjectionMatrix();
      const axes = this.scene.getObjectByName('axes');
      if (axes) axes.scale.setScalar(isInst ? 1000 : 10);
    }
  }

  private updateSelection(sel: Set<Id>) {
    this.selectionHelpers.clear();
    for (const id of sel) {
      const e = this.entries.get(id);
      if (!e) continue;
      const helper = new THREE.BoxHelper(e.obj, '#5cc8ff');
      this.selectionHelpers.add(helper);
    }
  }

  /** Attach move gizmo to a single selected component. */
  attachTransform(id: Id | null) {
    const e = id ? this.entries.get(id) : undefined;
    if (e && e.obj.userData.kind === 'component') this.transform.attach(e.obj);
    else this.transform.detach();
  }

  pick(ndcX: number, ndcY: number): { id: Id; point: THREE.Vector3 } | { id: null; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const objects = [...this.root.children, ...(this.board ? [this.board] : [])];
    const hits = this.raycaster.intersectObjects(objects, true);
    for (const h of hits) {
      if (h.object.userData.kind === 'ground') return { id: null, point: h.point };
      const id = h.object.userData.entityId as Id | undefined;
      if (id) return { id, point: h.point };
    }
    return null;
  }

  fit(selection?: Set<Id>) {
    const box = new THREE.Box3();
    if (selection?.size) for (const id of selection) {
      const e = this.entries.get(id);
      if (e) box.expandByObject(e.obj);
    }
    if (box.isEmpty()) box.setFromObject(this.root);
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0.5, 0.7, 0.6).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(size * 1.1 + 1)));
    this.perspective.near = Math.max(0.05, size / 2000);
    this.perspective.far = size * 50 + 1000;
    this.perspective.updateProjectionMatrix();
    this.controls.update();
  }

  preset(view: 'top' | 'front' | 'side' | 'iso') {
    const target = this.controls.target.clone();
    const d = Math.max(this.camera.position.distanceTo(target), 10);
    const dirs = { top: [0, 1, 0.0001], front: [0, 0.0001, 1], side: [1, 0.0001, 0], iso: [1, 1, 1] } as const;
    const v = new THREE.Vector3(...dirs[view]).normalize().multiplyScalar(d);
    this.camera.position.copy(target.clone().add(v));
    this.camera.lookAt(target);
    this.controls.update();
  }

  dispose() {
    for (const e of this.entries.values()) disposeTree(e.obj);
    this.controls.dispose();
    this.transform.dispose();
    this.renderer.dispose();
  }

  get project() {
    return this.lastProject;
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    // shared cached materials are not disposed; clipping clones are
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mm of mats) if ((mm as THREE.Material).clippingPlanes?.length) (mm as THREE.Material).dispose();
  });
}
