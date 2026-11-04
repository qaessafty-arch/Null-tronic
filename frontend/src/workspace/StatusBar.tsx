import { useMemo } from 'react';
import { useStore, setView } from '../state/store';
import { validateProject, overallStatus } from '../calculations/validation';
import { StatusIcon } from '../components/Icon';
import { execute } from '../history/history';
import { updateSettings } from '../project-model/operations';

export function StatusBar() {
  const project = useStore((s) => s.project);
  const cursor = useStore((s) => s.cursorWorld);
  const sel = useStore((s) => s.selection.length);
  const tool = useStore((s) => s.tool);
  const hand = useStore((s) => s.hand);
  const lastLog = useStore((s) => s.log[s.log.length - 1]);
  const status = useMemo(() => overallStatus(validateProject(project)), [project]);
  const u = project.settings.displayUnit;
  const fmt = (mm: number) => (u === 'm' ? (mm / 1000).toFixed(3) : u === 'cm' ? (mm / 10).toFixed(2) : mm.toFixed(2));
  return (
    <div className="statusbar" role="status">
      <button className={`sb-item sb-status st-${status.status}`} onClick={() => setView({ bottom: true, bottomTab: 'validation' })} title="Open validation report">
        <StatusIcon status={status.status} /> {status.label}
      </button>
      <span className="sb-item mono">{cursor ? `X ${fmt(cursor.x)}  Y ${fmt(cursor.y)} ${u}` : '—'}</span>
      <button className="sb-item" title="Toggle snap to grid" onClick={() => execute('Toggle snap', (p) => updateSettings(p, { snapToGrid: !p.settings.snapToGrid }))}>
        Snap {project.settings.snapToGrid ? 'on' : 'off'} · grid {project.settings.gridMm} mm
      </button>
      <span className="sb-item">Tool: {tool}</span>
      <span className="sb-item">{sel} selected</span>
      <span className="sb-item sb-log" title={lastLog?.text}>{lastLog ? lastLog.text : 'Ready'}</span>
      <span className={`sb-item conn-${hand.connection}`}>{hand.connection === 'connected' ? `Hand ${hand.fps.toFixed(0)} fps · ${hand.hands} hand(s)` : 'Mouse & keyboard'}</span>
    </div>
  );
}
