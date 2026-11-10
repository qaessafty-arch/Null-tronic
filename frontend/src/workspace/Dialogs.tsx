import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Field } from '../components/Dialog';
import { store, useStore, log } from '../state/store';
import { createProject, defaultSheet } from '../project-model/factory';
import { loadProject, execute, stage } from '../history/history';
import { EXAMPLES } from '../education/examples';
import { composeSheet } from '../printing/sheet';
import { sheetToSvg } from '../export/svg';
import { exportDrawings, printDrawings } from '../app/actions';
import { addSheet, updateMeta, updateSettings, updateSheet } from '../project-model/operations';
import type { AmpacityRow, DrawingSheet, PaperSize, ProjectType } from '../project-model/types';
import { connectHand, disconnectHand, sendToBackend } from '../hand-tracking/client';
import { clearAutosave, listSnapshots, readAutosave } from '../app/file-ops';
import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts } from '../input-system/input';
import { COMMAND_LABELS } from '../input-system/commands';
import { localAssistant, type AssistantReply } from '../assistant/assistant';
import { scenePrimitives } from '../drawing/scene';
import { runSimulation } from '../simulation/run';
import { compilePlc } from '../simulation/plc';
import { getDef } from '../component-library/library';

function NewProjectDialog() {
  const [type, setType] = useState<ProjectType>('electronic');
  const [name, setName] = useState('New project');
  const [unit, setUnit] = useState<'mm' | 'cm' | 'm'>('mm');
  const [voltage, setVoltage] = useState(230);
  const [phases, setPhases] = useState<1 | 3>(1);
  const create = () => {
    let p = createProject(type, name);
    p = updateSettings(p, { displayUnit: type === 'installation' && unit === 'mm' ? 'm' : unit, supplyVoltage: voltage, supplyPhases: phases });
    loadProject(p, 'untitled.ntcs.json');
    store.set({ dialog: null, tool: 'select' });
  };
  const types: [ProjectType, string, string][] = [
    ['electronic', 'Electronic circuit', 'Schematic capture, DC / transient / AC simulation, 3D board view.'],
    ['installation', 'Electrical installation', 'Floor plans, devices, circuits from boards, cable routes, load & voltage-drop calculations.'],
    ['control', 'Control system', 'Relay logic, contactors, push buttons, PLC I/O wiring with interactive simulation.'],
  ];
  return (
    <Dialog title="New project" footer={<><button className="btn" onClick={() => store.set({ dialog: null })}>Cancel</button><button className="btn btn-primary" onClick={create}>Create project</button></>}>
      <div className="type-cards">
        {types.map(([t, title, desc]) => (
          <button key={t} className={`type-card ${type === t ? 'on' : ''}`} onClick={() => { setType(t); setUnit(t === 'installation' ? 'm' : 'mm'); }}>
            <b>{title}</b>
            <span>{desc}</span>
          </button>
        ))}
      </div>
      <Field label="Project name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="row2">
        <Field label="Display units"><select value={unit} onChange={(e) => setUnit(e.target.value as 'mm')}><option>mm</option><option>cm</option><option>m</option></select></Field>
        {type === 'installation' && <Field label="Nominal voltage U0 (V)"><input type="number" value={voltage} onChange={(e) => setVoltage(+e.target.value)} /></Field>}
        {type === 'installation' && <Field label="Supply"><select value={phases} onChange={(e) => setPhases(+e.target.value as 1)}><option value={1}>Single-phase</option><option value={3}>Three-phase</option></select></Field>}
      </div>
      <p className="note">All geometry is stored in millimetres; units only change how values are displayed.</p>
    </Dialog>
  );
}

