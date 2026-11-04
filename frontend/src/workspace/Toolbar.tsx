import { runCommand } from '../input-system/commands';
import { setView, store, useStore } from '../state/store';
import { Icon } from '../components/Icon';
import { confirmPending, rejectPending } from '../history/history';

function Btn({ icon, label, cmd, active, disabled, onClick, text }: { icon: string; label: string; cmd?: string; active?: boolean; disabled?: boolean; onClick?: () => void; text?: string }) {
  return (
    <button className={`tb-btn ${active ? 'active' : ''} ${text ? 'with-text' : ''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick ?? (() => cmd && runCommand(cmd))}>
      <Icon name={icon} />
      {text && <span>{text}</span>}
    </button>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const type = useStore((s) => s.project.type);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const mode = useStore((s) => s.view.mode);
  const theme = useStore((s) => s.view.theme);
  const hand = useStore((s) => s.hand);
  const pending = useStore((s) => s.pending);
  const placeType = useStore((s) => s.placeType);
  const isInst = type === 'installation';
  const handLabel = hand.connection === 'connected' ? (hand.paused ? 'Hand: paused' : `Hand: ${hand.gesture}`) : hand.connection === 'connecting' ? 'Hand: connecting' : 'Hand: off';
  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="tb-group">
        <Btn icon="new" label="New project (Ctrl+N)" cmd="new" />
        <Btn icon="open" label="Open (Ctrl+O)" cmd="open" />
        <Btn icon="save" label="Save (Ctrl+S)" cmd="save" />
      </div>
      <div className="tb-group">
        <Btn icon="undo" label="Undo (Ctrl+Z)" cmd="undo" disabled={!past} />
        <Btn icon="redo" label="Redo (Ctrl+Y)" cmd="redo" disabled={!future} />
      </div>
      <div className="tb-group">
        <Btn icon="select" label="Select / move (S)" cmd="tool:select" active={tool === 'select'} />
        {!isInst && <Btn icon="wire" label="Wire (W)" cmd="tool:wire" active={tool === 'wire'} />}
        {isInst && <Btn icon="room" label="Room (O)" cmd="tool:room" active={tool === 'room'} />}
        {isInst && <Btn icon="circuit" label="Circuit from board (C)" cmd="tool:circuit" active={tool === 'circuit'} />}
        <Btn icon="dimension" label="Dimension (D)" cmd="tool:dimension" active={tool === 'dimension'} />
        <Btn icon="text" label="Text (T)" cmd="tool:text" active={tool === 'text'} />
        <Btn icon="measure" label="Measure (Shift+M)" cmd="tool:measure" active={tool === 'measure'} />
        {tool === 'place' && placeType && <span className="tb-chip">Placing: {placeType} · R rotates · Esc ends</span>}
      </div>
      <div className="tb-group">
        <Btn icon="rotate" label="Rotate (R)" cmd="rotate" />
        <Btn icon="mirror" label="Mirror (M)" cmd="mirror" />
        <Btn icon="trash" label="Delete (Del)" cmd="delete" />
      </div>
      <div className="tb-group">
        <Btn icon="square" label="2D canvas (1)" cmd="view-2d" active={mode === '2d'} text="2D" />
        <Btn icon="cube" label="3D viewport (2)" cmd="view-3d" active={mode === '3d'} text="3D" />
        <Btn icon="split" label="2D + 3D (3)" cmd="view-split" active={mode === 'split'} />
        <Btn icon="fit" label="Fit (F)" cmd="fit" />
      </div>
      <div className="tb-group">
        <Btn icon="play" label={isInst ? 'Calculate installation' : 'Simulate (F5)'} cmd="simulate" text={isInst ? 'Calculate' : 'Simulate'} />
        <Btn icon="print" label="Drawings / print (Ctrl+P)" cmd="print" />
      </div>
      {pending && (
        <div className="tb-group pending" role="status">
          <span className={`pending-label st-${pending.preview.status}`}>Preview: {pending.label}</span>
          <button className="btn btn-primary btn-sm" disabled={pending.preview.status === 'invalid'} onClick={() => confirmPending()}>
            Confirm ⏎
          </button>
          <button className="btn btn-sm" onClick={() => rejectPending()}>
            Reject Esc
          </button>
        </div>
      )}
      <div className="tb-spacer" />
      <div className="tb-group">
        <button className={`hand-pill conn-${hand.connection}`} onClick={() => store.set({ dialog: 'hand' })} title="Hand tracking">
          <Icon name="hand" />
          <span>{handLabel}</span>
        </button>
        <Btn icon="assistant" label="Engineering assistant" onClick={() => store.set({ dialog: 'assistant' })} />
        <Btn icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle theme" onClick={() => setView({ theme: theme === 'dark' ? 'light' : 'dark' })} />
      </div>
    </div>
  );
}
