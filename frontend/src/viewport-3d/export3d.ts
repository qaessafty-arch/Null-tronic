import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

/**
 * 3D exports of the synchronised model (not a screenshot). Units: the scene is in millimetres;
 * glTF expects metres, so GLB/glTF output is scaled by 0.001. Component identity (ref, type,
 * id, pin nets) is written to glTF node "extras". OBJ / STL carry geometry only (format limits).
 */

function prepared(root: THREE.Object3D, toMetres: boolean): THREE.Object3D {
  const clone = root.clone(true);
  // drop lights (LED glow) – not portable
  const lights: THREE.Object3D[] = [];
  clone.traverse((o) => {
    if ((o as THREE.Light).isLight) lights.push(o);
  });
  lights.forEach((l) => l.parent?.remove(l));
  const wrap = new THREE.Group();
  wrap.name = 'NULL-TECH model';
  wrap.add(clone);
  if (toMetres) wrap.scale.setScalar(0.001);
  wrap.updateMatrixWorld(true);
  return wrap;
}

export async function exportGLB(root: THREE.Object3D, binary = true): Promise<ArrayBuffer | object> {
  const exporter = new GLTFExporter();
  return exporter.parseAsync(prepared(root, true), { binary, onlyVisible: true });
}

export function exportOBJ(root: THREE.Object3D): string {
  return new OBJExporter().parse(prepared(root, false));
}

export function exportSTL(root: THREE.Object3D): DataView | string {
  return new STLExporter().parse(prepared(root, false), { binary: true });
}
