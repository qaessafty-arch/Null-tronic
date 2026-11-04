import { useEffect, useMemo, useState } from 'react';
import { getDef, DIODE_PRESETS, ledTypicalVf } from '../component-library/library';
import { buildNetlist, pinKey } from '../project-model/connectivity';
import { execute } from '../history/history';
import { setProperty, updateCircuit, updateComponent, updateRoom, updateWire, updateCable, updateSettings } from '../project-model/operations';
import { useStore, store } from '../state/store';
import { formatSI, parseSI } from '../calculations/units';
import { calculateCircuit } from '../calculations/installation';
import { polygonArea } from '../project-model/geometry';
import { rerouteCircuit } from '../project-model/installation';
import type { Circuit, ComponentInstance, ConductorRole, Project, PropertyValue } from '../project-model/types';
import { StatusIcon } from '../components/Icon';
import refData from '@shared/engineering-rules/installation-reference.json';

/** Text input that commits on Enter/blur, so each edit is one undoable history entry. */
function CommitInput({ value, onCommit, mono, ariaLabel }: { value: string; onCommit: (v: string) => void; mono?: boolean; ariaLabel?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={mono ? 'mono' : ''}
      aria-label={ariaLabel}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(value);
        e.stopPropagation();
      }}
    />
  );
}

function Row({ label, children, hint, badge }: { label: string; children: React.ReactNode; hint?: string; badge?: string }) {
  return (
    <div className="prop-row" title={hint}>
      <span className="prop-label">
        {label}
        {badge && <span className={`badge badge-${badge}`}>{badge}</span>}
      </span>
      <span className="prop-value">{children}</span>
    </div>
  );
}

