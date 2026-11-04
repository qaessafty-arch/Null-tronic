import { primitiveBounds, isEmptyBounds, text, line, rect, type Primitive, type Bounds } from '../drawing/primitives';
import { scenePrimitives } from '../drawing/scene';
import { singleLinePrimitives } from '../drawing/singleline';
import { calculateInstallation } from '../calculations/installation';
import { buildBom } from '../calculations/bom';
import type { DrawingSheet, Project } from '../project-model/types';

/**
 * Engineering drawing sheet composition (ISO 216 paper, border, zone references, title block).
 * Output is a list of primitives in paper millimetres; SVG / PDF / PNG writers render it.
 */

export const PAPER: Record<Exclude<DrawingSheet['paper'], 'custom'>, { w: number; h: number }> = {
  A0: { w: 841, h: 1189 },
  A1: { w: 594, h: 841 },
  A2: { w: 420, h: 594 },
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
};

export interface ComposedSheet {
  width: number;
  height: number;
  prims: Primitive[];
  warnings: string[];
  scaleLabel: string;
}

export function paperSize(s: DrawingSheet): { w: number; h: number } {
  const base = s.paper === 'custom' ? { w: s.customSize?.width ?? 210, h: s.customSize?.height ?? 297 } : PAPER[s.paper];
  const short = Math.min(base.w, base.h);
  const long = Math.max(base.w, base.h);
  return s.orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long };
}

const TB_W = 180;
const TB_H = 48;

function titleBlock(project: Project, s: DrawingSheet, x: number, y: number, scaleLabel: string, index: number, count: number): Primitive[] {
  const W = 0.35;
  const t = (px: number, py: number, str: string, size: number, bold = false): Primitive => ({ ...text(px, py, str, size, 'start', 'middle'), bold });
  const lbl = (px: number, py: number, str: string): Primitive => ({ ...text(px, py, str.toUpperCase(), 1.6, 'start', 'top'), color: '#555555' });
  const p: Primitive[] = [rect(x, y, TB_W, TB_H, { w: 0.5 })];
  // rows: 0-12 brand/org, 12-30 project/title, 30-48 data cells
  p.push(line(x, y + 12, x + TB_W, y + 12, W), line(x, y + 30, x + TB_W, y + 30, W), line(x + 60, y, x + 60, y + 12, W));
  p.push(t(x + 3, y + 6, 'NULL-TECH', 4.2, true), { ...text(x + 33, y + 6.3, 'CIRCUIT STUDIO', 2.2, 'start'), color: '#555555' });
  p.push(lbl(x + 62, y + 1.2, 'Organisation / author'), t(x + 62, y + 8, [project.meta.organisation, project.meta.author].filter(Boolean).join(' — ') || '—', 2.6));
  p.push(lbl(x + 2, y + 13.2, 'Project'), t(x + 2, y + 19.5, project.meta.name, 3.2, true));
  p.push(lbl(x + 2, y + 22.2, 'Drawing'), t(x + 2, y + 27, s.title, 2.8));
  const cells: [string, string, number][] = [
    ['Drawing no.', s.number, 36],
    ['Rev.', project.meta.revision, 16],
    ['Date', new Date(project.meta.modifiedAt).toISOString().slice(0, 10), 30],
    ['Scale', scaleLabel, 26],
    ['Sheet', `${index} / ${count}`, 22],
    ['Paper', `${s.paper === 'custom' ? 'Custom' : s.paper} ${s.orientation[0].toUpperCase()}`, 30],
  ];
  let cx = x;
  for (const [k, v, w] of cells) {
    p.push(lbl(cx + 1.5, y + 31.2, k), t(cx + 1.5, y + 39, v, 3, true));
    cx += w;
    if (cx < x + TB_W) p.push(line(cx, y + 30, cx, y + 44, W));
  }
  p.push(line(x, y + 44, x + TB_W, y + 44, W));
  p.push({ ...text(x + TB_W / 2, y + 46, 'Engineering assistance output — verify with a qualified engineer before construction.', 1.5, 'middle', 'middle'), color: '#555555' });
  return p;
}

function frame(w: number, h: number, m: number): Primitive[] {
  const p: Primitive[] = [rect(m, m, w - 2 * m, h - 2 * m, { w: 0.7 }), rect(m + 5, m + 5, w - 2 * m - 10, h - 2 * m - 10, { w: 0.35 })];
  // zone references (ISO 5457 style): numbers across, letters down
  const nx = Math.max(4, Math.round((w - 2 * m) / 50));
  const ny = Math.max(3, Math.round((h - 2 * m) / 50));
  for (let i = 0; i < nx; i++) {
    const x0 = m + ((w - 2 * m) * i) / nx;
    const xc = x0 + (w - 2 * m) / nx / 2;
    if (i > 0) p.push(line(x0, m, x0, m + 5, 0.25), line(x0, h - m - 5, x0, h - m, 0.25));
    p.push(text(xc, m + 2.5, String(i + 1), 2.2), text(xc, h - m - 2.5, String(i + 1), 2.2));
  }
  for (let j = 0; j < ny; j++) {
    const y0 = m + ((h - 2 * m) * j) / ny;
    const yc = y0 + (h - 2 * m) / ny / 2;
    if (j > 0) p.push(line(m, y0, m + 5, y0, 0.25), line(w - m - 5, y0, w - m, y0, 0.25));
    const L = String.fromCharCode(65 + (j % 26));
    p.push(text(m + 2.5, yc, L, 2.2), text(w - m - 2.5, yc, L, 2.2));
  }
  return p;
}

