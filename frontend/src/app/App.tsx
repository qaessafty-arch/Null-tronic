import { useEffect, useRef } from 'react';
import { MenuBar } from '../workspace/MenuBar';
import { Toolbar } from '../workspace/Toolbar';
import { LibraryPanel } from '../workspace/LibraryPanel';
import { PropertiesPanel } from '../workspace/PropertiesPanel';
import { BottomPanel } from '../workspace/BottomPanel';
import { StatusBar } from '../workspace/StatusBar';
import { Dialogs } from '../workspace/Dialogs';
import { Viewport2D } from '../viewport-2d/Viewport2D';
import { Viewport3D } from '../viewport-3d/Viewport3D';
import { store, useStore, setView } from '../state/store';
import { dispatchCommand, keyCombo, loadShortcuts } from '../input-system/input';
import { autosave, readAutosave } from './file-ops';
import { isDirty } from '../history/history';
import { Icon } from '../components/Icon';

function Splitter({ dir, onDrag }: { dir: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className={`splitter splitter-${dir}`}
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = dir === 'x' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const v = dir === 'x' ? e.clientX : e.clientY;
        onDrag(v - last.current);
        last.current = v;
      }}
      onPointerUp={() => (last.current = null)}
    />
  );
}

function Welcome() {
  const empty = useStore((s) => Object.keys(s.project.components).length === 0 && Object.keys(s.project.rooms).length === 0 && Object.keys(s.project.annotations).length === 0);
  const tool = useStore((s) => s.tool);
  const type = useStore((s) => s.project.type);
  if (!empty || tool === 'place') return null;
  return (
    <div className="welcome" role="note">
      <h2>Empty {type} workspace</h2>
      <p>{type === 'installation' ? 'Draw rooms (O), place a distribution board and devices from the library, then create circuits (C).' : 'Pick a component from the library, click to place it, then draw wires (W) between pins.'}</p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => store.set({ dialog: 'examples' })}>
          <Icon name="book" /> Open an example
        </button>
        <button className="btn" onClick={() => store.set({ dialog: 'new' })}>
          <Icon name="new" /> New project
        </button>
        <button className="btn" onClick={() => dispatchCommand('open')}>
          <Icon name="open" /> Open file
        </button>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const theme = view.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // keyboard → shared command system
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (store.get().dialog && e.key !== 'Escape') return;
      const combo = keyCombo(e);
      const cmd = loadShortcuts()[combo];
      if (!cmd) return;
      e.preventDefault();
      dispatchCommand(cmd, 'mouse');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // autosave every 20 s when there are unsaved changes; offer recovery at start-up
  useEffect(() => {
    const a = readAutosave();
    if (a && Object.keys(a.project.components).length) store.set({ dialog: 'recovery' });
    let last = store.get().project;
    const id = setInterval(() => {
      const p = store.get().project;
      if (p !== last && isDirty()) {
        autosave();
        last = p;
      }
    }, 20000);
    const before = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        autosave();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', before);
    };
  }, []);

  const fs = view.fullscreen;
  const showLeft = view.left && !fs;
  const showRight = view.right && !fs;
  const showBottom = view.bottom && !fs;
  return (
    <div className={`app ${fs ? 'fullscreen' : ''}`}>
      {!fs && <MenuBar />}
      {!fs && <Toolbar />}
      <div className="workspace" style={{ gridTemplateColumns: `${showLeft ? `${view.leftWidth}px 4px` : ''} 1fr ${showRight ? `4px ${view.rightWidth}px` : ''}` }}>
        {showLeft && <LibraryPanel />}
        {showLeft && <Splitter dir="x" onDrag={(d) => setView({ leftWidth: Math.min(480, Math.max(180, store.get().view.leftWidth + d)) })} />}
        <div className="center" style={{ gridTemplateRows: `1fr ${showBottom ? `4px ${view.bottomHeight}px` : ''}` }}>
          <div className={`viewports mode-${view.mode}`}>
            {(view.mode === '2d' || view.mode === 'split') && (
              <div className={`vp-wrap ${view.active === '2d' && view.mode === 'split' ? 'active' : ''}`}>
                <Viewport2D />
                <Welcome />
              </div>
            )}
            {(view.mode === '3d' || view.mode === 'split') && (
              <div className={`vp-wrap ${view.active === '3d' && view.mode === 'split' ? 'active' : ''}`}>
                <Viewport3D />
              </div>
            )}
            {fs && (
              <button className="exit-fs btn btn-sm" onClick={() => setView({ fullscreen: false })}>
                Exit full screen (F11)
              </button>
            )}
          </div>
          {showBottom && <Splitter dir="y" onDrag={(d) => setView({ bottomHeight: Math.min(600, Math.max(120, store.get().view.bottomHeight - d)) })} />}
          {showBottom && <BottomPanel />}
        </div>
        {showRight && <Splitter dir="x" onDrag={(d) => setView({ rightWidth: Math.min(520, Math.max(220, store.get().view.rightWidth - d)) })} />}
        {showRight && <PropertiesPanel />}
      </div>
      {!fs && <StatusBar />}
      <Dialogs />
      <Toasts />
    </div>
  );
}
