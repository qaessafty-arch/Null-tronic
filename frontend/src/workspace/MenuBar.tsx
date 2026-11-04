import { useEffect, useRef, useState } from 'react';
import { runCommand } from '../input-system/commands';
import { setView, store, useStore } from '../state/store';
import { exportDxfFile, exportSpiceNetlist, export3D, importDxfFile, importSpiceFile, verifyWithNgspice } from '../app/actions';
import { takeSnapshot } from '../app/file-ops';
import { serializeProject } from '../project-model/serialization';
import { download } from '../app/file-ops';
import { t } from '../localization/i18n';
import { runSimulation } from '../simulation/run';

type Item = { label: string; action?: () => void; key?: string; disabled?: boolean; sep?: boolean; check?: boolean };

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const s = useStore((x) => x);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const cmd = (c: string) => () => runCommand(c);
  const isInst = s.project.type === 'installation';
  const isElec = !isInst;
  const sim = (analysis: 'op' | 'tran' | 'ac') => () => {
    store.set({ sim: { ...store.get().sim, analysis } });
    runSimulation();
  };
  const menus: Record<string, Item[]> = {
    [t('menu.file')]: [
      { label: 'New project…', action: cmd('new'), key: 'Ctrl+N' },
      { label: 'Open…', action: cmd('open'), key: 'Ctrl+O' },
      { label: 'Save', action: cmd('save'), key: 'Ctrl+S' },
      { label: 'Save as…', action: cmd('save-as'), key: 'Ctrl+Shift+S' },
      { label: 'Store snapshot', action: () => takeSnapshot(`${s.project.meta.name} ${new Date().toLocaleTimeString()}`) },
      { label: 'Recover / snapshots…', action: () => store.set({ dialog: 'recovery' }) },
      { sep: true, label: '' },
      { label: 'Import SPICE netlist…', action: () => void importSpiceFile() },
      { label: 'Import DXF as underlay…', action: () => void importDxfFile(false) },
      { label: 'Import DXF rooms (closed polylines)…', action: () => void importDxfFile(true), disabled: !isInst },
      { sep: true, label: '' },
      { label: 'Print / drawing sheets…', action: cmd('print'), key: 'Ctrl+P' },
    ],
    [t('menu.edit')]: [
      { label: 'Undo', action: cmd('undo'), key: 'Ctrl+Z', disabled: !s.past.length },
      { label: 'Redo', action: cmd('redo'), key: 'Ctrl+Y', disabled: !s.future.length },
      { sep: true, label: '' },
      { label: 'Copy', action: cmd('copy'), key: 'Ctrl+C', disabled: !s.selection.length },
      { label: 'Paste', action: cmd('paste'), key: 'Ctrl+V' },
      { label: 'Duplicate', action: cmd('duplicate'), key: 'Ctrl+D', disabled: !s.selection.length },
      { label: 'Delete', action: cmd('delete'), key: 'Del', disabled: !s.selection.length },
      { label: 'Select all', action: cmd('select-all'), key: 'Ctrl+A' },
      { sep: true, label: '' },
      { label: 'Rotate 90°', action: cmd('rotate'), key: 'R' },
      { label: 'Mirror', action: cmd('mirror'), key: 'M' },
    ],
    [t('menu.view')]: [
      { label: '2D canvas', action: cmd('view-2d'), key: '1', check: s.view.mode === '2d' },
      { label: '3D viewport', action: cmd('view-3d'), key: '2', check: s.view.mode === '3d' },
      { label: '2D + 3D side by side', action: cmd('view-split'), key: '3', check: s.view.mode === 'split' },
      { label: 'Full-screen viewport', action: cmd('fullscreen'), key: 'F11', check: s.view.fullscreen },
      { sep: true, label: '' },
      { label: 'Component library panel', action: () => setView({ left: !s.view.left }), check: s.view.left },
      { label: 'Properties panel', action: () => setView({ right: !s.view.right }), check: s.view.right },
      { label: 'Bottom panel', action: () => setView({ bottom: !s.view.bottom }), check: s.view.bottom },
      { label: 'Grid', action: cmd('toggle-grid'), key: 'G', check: s.view.showGrid },
      { sep: true, label: '' },
      { label: 'Dark theme', action: () => setView({ theme: 'dark' }), check: s.view.theme === 'dark' },
      { label: 'Light theme', action: () => setView({ theme: 'light' }), check: s.view.theme === 'light' },
      { label: 'Fit to project', action: cmd('fit'), key: 'F' },
    ],
    [t('menu.project')]: [
      { label: 'Project information…', action: () => store.set({ dialog: 'project' }) },
      { label: 'Engineering settings…', action: () => store.set({ dialog: 'settings' }) },
      { label: 'Drawing sheets…', action: cmd('print') },
    ],
    [t('menu.components')]: [
      { label: 'Show library', action: () => setView({ left: true }) },
      ...(isInst
        ? [
            { label: 'Distribution board', action: () => placeType('db') },
            { label: 'Luminaire', action: () => placeType('light') },
            { label: 'Socket outlet', action: () => placeType('socket') },
            { label: 'Light switch', action: () => placeType('switch_1way') },
          ]
        : [
            { label: 'Resistor', action: () => placeType('resistor') },
            { label: 'DC voltage source', action: () => placeType('vdc') },
            { label: 'Ground', action: () => placeType('ground') },
            { label: 'LED', action: () => placeType('led') },
          ]),
    ],
    [t('menu.engineering')]: [
      { label: 'Validation report', action: () => setView({ bottom: true, bottomTab: 'validation' }) },
      { label: 'Circuit schedule & loads', action: () => setView({ bottom: true, bottomTab: 'schedule' }), disabled: !isInst },
      { label: 'Bill of materials', action: () => setView({ bottom: true, bottomTab: 'bom' }) },
      { label: 'Engineering / lab report', action: () => setView({ bottom: true, bottomTab: 'report' }) },
    ],
    [t('menu.simulation')]: [
      { label: 'Operating point (DC)', action: sim('op'), key: 'F5', disabled: !isElec },
      { label: 'Transient', action: sim('tran'), disabled: !isElec },
      { label: 'AC sweep', action: sim('ac'), disabled: !isElec },
      { label: 'Verify with ngspice (local service)', action: () => void verifyWithNgspice(), disabled: !isElec || s.hand.connection !== 'connected' },
      { label: 'Simulation panel', action: () => setView({ bottom: true, bottomTab: 'simulation' }) },
    ],
    [t('menu.tools')]: [
      { label: 'Select', action: cmd('tool:select'), key: 'S' },
      { label: 'Wire', action: cmd('tool:wire'), key: 'W', disabled: isInst },
      { label: 'Room', action: cmd('tool:room'), key: 'O', disabled: !isInst },
      { label: 'Circuit', action: cmd('tool:circuit'), key: 'C', disabled: !isInst },
      { label: 'Dimension', action: cmd('tool:dimension'), key: 'D' },
      { label: 'Text', action: cmd('tool:text'), key: 'T' },
      { label: 'Measure', action: cmd('tool:measure'), key: 'Shift+M' },
      { sep: true, label: '' },
      { label: 'PLC program (Structured Text)…', action: () => store.set({ dialog: 'plc' }), disabled: isInst },
      { label: 'Engineering assistant…', action: () => store.set({ dialog: 'assistant' }) },
      { label: 'Hand tracking…', action: () => store.set({ dialog: 'hand' }) },
      { label: 'Keyboard shortcuts…', action: () => store.set({ dialog: 'shortcuts' }) },
    ],
    [t('menu.export')]: [
      { label: 'Drawings: PDF / SVG / PNG…', action: cmd('print') },
      { label: 'DXF (model space)', action: exportDxfFile },
      { label: 'SPICE netlist (.cir)', action: exportSpiceNetlist, disabled: !isElec },
      { label: '3D: GLB', action: () => void export3D('glb') },
      { label: '3D: glTF', action: () => void export3D('gltf') },
      { label: '3D: OBJ', action: () => void export3D('obj') },
      { label: '3D: STL', action: () => void export3D('stl') },
      { label: 'Native project (.ntcs.json)', action: () => download(`${s.project.meta.name.replace(/\W+/g, '-').toLowerCase() || 'project'}.ntcs.json`, serializeProject(s.project), 'application/json') },
    ],
    [t('menu.help')]: [
      { label: 'Examples & tutorials…', action: () => store.set({ dialog: 'examples' }) },
      { label: 'Gesture guide…', action: () => store.set({ dialog: 'hand' }) },
      { label: 'Keyboard shortcuts…', action: () => store.set({ dialog: 'shortcuts' }) },
      { label: 'About, scope & limitations…', action: () => store.set({ dialog: 'about' }) },
    ],
  };
  return (
    <div className="menubar" ref={ref} role="menubar">
      <div className="brand" aria-label="NULL-TECH CIRCUIT STUDIO">
        <span className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M3 12h4l2-6 4 12 2-6h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
          </svg>
        </span>
        <span className="brand-name">NULL-TECH</span>
        <span className="brand-product">CIRCUIT STUDIO</span>
      </div>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className={`menu ${open === name ? 'open' : ''}`}>
          <button role="menuitem" aria-haspopup="true" aria-expanded={open === name} onClick={() => setOpen(open === name ? null : name)} onPointerEnter={() => open && setOpen(name)}>
            {name}
          </button>
          {open === name && (
            <div className="menu-pop" role="menu">
              {items.map((it, i) =>
                it.sep ? (
                  <div key={i} className="sep" />
                ) : (
                  <button
                    key={i}
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span className="check">{it.check ? '✓' : ''}</span>
                    <span className="label">{it.label}</span>
                    {it.key && <kbd>{it.key}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-right">
        <span className="doc-name" title={s.fileName}>
          {s.project.meta.name}
          {s.project !== s.savedRevision && <span className="dirty" title="Unsaved changes"> ●</span>}
        </span>
        <span className={`mode-badge mode-${s.project.type}`}>{s.project.type}</span>
      </div>
    </div>
  );
}

export function placeType(type: string) {
  store.set({ tool: 'place', placeType: type, placeRotation: 0 });
}
