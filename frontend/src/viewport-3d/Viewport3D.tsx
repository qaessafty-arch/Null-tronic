import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Scene3D } from './scene3d';
import { exportGLB, exportOBJ, exportSTL } from './export3d';
import { store, setView, useStore, log } from '../state/store';
import { registerAdapter, type InputSource } from '../input-system/input';
import { execute } from '../history/history';
import { moveEntities, updateComponent } from '../project-model/operations';
import { download } from '../app/file-ops';
import { Icon } from '../components/Icon';

let activeScene: Scene3D | null = null;
export const get3DScene = () => activeScene;

export async function export3D(kind: 'glb' | 'gltf' | 'obj' | 'stl'): Promise<void> {
  const sc = activeScene;
  if (!sc) {
    log('warn', 'Open the 3D view once before exporting a 3D model.');
    return;
  }
  const name = (store.get().project.meta.name || 'model').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase();
  if (kind === 'glb') download(`${name}.glb`, new Blob([(await exportGLB(sc.root, true)) as ArrayBuffer], { type: 'model/gltf-binary' }));
  else if (kind === 'gltf') download(`${name}.gltf`, JSON.stringify(await exportGLB(sc.root, false)), 'model/gltf+json');
  else if (kind === 'obj') download(`${name}.obj`, exportOBJ(sc.root), 'text/plain');
  else {
    const dv = exportSTL(sc.root) as DataView;
    download(`${name}.stl`, new Blob([dv.buffer as ArrayBuffer], { type: 'model/stl' }));
  }
  log('info', `Exported ${kind.toUpperCase()} (${sc.root.children.length} objects)`, true);
}

