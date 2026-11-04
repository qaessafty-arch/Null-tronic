import { getDef } from '../component-library/library';
import { scenePrimitives } from '../drawing/scene';
import type { Primitive } from '../drawing/primitives';
import { attachmentCounts, buildNetlist, pinKey } from '../project-model/connectivity';
import { pinWorldPosition, wirePolyline } from '../project-model/geometry';
import type { Project, Vec2 } from '../project-model/types';
import type { AppState } from '../state/store';
import { formatSI } from '../calculations/units';

export interface View2D {
  cx: number;
  cy: number;
  /** pixels per millimetre */
  scale: number;
  w: number;
  h: number;
}

export interface Palette {
  bg: string;
  grid: string;
  gridMajor: string;
  ink: string;
  muted: string;
  accent: string;
  accentSoft: string;
  warn: string;
  error: string;
  wire: string;
  room: string;
  cable: string;
  select: string;
}

export function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    bg: v('--canvas-bg', '#0d1014'),
    grid: v('--canvas-grid', '#1a2027'),
    gridMajor: v('--canvas-grid-major', '#242c35'),
    ink: v('--canvas-ink', '#d8dee6'),
    muted: v('--text-muted', '#7d8794'),
    accent: v('--accent', '#2bd97a'),
    accentSoft: v('--accent-soft', 'rgba(43,217,122,0.18)'),
    warn: v('--warn', '#f2b84b'),
    error: v('--error', '#f05252'),
    wire: v('--canvas-wire', '#2bd97a'),
    room: v('--canvas-room', '#8a96a3'),
    cable: v('--canvas-cable', '#f2b84b'),
    select: v('--select', '#5cc8ff'),
  };
}

export const toScreen = (v: View2D, p: Vec2): Vec2 => ({ x: (p.x - v.cx) * v.scale + v.w / 2, y: (p.y - v.cy) * v.scale + v.h / 2 });
export const toWorld = (v: View2D, p: Vec2): Vec2 => ({ x: (p.x - v.w / 2) / v.scale + v.cx, y: (p.y - v.h / 2) / v.scale + v.cy });

