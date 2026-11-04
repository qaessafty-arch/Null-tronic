import * as THREE from 'three';
import { getDef } from '../component-library/library';
import type { ComponentInstance } from '../project-model/types';

/**
 * Parametric 3D component models. Local frame: X = symbol x, Z = symbol y (2D y-down), Y = up.
 * Lead tips / terminals are placed exactly at the library pin coordinates, so 3D connections
 * coincide with the 2D schematic pins. Units: millimetres.
 */

export interface ModelOptions {
  realistic: boolean;
  /** Simulation state used for visual feedback (LED glow, coil energised). */
  active?: boolean;
  intensity?: number;
}

const matCache = new Map<string, THREE.Material>();
export function mat(color: string | number, opts: { metal?: number; rough?: number; emissive?: string; ei?: number; opacity?: number; realistic?: boolean } = {}): THREE.Material {
  const key = JSON.stringify([color, opts]);
  let m = matCache.get(key);
  if (!m) {
    if (opts.realistic === false) m = new THREE.MeshLambertMaterial({ color, transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1 });
    else
      m = new THREE.MeshStandardMaterial({
        color,
        metalness: opts.metal ?? 0.05,
        roughness: opts.rough ?? 0.6,
        emissive: opts.emissive ?? '#000000',
        emissiveIntensity: opts.ei ?? 0,
        transparent: opts.opacity !== undefined,
        opacity: opts.opacity ?? 1,
      });
    matCache.set(key, m);
  }
  return m;
}

const RES_COLORS = ['#111111', '#7a4a1f', '#d42a2a', '#ef7c1a', '#f2d21b', '#2e9b3d', '#2a5bd4', '#7b3fbf', '#888888', '#f2f2f2'];

/** IEC 60062 four-band colour code (2 significant digits + multiplier + tolerance). */
export function resistorBands(ohms: number, tolerance: number): string[] {
  if (!(ohms > 0)) return ['#111111', '#111111', '#111111', '#c9a227'];
  const exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / Math.pow(10, exp));
  let e = exp;
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    e += 1;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const mult = e === -1 ? '#c9a227' : e === -2 ? '#c0c0c0' : RES_COLORS[Math.min(Math.max(e, 0), 9)];
  const tol = tolerance <= 1 ? RES_COLORS[1] : tolerance <= 2 ? RES_COLORS[2] : tolerance <= 5 ? '#c9a227' : '#c0c0c0';
  return [RES_COLORS[d1], RES_COLORS[d2], mult, tol];
}