/** 3D viewport: orbit/pan/zoom, picking into the shared selection, move gizmo committing to the model. */
export function Viewport3D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const view = useStore((s) => s.view);
  const projectId = useStore((s) => s.project.meta.id);
  const [measure, setMeasure] = useState(false);
  const measureRef = useRef<THREE.Vector3[]>([]);
  const [measureText, setMeasureText] = useState('');
  const handDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let sc: Scene3D;
    try {
      sc = new Scene3D(canvas);
    } catch (e) {
      log('error', `WebGL is not available: ${(e as Error).message}`);
      return;
    }
    sceneRef.current = sc;
    activeScene = sc;
    const bg = getComputedStyle(canvas).getPropertyValue('--viewport3d-bg').trim() || '#11151a';
    sc.setBackground(bg);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      sc.render();
    };
    loop();
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current!.getBoundingClientRect();
      sc.resize(r.width, r.height);
    });
    ro.observe(wrapRef.current!);

    // commit gizmo moves to the authoritative model (2D updates automatically)
    sc.transform.addEventListener('dragging-changed', (ev) => {
      const dragging = (ev as unknown as { value: boolean }).value;
      sc.controls.enabled = !dragging;
      if (dragging) return;
      const obj = sc.transform.object;
      if (!obj) return;
      const id = obj.userData.entityId as string;
      const c = store.get().project.components[id];
      if (!c) return;
      const g = store.get().project.settings.gridMm;
      const snap = (v: number) => (store.get().project.settings.snapToGrid ? Math.round(v / g) * g : v);
      const dx = snap(obj.position.x) - c.position.x;
      const dz = snap(obj.position.z) - c.position.y;
      const elev = Math.max(0, Math.round(obj.position.y));
      if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6 && Math.abs(elev - c.elevation) < 1e-6) return;
      execute(`Move ${c.ref} (3D)`, (p) => {
        let q = moveEntities(p, [id], { x: dx, y: dz });
        if (Math.abs(elev - c.elevation) > 1e-6) q = updateComponent(q, id, { elevation: elev });
        return q;
      });
    });

    const sync = () => {
      const s = store.get();
      sc.sync(s.project, { realistic: s.view.realistic, exploded: s.view.exploded, hidden: new Set(s.view.hidden3d), section: s.view.section, sim: s.sim.forProject === s.project ? s.sim.result : null, selection: new Set(s.selection) });
      const sel = s.selection.length === 1 ? s.selection[0] : null;
      sc.attachTransform(sel && s.project.components[sel] ? sel : null);
    };
    let last: unknown[] = [];
    const unsub = store.subscribe(() => {
      const s = store.get();
      const key = [s.project, s.view.realistic, s.view.exploded, s.view.hidden3d, s.view.section, s.sim.result, s.selection];
      if (key.every((k, i) => k === last[i])) return;
      last = key;
      sync();
    });
    sync();
    setTimeout(() => sc.fit(), 0);

    const unreg = registerAdapter({
      kind: '3d',
      normalizedToWorld: () => null,
      tolerance: () => 1,
      zoomAt: (f) => {
        const t = sc.controls.target;
        const d = sc.camera.position.clone().sub(t).multiplyScalar(1 / f);
        sc.camera.position.copy(t.clone().add(d));
      },
      panBy: (dx, dy) => {
        const dist = sc.camera.position.distanceTo(sc.controls.target);
        const right = new THREE.Vector3().setFromMatrixColumn(sc.camera.matrix, 0).multiplyScalar(dx * dist);
        const up = new THREE.Vector3().setFromMatrixColumn(sc.camera.matrix, 1).multiplyScalar(-dy * dist);
        sc.camera.position.add(right).add(up);
        sc.controls.target.add(right).add(up);
      },
      rawPointer: (phase, nx, ny, source: InputSource) => {
        // hand: pinch-drag orbits, pinch-tap selects
        if (phase === 'down') handDrag.current = { x: nx, y: ny, moved: false };
        else if (phase === 'move' && handDrag.current) {
          const dx = nx - handDrag.current.x;
          const dy = ny - handDrag.current.y;
          if (Math.hypot(dx, dy) > 0.01) handDrag.current.moved = true;
          const t = sc.controls.target;
          const offset = sc.camera.position.clone().sub(t);
          const sph = new THREE.Spherical().setFromVector3(offset);
          sph.theta -= dx * Math.PI * 2;
          sph.phi = Math.min(Math.max(sph.phi - dy * Math.PI, 0.05), Math.PI - 0.05);
          sc.camera.position.copy(t.clone().add(new THREE.Vector3().setFromSpherical(sph)));
          handDrag.current.x = nx;
          handDrag.current.y = ny;
        } else if (phase === 'up') {
          if (handDrag.current && !handDrag.current.moved) {
            const hit = sc.pick(nx * 2 - 1, -(ny * 2 - 1));
            store.set({ selection: hit && hit.id ? [hit.id] : [] });
          }
          handDrag.current = null;
        }
        void source;
      },
      fit: () => sc.fit(new Set(store.get().selection)),
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      unreg();
      sc.dispose();
      if (activeScene === sc) activeScene = null;
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const bg = getComputedStyle(canvasRef.current!).getPropertyValue('--viewport3d-bg').trim() || '#11151a';
    sc.setBackground(bg);
  }, [view.theme]);

  useEffect(() => {
    sceneRef.current?.setOrtho(view.ortho);
  }, [view.ortho]);

  useEffect(() => {
    setTimeout(() => sceneRef.current?.fit(), 50);
  }, [projectId]);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const sc = sceneRef.current;
    if (!sc || !down.current || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4;
    down.current = null;
    if (moved || sc.transform.dragging) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const hit = sc.pick(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    if (measure) {
      if (!hit) return;
      measureRef.current.push(hit.point.clone());
      if (measureRef.current.length === 2) {
        const [a, b] = measureRef.current;
        const d = a.distanceTo(b);
        const unit = store.get().project.settings.displayUnit;
        setMeasureText(`${unit === 'm' ? `${(d / 1000).toFixed(3)} m` : `${d.toFixed(2)} mm`}  (Δx ${(b.x - a.x).toFixed(1)}, Δy ${(b.z - a.z).toFixed(1)}, Δz ${(b.y - a.y).toFixed(1)} mm)`);
        if (sc.measureLine) sc.scene.remove(sc.measureLine);
        sc.measureLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#f2b84b', depthTest: false }));
        sc.scene.add(sc.measureLine);
        measureRef.current = [];
      } else setMeasureText('Pick the second point…');
      return;
    }
    if (hit && hit.id) {
      const sel = store.get().selection;
      store.set({ selection: e.shiftKey ? (sel.includes(hit.id) ? sel.filter((x) => x !== hit.id) : [...sel, hit.id]) : [hit.id] });
    } else if (!e.shiftKey) store.set({ selection: [] });
  };

  const sel = useStore((s) => s.selection);
  return (
    <div ref={wrapRef} className="viewport viewport-3d" data-testid="viewport-3d" onPointerEnter={() => setView({ active: '3d' })}>
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp} aria-label="3D engineering viewport" />
      <div className="vp3d-toolbar" role="toolbar" aria-label="3D view controls">
        <button title="Fit to project" onClick={() => sceneRef.current?.fit()}>
          <Icon name="fit" />
        </button>
        <button title="Fit to selection" disabled={!sel.length} onClick={() => sceneRef.current?.fit(new Set(sel))}>
          <Icon name="target" />
        </button>
        <span className="sep" />
        {(['top', 'front', 'side', 'iso'] as const).map((p) => (
          <button key={p} className="text" title={`${p} view`} onClick={() => sceneRef.current?.preset(p)}>
            {p === 'iso' ? 'ISO' : p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
        <button className={`text ${view.ortho ? 'on' : ''}`} title="Orthographic / perspective" onClick={() => setView({ ortho: !view.ortho })}>
          {view.ortho ? 'Ortho' : 'Persp'}
        </button>
        <span className="sep" />
        <button className={`text ${view.realistic ? 'on' : ''}`} title="Realistic / simplified materials" onClick={() => setView({ realistic: !view.realistic })}>
          {view.realistic ? 'Realistic' : 'Simple'}
        </button>
        <label className="slider" title="Exploded view">
          Explode
          <input type="range" min={0} max={3} step={0.1} value={view.exploded} onChange={(e) => setView({ exploded: Number(e.target.value) })} />
        </label>
        <label className="slider" title="Horizontal section height">
          <input type="checkbox" checked={view.section !== null} onChange={(e) => setView({ section: e.target.checked ? (store.get().project.type === 'installation' ? 1500 : 6) : null })} />
          Section
          {view.section !== null && <input type="range" min={store.get().project.type === 'installation' ? 100 : 0.5} max={store.get().project.type === 'installation' ? 3200 : 20} step={store.get().project.type === 'installation' ? 50 : 0.5} value={view.section} onChange={(e) => setView({ section: Number(e.target.value) })} />}
        </label>
        <span className="sep" />
        <button className="text" title="Hide selected" disabled={!sel.length} onClick={() => setView({ hidden3d: [...new Set([...view.hidden3d, ...sel])] })}>
          Hide
        </button>
        <button
          className="text"
          title="Isolate selected"
          disabled={!sel.length}
          onClick={() => {
            const p = store.get().project;
            setView({ hidden3d: Object.keys(p.components).filter((id) => !sel.includes(id)) });
          }}
        >
          Isolate
        </button>
        <button className="text" title="Show all" disabled={!view.hidden3d.length} onClick={() => setView({ hidden3d: [] })}>
          Show all
        </button>
        <button
          className={`text ${measure ? 'on' : ''}`}
          title="Measure distance between two picked points"
          onClick={() => {
            setMeasure(!measure);
            measureRef.current = [];
            setMeasureText(measure ? '' : 'Pick the first point…');
          }}
        >
          Measure
        </button>
      </div>
      {measureText && <div className="vp3d-measure">{measureText}</div>}
      <div className="vp3d-hint">Drag: orbit · Right-drag: pan · Wheel: zoom · Click: select · Gizmo: move (commits to model)</div>
    </div>
  );
}