export function table(x: number, y: number, cols: { title: string; width: number; align?: 'start' | 'end' }[], rows: string[][], rowH = 6): Primitive[] {
  const p: Primitive[] = [];
  const W = cols.reduce((a, c) => a + c.width, 0);
  const total = rowH * (rows.length + 1);
  p.push(rect(x, y, W, total, { w: 0.35 }));
  p.push({ ...rect(x, y, W, rowH, { w: 0.35 }) });
  let cx = x;
  for (const c of cols) {
    p.push({ ...text(cx + 1.5, y + rowH / 2, c.title, 2.2, 'start'), bold: true });
    cx += c.width;
    if (cx < x + W) p.push(line(cx, y, cx, y + total, 0.25));
  }
  rows.forEach((r, i) => {
    const ry = y + rowH * (i + 1);
    if (i > 0) p.push(line(x, ry, x + W, ry, 0.18));
    let cx2 = x;
    r.forEach((cell, k) => {
      const c = cols[k];
      if (!c) return;
      const right = c.align === 'end';
      p.push(text(right ? cx2 + c.width - 1.5 : cx2 + 1.5, ry + rowH / 2, cell, 2.1, right ? 'end' : 'start'));
      cx2 += c.width;
    });
  });
  return p;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Transform world primitives into paper space with scale s and offset. */
function placeDrawing(prims: Primitive[], b: Bounds, s: number, ox: number, oy: number, weightScale: number): Primitive[] {
  const tx = (p: { x: number; y: number }) => ({ x: ox + (p.x - b.minX) * s, y: oy + (p.y - b.minY) * s });
  const lw = (w: number | undefined) => clamp((w ?? 0.25) * s, 0.13, 1.0) * weightScale;
  return prims.map((p): Primitive => {
    switch (p.k) {
      case 'line':
        return { ...p, a: tx(p.a), b: tx(p.b), w: lw(p.w), dash: p.dash?.map((d) => clamp(d * s, 0.5, 6)) };
      case 'poly':
        return { ...p, pts: p.pts.map(tx), w: lw(p.w), dash: p.dash?.map((d) => clamp(d * s, 0.5, 6)) };
      case 'circle':
        return { ...p, c: tx(p.c), r: p.r * s, w: lw(p.w) };
      case 'arc':
        return { ...p, c: tx(p.c), r: p.r * s, w: lw(p.w) };
      case 'text':
        return { ...p, p: tx(p.p), size: clamp(p.size * s, 1.6, 6) };
    }
  });
}

function formatScale(s: number): string {
  if (s >= 1) return `${Number(s.toFixed(2))}:1`;
  return `1:${Number((1 / s).toFixed(2))}`;
}

export function composeSheet(project: Project, sheet: DrawingSheet, index = 1, count = 1): ComposedSheet {
  const { w, h } = paperSize(sheet);
  const m = sheet.marginMm;
  const warnings: string[] = [];
  const prims: Primitive[] = [...frame(w, h, m)];
  const areaX = m + 10;
  const areaY = m + 10;
  const areaW = w - 2 * m - 20;
  const areaH = h - 2 * m - 20 - TB_H - 4;
  let scaleLabel = 'NTS';

  const tbX = w - m - 5 - TB_W;
  const tbY = h - m - 5 - TB_H;

  if (sheet.kind === 'schedule' || sheet.kind === 'bom') {
    if (sheet.kind === 'schedule') {
      const rep = calculateInstallation(project);
      const rows = rep.circuits.map((c) => {
        const cc = project.circuits[c.circuitId];
        return [
          c.name,
          c.boardRef,
          c.phase,
          cc.category,
          String(c.deviceCount),
          c.connectedW.toFixed(0),
          c.ibA.toFixed(2),
          `${cc.protection.kind} ${cc.protection.curve}${c.breakerA ?? '?'}${c.breakerSource === 'suggested' ? '*' : ''}`,
          `${cc.cable.material} ${c.csaMm2 ?? '?'}${c.csaSource === 'suggested' ? '*' : ''}`,
          c.totalLengthM.toFixed(1),
          `${c.dropPct.toFixed(2)} / ${c.dropLimitPct}`,
          c.status.toUpperCase(),
        ];
      });
      prims.push({ ...text(areaX, areaY + 4, 'DISTRIBUTION BOARD SCHEDULE', 4, 'start'), bold: true });
      prims.push(
        ...table(
          areaX,
          areaY + 10,
          [
            { title: 'Circuit', width: 16 },
            { title: 'Board', width: 14 },
            { title: 'Phase', width: 13 },
            { title: 'Type', width: 18 },
            { title: 'Devices', width: 15, align: 'end' },
            { title: 'Load W', width: 17, align: 'end' },
            { title: 'Ib A', width: 15, align: 'end' },
            { title: 'Protection', width: 28 },
            { title: 'Cable mm²', width: 22 },
            { title: 'Length m', width: 18, align: 'end' },
            { title: 'ΔU % / limit', width: 24, align: 'end' },
            { title: 'Status', width: 26 },
          ],
          rows,
        ),
      );
      const ny = areaY + 10 + 6 * (rows.length + 1) + 6;
      prims.push(text(areaX, ny, '* suggested by the calculation engine (IEC 60898-1 ratings, IEC 60228 sizes). Ampacity (Iz) is checked only against the project table.', 2, 'start'));
      prims.push(text(areaX, ny + 4, 'Status vocabulary: VALID (within supported checks), WARNING, ERROR, NOT-EVALUATED, REVIEW. No status implies safety or compliance.', 2, 'start'));
      rep.boards.forEach((b, i) => {
        prims.push(text(areaX, ny + 12 + i * 5, `${b.ref}: demand ${b.totalDemandVA.toFixed(0)} VA — L1 ${b.phaseA.L1.toFixed(1)} A, L2 ${b.phaseA.L2.toFixed(1)} A, L3 ${b.phaseA.L3.toFixed(1)} A; incomer ${b.incomerA} A`, 2.3, 'start'));
      });
    } else {
      const bom = buildBom(project);
      prims.push({ ...text(areaX, areaY + 4, 'BILL OF MATERIALS', 4, 'start'), bold: true });
      const rows = bom.lines.map((l, i) => [String(i + 1), l.description, `${l.quantity} ${l.unit}`, l.refs.slice(0, 8).join(', ') + (l.refs.length > 8 ? ' …' : ''), l.unitPrice === null ? '—' : l.unitPrice.toFixed(2), l.total === null ? '—' : l.total.toFixed(2)]);
      prims.push(...table(areaX, areaY + 10, [{ title: '#', width: 10 }, { title: 'Description', width: 90 }, { title: 'Qty', width: 22, align: 'end' }, { title: 'References', width: 80 }, { title: `Unit ${project.settings.currency}`, width: 26, align: 'end' }, { title: 'Total', width: 26, align: 'end' }], rows));
      prims.push(text(areaX, areaY + 10 + 6 * (rows.length + 1) + 6, bom.total === null ? 'No unit prices entered — costs not estimated.' : `Estimated total (entered prices only): ${bom.total.toFixed(2)} ${project.settings.currency}; ${bom.missingPrices} line(s) without price.`, 2.3, 'start'));
    }
  } else {
    let content: Primitive[];
    if (sheet.kind === 'single-line') content = singleLinePrimitives(project);
    else {
      const filter = sheet.kind === 'lighting-plan' ? 'lighting' : sheet.kind === 'power-plan' ? 'power' : 'all';
      content = scenePrimitives(project, { filter }).flatMap((e) => e.prims);
    }
    const b = primitiveBounds(content);
    if (isEmptyBounds(b)) {
      prims.push(text(areaX + areaW / 2, areaY + areaH / 2, 'Empty drawing', 6));
    } else {
      const bw = Math.max(b.maxX - b.minX, 1);
      const bh = Math.max(b.maxY - b.minY, 1);
      let s: number;
      if (sheet.scale > 0 && sheet.kind !== 'single-line') {
        s = 1 / sheet.scale;
        scaleLabel = `1:${sheet.scale}`;
        if (bw * s > areaW || bh * s > areaH) warnings.push(`Drawing does not fit the sheet at 1:${sheet.scale}; choose a larger paper or scale.`);
      } else {
        s = Math.min(areaW / bw, areaH / bh);
        scaleLabel = sheet.kind === 'single-line' ? 'NTS' : formatScale(s);
      }
      const ox = areaX + Math.max(0, (areaW - bw * s) / 2);
      const oy = areaY + Math.max(0, (areaH - bh * s) / 2);
      prims.push(...placeDrawing(content, b, s, ox, oy, sheet.lineWeightScale));
    }
  }
  prims.push(...titleBlock(project, sheet, tbX, tbY, scaleLabel, index, count));
  if (sheet.showWatermark) prims.push({ ...text(m + 8, h - m - 8, 'NULL-TECH', 3, 'start', 'bottom'), color: '#9aa4b1' });
  return { width: w, height: h, prims, warnings, scaleLabel };
}
