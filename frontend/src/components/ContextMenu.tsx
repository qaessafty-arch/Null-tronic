import { useEffect } from 'react';
import { runCommand } from '../input-system/commands';
import { store, useStore } from '../state/store';

export function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const sel = useStore((s) => s.selection);
  const hasComp = useStore((s) => s.selection.some((id) => s.project.components[id]));
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [onClose]);
  const item = (label: string, cmd: string, enabled = true, key?: string) => (
    <button
      role="menuitem"
      disabled={!enabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        runCommand(cmd);
        onClose();
      }}
    >
      <span>{label}</span>
      {key && <kbd>{key}</kbd>}
    </button>
  );
  return (
    <div className="context-menu" role="menu" style={{ left: x, top: y }}>
      {item('Rotate 90°', 'rotate', hasComp, 'R')}
      {item('Mirror', 'mirror', hasComp, 'M')}
      {item('Duplicate', 'duplicate', sel.length > 0, 'Ctrl+D')}
      {item('Copy', 'copy', sel.length > 0, 'Ctrl+C')}
      {item('Paste', 'paste', true, 'Ctrl+V')}
      <div className="sep" />
      {item('Delete', 'delete', sel.length > 0, 'Del')}
      <div className="sep" />
      <button
        role="menuitem"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          store.set((s) => ({ view: { ...s.view, right: true } }));
          onClose();
        }}
      >
        <span>Properties…</span>
      </button>
    </div>
  );
}
