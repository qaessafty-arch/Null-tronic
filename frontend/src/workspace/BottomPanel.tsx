import { useMemo, useState } from 'react';
import { getDef } from '../component-library/library';
import { useStore, store, setView, type BottomTab } from '../state/store';
import { validateProject, overallStatus } from '../calculations/validation';
import { calculateInstallation } from '../calculations/installation';
import { buildBom } from '../calculations/bom';
import { formatSI } from '../calculations/units';
import { StatusIcon } from '../components/Icon';
import { Waveform } from '../components/Waveform';
import { runSimulation, toggleState } from '../simulation/run';
import { buildReportHtml, exportSpiceNetlist, verifyWithNgspice } from '../app/actions';
import { download } from '../app/file-ops';
import { execute } from '../history/history';
import { setProperty, updateCircuit, updateSettings } from '../project-model/operations';
import { parseSI } from '../calculations/units';
import type { Finding } from '../project-model/types';

function FindingList({ findings }: { findings: Finding[] }) {
  const order = { error: 0, warning: 1, review: 2, 'not-evaluated': 3, valid: 4 };
  const sorted = [...findings].sort((a, b) => order[a.status] - order[b.status]);
  if (!sorted.length) return <p className="empty">No findings within the supported checks.</p>;
  return (
    <table className="grid-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Code</th>
          <th>Message</th>
          <th>Basis</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((f) => (
          <tr key={f.id} className={`st-${f.status} clickable`} onClick={() => f.refs.length && store.set({ selection: f.refs.filter((r) => { const p = store.get().project; return p.components[r] || p.wires[r] || p.junctions[r] || p.circuits[r] || p.cables[r]; }) })}>
            <td>
              <StatusIcon status={f.status} /> {f.status}
            </td>
            <td className="mono">{f.code}</td>
            <td>{f.message}</td>
            <td className="muted">{f.basis}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SimulationTab() {
  const s = useStore((x) => x.sim);
  const project = useStore((x) => x.project);
  const handConn = useStore((x) => x.hand.connection);
  const stale = s.forProject !== project;
  const r = s.result;
  const set = (patch: Partial<typeof s>) => store.set({ sim: { ...store.get().sim, ...patch } });
  const interactive = Object.values(project.components).filter((c) => ['switch', 'pushbutton', 'pb_no', 'pb_nc', 'estop', 'limit_switch', 'overload_nc', 'mcb'].includes(c.type));
  const forced = Object.values(project.components).filter((c) => c.type === 'plc_output');
  const states = r && r.ok && r.kind === 'op' ? r.states : s.states;
  if (project.type === 'installation') return <p className="empty">Installation projects use the calculation engine — see the Schedule tab.</p>;
  return (
    <div className="sim-tab">
      <div className="sim-controls">
        <div className="seg">
          {(['op', 'tran', 'ac'] as const).map((a) => (
            <button key={a} className={s.analysis === a ? 'on' : ''} onClick={() => set({ analysis: a })}>
              {a === 'op' ? 'Operating point' : a === 'tran' ? 'Transient' : 'AC sweep'}
            </button>
          ))}
        </div>
        {s.analysis === 'tran' && (
          <>
            <label>
              Stop time <input className="mono short" defaultValue={formatSI(s.tstop, '').replace(' ', '')} onBlur={(e) => { const v = parseSI(e.target.value); if (v > 0) set({ tstop: v }); }} />s
            </label>
            <label>
              Steps <input className="mono short" type="number" min={10} max={200000} value={s.steps} onChange={(e) => set({ steps: Math.max(10, +e.target.value) })} />
            </label>
            <label>
              <input type="checkbox" checked={s.uic} onChange={() => set({ uic: !s.uic })} /> Start from zero (UIC)
            </label>
          </>
        )}
        {s.analysis === 'ac' && (
          <>
            <label>
              From <input className="mono short" defaultValue={formatSI(s.fstart, '').replace(' ', '')} onBlur={(e) => { const v = parseSI(e.target.value); if (v > 0) set({ fstart: v }); }} />Hz
            </label>
            <label>
              To <input className="mono short" defaultValue={formatSI(s.fstop, '').replace(' ', '')} onBlur={(e) => { const v = parseSI(e.target.value); if (v > 0) set({ fstop: v }); }} />Hz
            </label>
            <label>
              Points/dec <input className="mono short" type="number" value={s.ppd} onChange={(e) => set({ ppd: Math.max(1, +e.target.value) })} />
            </label>
          </>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => runSimulation()}>
          Run
        </button>
        <button className="btn btn-sm" onClick={exportSpiceNetlist}>
          Export netlist
        </button>
        <button className="btn btn-sm" disabled={handConn !== 'connected'} title="Requires the local service with ngspice installed" onClick={() => void verifyWithNgspice()}>
          Verify with ngspice
        </button>
        {stale && r && <span className="badge badge-warn">Result is from an earlier revision — re-run</span>}
      </div>
      {(interactive.length > 0 || forced.length > 0) && (
        <div className="sim-interactive">
          <span className="muted">Interactive:</span>
          {interactive.map((c) => {
            const key = `sw:${c.id}`;
            const on = states[key] ?? Boolean(c.properties.closed ?? c.properties.pressed);
            const verb = ['switch', 'mcb'].includes(c.type) ? (on ? 'closed' : 'open') : on ? 'pressed' : 'released';
            return (
              <button key={c.id} className={`chip ${on ? 'on' : ''}`} onClick={() => { if (s.analysis !== 'op') set({ analysis: 'op' }); toggleState(key); }}>
                {c.ref}: {verb}
              </button>
            );
          })}
          {forced.map((c) => (
            <button key={c.id} className={`chip ${c.properties.state ? 'on' : ''}`} onClick={() => { execute(`Force ${c.ref}`, (p) => setProperty(p, c.id, 'state', !c.properties.state)); setTimeout(() => runSimulation(), 0); }}>
              {String(c.properties.address)} forced {c.properties.state ? 'ON' : 'OFF'}
            </button>
          ))}
        </div>
      )}
      {!r && <p className="empty">No simulation yet. Press Run (F5). Results come from the built-in modified-nodal-analysis solver.</p>}
      {r && !r.ok && (
        <div className="finding st-error">
          <StatusIcon status="error" /> {r.error}
        </div>
      )}
      {r && r.ok && r.kind === 'op' && (
        <div className="sim-results">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Net</th>
                <th>Voltage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.nodeVoltages).sort((a, b) => a[0].localeCompare(b[0])).map(([n, v]) => (
                <tr key={n}>
                  <td className="mono">{n === '0' ? 'GND (0)' : n}</td>
                  <td className="mono num">{formatSI(v, 'V', 5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>V</th>
                <th>I</th>
                <th>P</th>
                <th>State / detail</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.components).filter(([id]) => project.components[id]).sort((a, b) => project.components[a[0]].ref.localeCompare(project.components[b[0]].ref, undefined, { numeric: true })).map(([id, c]) => (
                <tr key={id} className="clickable" onClick={() => store.set({ selection: [id] })}>
                  <td className="mono">{project.components[id].ref}</td>
                  <td className="mono num">{c.voltage !== undefined ? formatSI(c.voltage, 'V', 4) : ''}</td>
                  <td className="mono num">{c.current !== undefined ? formatSI(c.current, 'A', 4) : ''}</td>
                  <td className="mono num">{c.power !== undefined ? formatSI(c.power, 'W', 4) : ''}</td>
                  <td>
                    {c.state !== undefined ? (c.state ? 'ON' : 'OFF') : ''} {c.extra?.region ? String(c.extra.region) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="muted">
              Method: {r.method}, {r.iterations} Newton iterations · {r.timestamp.slice(11, 19)}
            </p>
            <FindingList findings={r.findings} />
          </div>
        </div>
      )}
      {r && r.ok && r.kind === 'tran' && (
        <>
          <Waveform x={r.time} xUnit="s" series={r.traces.filter((t) => t.unit === 'V').map((t) => ({ name: t.name, values: t.values, unit: 'V' }))} />
          {r.traces.some((t) => t.unit === 'A') && <Waveform x={r.time} xUnit="s" series={r.traces.filter((t) => t.unit === 'A').map((t) => ({ name: t.name, values: t.values, unit: 'A' }))} />}
          <FindingList findings={r.findings} />
        </>
      )}
      {r && r.ok && r.kind === 'ac' && (
        <>
          <Waveform x={r.freq} logX xUnit="Hz" series={r.traces.map((t) => ({ name: `${t.name} dB`, values: t.magDb, unit: 'dB' }))} />
          <Waveform x={r.freq} logX xUnit="Hz" series={r.traces.map((t) => ({ name: `${t.name} °`, values: t.phaseDeg, unit: '°' }))} />
          <FindingList findings={r.findings} />
        </>
      )}
    </div>
  );
}

function ScheduleTab() {
  const project = useStore((x) => x.project);
  const rep = useMemo(() => calculateInstallation(project), [project]);
  if (project.type !== 'installation') return <p className="empty">The circuit schedule applies to installation projects.</p>;
  return (
    <div>
      <div className="sim-controls">
        <label>
          U0 <input className="mono short" type="number" value={project.settings.supplyVoltage} onChange={(e) => execute('Supply voltage', (p) => updateSettings(p, { supplyVoltage: +e.target.value || 230 }))} /> V
        </label>
        <label>
          Supply
          <select value={project.settings.supplyPhases} onChange={(e) => execute('Supply phases', (p) => updateSettings(p, { supplyPhases: +e.target.value as 1 }))}>
            <option value={1}>1-phase</option>
            <option value={3}>3-phase</option>
          </select>
        </label>
        <label title="External earth-fault loop impedance at the origin, measured or declared by the supplier">
          Ze <input className="mono short" type="number" step="0.01" placeholder="not set" value={project.settings.externalLoopImpedance ?? ''} onChange={(e) => execute('Ze', (p) => updateSettings(p, { externalLoopImpedance: e.target.value === '' ? null : Math.max(0, +e.target.value) }))} /> Ω
        </label>
        <label>
          Earthing
          <select value={project.settings.earthingSystem ?? 'TN-C-S'} onChange={(e) => execute('Earthing system', (p) => updateSettings(p, { earthingSystem: e.target.value as 'TT' }))}>
            {['TN-S', 'TN-C-S', 'TT', 'IT'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <span className="muted">ΔU limits: lighting {project.settings.voltageDropLimitLighting} %, other {project.settings.voltageDropLimitOther} % (IEC 60364-5-52 Annex G, configurable)</span>
      </div>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Circuit</th>
            <th>Phase</th>
            <th>Devices</th>
            <th>Load W</th>
            <th>Ib A</th>
            <th>Protection</th>
            <th>Cable</th>
            <th>Length m</th>
            <th>ΔU %</th>
            <th>Iz</th>
            <th>Zs / max Ω</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rep.circuits.map((c) => {
            const cc = project.circuits[c.circuitId];
            return (
              <tr key={c.circuitId} className="clickable" onClick={() => store.set({ selection: [c.circuitId] })}>
                <td className="mono">{c.name}</td>
                <td>{c.phase}</td>
                <td className="num">{c.deviceCount}</td>
                <td className="num">{c.connectedW.toFixed(0)}</td>
                <td className="num">{c.ibA.toFixed(2)}</td>
                <td>
                  {cc.protection.kind} {cc.protection.curve}
                  {c.breakerA ?? '?'} {c.breakerSource === 'suggested' && <span className="badge badge-auto">suggested</span>}
                </td>
                <td>
                  {cc.cable.material} {c.csaMm2} mm² {c.csaSource === 'suggested' && <span className="badge badge-auto">suggested</span>}
                </td>
                <td className="num">{c.totalLengthM.toFixed(1)}</td>
                <td className={`num ${c.dropPct > c.dropLimitPct ? 'st-error' : ''}`}>
                  {c.dropPct.toFixed(2)} / {c.dropLimitPct}
                </td>
                <td>{c.izA ?? 'n/e'}</td>
                <td className={`num ${c.faultLoop?.zs != null && c.faultLoop.maxZs != null && c.faultLoop.zs > c.faultLoop.maxZs ? 'st-error' : ''}`}>{c.faultLoop?.zs != null ? `${c.faultLoop.zs.toFixed(2)} / ${c.faultLoop.maxZs?.toFixed(2) ?? '—'}` : 'n/e'}</td>
                <td>
                  <StatusIcon status={c.status} /> {c.status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rep.boards.map((b) => (
        <div key={b.boardId} className="calc-box">
          <b>{b.ref}</b>: demand {b.totalDemandVA.toFixed(0)} VA — L1 {b.phaseA.L1.toFixed(1)} A · L2 {b.phaseA.L2.toFixed(1)} A · L3 {b.phaseA.L3.toFixed(1)} A · incomer {b.incomerA} A
          {b.imbalancePct !== null && <> · imbalance {b.imbalancePct.toFixed(0)} %</>}
          {b.balanceSuggestion && Object.keys(b.balanceSuggestion).length > 0 && (
            <button
              className="btn btn-sm"
              onClick={() =>
                execute('Apply phase balancing suggestion', (p) => {
                  let q = p;
                  for (const [cid, ph] of Object.entries(b.balanceSuggestion!)) q = updateCircuit(q, cid, { phase: ph });
                  return q;
                })
              }
            >
              Apply suggested phase allocation
            </button>
          )}
        </div>
      ))}
      <p className="note">Values marked “suggested” are produced by the engine from IEC 60898-1 ratings / IEC 60228 sizes and the voltage-drop method; they are not a compliance check. Iz is evaluated only from the project's ampacity table (Project ▸ Engineering settings).</p>
    </div>
  );
}

function BomTab() {
  const project = useStore((x) => x.project);
  const bom = useMemo(() => buildBom(project), [project]);
  const [edit, setEdit] = useState(false);
  return (
    <div>
      <div className="sim-controls">
        <button className="btn btn-sm" onClick={() => setEdit(!edit)}>
          {edit ? 'Done editing prices' : 'Edit unit prices'}
        </button>
        <button className="btn btn-sm" onClick={() => download('bom.csv', ['Description,Quantity,Unit,References,Unit price,Total', ...bom.lines.map((l) => [l.description, l.quantity, l.unit, l.refs.join(' '), l.unitPrice ?? '', l.total ?? ''].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n'), 'text/csv')}>
          Export CSV
        </button>
        <span className="muted">{bom.total === null ? 'No prices entered — cost not estimated.' : `Estimated total ${bom.total.toFixed(2)} ${project.settings.currency} (${bom.missingPrices} line(s) unpriced)`}</span>
      </div>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>References</th>
            <th>Unit price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((l) => (
            <tr key={l.key}>
              <td>{l.description}</td>
              <td className="num">
                {l.quantity} {l.unit}
              </td>
              <td className="muted">{l.refs.join(', ')}</td>
              <td className="num">
                {edit ? <input className="mono short" type="number" defaultValue={l.unitPrice ?? ''} onBlur={(e) => execute('Unit price', (p) => { const prices = { ...p.settings.unitPrices }; if (e.target.value === '') delete prices[l.key]; else prices[l.key] = +e.target.value; return updateSettings(p, { unitPrices: prices }); })} /> : l.unitPrice ?? '—'}
              </td>
              <td className="num">{l.total?.toFixed(2) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportTab() {
  const project = useStore((x) => x.project);
  const html = useMemo(() => buildReportHtml(project), [project]);
  return (
    <div className="report-tab">
      <div className="sim-controls">
        <button className="btn btn-sm btn-primary" onClick={() => download(`${project.meta.name.replace(/\W+/g, '-').toLowerCase()}-report.html`, html, 'text/html')}>
          Download report (HTML)
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(html);
              w.document.close();
              w.print();
            }
          }}
        >
          Print report
        </button>
        <span className="muted">Engineering / lab report generated from the model, findings and the latest simulation.</span>
      </div>
      <iframe title="Report preview" srcDoc={html} className="report-frame" />
    </div>
  );
}

function ConsoleTab() {
  const log = useStore((x) => x.log);
  return (
    <div className="console mono">
      {log.length === 0 && <p className="empty">Console is empty.</p>}
      {[...log].reverse().map((l, i) => (
        <div key={i} className={`log-${l.level}`}>
          <span className="muted">{l.t}</span> {l.text}
        </div>
      ))}
    </div>
  );
}

export function BottomPanel() {
  const tab = useStore((x) => x.view.bottomTab);
  const project = useStore((x) => x.project);
  const findings = useMemo(() => validateProject(project), [project]);
  const status = overallStatus(findings);
  const counts = { e: findings.filter((f) => f.status === 'error').length, w: findings.filter((f) => f.status === 'warning').length };
  const tabs: [BottomTab, string][] = [
    ['validation', `Validation${counts.e + counts.w ? ` (${counts.e}E ${counts.w}W)` : ''}`],
    ['simulation', 'Simulation'],
    ...(project.type === 'installation' ? ([['schedule', 'Schedule & loads']] as [BottomTab, string][]) : []),
    ['bom', 'Bill of materials'],
    ['report', 'Report'],
    ['console', 'Console'],
  ];
  return (
    <section className="panel panel-bottom" aria-label="Output panel">
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setView({ bottomTab: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-scroll bottom-body">
        {tab === 'validation' && (
          <>
            <div className={`status-banner st-${status.status}`}>
              <StatusIcon status={status.status} /> {status.label}. <span className="muted">A clean result never means “safe”: it means no issue was found by the checks implemented here.</span>
            </div>
            <FindingList findings={findings} />
          </>
        )}
        {tab === 'simulation' && <SimulationTab />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'bom' && <BomTab />}
        {tab === 'report' && <ReportTab />}
        {tab === 'console' && <ConsoleTab />}
      </div>
    </section>
  );
}

export { getDef };