function lead(points: THREE.Vector3[], r = 0.25, realistic = true): THREE.Mesh {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < points.length; i++) curve.add(new THREE.LineCurve3(points[i - 1], points[i]));
  const geo = new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, Math.max(2, points.length * 4), r, 6, false);
  return new THREE.Mesh(geo, mat('#c7ccd1', { metal: 0.9, rough: 0.3, realistic }));
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(w: number, h: number, d: number, m: THREE.Material, y = h / 2, x = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(r: number, len: number, m: THREE.Material, axis: 'x' | 'y' | 'z' = 'y', seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Leads from the body down to each pin. */
function pinLeads(c: ComponentInstance, fromY: number, realistic: boolean, inset = 0.4): THREE.Object3D[] {
  const def = getDef(c.type);
  return def.pins.map((p) => {
    const len = Math.hypot(p.x, p.y) || 1;
    const ix = p.x - (p.x / len) * inset;
    const iz = p.y - (p.y / len) * inset;
    return lead([V(ix * 0.55, fromY, iz * 0.55), V(ix, fromY, iz), V(p.x, 0.05, p.y)], 0.25, realistic);
  });
}

function axial(c: ComponentInstance, body: THREE.Material, len: number, r: number, bands: string[], o: ModelOptions): THREE.Group {
  const g = new THREE.Group();
  const h = r + 0.6;
  const b = cyl(r, len, body, 'x');
  b.position.y = h;
  g.add(b);
  bands.forEach((col, i) => {
    const band = cyl(r * 1.04, len * 0.08, mat(col, { realistic: o.realistic }), 'x');
    band.position.set(-len / 2 + len * (0.2 + i * 0.17) + (i === bands.length - 1 && bands.length > 1 ? len * 0.08 : 0), h, 0);
    g.add(band);
  });
  const def = getDef(c.type);
  for (const p of def.pins) {
    const sx = Math.sign(p.x) || 1;
    g.add(lead([V((sx * len) / 2, h, 0), V(p.x, h, p.y), V(p.x, 0.05, p.y)], 0.25, o.realistic));
  }
  return g;
}

function generic(c: ComponentInstance, color: string, o: ModelOptions, h = 4): THREE.Group {
  const def = getDef(c.type);
  const g = new THREE.Group();
  const xs = def.pins.map((p) => p.x);
  const zs = def.pins.map((p) => p.y);
  const w = Math.max(4, (Math.max(...xs, 0) - Math.min(...xs, 0)) * 0.7);
  const d = Math.max(4, (Math.max(...zs, 0) - Math.min(...zs, 0)) * 0.7);
  g.add(box(w, h, d, mat(color, { realistic: o.realistic }), h / 2 + 0.5));
  pinLeads(c, 1, o.realistic).forEach((l) => g.add(l));
  return g;
}

function dip(c: ComponentInstance, o: ModelOptions): THREE.Group {
  const def = getDef(c.type);
  const g = new THREE.Group();
  const xs = def.pins.map((p) => p.x);
  const zs = def.pins.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs) - 3.2;
  const d = Math.max(...zs) - Math.min(...zs) + 2.6;
  const body = box(Math.max(w, 6), 3.3, d, mat('#1b1d20', { rough: 0.8, realistic: o.realistic }), 0.8 + 1.65);
  g.add(body);
  const notch = cyl(0.7, 0.3, mat('#2c2f33', { realistic: o.realistic }));
  notch.position.set(0, 4.15, -d / 2 + 1.2);
  g.add(notch);
  for (const p of def.pins) {
    const sx = Math.sign(p.x);
    const edge = (sx * Math.max(w, 6)) / 2;
    g.add(box(Math.abs(p.x - edge) + 0.3, 0.25, 0.5, mat('#c7ccd1', { metal: 0.9, rough: 0.3, realistic: o.realistic }), 1.6, (p.x + edge) / 2, p.y));
    g.add(box(0.25, 1.6, 0.5, mat('#c7ccd1', { metal: 0.9, rough: 0.3, realistic: o.realistic }), 0.8, p.x, p.y));
  }
  return g;
}

function plate(w: number, h: number, depth: number, color: string, o: ModelOptions): THREE.Mesh {
  // wall-mounted plate: face toward -Z (local), centred on origin
  return box(w, h, depth, mat(color, { rough: 0.5, realistic: o.realistic }), 0);
}

export function buildModel(c: ComponentInstance, o: ModelOptions): THREE.Object3D | null {
  const def = getDef(c.type);
  const pr = c.properties;
  const R = o.realistic;
  switch (def.model3d) {
    case 'none':
      return null;
    case 'axial-resistor':
      return axial(c, mat('#d9c39a', { rough: 0.7, realistic: R }), 6.3, 1.25, resistorBands(Number(pr.resistance), Number(pr.tolerance ?? 5)), o);
    case 'axial-diode': {
      const g = axial(c, mat('#1d1d1f', { rough: 0.5, realistic: R }), 4.2, 1.0, [], o);
      const band = cyl(1.05, 0.5, mat('#c0c0c0', { realistic: R }), 'x');
      band.position.set(1.5, 1.6, 0);
      g.add(band);
      return g;
    }
    case 'inductor':
      return axial(c, mat('#3f7a4a', { rough: 0.6, realistic: R }), 8, 2.2, ['#c9a227', '#111111'], o);
    case 'ceramic-capacitor': {
      const g = new THREE.Group();
      const disc = cyl(2.5, 1.2, mat('#d8933a', { rough: 0.6, realistic: R }), 'z');
      disc.position.y = 4.2;
      g.add(disc);
      pinLeads(c, 2, R, 3.6).forEach((l) => g.add(l));
      return g;
    }
    case 'electrolytic-capacitor': {
      const g = new THREE.Group();
      const C = Number(pr.capacitance) || 1e-4;
      const r = Math.min(6.3, Math.max(2.5, 2 + Math.log10(C / 1e-6 + 1) * 1.1));
      const h = r * 2.4;
      const body = cyl(r, h, mat('#1f3a6e', { rough: 0.4, realistic: R }));
      body.position.y = h / 2 + 0.6;
      g.add(body);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.98, 24, 1, true, Math.PI * 0.35, Math.PI * 0.3), mat('#c9d1dc', { realistic: R }));
      stripe.position.y = h / 2 + 0.6;
      g.add(stripe);
      const top = cyl(r * 0.98, 0.2, mat('#b7bec7', { metal: 0.7, rough: 0.3, realistic: R }));
      top.position.y = h + 0.65;
      g.add(top);
      pinLeads(c, 0.7, R, 3.6).forEach((l) => g.add(l));
      return g;
    }
    case 'battery': {
      const g = new THREE.Group();
      g.add(box(8, 10, 9, mat('#2d2f33', { realistic: R }), 5.5));
      g.add(box(8.05, 4, 9.05, mat('#d9a400', { realistic: R }), 9.5));
      for (const p of def.pins) {
        const t = cyl(1, 1.2, mat('#c7ccd1', { metal: 0.9, rough: 0.3, realistic: R }));
        t.position.set(p.x, 0.6, p.y);
        g.add(t);
      }
      return g;
    }
    case 'source-box':
      return generic(c, '#3b4553', o, 6);
    case 'led': {
      const g = new THREE.Group();
      const color = { red: '#ff3b30', green: '#34c759', blue: '#2f7dff', yellow: '#ffd60a', white: '#f4f4f4' }[String(pr.color)] ?? '#ff3b30';
      const glow = o.active ? Math.min(2.5, 0.4 + (o.intensity ?? 1) * 1.5) : 0;
      const m = mat(color, { rough: 0.2, opacity: 0.85, emissive: color, ei: glow, realistic: R });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
      dome.position.y = 7.5;
      const body = cyl(2.5, 5, m);
      body.position.y = 5;
      const rim = cyl(2.9, 1, m);
      rim.position.y = 2.9;
      g.add(dome, body, rim);
      if (o.active) {
        const light = new THREE.PointLight(color, glow * 30, 40, 2);
        light.position.y = 9;
        g.add(light);
      }
      pinLeads(c, 2.4, R, 3.6).forEach((l) => g.add(l));
      return g;
    }
    case 'to92': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 4.8, 24, 1, false, 0, Math.PI), mat('#1b1d20', { rough: 0.8, realistic: R }));
      body.position.y = 5;
      body.rotation.y = Math.PI / 2;
      g.add(body);
      pinLeads(c, 2.6, R, 1).forEach((l) => g.add(l));
      return g;
    }
    case 'to220': {
      const g = new THREE.Group();
      g.add(box(10, 9, 4.5, mat('#1b1d20', { rough: 0.8, realistic: R }), 9));
      g.add(box(10, 6.5, 1.3, mat('#c7ccd1', { metal: 0.9, rough: 0.35, realistic: R }), 16.5, 0, -1.6));
      pinLeads(c, 4.5, R, 1).forEach((l) => g.add(l));
      return g;
    }
    case 'dip8':
    case 'dip14':
    case 'dip28':
      return def.pins.length > 3 ? dip(c, o) : generic(c, '#1b1d20', o, 3.3);
    case 'toggle-switch':
    case 'pushbutton': {
      const g = generic(c, '#2c3036', o, 5);
      const on = Boolean(pr.closed ?? pr.pressed);
      const knob = def.model3d === 'pushbutton' ? cyl(1.6, on ? 1 : 2.5, mat(c.type === 'pb_nc' ? '#d64545' : '#34c759', { realistic: R })) : cyl(0.6, 5, mat('#c7ccd1', { metal: 0.8, realistic: R }));
      knob.position.y = def.model3d === 'pushbutton' ? 6.2 : 7.5;
      if (def.model3d === 'toggle-switch') knob.rotation.z = on ? -0.5 : 0.5;
      g.add(knob);
      return g;
    }
    case 'relay':
    case 'contactor': {
      const g = generic(c, c.type === 'relay' ? '#2a5bd4' : '#d8dde3', o, c.type === 'relay' ? 12 : 9);
      if (o.active) {
        const ind = cyl(0.8, 0.4, mat('#ffd60a', { emissive: '#ffd60a', ei: 2, realistic: R }));
        ind.position.y = (c.type === 'relay' ? 12 : 9) + 0.8;
        g.add(ind);
      }
      return g;
    }
    case 'transformer': {
      const g = new THREE.Group();
      g.add(box(9, 8, 8, mat('#5c6672', { metal: 0.6, rough: 0.4, realistic: R }), 4.5));
      const w1 = cyl(2.6, 6, mat('#b5651d', { metal: 0.6, rough: 0.35, realistic: R }), 'z');
      w1.position.set(-2.4, 4.5, 0);
      const w2 = w1.clone();
      w2.position.x = 2.4;
      g.add(w1, w2);
      pinLeads(c, 1, R, 1).forEach((l) => g.add(l));
      return g;
    }
    case 'ground-post': {
      const g = new THREE.Group();
      const post = cyl(0.8, 3, mat('#8f9aa6', { metal: 0.6, realistic: R }));
      post.position.y = 1.5;
      g.add(post);
      g.add(box(4, 0.4, 4, mat('#5f6b78', { metal: 0.5, realistic: R }), 0.2, 0, 2));
      return g;
    }
    case 'terminal-block': {
      const g = new THREE.Group();
      g.add(box(5, 6, 5, mat('#2e9b3d', { realistic: R }), 3));
      const s = cyl(1.2, 0.6, mat('#c7ccd1', { metal: 0.9, realistic: R }));
      s.position.y = 6.2;
      g.add(s);
      return g;
    }
    case 'header2': {
      const g = new THREE.Group();
      g.add(box(2.5, 2.5, 5.1, mat('#1b1d20', { realistic: R }), 1.25, -5, 0));
      for (const p of def.pins) g.add(box(0.64, 8.5, 0.64, mat('#d4af37', { metal: 0.9, rough: 0.25, realistic: R }), 3.5, p.x, p.y));
      return g;
    }
    case 'probe': {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 16), mat('#e5534b', { realistic: R }));
      cone.rotation.x = Math.PI;
      cone.position.y = 2;
      g.add(cone);
      for (const p of def.pins) if (p.x || p.y) g.add(lead([V(0, 0.5, 0), V(p.x, 0.5, p.y)], 0.2, R));
      return g;
    }
    // ----- installation (mounted at component elevation) -----
    case 'distribution-board': {
      const g = new THREE.Group();
      g.add(box(450, 600, 110, mat('#e3e6ea', { rough: 0.5, realistic: R }), 0));
      g.add(box(420, 560, 6, mat('#cfd4da', { rough: 0.4, realistic: R }), 0, 0, -58));
      for (let i = 0; i < 12; i++) g.add(box(18, 80, 20, mat('#ffffff', { realistic: R }), 120, -190 + i * 34.5, -62));
      return g;
    }
    case 'ceiling-light': {
      const g = new THREE.Group();
      const panel = cyl(150, 40, mat('#f5f5f0', { emissive: '#fff6d8', ei: 0.6, rough: 0.3, realistic: R }));
      panel.position.y = 20;
      g.add(panel);
      return g;
    }
    case 'wall-switch': {
      const g = new THREE.Group();
      g.add(plate(86, 86, 12, '#f2f2f2', o));
      g.add(box(30, 50, 8, mat('#e0e0e0', { realistic: R }), 0, 0, -9));
      return g;
    }
    case 'socket': {
      const g = new THREE.Group();
      g.add(plate(86, 86, 14, '#f2f2f2', o));
      const face = cyl(30, 4, mat('#e6e6e6', { realistic: R }), 'z');
      face.position.z = -9;
      g.add(face);
      return g;
    }
    case 'ac-unit':
      return box(800, 290, 200, mat('#f4f6f8', { rough: 0.4, realistic: R }), 0);
    case 'water-heater': {
      const t = cyl(225, 800, mat('#eef0f2', { rough: 0.35, realistic: R }));
      const g = new THREE.Group();
      g.add(t);
      return g;
    }
    case 'motor': {
      const g = new THREE.Group();
      const body = cyl(100, 260, mat('#3a6ea5', { metal: 0.3, rough: 0.5, realistic: R }), 'x');
      body.position.y = 110;
      g.add(body, box(200, 20, 160, mat('#2b2f36', { realistic: R }), 10));
      return g;
    }
    case 'appliance':
      return box(600, 900, 600, mat('#d9dde2', { rough: 0.4, realistic: R }), 450);
    case 'junction-box':
      return box(100, 50, 100, mat('#9aa4b1', { realistic: R }), 0);
    case 'cable-tray': {
      const l = Number(pr.length) || 3000;
      const w = Number(pr.width) || 200;
      const g = new THREE.Group();
      const m = mat('#a9b2bc', { metal: 0.7, rough: 0.35, realistic: R });
      g.add(box(l, 3, w, m, 0), box(l, 60, 3, m, 30, 0, w / 2), box(l, 60, 3, m, 30, 0, -w / 2));
      return g;
    }
    case 'earth-rod': {
      const r = cyl(8, 1500, mat('#b87333', { metal: 0.8, rough: 0.4, realistic: R }));
      r.position.y = -750;
      return r;
    }
    case 'meter-box':
      return box(400, 400, 160, mat('#cfd4da', { realistic: R }), 0);
    case 'inverter':
      return box(500, 360, 180, mat('#e9ecef', { realistic: R }), 0);
    case 'generator':
      return box(900, 600, 500, mat('#d9a400', { realistic: R }), 300);
    // ----- control panel devices -----
    case 'estop': {
      const g = generic(c, '#f2d21b', o, 5);
      const mush = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d42a2a', { realistic: R }));
      mush.position.y = 5.5;
      g.add(mush);
      return g;
    }
    case 'pilot-lamp': {
      const col = { green: '#34c759', red: '#ff3b30', amber: '#ff9f0a', white: '#f4f4f4', blue: '#2f7dff' }[String(pr.color)] ?? '#34c759';
      const g = generic(c, '#2c3036', o, 4);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(col, { emissive: col, ei: o.active ? 2 : 0, opacity: 0.9, realistic: R }));
      lens.position.y = 4.5;
      g.add(lens);
      return g;
    }
    case 'limit-switch':
      return generic(c, '#c9a227', o, 6);
    case 'overload':
      return generic(c, '#9aa4b1', o, 6);
    case 'mcb': {
      const g = generic(c, '#f2f2f2', o, 8);
      const tog = box(1.6, 2, 1.6, mat(pr.closed ? '#2e9b3d' : '#d42a2a', { realistic: R }), 9.5);
      g.add(tog);
      return g;
    }
    case 'plc-module':
      return generic(c, '#5c6672', o, 5);
    default:
      return generic(c, '#6b7684', o);
  }
}
