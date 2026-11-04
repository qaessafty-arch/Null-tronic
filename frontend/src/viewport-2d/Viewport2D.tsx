import { useEffect, useRef, useState } from 'react';
import { store, setView, useStore } from '../state/store';
import { dispatchPointer, registerAdapter, type InputSource } from '../input-system/input';
import { primitiveBounds, isEmptyBounds } from '../drawing/primitives';
import { scenePrimitives } from '../drawing/scene';
import { readPalette, render2D, toWorld, type Palette, type View2D } from './render';
import { ContextMenu } from '../components/ContextMenu';

/**
 * 2D engineering canvas. Converts DOM pointer events into shared PointerInput and renders the
 * model through the same primitive pipeline used for printing.
 */
export function Viewport2D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View2D>({ cx: 25, cy: 15, scale: 8, w: 800, h: 600 });
  const palRef = useRef<Palette | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const spaceRef = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const theme = useStore((s) => s.view.theme);
  const projectType = useStore((s) => s.project.type);
  const projectId = useStore((s) => s.project.meta.id);

  const draw = useRef<() => void>(() => {});
  const frame = useRef(0);
  const requestDraw = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw.current();
    });
  };

  draw.current = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!palRef.current) palRef.current = readPalette(c);
    render2D(ctx, viewRef.current, store.get(), palRef.current);
  };

  const fit = () => {
    const s = store.get();
    const prims = scenePrimitives(s.project).flatMap((e) => e.prims);
    const b = primitiveBounds(prims);
    const v = viewRef.current;
    if (isEmptyBounds(b)) {
      const inst = s.project.type === 'installation';
      Object.assign(v, { cx: inst ? 5000 : 25, cy: inst ? 4000 : 15, scale: inst ? 0.06 : 8 });
    } else {
      const bw = Math.max(b.maxX - b.minX, s.project.settings.gridMm * 4);
      const bh = Math.max(b.maxY - b.minY, s.project.settings.gridMm * 4);
      v.cx = (b.minX + b.maxX) / 2;
      v.cy = (b.minY + b.maxY) / 2;
      v.scale = Math.min((v.w * 0.85) / bw, (v.h * 0.85) / bh);
    }
    requestDraw();
  };

  // size & DPR
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const c = canvasRef.current!;
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.floor(r.width * dpr));
      c.height = Math.max(1, Math.floor(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      viewRef.current.w = r.width;
      viewRef.current.h = r.height;
      requestDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    palRef.current = null;
    requestDraw();
  }, [theme]);

  useEffect(() => {
    // fit when a different project is opened
    setTimeout(fit, 0);
  }, [projectId, projectType]);

  useEffect(() => store.subscribe(requestDraw), []);

  // adapter for hand tracking & global commands
  useEffect(
    () =>
      registerAdapter({
        kind: '2d',
        normalizedToWorld: (nx, ny) => toWorld(viewRef.current, { x: nx * viewRef.current.w, y: ny * viewRef.current.h }),
        tolerance: () => 8 / viewRef.current.scale,
        zoomAt: (f, nx = 0.5, ny = 0.5) => zoomAt(f, nx * viewRef.current.w, ny * viewRef.current.h),
        panBy: (dx, dy) => {
          const v = viewRef.current;
          v.cx += (dx * v.w) / v.scale;
          v.cy += (dy * v.h) / v.scale;
          requestDraw();
        },
        fit,
      }),
    [],
  );

  const zoomAt = (factor: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const before = toWorld(v, { x: sx, y: sy });
    v.scale = Math.min(Math.max(v.scale * factor, 0.002), 400);
    const after = toWorld(v, { x: sx, y: sy });
    v.cx += before.x - after.x;
    v.cy += before.y - after.y;
    requestDraw();
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const send = (phase: 'down' | 'move' | 'up', e: React.PointerEvent) => {
    const l = local(e);
    const source: InputSource = e.pointerType === 'touch' ? 'touch' : 'mouse';
    dispatchPointer({ phase, world: toWorld(viewRef.current, l), source, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, tolerance: 8 / viewRef.current.scale, detail: e.detail });
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const c = canvasRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), l.x, l.y);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, []);

  const rightDown = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  return (
    <div ref={wrapRef} className="viewport viewport-2d" data-testid="viewport-2d" onPointerEnter={() => setView({ active: '2d' })}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="2D engineering canvas"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          (e.target as HTMLElement).focus();
          setMenu(null);
          if (e.button === 1 || e.button === 2 || spaceRef.current) {
            panRef.current = local(e);
            if (e.button === 2) rightDown.current = { ...local(e), moved: false };
            return;
          }
          send('down', e);
        }}
        onPointerMove={(e) => {
          if (panRef.current) {
            const l = local(e);
            const v = viewRef.current;
            v.cx -= (l.x - panRef.current.x) / v.scale;
            v.cy -= (l.y - panRef.current.y) / v.scale;
            if (rightDown.current && Math.hypot(l.x - rightDown.current.x, l.y - rightDown.current.y) > 4) rightDown.current.moved = true;
            panRef.current = l;
            requestDraw();
            return;
          }
          send('move', e);
        }}
        onPointerUp={(e) => {
          if (panRef.current) {
            panRef.current = null;
            if (e.button === 2 && rightDown.current && !rightDown.current.moved) {
              // right click without drag: select under cursor and open context menu
              const l = local(e);
              dispatchPointer({ phase: 'down', world: toWorld(viewRef.current, l), source: 'mouse', button: 0, shift: false, ctrl: false, alt: false, tolerance: 8 / viewRef.current.scale, detail: 1 });
              dispatchPointer({ phase: 'up', world: toWorld(viewRef.current, l), source: 'mouse', button: 0, shift: false, ctrl: false, alt: false, tolerance: 8 / viewRef.current.scale, detail: 1 });
              setMenu(l);
            }
            rightDown.current = null;
            return;
          }
          send('up', e);
        }}
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