function PrintDialog() {
  const project = useStore((s) => s.project);
  const [idx, setIdx] = useState(0);
  const [mono, setMono] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(project.sheets.map((s) => s.id)));
  const sheet = project.sheets[Math.min(idx, project.sheets.length - 1)];
  const composed = useMemo(() => (sheet ? composeSheet(project, sheet, idx + 1, project.sheets.length) : null), [project, sheet, idx]);
  const svg = useMemo(() => (composed ? sheetToSvg(composed, { monochrome: mono }) : ''), [composed, mono]);
  const up = (patch: Partial<DrawingSheet>) => sheet && execute(`Sheet ${sheet.number}`, (p) => updateSheet(p, sheet.id, patch));
  const selected = project.sheets.filter((s) => chosen.has(s.id));
  const kinds: DrawingSheet['kind'][] = project.type === 'installation' ? ['installation-plan', 'lighting-plan', 'power-plan', 'cable-plan', 'single-line', 'schedule', 'bom'] : ['schematic', 'bom'];
  return (
    <Dialog title="Drawing sheets — print & export" wide="xl">
      <div className="print-layout">
        <div className="print-side">
          <h4>Sheets</h4>
          {project.sheets.map((s, i) => (
            <div key={s.id} className={`sheet-item ${i === idx ? 'on' : ''}`} onClick={() => setIdx(i)}>
              <input type="checkbox" checked={chosen.has(s.id)} onChange={() => { const n = new Set(chosen); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setChosen(n); }} onClick={(e) => e.stopPropagation()} aria-label={`Include ${s.title}`} />
              <span>{s.number} · {s.title}</span>
            </div>
          ))}
          <button className="btn btn-sm" onClick={() => {
            const n = defaultSheet(project.type);
            const kind = kinds[project.sheets.length % kinds.length];
            const s: DrawingSheet = { ...n, number: `E-${String(project.sheets.length + 1).padStart(3, '0')}`, kind, title: kind.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), scale: kind === 'single-line' || kind === 'schedule' || kind === 'bom' ? 0 : n.scale };
            execute('Add drawing sheet', (p) => addSheet(p, s));
            setChosen(new Set([...chosen, s.id]));
            setIdx(project.sheets.length);
          }}>+ Add sheet</button>
          {sheet && (
            <>
              <h4>Sheet settings</h4>
              <Field label="Title"><input defaultValue={sheet.title} key={sheet.id + 't'} onBlur={(e) => up({ title: e.target.value })} /></Field>
              <Field label="Drawing number"><input defaultValue={sheet.number} key={sheet.id + 'n'} onBlur={(e) => up({ number: e.target.value })} /></Field>
              <Field label="Content"><select value={sheet.kind} onChange={(e) => up({ kind: e.target.value as DrawingSheet['kind'] })}>{kinds.map((k) => <option key={k}>{k}</option>)}</select></Field>
              <div className="row2">
                <Field label="Paper"><select value={sheet.paper} onChange={(e) => up({ paper: e.target.value as PaperSize })}>{['A4', 'A3', 'A2', 'A1', 'A0', 'custom'].map((k) => <option key={k}>{k}</option>)}</select></Field>
                <Field label="Orientation"><select value={sheet.orientation} onChange={(e) => up({ orientation: e.target.value as 'landscape' })}><option>landscape</option><option>portrait</option></select></Field>
              </div>
              {sheet.paper === 'custom' && (
                <div className="row2">
                  <Field label="Width mm"><input type="number" defaultValue={sheet.customSize?.width ?? 500} onBlur={(e) => up({ customSize: { width: +e.target.value, height: sheet.customSize?.height ?? 350 } })} /></Field>
                  <Field label="Height mm"><input type="number" defaultValue={sheet.customSize?.height ?? 350} onBlur={(e) => up({ customSize: { height: +e.target.value, width: sheet.customSize?.width ?? 500 } })} /></Field>
                </div>
              )}
              <div className="row2">
                <Field label="Scale 1:N (0 = fit)"><input type="number" min={0} value={sheet.scale} onChange={(e) => up({ scale: Math.max(0, +e.target.value) })} /></Field>
                <Field label="Margin mm"><input type="number" value={sheet.marginMm} onChange={(e) => up({ marginMm: Math.max(0, +e.target.value) })} /></Field>
              </div>
              <Field label="Line weight ×"><input type="number" step={0.1} value={sheet.lineWeightScale} onChange={(e) => up({ lineWeightScale: Math.max(0.2, +e.target.value) })} /></Field>
              <label className="check"><input type="checkbox" checked={sheet.showWatermark} onChange={() => up({ showWatermark: !sheet.showWatermark })} /> NULL-TECH watermark (outside the drawing area)</label>
              <label className="check"><input type="checkbox" checked={mono} onChange={() => setMono(!mono)} /> Monochrome output</label>
            </>
          )}
        </div>
        <div className="print-preview">
          {composed?.warnings.map((w) => <div key={w} className="finding st-warning">{w}</div>)}
          <div className="paper" dangerouslySetInnerHTML={{ __html: svg.replace(/^<\?xml[^>]*>/, '') }} />
        </div>
      </div>
      <footer className="print-actions">
        <span className="muted">{selected.length} sheet(s) selected · vector output from the engineering model</span>
        <button className="btn" disabled={!selected.length} onClick={() => exportDrawings(selected, 'svg', mono)}>SVG</button>
        <button className="btn" disabled={!selected.length} onClick={() => exportDrawings(selected, 'png', mono)}>PNG</button>
        <button className="btn" disabled={!selected.length} onClick={() => exportDrawings(selected, 'jpeg', mono)}>JPEG</button>
        <button className="btn" disabled={!selected.length} onClick={() => printDrawings(selected, mono)}>Print…</button>
        <button className="btn btn-primary" disabled={!selected.length} onClick={() => exportDrawings(selected, 'pdf', mono)}>Export vector PDF</button>
      </footer>
    </Dialog>
  );
}

