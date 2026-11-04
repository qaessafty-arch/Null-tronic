import { useEffect, useRef } from 'react';
import { formatSI } from '../calculations/units';

const COLORS = ['#2bd97a', '#5cc8ff', '#f2b84b', '#c084fc', '#f472b6', '#22d3ee', '#a3e635', '#fb923c'];

export interface PlotSeries {
  name: string;
  values: ArrayLike<number>;
  unit: string;
}

/** Lightweight canvas plot for transient (linear x) and AC (log x) results. */
export function Waveform({ x, series, xUnit, logX }: { x: ArrayLike<number>; series: PlotSeries[]; xUnit: string; logX?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const draw = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cs = getComputedStyle(c);
      const ink = cs.getPropertyValue('--text-muted').trim() || '#7d8794';
      const grid = cs.getPropertyValue('--border').trim() || '#262d36';
      ctx.clearRect(0, 0, r.width, r.height);
      const L = 58;
      const R = 10;
      const T = 10;
      const B = 24;
      const W = r.width - L - R;
      const H = r.height - T - B;
      if (W < 20 || H < 20 || x.length < 2) return;
      const tx = (v: number) => (logX ? Math.log10(v) : v);
      const x0 = tx(x[0]);
      const x1 = tx(x[x.length - 1]);
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const s of series) for (let i = 0; i < s.values.length; i++) {
        y0 = Math.min(y0, s.values[i]);
        y1 = Math.max(y1, s.values[i]);
      }
      if (!Number.isFinite(y0)) return;
      if (y1 - y0 < 1e-12) {
        y0 -= 1;
        y1 += 1;
      }
      const pad = (y1 - y0) * 0.08;
      y0 -= pad;
      y1 += pad;
      const X = (v: number) => L + ((tx(v) - x0) / (x1 - x0 || 1)) * W;
      const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * H;
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.strokeStyle = grid;
      ctx.fillStyle = ink;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const yv = y0 + ((y1 - y0) * i) / 5;
        const py = Math.round(Y(yv)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(L, py);
        ctx.lineTo(L + W, py);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatSI(yv, series[0]?.unit ?? '', 3), L - 4, py);
      }
      for (let i = 0; i <= 6; i++) {
        const xv = logX ? Math.pow(10, x0 + ((x1 - x0) * i) / 6) : x0 + ((x1 - x0) * i) / 6;
        const px = Math.round(X(xv)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, T);
        ctx.lineTo(px, T + H);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(formatSI(xv, xUnit, 3), px, T + H + 4);
      }
      series.forEach((s, k) => {
        ctx.strokeStyle = COLORS[k % COLORS.length];
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < s.values.length; i++) {
          const px = X(x[i]);
          const py = Y(s.values[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [x, series, xUnit, logX]);
  return (
    <div className="waveform">
      <canvas ref={ref} />
      <div className="legend">
        {series.map((s, k) => (
          <span key={s.name}>
            <i style={{ background: COLORS[k % COLORS.length] }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