function drawPrim(ctx: CanvasRenderingContext2D, v: View2D, p: Primitive, color: string, minW: number, widthScale = 1) {
  const S = (q: Vec2) => toScreen(v, q);
  const lw = Math.max(minW, ('w' in p && p.w !== undefined ? p.w : 0.25) * v.scale) * widthScale;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  if ('dash' in p && p.dash) ctx.setLineDash(p.dash.map((d) => Math.max(2, d * v.scale)));
  else ctx.setLineDash([]);
  switch (p.k) {
    case 'line': {
      const a = S(p.a);
      const b = S(p.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case 'poly': {
      if (p.pts.length < 2) break;
      ctx.beginPath();
      const a = S(p.pts[0]);
      ctx.moveTo(a.x, a.y);
      for (const q of p.pts.slice(1)) {
        const s = S(q);
        ctx.lineTo(s.x, s.y);
      }
      if (p.closed) ctx.closePath();
      if (p.fill) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'circle': {
      const c = S(p.c);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(p.r * v.scale, 1), 0, Math.PI * 2);
      if (p.fill) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'arc': {
      const c = S(p.c);
      ctx.beginPath();
      ctx.arc(c.x, c.y, p.r * v.scale, (p.a0 * Math.PI) / 180, (p.a1 * Math.PI) / 180);
      ctx.stroke();
      break;
    }
    case 'text': {
      const px = p.size * v.scale;
      if (px < 4) break;
      const c = S(p.p);
      ctx.font = `${p.bold ? '600 ' : ''}${px}px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = (p.anchor === 'middle' || !p.anchor ? 'center' : p.anchor === 'end' ? 'right' : 'left') as CanvasTextAlign;
      ctx.textBaseline = p.baseline === 'top' ? 'top' : p.baseline === 'bottom' ? 'alphabetic' : 'middle';
      ctx.fillText(p.text, c.x, c.y);
      break;
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View2D, gridMm: number, pal: Palette) {
  let step = gridMm;
  while (step * v.scale < 8) step *= gridMm >= 100 ? 5 : 2;
  const major = step * 5;
  const tl = toWorld(v, { x: 0, y: 0 });
  const br = toWorld(v, { x: v.w, y: v.h });
  ctx.setLineDash([]);
  for (const [s, col] of [
    [step, pal.grid],
    [major, pal.gridMajor],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / s) * s; x <= br.x; x += s) {
      const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, v.h);
    }
    for (let y = Math.floor(tl.y / s) * s; y <= br.y; y += s) {
      const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(v.w, sy);
    }
    ctx.stroke();
  }
  // origin cross
  const o = toScreen(v, { x: 0, y: 0 });
  ctx.strokeStyle = pal.muted;
  ctx.beginPath();
  ctx.moveTo(o.x - 6, o.y);
  ctx.lineTo(o.x + 6, o.y);
  ctx.moveTo(o.x, o.y - 6);
  ctx.lineTo(o.x, o.y + 6);
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, at: Vec2, text: string, fg: string, bg: string, border: string) {
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.rect(Math.round(at.x) + 0.5, Math.round(at.y) + 0.5, w, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x + 5, at.y + 9.5);
}

const sceneCache = new WeakMap<Project, ReturnType<typeof scenePrimitives>>();
function cachedScene(p: Project) {
  let s = sceneCache.get(p);
  if (!s) {
    s = scenePrimitives(p);
    sceneCache.set(p, s);
  }
  return s;
}

export function render2D(ctx: CanvasRenderingContext2D, v: View2D, st: AppState, pal: Palette): void {
  const p = st.project;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, v.w, v.h);
  if (st.view.showGrid) drawGrid(ctx, v, p.settings.gridMm, pal);
  const selected = new Set(st.selection);
  // circuits / net highlight
  const highlight = new Set<string>();
  let netlist: ReturnType<typeof buildNetlist> | null = null;
  if (p.type !== 'installation') {
    netlist = buildNetlist(p);
    const hp = st.hover.pin;
    if (hp) {
      const net = netlist.pinNet.get(pinKey(hp.componentId, hp.pinId));
      if (net) netlist.byName.get(net)?.wires.forEach((w) => highlight.add(w));
    }
  } else {
    for (const id of st.selection) {
      const c = p.circuits[id] ?? (p.cables[id] ? p.circuits[p.cables[id].circuitId] : undefined);
      if (c) Object.values(p.cables).filter((k) => k.circuitId === c.id).forEach((k) => highlight.add(k.id));
    }
  }
  const minW = 1;
  for (const e of cachedScene(p)) {
    const isSel = selected.has(e.id);
    const isHover = st.hover.id === e.id;
    let color = pal.ink;
    if (e.kind === 'wire') color = netlist && netlist.byName.get(netlist.wireNet.get(e.id) ?? '')?.isGround ? pal.muted : pal.wire;
    else if (e.kind === 'junction') color = pal.wire;
    else if (e.kind === 'room') color = pal.room;
    else if (e.kind === 'cable') {
      const cb = p.cables[e.id];
      const cc = cb ? p.circuits[cb.circuitId] : undefined;
      color = cc ? phaseColor(cc.phase, p, pal) : pal.cable;
    } else if (e.kind === 'annotation') color = e.layer === 'underlay' ? pal.muted : pal.ink;
    if (isSel) color = pal.select;
    else if (isHover || highlight.has(e.id)) color = pal.accent;
    const widthScale = isSel || highlight.has(e.id) ? 2 : 1;
    if (e.kind === 'room') {
      // walls: filled band
      for (const pr of e.prims) {
        if (pr.k === 'poly') {
          ctx.globalAlpha = 0.18;
          drawPrim(ctx, v, pr, color, 2);
          ctx.globalAlpha = 1;
          drawPrim(ctx, v, { ...pr, w: 0 }, color, 1);
        } else drawPrim(ctx, v, pr, pal.muted, minW);
      }
      continue;
    }
    for (const pr of e.prims) drawPrim(ctx, v, pr, color, e.kind === 'cable' ? 1.5 : minW, widthScale);
  }

  // pins & open-pin markers (electronic / control)
  if (p.type !== 'installation' && v.scale > 2.5) {
    const counts = attachmentCounts(p);
    for (const c of Object.values(p.components)) {
      const def = getDef(c.type);
      for (const pd of def.pins) {
        const q = toScreen(v, pinWorldPosition(c, pd.id));
        const key = pinKey(c.id, pd.id);
        const net = netlist?.pinNet.get(key);
        const connected = (counts.get(key) ?? 0) > 0 || (net ? (netlist!.byName.get(net)?.pins.length ?? 0) > 1 : false);
        const hovered = st.hover.pin && st.hover.pin.componentId === c.id && st.hover.pin.pinId === pd.id;
        ctx.setLineDash([]);
        if (hovered) {
          ctx.strokeStyle = pal.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
          ctx.stroke();
        } else if (!connected && c.type !== 'ground') {
          ctx.strokeStyle = pal.error;
          ctx.lineWidth = 1;
          ctx.strokeRect(q.x - 2.5, q.y - 2.5, 5, 5);
        }
      }
    }
  }

  // simulation overlay: node voltages
  const r = st.sim.result;
  if (r && r.ok && r.kind === 'op' && netlist && st.sim.forProject === p) {
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    for (const net of netlist.nets) {
      if (net.isGround) continue;
      const vv = r.nodeVoltages[net.name];
      if (vv === undefined) continue;
      let at: Vec2 | null = null;
      if (net.wires.length) {
        const pts = wirePolyline(p, p.wires[net.wires[0]]);
        if (pts.length >= 2) at = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      }
      if (!at && net.pins[0]) at = pinWorldPosition(p.components[net.pins[0].componentId], net.pins[0].pinId);
      if (!at) continue;
      const s = toScreen(v, at);
      label(ctx, { x: s.x + 4, y: s.y - 22 }, formatSI(vv, 'V'), pal.bg, pal.accent, pal.accent);
    }
  }

  // preview
  const pv = st.preview;
  if (pv) {
    const col = pv.status === 'invalid' ? pal.error : pv.status === 'warning' ? pal.warn : pal.accent;
    ctx.globalAlpha = 0.9;
    for (const pr of pv.prims) drawPrim(ctx, v, pr.k === 'poly' && pr.w === 0 ? { ...pr, w: 0.01 } : pr, col, 1.5, 1);
    ctx.globalAlpha = 1;
    if (pv.label) {
      const s = toScreen(v, pv.label.at);
      label(ctx, { x: s.x + 14, y: s.y + 10 }, pv.label.text, pal.ink, pal.bg, col);
    }
    if (pv.messages.length && st.pending) {
      const s = pv.label ? toScreen(v, pv.label.at) : { x: 20, y: 20 };
      pv.messages.slice(0, 3).forEach((m, i) => label(ctx, { x: s.x + 14, y: s.y + 32 + i * 20 }, m, col, pal.bg, col));
    }
  }

  // hand cursor
  const h = st.hand;
  if (h.connection === 'connected' && h.cursor && st.view.active === '2d') {
    const x = h.cursor.x * v.w;
    const y = h.cursor.y * v.h;
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = h.paused ? pal.muted : pal.accent;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    if (h.pinching) {
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x - 12, y);
    ctx.moveTo(x + 12, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y - 12);
    ctx.moveTo(x, y + 12);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
  }
}

export function phaseColor(phase: string, p: Project, pal: Palette): string {
  const c = p.settings.conductorColors;
  if (phase === 'L1') return c.L1 === '#8b5a2b' ? '#c98a4b' : c.L1; // lighten brown for dark canvas legibility
  if (phase === 'L2') return '#b8c1cc';
  if (phase === 'L3') return c.L3;
  return pal.cable;
}
