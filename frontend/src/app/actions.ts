import { store, log } from '../state/store';
import { download, pickFile } from './file-ops';
import { exportDxf, importDxf } from '../export/dxf';
import { importSpice } from '../export/spice-import';
import { toSpice } from '../simulation/spice';
import { execute, loadProject } from '../history/history';
import { addAnnotations, addRoom } from '../project-model/operations';
import { newId } from '../project-model/ids';
import { composeSheet } from '../printing/sheet';
import { buildPdf } from '../export/pdf';
import { sheetToSvg } from '../export/svg';
import { export3D } from '../viewport-3d/Viewport3D';
import { requestBackend } from '../hand-tracking/client';
import type { DrawingSheet, Project } from '../project-model/types';
import { calculateInstallation } from '../calculations/installation';
import { validateProject, overallStatus } from '../calculations/validation';
import { buildBom } from '../calculations/bom';
import { formatSI } from '../calculations/units';

const base = (p: Project) => (p.meta.name || 'project').replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase();

export function exportSpiceNetlist(): void {
  const p = store.get().project;
  const s = store.get().sim;
  const analysis = s.analysis === 'tran' ? { kind: 'tran' as const, tstop: s.tstop, step: s.tstop / s.steps } : s.analysis === 'ac' ? { kind: 'ac' as const, fstart: s.fstart, fstop: s.fstop, ppd: s.ppd } : { kind: 'op' as const };
  download(`${base(p)}.cir`, toSpice(p, { analysis, states: new Map(Object.entries(s.states)) }), 'text/plain');
  log('info', 'Exported SPICE netlist (ngspice dialect)', true);
}

export function exportDxfFile(): void {
  const p = store.get().project;
  download(`${base(p)}.dxf`, exportDxf(p), 'application/dxf');
  log('info', 'Exported DXF (R12, model space 1:1, millimetres)', true);
}

