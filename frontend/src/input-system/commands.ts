import { confirmPending, execute, redo, rejectPending, undo } from '../history/history';
import { duplicateEntities, mirrorComponents, removeEntities, rotateComponents } from '../project-model/operations';
import { log, setView, store } from '../state/store';
import { setTool } from '../engineering-tools/tools';
import { getAdapter, setGlobalCommandHandler, type InputSource } from './input';
import { openProjectDialog, saveProject } from '../app/file-ops';
import { runSimulation } from '../simulation/run';
import type { Project } from '../project-model/types';

/**
 * Global application commands. Each is reachable from the menu, toolbar, keyboard shortcuts,
 * hand gestures (via the shared input protocol) and the assistant.
 */

let clipboard: { project: Project; ids: string[] } | null = null;

export const COMMAND_LABELS: Record<string, string> = {
  undo: 'Undo',
  redo: 'Redo',
  delete: 'Delete selection',
  rotate: 'Rotate 90°',
  mirror: 'Mirror',
  duplicate: 'Duplicate',
  copy: 'Copy',
  paste: 'Paste',
  'select-all': 'Select all',
  cancel: 'Cancel / back to select',
  confirm: 'Confirm preview',
  reject: 'Reject preview',
  'tool:select': 'Select tool',
  'tool:wire': 'Wire tool',
  'tool:room': 'Room tool',
  'tool:circuit': 'Circuit tool',
  'tool:dimension': 'Dimension tool',
  'tool:text': 'Text tool',
  'tool:measure': 'Measure tool',
  fit: 'Fit to project',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'view-2d': '2D view',
  'view-3d': '3D view',
  'view-split': '2D + 3D',
  save: 'Save',
  'save-as': 'Save as',
  open: 'Open',
  new: 'New project',
  print: 'Print / export drawing',
  simulate: 'Run simulation',
  fullscreen: 'Full-screen viewport',
  'toggle-grid': 'Toggle grid',
  pause: 'Pause hand input',
  resume: 'Resume hand input',
};

export function runCommand(name: string, source: InputSource = 'mouse'): boolean {
  const s = store.get();
  // While hand input is paused (open palm), only resume / cancel are honoured from the hand.
  if (source === 'hand' && s.hand.paused && name !== 'resume' && name !== 'pause') return true;
  switch (name) {
    case 'undo':
      undo();
      return true;
    case 'redo':
      redo();
      return true;
    case 'delete':
      if (s.selection.length) execute(`Delete ${s.selection.length} item(s)`, (p) => removeEntities(p, s.selection));
      return true;
    case 'rotate':
      if (s.selection.some((id) => s.project.components[id])) execute('Rotate', (p) => rotateComponents(p, s.selection, 90));
      return true;
    case 'mirror':
      if (s.selection.some((id) => s.project.components[id])) execute('Mirror', (p) => mirrorComponents(p, s.selection));
      return true;
    case 'duplicate': {
      if (!s.selection.length) return true;
      const g = s.project.settings.gridMm * 4;
      let ids: string[] = [];
      execute('Duplicate', (p) => {
        const r = duplicateEntities(p, s.selection, { x: g, y: g });
        ids = r.newIds;
        return r.project;
      });
      store.set({ selection: ids });
      return true;
    }
    case 'copy':
      if (s.selection.length) {
        clipboard = { project: s.project, ids: [...s.selection] };
        log('info', `Copied ${s.selection.length} item(s)`);
      }
      return true;
    case 'paste': {
      if (!clipboard) return true;
      const g = s.project.settings.gridMm * 4;
      const cb = clipboard;
      let ids: string[] = [];
      execute('Paste', (p) => {
        const r = duplicateEntities(p, cb.ids, { x: g, y: g }, cb.project);
        ids = r.newIds;
        return r.project;
      });
      store.set({ selection: ids });
      return true;
    }
    case 'select-all': {
      const p = s.project;
      store.set({ selection: [...Object.keys(p.components), ...Object.keys(p.wires), ...Object.keys(p.junctions), ...Object.keys(p.rooms), ...Object.keys(p.annotations)] });
      return true;
    }
    case 'confirm':
      return confirmPending();
    case 'reject':
      if (rejectPending()) return true;
      return runCommand('cancel', source);
    case 'cancel':
      if (rejectPending()) return true;
      if (s.tool !== 'select') setTool('select');
      else store.set({ selection: [], preview: null });
      return true;
    case 'fit':
      getAdapter()?.fit?.();
      return true;
    case 'zoom-in':
      getAdapter()?.zoomAt(1.25);
      return true;
    case 'zoom-out':
      getAdapter()?.zoomAt(0.8);
      return true;
    case 'view-2d':
      setView({ mode: '2d', active: '2d' });
      return true;
    case 'view-3d':
      setView({ mode: '3d', active: '3d' });
      return true;
    case 'view-split':
      setView({ mode: 'split' });
      return true;
    case 'save':
      void saveProject(false);
      return true;
    case 'save-as':
      void saveProject(true);
      return true;
    case 'open':
      void openProjectDialog();
      return true;
    case 'new':
      store.set({ dialog: 'new' });
      return true;
    case 'print':
      store.set({ dialog: 'print' });
      return true;
    case 'simulate':
      runSimulation();
      return true;
    case 'fullscreen':
      setView({ fullscreen: !s.view.fullscreen });
      return true;
    case 'toggle-grid':
      setView({ showGrid: !s.view.showGrid });
      return true;
    case 'pause':
      store.set({ hand: { ...s.hand, paused: true } });
      if (s.pending) rejectPending();
      return true;
    case 'resume':
      store.set({ hand: { ...s.hand, paused: false } });
      return true;
  }
  if (name.startsWith('tool:')) {
    setTool(name.slice(5) as never);
    return true;
  }
  return false;
}

export function installGlobalCommands(): void {
  setGlobalCommandHandler(runCommand);
}