function ComponentProps({ c, project }: { c: ComponentInstance; project: Project }) {
  const def = getDef(c.type);
  const sim = useStore((s) => (s.sim.forProject === s.project && s.sim.result?.ok && s.sim.result.kind === 'op' ? s.sim.result.components[c.id] : undefined));
  const netlist = useMemo(() => (project.type !== 'installation' ? buildNetlist(project) : null), [project]);
  const set = (key: string, value: PropertyValue) => execute(`${c.ref}: ${key} = ${String(value)}`, (p) => {
    let q = setProperty(p, c.id, key, value);
    if (c.type === 'diode' && key === 'model' && DIODE_PRESETS[String(value)]) {
      const pr = DIODE_PRESETS[String(value)];
      q = setProperty(setProperty(setProperty(q, c.id, 'is', pr.is), c.id, 'n', pr.n), c.id, 'rs', pr.rs);
    }
    if (c.type === 'led' && key === 'color') q = setProperty(q, c.id, 'vf', ledTypicalVf[String(value)] ?? 2);
    return q;
  });
  const circuit = project.type === 'installation' ? Object.values(project.circuits).find((k) => k.deviceIds.includes(c.id) || k.boardId === c.id) : undefined;
  return (
    <>
      <section>
        <h4>{def.name}</h4>
        <Row label="Reference">
          <CommitInput value={c.ref} onCommit={(v) => v.trim() && execute(`Rename ${c.ref} → ${v}`, (p) => updateComponent(p, c.id, { ref: v.trim() }))} ariaLabel="Reference" />
        </Row>
        <Row label="Position" hint="Plan / schematic coordinates (mm)">
          <span className="pair">
            <CommitInput mono value={String(c.position.x)} onCommit={(v) => isFinite(+v) && execute(`Move ${c.ref}`, (p) => updateComponent(p, c.id, { position: { ...c.position, x: +v } }))} ariaLabel="X" />
            <CommitInput mono value={String(c.position.y)} onCommit={(v) => isFinite(+v) && execute(`Move ${c.ref}`, (p) => updateComponent(p, c.id, { position: { ...c.position, y: +v } }))} ariaLabel="Y" />
          </span>
        </Row>
        <Row label="Rotation">
          <select value={c.rotation} onChange={(e) => execute(`Rotate ${c.ref}`, (p) => updateComponent(p, c.id, { rotation: +e.target.value as 0 }))}>
            {[0, 90, 180, 270].map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </Row>
        <Row label="Mirror">
          <input type="checkbox" checked={c.mirror} onChange={() => execute(`Mirror ${c.ref}`, (p) => updateComponent(p, c.id, { mirror: !c.mirror }))} />
        </Row>
        <Row label={project.type === 'installation' ? 'Mounting height' : 'Elevation (3D)'} hint="Height used by the 3D model and cable drops (mm)">
          <CommitInput mono value={String(c.elevation)} onCommit={(v) => isFinite(+v) && execute(`${c.ref} elevation`, (p) => updateComponent(p, c.id, { elevation: Math.max(0, +v) }))} ariaLabel="Elevation" />
        </Row>
      </section>
      {def.properties.length > 0 && (
        <section>
          <h4>Electrical parameters</h4>
          {def.properties.map((pd) => {
            const val = c.properties[pd.key] ?? pd.default;
            return (
              <Row key={pd.key} label={pd.label} hint={pd.hint} badge={pd.assumption ? 'assumed' : undefined}>
                {pd.kind === 'boolean' ? (
                  <input type="checkbox" checked={!!val} onChange={() => set(pd.key, !val)} />
                ) : pd.kind === 'select' ? (
                  <select value={String(val)} onChange={(e) => set(pd.key, e.target.value)}>
                    {pd.options!.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : pd.kind === 'number' ? (
                  <span className="with-unit">
                    <CommitInput
                      mono
                      value={pd.unit && ['Ω', 'F', 'H', 'A', 'V'].includes(pd.unit) ? formatSI(Number(val), '', 4).replace(' ', '') : String(val)}
                      onCommit={(v) => {
                        const n = parseSI(v);
                        if (!Number.isFinite(n)) {
                          store.get();
                          return;
                        }
                        if (pd.min !== undefined && n < pd.min) return;
                        set(pd.key, n);
                      }}
                      ariaLabel={pd.label}
                    />
                    {pd.unit && <span className="unit">{pd.unit}</span>}
                  </span>
                ) : (
                  <CommitInput value={String(val)} onCommit={(v) => set(pd.key, v)} ariaLabel={pd.label} />
                )}
              </Row>
            );
          })}
        </section>
      )}
      {netlist && def.pins.length > 0 && (
        <section>
          <h4>Pins & connections</h4>
          <table className="mini">
            <tbody>
              {def.pins.map((pd) => {
                const net = netlist.pinNet.get(pinKey(c.id, pd.id));
                const n = net ? netlist.byName.get(net) : undefined;
                const others = n ? n.pins.filter((x) => !(x.componentId === c.id && x.pinId === pd.id)).map((x) => `${project.components[x.componentId]?.ref}.${x.pinId}`) : [];
                return (
                  <tr key={pd.id}>
                    <td className="mono">{pd.name}</td>
                    <td className="mono">{n?.isGround ? 'GND' : net}</td>
                    <td className={others.length ? '' : 'st-warning'}>{others.length ? others.slice(0, 4).join(', ') + (others.length > 4 ? '…' : '') : 'open'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {sim && (
        <section>
          <h4>Simulation result (operating point)</h4>
          {sim.voltage !== undefined && <Row label="Voltage">{formatSI(sim.voltage, 'V', 4)}</Row>}
          {sim.current !== undefined && <Row label="Current">{formatSI(sim.current, 'A', 4)}</Row>}
          {sim.power !== undefined && <Row label="Power">{formatSI(sim.power, 'W', 4)}</Row>}
          {sim.state !== undefined && <Row label="State">{sim.state ? 'ON / closed / energised' : 'OFF / open'}</Row>}
          {sim.extra &&
            Object.entries(sim.extra).map(([k, v]) => (
              <Row key={k} label={k}>
                {typeof v === 'number' ? formatSI(v, /^I/.test(k) || k.includes('Current') ? 'A' : 'V', 4) : v}
              </Row>
            ))}
          <p className="note">Calculated by the built-in MNA solver.</p>
        </section>
      )}
      {circuit && <CircuitProps circuit={circuit} project={project} />}
      <section>
        <h4>Reference</h4>
        <p className="note">{def.description}</p>
        {def.datasheet && <p className="note">Datasheet: {def.datasheet}</p>}
        {def.dimensions && (
          <p className="note">
            Envelope {def.dimensions.l} × {def.dimensions.w} × {def.dimensions.h} mm
          </p>
        )}
      </section>
    </>
  );
}

function CircuitProps({ circuit, project }: { circuit: Circuit; project: Project }) {
  const calc = useMemo(() => calculateCircuit(project, circuit), [project, circuit]);
  const up = (label: string, patch: Partial<Circuit>) => execute(`${circuit.name}: ${label}`, (p) => updateCircuit(p, circuit.id, patch));
  return (
    <section>
      <h4>
        Circuit {circuit.name} <StatusIcon status={calc.status} />
      </h4>
      <Row label="Name">
        <CommitInput value={circuit.name} onCommit={(v) => up('rename', { name: v })} />
      </Row>
      <Row label="Phase">
        <select value={circuit.phase} onChange={(e) => up('phase', { phase: e.target.value as Circuit['phase'] })}>
          {['L1', 'L2', 'L3', 'L123'].map((x) => (
            <option key={x} value={x}>
              {x === 'L123' ? '3-phase' : x}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Category">
        <select value={circuit.category} onChange={(e) => up('category', { category: e.target.value as Circuit['category'] })}>
          <option value="lighting">lighting</option>
          <option value="power">power</option>
        </select>
      </Row>
      <Row label="Protection">
        <span className="pair">
          <select value={circuit.protection.kind} onChange={(e) => up('protection', { protection: { ...circuit.protection, kind: e.target.value as 'MCB', residualmA: e.target.value === 'RCBO' ? 30 : null } })}>
            <option>MCB</option>
            <option>RCBO</option>
          </select>
          <select value={circuit.protection.curve} onChange={(e) => up('curve', { protection: { ...circuit.protection, curve: e.target.value as 'B' } })}>
            <option>B</option>
            <option>C</option>
            <option>D</option>
          </select>
        </span>
      </Row>
      <Row label="Rated current In" badge={circuit.protection.ratingA === null ? 'auto' : 'user'}>
        <select value={circuit.protection.ratingA ?? ''} onChange={(e) => up('breaker', { protection: { ...circuit.protection, ratingA: e.target.value ? +e.target.value : null } })}>
          <option value="">auto ({calc.breakerA ?? '—'} A)</option>
          {refData.mcbRatedCurrents.values.map((v) => (
            <option key={v} value={v}>
              {v} A
            </option>
          ))}
        </select>
      </Row>
      <Row label="Conductor" badge={circuit.cable.csaMm2 === null ? 'auto' : 'user'}>
        <span className="pair">
          <select value={circuit.cable.material} onChange={(e) => up('material', { cable: { ...circuit.cable, material: e.target.value as 'Cu' } })}>
            <option>Cu</option>
            <option>Al</option>
          </select>
          <select value={circuit.cable.csaMm2 ?? ''} onChange={(e) => up('cable size', { cable: { ...circuit.cable, csaMm2: e.target.value ? +e.target.value : null } })}>
            <option value="">auto ({calc.csaMm2 ?? '—'} mm²)</option>
            {refData.nominalCrossSections.values.map((v) => (
              <option key={v} value={v}>
                {v} mm²
              </option>
            ))}
          </select>
        </span>
      </Row>
      <Row label="Insulation / method">
        <span className="pair">
          <select value={circuit.cable.insulation} onChange={(e) => up('insulation', { cable: { ...circuit.cable, insulation: e.target.value as 'PVC' } })}>
            <option>PVC</option>
            <option>XLPE</option>
          </select>
          <CommitInput value={circuit.cable.installationMethod} onCommit={(v) => up('method', { cable: { ...circuit.cable, installationMethod: v } })} />
        </span>
      </Row>
      <Row label="PE size" badge={circuit.cable.peCsaMm2 ? 'user' : undefined}>
        <select value={circuit.cable.peCsaMm2 ?? ''} onChange={(e) => up('PE size', { cable: { ...circuit.cable, peCsaMm2: e.target.value ? +e.target.value : null } })}>
          <option value="">= phase conductor</option>
          {refData.nominalCrossSections.values.map((v) => <option key={v} value={v}>{v} mm²</option>)}
        </select>
      </Row>
      <Row label="Breaking capacity Icn" hint="From the protective device datasheet">
        <CommitInput mono value={circuit.protection.breakingCapacitykA == null ? '' : String(circuit.protection.breakingCapacitykA)} onCommit={(v) => up('breaking capacity', { protection: { ...circuit.protection, breakingCapacitykA: v.trim() === '' ? null : Math.max(0, +v) } })} />
      </Row>
      <Row label="Protective conductor">
        <input type="checkbox" checked={circuit.cable.hasPE} onChange={() => up('PE', { cable: { ...circuit.cable, hasPE: !circuit.cable.hasPE } })} />
      </Row>
      <Row label="Demand factor" badge="assumed">
        <CommitInput mono value={String(circuit.demandFactor)} onCommit={(v) => isFinite(+v) && up('demand factor', { demandFactor: Math.min(1, Math.max(0, +v)) })} />
      </Row>
      <button className="btn btn-sm" onClick={() => execute(`${circuit.name}: re-route cables`, (p) => rerouteCircuit(p, circuit.id))} title="Route every cable of this circuit through the cable trays (or an orthogonal L where none apply)">
        Re-route via containment
      </button>
      <div className="calc-box">
        <div>
          Connected load <b>{calc.connectedW.toFixed(0)} W</b> · cos φ {calc.powerFactor.toFixed(2)}
        </div>
        <div>
          Ib <b>{calc.ibA.toFixed(2)} A</b> · route length <b>{calc.totalLengthM.toFixed(1)} m</b>
        </div>
        <div>
          ΔU <b>{calc.dropPct.toFixed(2)} %</b> ({calc.dropV.toFixed(2)} V) / limit {calc.dropLimitPct} %
        </div>
        <div>Iz: {calc.izA !== null ? `${calc.izA} A` : 'not evaluated (no ampacity row)'}</div>
        {calc.faultLoop && (
          <div>
            R1+R2 {Number.isFinite(calc.faultLoop.r1r2) ? `${calc.faultLoop.r1r2.toFixed(3)} Ω` : '—'} · Zs {calc.faultLoop.zs != null ? <b>{calc.faultLoop.zs.toFixed(3)} Ω</b> : 'n/e (enter Ze)'}
            {calc.faultLoop.maxZs != null && <> / max {calc.faultLoop.maxZs.toFixed(3)} Ω</>}
            {calc.faultLoop.ipfA != null && <> · Ipf {(calc.faultLoop.ipfA / 1000).toFixed(2)} kA</>}
          </div>
        )}
      </div>
      <details>
        <summary>Calculation details</summary>
        <ul className="note">
          {calc.formulae.map((f) => (
            <li key={f} className="mono">
              {f}
            </li>
          ))}
          {calc.segments.map((s) => (
            <li key={s.cableId}>
              {s.fromRef}→{s.toRef}: {s.horizontalM.toFixed(2)} m + {s.verticalM.toFixed(2)} m drops, {s.currentA.toFixed(2)} A, {s.dropV.toFixed(3)} V
            </li>
          ))}
          {calc.assumptions.map((a) => (
            <li key={a.text}>Assumption: {a.text}</li>
          ))}
        </ul>
      </details>
      {calc.findings.map((f) => (
        <div key={f.id} className={`finding st-${f.status}`}>
          <StatusIcon status={f.status} /> {f.message}
        </div>
      ))}
    </section>
  );
}

export function PropertiesPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const id = selection[0];
  let body: React.ReactNode;
  if (selection.length === 0) {
    body = (
      <section>
        <h4>Project</h4>
        <Row label="Name">
          <CommitInput value={project.meta.name} onCommit={(v) => execute('Rename project', (p) => ({ ...p, meta: { ...p.meta, name: v } }))} />
        </Row>
        <Row label="Type">{project.type}</Row>
        <Row label="Display unit">
          <select value={project.settings.displayUnit} onChange={(e) => execute('Display unit', (p) => updateSettings(p, { displayUnit: e.target.value as 'mm' }))}>
            <option>mm</option>
            <option>cm</option>
            <option>m</option>
          </select>
        </Row>
        <Row label="Grid (mm)">
          <CommitInput mono value={String(project.settings.gridMm)} onCommit={(v) => +v > 0 && execute('Grid', (p) => updateSettings(p, { gridMm: +v }))} />
        </Row>
        <Row label="Components">{Object.keys(project.components).length}</Row>
        {project.type !== 'installation' ? <Row label="Wires">{Object.keys(project.wires).length}</Row> : <Row label="Circuits">{Object.keys(project.circuits).length}</Row>}
        <p className="note">Select an item to edit its properties. Pick a component from the library to place it.</p>
      </section>
    );
  } else if (selection.length > 1) {
    body = (
      <section>
        <h4>{selection.length} items selected</h4>
        <p className="note">Move, rotate, mirror, duplicate or delete them together.</p>
      </section>
    );
  } else if (project.components[id]) body = <ComponentProps c={project.components[id]} project={project} />;
  else if (project.wires[id]) {
    const w = project.wires[id];
    const netlist = buildNetlist(project);
    body = (
      <section>
        <h4>Wire</h4>
        <Row label="Net">{netlist.wireNet.get(id)}</Row>
        <Row label="Conductor role">
          <select value={w.role} onChange={(e) => execute('Wire role', (p) => updateWire(p, id, { role: e.target.value as ConductorRole }))}>
            {['auto', 'signal', 'power', 'ground', 'control', 'L', 'N', 'PE'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Row>
        <Row label="Bend points">{w.vertices.length}</Row>
        <p className="note">Drag a bend point of the selected wire to re-route it. Endpoints stay attached to their pins.</p>
      </section>
    );
  } else if (project.rooms[id]) {
    const r = project.rooms[id];
    body = (
      <section>
        <h4>Room</h4>
        <Row label="Name">
          <CommitInput value={r.name} onCommit={(v) => execute('Rename room', (p) => updateRoom(p, id, { name: v }))} />
        </Row>
        <Row label="Area">{(polygonArea(r.polygon) / 1e6).toFixed(2)} m²</Row>
        <Row label="Height (mm)">
          <CommitInput mono value={String(r.height)} onCommit={(v) => +v > 0 && execute('Room height', (p) => updateRoom(p, id, { height: +v }))} />
        </Row>
        <Row label="Wall thickness (mm)">
          <CommitInput mono value={String(r.wallThickness)} onCommit={(v) => +v > 0 && execute('Wall thickness', (p) => updateRoom(p, id, { wallThickness: +v }))} />
        </Row>
      </section>
    );
  } else if (project.cables[id]) {
    const cb = project.cables[id];
    body = (
      <>
        <section>
          <h4>Cable run</h4>
          <Row label="From → to">
            {project.components[cb.fromId]?.ref} → {project.components[cb.toId]?.ref}
          </Row>
          <Row label="Route height (mm)">
            <CommitInput mono value={String(cb.routeElevation)} onCommit={(v) => +v >= 0 && execute('Route height', (p) => updateCable(p, id, { routeElevation: +v }))} />
          </Row>
          <p className="note">Drag the route's bend points to follow walls / containment; length is recalculated from the route.</p>
        </section>
        {project.circuits[cb.circuitId] && <CircuitProps circuit={project.circuits[cb.circuitId]} project={project} />}
      </>
    );
  } else if (project.annotations[id]) {
    const a = project.annotations[id];
    body = (
      <section>
        <h4>Annotation ({a.kind})</h4>
        {(a.kind === 'text' || a.kind === 'dimension') && (
          <Row label="Text">
            <CommitInput value={a.text ?? ''} onCommit={(v) => execute('Edit annotation', (p) => ({ ...p, annotations: { ...p.annotations, [id]: { ...a, text: v } } }))} />
          </Row>
        )}
        <Row label="Layer">{a.layer}</Row>
      </section>
    );
  } else if (project.junctions[id]) body = <section><h4>Junction</h4><p className="note">Connection point joining wires.</p></section>;
  return (
    <aside className="panel panel-right" aria-label="Properties">
      <div className="panel-head">
        <h3>Properties</h3>
      </div>
      <div className="panel-scroll">{body}</div>
    </aside>
  );
}