export function exportDrawings(sheets: DrawingSheet[], kind: 'pdf' | 'svg' | 'png' | 'jpeg', monochrome = true): void {
  const p = store.get().project;
  const composed = sheets.map((s, i) => composeSheet(p, s, i + 1, sheets.length));
  composed.forEach((c) => c.warnings.forEach((w) => log('warn', w)));
  if (kind === 'pdf') {
    const bytes = buildPdf(composed, { title: p.meta.name, author: p.meta.author, monochrome });
    download(`${base(p)}-drawings.pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    log('info', `Exported vector PDF (${composed.length} sheet${composed.length > 1 ? 's' : ''})`, true);
    return;
  }
  composed.forEach((c, i) => {
    const svg = sheetToSvg(c, { monochrome });
    const name = `${base(p)}-${sheets[i].number || i + 1}`;
    if (kind === 'svg') {
      download(`${name}.svg`, svg, 'image/svg+xml');
      return;
    }
    // raster: 200 dpi render of the vector sheet
    const dpi = 200;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((c.width / 25.4) * dpi);
      canvas.height = Math.round((c.height / 25.4) * dpi);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => b && download(`${name}.${kind === 'png' ? 'png' : 'jpg'}`, b), kind === 'png' ? 'image/png' : 'image/jpeg', 0.92);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  log('info', `Exported ${kind.toUpperCase()} drawing(s)`, true);
}

/** Print through the browser's print system using vector SVG pages (not a UI screenshot). */
export function printDrawings(sheets: DrawingSheet[], monochrome = true): void {
  const p = store.get().project;
  const composed = sheets.map((s, i) => composeSheet(p, s, i + 1, sheets.length));
  const w = window.open('', '_blank');
  if (!w) {
    log('error', 'Pop-up blocked: allow pop-ups to print, or export a PDF instead.');
    return;
  }
  const pages = composed.map((c) => `<div class="page" style="width:${c.width}mm;height:${c.height}mm">${sheetToSvg(c, { monochrome }).replace(/^<\?xml[^>]*>/, '')}</div>`).join('');
  const first = composed[0];
  w.document.write(`<!doctype html><html><head><title>${p.meta.name} — drawings</title><style>
    @page { size: ${first.width}mm ${first.height}mm; margin: 0 }
    html,body{margin:0;padding:0;background:#fff}
    .page{page-break-after:always;overflow:hidden}
    .page svg{width:100%;height:100%;display:block}
  </style></head><body>${pages}<script>window.onload=()=>{window.focus();window.print();}<\/script></body></html>`);
  w.document.close();
}

export async function importSpiceFile(): Promise<void> {
  const f = await pickFile('.cir,.sp,.spice,.net,.txt');
  if (!f) return;
  const r = importSpice(await f.text(), f.name.replace(/\.[^.]+$/, ''));
  loadProject(r.project, `${f.name}.ntcs.json`);
  log(r.skipped.length ? 'warn' : 'info', `Imported ${r.imported} element(s) from ${f.name}${r.skipped.length ? `; ${r.skipped.length} line(s) not supported: ${r.skipped.map((s) => s.text.split(/\s+/)[0]).join(', ')}` : ''}`, true);
}

export async function importDxfFile(asRooms: boolean): Promise<void> {
  const f = await pickFile('.dxf');
  if (!f) return;
  const r = importDxf(await f.text());
  const p = store.get().project;
  execute(`Import DXF ${f.name}`, (q) => {
    let out = addAnnotations(q, r.annotations);
    if (asRooms && p.type === 'installation') {
      r.closedPolylines.forEach((poly, i) => {
        out = addRoom(out, { id: newId('room'), name: `Imported room ${i + 1}`, polygon: poly, floor: 0, height: 3000, wallThickness: 150 });
      });
    }
    return out;
  });
  const skipped = Object.entries(r.skipped).map(([k, v]) => `${v}× ${k}`).join(', ');
  log(skipped ? 'warn' : 'info', `DXF: ${r.annotations.length} entities imported to layer "underlay" (unit scale ×${r.unitScale})${asRooms ? `, ${r.closedPolylines.length} closed polylines → rooms` : ''}${skipped ? `; not imported: ${skipped}` : ''}`, true);
}

export { export3D };

/** Cross-check the current circuit with ngspice through the local backend service. */
export async function verifyWithNgspice(): Promise<void> {
  const p = store.get().project;
  try {
    const res = await requestBackend({ type: 'simulate', netlist: toSpice(p, { analysis: { kind: 'op' }, states: new Map(Object.entries(store.get().sim.states)) }) });
    if (res.ok) {
      const v = res.vectors as Record<string, number>;
      log('info', `ngspice operating point: ${Object.entries(v).slice(0, 12).map(([k, x]) => `${k}=${formatSI(x, '')}`).join(', ')}`, true);
      store.set({ view: { ...store.get().view, bottom: true, bottomTab: 'console' } });
    } else log('error', `ngspice: ${String(res.error)}`);
  } catch (e) {
    log('error', `ngspice verification unavailable: ${(e as Error).message}. Start the local service (backend/) with ngspice installed.`);
  }
}

/** Engineering / lab report as a standalone HTML document. */
export function buildReportHtml(project: Project): string {
  const s = store.get();
  const findings = validateProject(project);
  const status = overallStatus(findings);
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let body = `<h1>${esc(project.meta.name)}</h1><p class="meta">${esc(project.type)} project · revision ${esc(project.meta.revision)} · generated ${new Date().toLocaleString()} by NULL-TECH CIRCUIT STUDIO</p>`;
  body += `<p class="status st-${status.status}"><b>Design status:</b> ${esc(status.label)}</p>`;
  if (project.meta.description) body += `<p>${esc(project.meta.description)}</p>`;
  body += '<h2>Findings</h2>' + (findings.length ? `<table><tr><th>Status</th><th>Code</th><th>Message</th><th>Basis</th></tr>${findings.map((f) => `<tr><td>${f.status}</td><td>${f.code}</td><td>${esc(f.message)}</td><td>${esc(f.basis ?? '')}</td></tr>`).join('')}</table>` : '<p>No findings within the supported checks.</p>');
  if (project.type === 'installation') {
    const rep = calculateInstallation(project);
    body += '<h2>Circuit calculations</h2><table><tr><th>Circuit</th><th>Load W</th><th>Ib A</th><th>Breaker</th><th>Cable mm²</th><th>Length m</th><th>ΔU %</th><th>Status</th></tr>';
    body += rep.circuits.map((c) => `<tr><td>${c.name}</td><td>${c.connectedW.toFixed(0)}</td><td>${c.ibA.toFixed(2)}</td><td>${c.breakerA ?? '—'} (${c.breakerSource})</td><td>${c.csaMm2 ?? '—'} (${c.csaSource})</td><td>${c.totalLengthM.toFixed(1)}</td><td>${c.dropPct.toFixed(2)} / ${c.dropLimitPct}</td><td>${c.status}</td></tr>`).join('') + '</table>';
    const assumptions = [...new Set(rep.circuits.flatMap((c) => c.assumptions.map((a) => a.text + (a.source ? ` [${a.source}]` : ''))))];
    const formulae = [...new Set(rep.circuits.flatMap((c) => c.formulae))];
    body += `<h2>Formulae</h2><ul>${formulae.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul><h2>Assumptions</h2><ul>${assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
  } else {
    const r = s.sim.result;
    if (r && r.ok && r.kind === 'op' && s.sim.forProject === project) {
      body += `<h2>Operating point (${r.method}, ${r.iterations} iterations)</h2><table><tr><th>Net</th><th>Voltage</th></tr>${Object.entries(r.nodeVoltages).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${formatSI(v, 'V', 5)}</td></tr>`).join('')}</table>`;
      body += `<table><tr><th>Component</th><th>V</th><th>I</th><th>P</th><th>State</th></tr>${Object.entries(r.components).map(([id, c]) => `<tr><td>${esc(project.components[id]?.ref ?? id)}</td><td>${c.voltage !== undefined ? formatSI(c.voltage, 'V', 4) : ''}</td><td>${c.current !== undefined ? formatSI(c.current, 'A', 4) : ''}</td><td>${c.power !== undefined ? formatSI(c.power, 'W', 4) : ''}</td><td>${c.state === undefined ? '' : c.state ? 'on/closed' : 'off/open'}</td></tr>`).join('')}</table>`;
    } else body += '<p><i>No current operating-point result. Run Simulation ▸ Operating point before generating the report to include measured values.</i></p>';
    body += '<h2>Method</h2><p>Modified nodal analysis with Newton–Raphson; Shockley diode, Ebers–Moll BJT and square-law MOSFET models; trapezoidal transient integration. Results are model predictions, not measurements.</p>';
  }
  const bom = buildBom(project);
  body += `<h2>Bill of materials</h2><table><tr><th>Description</th><th>Qty</th><th>Refs</th></tr>${bom.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${l.quantity} ${l.unit}</td><td>${esc(l.refs.join(', '))}</td></tr>`).join('')}</table>`;
  if (project.meta.notes) body += `<h2>Notes</h2><p>${esc(project.meta.notes)}</p>`;
  body += '<p class="disclaimer">This report is engineering assistance output. It is not a certificate of safety or compliance; the design must be verified by a qualified engineer against the applicable standards and regulations.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.meta.name)} — report</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:32px auto;color:#16191d;padding:0 16px}h1{font-size:24px;margin-bottom:0}h2{font-size:16px;margin-top:28px;border-bottom:2px solid #0e9f57;padding-bottom:4px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #c9ced4;padding:4px 6px;text-align:left}th{background:#f1f3f5}.meta{color:#5b6570}.status{padding:8px 10px;border-left:4px solid #0e9f57;background:#f1f3f5}.st-error{border-color:#d33}.st-warning{border-color:#d99a00}.disclaimer{margin-top:32px;color:#5b6570;font-size:12px}</style></head><body>${body}</body></html>`;
}