function SettingsDialog() {
  const project = useStore((s) => s.project);
  const st = project.settings;
  const set = (label: string, patch: Partial<typeof st>) => execute(label, (p) => updateSettings(p, patch));
  const [row, setRow] = useState<AmpacityRow>({ csaMm2: 2.5, material: 'Cu', insulation: 'PVC', installationMethod: 'B1', ampacityA: 0, source: '' });
  return (
    <Dialog title="Engineering settings" wide>
      <div className="row2">
        <Field label="Nominal voltage U0 (V)"><input type="number" value={st.supplyVoltage} onChange={(e) => set('U0', { supplyVoltage: +e.target.value || 230 })} /></Field>
        <Field label="Frequency (Hz)"><input type="number" value={st.frequencyHz} onChange={(e) => set('Frequency', { frequencyHz: +e.target.value || 50 })} /></Field>
        <Field label="Supply"><select value={st.supplyPhases} onChange={(e) => set('Supply', { supplyPhases: +e.target.value as 1 })}><option value={1}>1-phase</option><option value={3}>3-phase</option></select></Field>
      </div>
      <div className="row2">
        <Field label="ΔU limit lighting (%)" hint="Default: IEC 60364-5-52 Annex G, type A"><input type="number" step={0.1} value={st.voltageDropLimitLighting} onChange={(e) => set('ΔU limit', { voltageDropLimitLighting: +e.target.value })} /></Field>
        <Field label="ΔU limit other uses (%)"><input type="number" step={0.1} value={st.voltageDropLimitOther} onChange={(e) => set('ΔU limit', { voltageDropLimitOther: +e.target.value })} /></Field>
        <Field label="Currency"><input value={st.currency} onChange={(e) => set('Currency', { currency: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={st.alwaysConfirm} onChange={() => set('Confirmation mode', { alwaysConfirm: !st.alwaysConfirm })} /> Require confirmation for every operation (mouse too). Hand-tracking operations always require it.</label>
      <h4>Current-carrying capacity table (Iz)</h4>
      <p className="note">No ampacity values are shipped: enter them from the edition of IEC 60364-5-52 (or national rules, e.g. Iraqi / Kurdistan Region requirements) you design to, including the source. Until a matching row exists, the In ≤ Iz check is reported as “not evaluated”.</p>
      <table className="grid-table">
        <thead><tr><th>Material</th><th>Insulation</th><th>Method</th><th>mm²</th><th>Iz A</th><th>Source</th><th /></tr></thead>
        <tbody>
          {st.ampacityTable.map((r, i) => (
            <tr key={i}><td>{r.material}</td><td>{r.insulation}</td><td>{r.installationMethod}</td><td>{r.csaMm2}</td><td>{r.ampacityA}</td><td>{r.source}</td><td><button className="btn btn-sm" onClick={() => set('Remove ampacity row', { ampacityTable: st.ampacityTable.filter((_, k) => k !== i) })}>Remove</button></td></tr>
          ))}
          <tr>
            <td><select value={row.material} onChange={(e) => setRow({ ...row, material: e.target.value as 'Cu' })}><option>Cu</option><option>Al</option></select></td>
            <td><select value={row.insulation} onChange={(e) => setRow({ ...row, insulation: e.target.value as 'PVC' })}><option>PVC</option><option>XLPE</option></select></td>
            <td><input className="short" value={row.installationMethod} onChange={(e) => setRow({ ...row, installationMethod: e.target.value })} /></td>
            <td><input className="short" type="number" value={row.csaMm2} onChange={(e) => setRow({ ...row, csaMm2: +e.target.value })} /></td>
            <td><input className="short" type="number" value={row.ampacityA} onChange={(e) => setRow({ ...row, ampacityA: +e.target.value })} /></td>
            <td><input placeholder="e.g. IEC 60364-5-52:2009 Table B.52.4" value={row.source} onChange={(e) => setRow({ ...row, source: e.target.value })} /></td>
            <td><button className="btn btn-sm btn-primary" disabled={!(row.ampacityA > 0) || !row.source.trim()} onClick={() => set('Add ampacity row', { ampacityTable: [...st.ampacityTable, row] })}>Add</button></td>
          </tr>
        </tbody>
      </table>
      <h4>Conductor colours (display only — not proof of compliance)</h4>
      <div className="colors">
        {(Object.keys(st.conductorColors) as (keyof typeof st.conductorColors)[]).map((k) => (
          <label key={k} className="color-field">{k}<input type="color" value={st.conductorColors[k]} onChange={(e) => set('Conductor colour', { conductorColors: { ...st.conductorColors, [k]: e.target.value } })} /></label>
        ))}
      </div>
    </Dialog>
  );
}

function ProjectInfoDialog() {
  const p = useStore((s) => s.project);
  const up = (patch: Partial<typeof p.meta>) => execute('Project information', (q) => updateMeta(q, patch));
  return (
    <Dialog title="Project information" wide>
      <div className="row2">
        <Field label="Name"><input defaultValue={p.meta.name} onBlur={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Author"><input defaultValue={p.meta.author} onBlur={(e) => up({ author: e.target.value })} /></Field>
        <Field label="Organisation"><input defaultValue={p.meta.organisation} onBlur={(e) => up({ organisation: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea defaultValue={p.meta.description} onBlur={(e) => up({ description: e.target.value })} /></Field>
      <Field label="Notes (included in reports)"><textarea defaultValue={p.meta.notes} onBlur={(e) => up({ notes: e.target.value })} /></Field>
      <h4>Revisions</h4>
      <table className="grid-table"><thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>Author</th></tr></thead>
        <tbody>{p.meta.revisions.map((r) => <tr key={r.id + r.date}><td>{r.id}</td><td>{r.date}</td><td>{r.description}</td><td>{r.author}</td></tr>)}</tbody></table>
      <button className="btn btn-sm" onClick={() => {
        const desc = window.prompt('Revision description', 'Revised design');
        if (!desc) return;
        const next = String.fromCharCode(p.meta.revision.charCodeAt(0) + 1);
        up({ revision: next, revisions: [...p.meta.revisions, { id: next, date: new Date().toISOString().slice(0, 10), description: desc, author: p.meta.author }] });
      }}>Issue new revision ({String.fromCharCode(p.meta.revision.charCodeAt(0) + 1)})</button>
      <p className="note">Created {new Date(p.meta.createdAt).toLocaleString()} · modified {new Date(p.meta.modifiedAt).toLocaleString()} · schema v{p.schemaVersion}</p>
    </Dialog>
  );
}

const GESTURES: [string, string, string][] = [
  ['Index finger pointing', 'Move the cursor', 'pointer move'],
  ['Thumb–index pinch', 'Select / start drag / start or end a wire / place', 'pointer down'],
  ['Release pinch', 'Finish the current drag or stroke', 'pointer up'],
  ['Open palm (held)', 'Pause hand input and cancel the current preview', 'command: pause'],
  ['Fist (held)', 'Confirm the previewed operation', 'command: confirm'],
  ['V-sign (held)', 'Reject the preview / cancel', 'command: reject'],
  ['Two hands, both pinching, moving', 'Pan the view', 'pan'],
  ['Two hands, both pinching, spreading', 'Zoom', 'zoom'],
];

function HandDialog() {
  const hand = useStore((s) => s.hand);
  const [url, setUrl] = useState(hand.url);
  const [sens, setSens] = useState({ smoothing: 1.0, pinchOn: 0.32, pinchOff: 0.45, stableFrames: 4, margin: 0.12 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0b0e12';
    ctx.fillRect(0, 0, c.width, c.height);
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    hand.landmarks.forEach((lm, h) => {
      ctx.strokeStyle = h ? '#5cc8ff' : '#2bd97a';
      ctx.lineWidth = 2;
      for (const [a, b] of links) {
        if (!lm[a] || !lm[b]) continue;
        ctx.beginPath();
        ctx.moveTo(lm[a][0] * c.width, lm[a][1] * c.height);
        ctx.lineTo(lm[b][0] * c.width, lm[b][1] * c.height);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      lm.forEach((p) => ctx.fillRect(p[0] * c.width - 2, p[1] * c.height - 2, 4, 4));
    });
    if (!hand.landmarks.length) {
      ctx.fillStyle = '#7d8794';
      ctx.font = '13px system-ui';
      ctx.fillText(hand.connection === 'connected' ? 'No hand in view' : 'Not connected', 12, 24);
    }
  }, [hand.landmarks, hand.connection]);
  return (
    <Dialog title="Hand tracking" wide>
      <div className="hand-layout">
        <div>
          <canvas ref={canvasRef} width={320} height={240} className="hand-preview" aria-label="Hand landmark preview" />
          <div className="kv">
            <span>Connection</span><b className={`conn-${hand.connection}`}>{hand.connection}</b>
            <span>Camera</span><b>{hand.camera}</b>
            <span>Frame rate</span><b>{hand.fps.toFixed(1)} fps</b>
            <span>Hands</span><b>{hand.hands}</b>
            <span>Gesture</span><b>{hand.gesture}{hand.paused ? ' (paused)' : ''}</b>
          </div>
          {hand.message && <p className="note">{hand.message}</p>}
        </div>
        <div>
          <Field label="Local service URL" hint="Start it with: cd backend && python -m nulltech_backend (add --replay demo for a camera-free demo)"><input value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          <div className="btn-row">
            {hand.enabled ? <button className="btn" onClick={() => disconnectHand()}>Disable hand tracking</button> : <button className="btn btn-primary" onClick={() => connectHand(url)}>Enable hand tracking</button>}
          </div>
          <h4>Calibration & sensitivity</h4>
          <Field label={`Cursor smoothing (One-Euro min cutoff ${sens.smoothing.toFixed(2)} Hz)`}><input type="range" min={0.2} max={4} step={0.1} value={sens.smoothing} onChange={(e) => setSens({ ...sens, smoothing: +e.target.value })} /></Field>
          <Field label={`Pinch threshold on/off (${sens.pinchOn.toFixed(2)} / ${sens.pinchOff.toFixed(2)} × palm size)`}><input type="range" min={0.15} max={0.5} step={0.01} value={sens.pinchOn} onChange={(e) => setSens({ ...sens, pinchOn: +e.target.value, pinchOff: +e.target.value + 0.13 })} /></Field>
          <Field label={`Stable frames before a gesture fires (${sens.stableFrames})`}><input type="range" min={1} max={12} step={1} value={sens.stableFrames} onChange={(e) => setSens({ ...sens, stableFrames: +e.target.value })} /></Field>
          <Field label={`Active camera region margin (${Math.round(sens.margin * 100)} %)`}><input type="range" min={0} max={0.3} step={0.01} value={sens.margin} onChange={(e) => setSens({ ...sens, margin: +e.target.value })} /></Field>
          <div className="btn-row">
            <button className="btn" disabled={hand.connection !== 'connected'} onClick={() => { sendToBackend({ type: 'config', min_cutoff: sens.smoothing, pinch_on: sens.pinchOn, pinch_off: sens.pinchOff, stable_frames: sens.stableFrames, margin: sens.margin }); log('info', 'Hand-tracking settings sent', true); }}>Apply to service</button>
            <button className="btn" disabled={hand.connection !== 'connected'} onClick={() => sendToBackend({ type: 'calibrate' })}>Calibrate pinch (hold a relaxed open hand)</button>
          </div>
        </div>
      </div>
      <h4>Gesture guide</h4>
      <table className="grid-table"><thead><tr><th>Gesture</th><th>Action</th><th>Command sent</th></tr></thead>
        <tbody>{GESTURES.map(([g, a, c]) => <tr key={g}><td>{g}</td><td>{a}</td><td className="mono">{c}</td></tr>)}</tbody></table>
      <p className="note">The hand-tracking service only produces input commands; the active tool decides what they mean, exactly as with the mouse. Every operation started by hand is previewed and must be confirmed (fist) or rejected (V-sign).</p>
    </Dialog>
  );
}

function ExamplesDialog() {
  const [sel, setSel] = useState(EXAMPLES[0].id);
  const ex = EXAMPLES.find((e) => e.id === sel)!;
  const open = () => {
    const p = ex.build();
    loadProject(p, `${ex.id}.ntcs.json`);
    const a = ex.analysis;
    store.set({ dialog: null, sim: { ...store.get().sim, analysis: a.kind, ...(a.kind === 'tran' ? { tstop: a.tstop, steps: a.steps, uic: !!a.uic } : {}), ...(a.kind === 'ac' ? { fstart: a.fstart, fstop: a.fstop, ppd: a.ppd } : {}) } });
    if (ex.type !== 'installation') setTimeout(() => runSimulation(), 50);
    else store.set({ view: { ...store.get().view, bottom: true, bottomTab: 'schedule' } });
  };
  return (
    <Dialog title="Examples & guided tutorials" wide footer={<><button className="btn" onClick={() => store.set({ dialog: null })}>Close</button><button className="btn btn-primary" onClick={open}>Open example</button></>}>
      <div className="examples">
        <ul className="ex-list">
          {EXAMPLES.map((e) => (
            <li key={e.id} className={e.id === sel ? 'on' : ''} onClick={() => setSel(e.id)}>
              <b>{e.title}</b>
              <span className="muted">{e.topic}</span>
            </li>
          ))}
        </ul>
        <div className="ex-detail">
          <h3>{ex.title}</h3>
          <p>{ex.summary}</p>
          <h4>Theory (hand calculation)</h4>
          <ul>{ex.theory.map((t) => <li key={t} className="mono">{t}</li>)}</ul>
          <h4>Steps — build it yourself</h4>
          <ol>{ex.steps.map((t) => <li key={t}>{t}</li>)}</ol>
          <p className="note">Opening the example loads a real, editable project and runs the recommended analysis. Compare the simulated values with the hand calculation, then generate a lab report from the Report tab.</p>
        </div>
      </div>
    </Dialog>
  );
}

function RecoveryDialog() {
  const auto = useMemo(() => readAutosave(), []);
  const snaps = useMemo(() => listSnapshots(), []);
  return (
    <Dialog title="Recovery & snapshots" wide>
      {auto ? (
        <div className="calc-box">
          Autosave of <b>{auto.project.meta.name}</b> from {new Date(auto.savedAt).toLocaleString()}
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={() => { loadProject(auto.project, auto.fileName); store.set({ dialog: null }); log('info', 'Recovered autosaved project', true); }}>Restore</button>
            <button className="btn btn-sm" onClick={() => { clearAutosave(); store.set({ dialog: null }); }}>Discard</button>
          </div>
        </div>
      ) : <p className="empty">No autosave available.</p>}
      <h4>Snapshots (stored in this browser)</h4>
      {snaps.length === 0 && <p className="empty">No snapshots. Use File ▸ Store snapshot.</p>}
      {snaps.map((s) => (
        <div key={s.id} className="sheet-item">
          <span>{s.name} · {new Date(s.savedAt).toLocaleString()}</span>
          <button className="btn btn-sm" onClick={() => { loadProject(s.project, `${s.project.meta.name}.ntcs.json`); store.set({ dialog: null }); }}>Open</button>
        </div>
      ))}
    </Dialog>
  );
}

function ShortcutsDialog() {
  const [map, setMap] = useState(loadShortcuts);
  const [capture, setCapture] = useState<string | null>(null);
  const byCmd = new Map<string, string[]>();
  for (const [k, c] of Object.entries(map)) byCmd.set(c, [...(byCmd.get(c) ?? []), k]);
  useEffect(() => {
    if (!capture) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('ctrl');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      parts.push(e.key.toLowerCase());
      const combo = parts.join('+');
      const next = { ...map };
      for (const [k, c] of Object.entries(next)) if (c === capture) delete next[k];
      next[combo] = capture;
      setMap(next);
      saveShortcuts(next);
      setCapture(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [capture, map]);
  return (
    <Dialog title="Keyboard shortcuts" wide>
      <table className="grid-table"><thead><tr><th>Command</th><th>Keys</th><th /></tr></thead>
        <tbody>{Object.entries(COMMAND_LABELS).map(([cmd, label]) => (
          <tr key={cmd}><td>{label}</td><td className="mono">{capture === cmd ? 'press keys…' : (byCmd.get(cmd) ?? []).join(', ') || '—'}</td><td><button className="btn btn-sm" onClick={() => setCapture(cmd)}>Change</button></td></tr>
        ))}</tbody></table>
      <button className="btn btn-sm" onClick={() => { setMap({ ...DEFAULT_SHORTCUTS }); saveShortcuts(DEFAULT_SHORTCUTS); }}>Reset to defaults</button>
      <p className="note">Mouse: left-drag selects / moves, right or middle drag (or Space+drag) pans, wheel zooms, right-click opens the context menu.</p>
    </Dialog>
  );
}

function AssistantDialog() {
  const project = useStore((s) => s.project);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ q: string; a: AssistantReply }[]>([]);
  const ask = async () => {
    if (!input.trim()) return;
    const a = await localAssistant.respond(input, store.get().project);
    setHistory([...history, { q: input, a }]);
    setInput('');
    if (a.proposal) {
      // previews go through the same validation + confirmation path as every tool
      const next = a.proposal.apply(store.get().project);
      const prims = scenePrimitives(next).filter((e) => !(e.id in store.get().project.components) && !(e.id in store.get().project.wires) && !(e.id in store.get().project.cables)).flatMap((e) => e.prims);
      stage({ label: a.proposal.label, apply: a.proposal.apply, preview: { prims, status: 'valid', messages: a.needs ?? [] } });
    }
  };
  return (
    <Dialog title="Engineering assistant (local, offline)" wide>
      <div className="assistant">
        <div className="assistant-log">
          {history.length === 0 && <p className="note">{localAssistant.name}. It proposes operations that you preview and confirm (Enter / Confirm button / fist); it never changes the project by itself and never invents ratings or compliance. Project: {project.meta.name}.</p>}
          {history.map((h, i) => (
            <div key={i} className="qa">
              <div className="q">{h.q}</div>
              <div className="a">{h.a.text}{h.a.needs?.length ? <ul>{h.a.needs.map((n) => <li key={n}>Assumed / to confirm: {n}</li>)}</ul> : null}{h.a.proposal && <div className="badge badge-auto">Preview staged — confirm or reject in the toolbar</div>}</div>
            </div>
          ))}
        </div>
        <div className="assistant-input">
          <input value={input} placeholder="e.g. create a green LED circuit with 12 V" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void ask(); }} autoFocus />
          <button className="btn btn-primary" onClick={() => void ask()}>Ask</button>
        </div>
      </div>
    </Dialog>
  );
}

function AboutDialog() {
  return (
    <Dialog title="NULL-TECH CIRCUIT STUDIO" wide>
      <p><b>Version 0.1.0</b> — electrical engineering design, simulation and visualisation.</p>
      <h4>Implemented and tested</h4>
      <ul>
        <li>One authoritative project model; 2D canvas, 3D viewport, drawings and exports are all derived from it.</li>
        <li>Built-in MNA simulator: DC operating point, transient, AC; cross-validated against ngspice in the automated tests.</li>
        <li>Installation calculations: design current, route-based cable length, voltage drop (IEC 60364-5-52 Annex G method), IEC 60898-1 breaker and IEC 60228 size suggestions.</li>
        <li>Exports: vector PDF, SVG, PNG/JPEG, DXF (R12), SPICE, GLB/glTF/OBJ/STL, native JSON. Imports: SPICE subset, DXF geometry.</li>
      </ul>
      <h4>Known limitations</h4>
      <ul>
        <li>No status ever means “safe” or “compliant”. Fault-loop impedance, disconnection times, short-circuit levels and ampacity tables are not built in.</li>
        <li>Logic gates are zero-delay; generic ICs and microcontrollers are not simulated (reported as “not evaluated”). Op-amps are ideal macro-models.</li>
        <li>PLC programs: Boolean Structured Text subset with TON/TOF timers and CTU counter (no arithmetic or other function blocks); no vendor PLC or protocol is emulated.</li>
        <li>Cable routes are explicit polylines; automatic routing through trays/conduits is not yet implemented.</li>
        <li>IFC import/export is not implemented.</li>
      </ul>
      <p className="note">Engineering assistance only: verify every design with a qualified engineer against the applicable standards and local regulations.</p>
    </Dialog>
  );
}

function PlcDialog() {
  const project = useStore((s) => s.project);
  const [src, setSrc] = useState(project.settings.plcProgram ?? '');
  const io = Object.values(project.components).filter((c) => c.type === 'plc_input' || c.type === 'plc_output');
  let status: { ok: boolean; text: string };
  try {
    const prog = compilePlc(src);
    status = { ok: true, text: src.trim() ? `OK — writes ${[...prog.written].join(', ') || 'nothing'}; reads ${[...prog.read].join(', ') || 'nothing'}` : 'No program: outputs follow their forced state.' };
  } catch (e) {
    status = { ok: false, text: (e as Error).message };
  }
  const save = () => {
    execute('Edit PLC program', (p) => updateSettings(p, { plcProgram: src }));
    store.set({ dialog: null });
    if (project.type !== 'installation') setTimeout(() => runSimulation(), 0);
  };
  return (
    <Dialog title="PLC program — IEC 61131-3 Structured Text (subset)" wide footer={<><button className="btn" onClick={() => store.set({ dialog: null })}>Cancel</button><button className="btn btn-primary" disabled={!status.ok} onClick={save}>Save & simulate</button></>}>
      <div className="row2">
        <div style={{ flex: 2, minWidth: 0 }}>
          <textarea className="mono plc-editor" spellCheck={false} value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={'(* example *)\nQ0.0 := (I0.0 OR Q0.0) AND NOT I0.1;'} />
          <div className={`finding ${status.ok ? 'st-valid' : 'st-error'}`}>{status.text}</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h4>I/O in this project</h4>
          {io.length === 0 && <p className="note">Place PLC input / output components (library ▸ PLC) and give them addresses.</p>}
          <table className="mini"><tbody>{io.map((c) => <tr key={c.id}><td className="mono">{String(c.properties.address)}</td><td>{c.ref}</td><td>{getDef(c.type).name}</td></tr>)}</tbody></table>
          <h4>Language</h4>
          <ul className="note">
            <li><code>X := expr;</code> assignment (outputs Q…, memory M… or any name)</li>
            <li><code>IF … THEN … ELSIF … ELSE … END_IF;</code></li>
            <li><code>NOT</code> &gt; <code>AND</code>/<code>&amp;</code> &gt; <code>XOR</code> &gt; <code>OR</code>, <code>TRUE</code>, <code>FALSE</code></li>
            <li><code>VAR T1 : TON; C1 : CTU; END_VAR</code> declares timers / counters</li>
            <li><code>T1(IN := I0.0, PT := T#2s);</code> on-delay (<code>TOF</code>: off-delay), read <code>T1.Q</code></li>
            <li><code>C1(CU := I0.1, R := I0.2, PV := 3);</code> up-counter, read <code>C1.Q</code></li>
            <li>Comments <code>(* … *)</code> and <code>// …</code></li>
          </ul>
          <p className="note">One scan runs per simulation iteration until outputs settle. Timers use simulation time, so run a transient analysis to see them act (resolution = the time step). Arithmetic, comparisons and other function blocks are rejected, not ignored. Vendor-neutral: no PLC brand or protocol is emulated.</p>
        </div>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  switch (d) {
    case 'new': return <NewProjectDialog />;
    case 'print': return <PrintDialog />;
    case 'settings': return <SettingsDialog />;
    case 'project': return <ProjectInfoDialog />;
    case 'hand': return <HandDialog />;
    case 'examples': return <ExamplesDialog />;
    case 'recovery': return <RecoveryDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'assistant': return <AssistantDialog />;
    case 'about': return <AboutDialog />;
    case 'plc': return <PlcDialog />;
    default: return null;
  }
}
