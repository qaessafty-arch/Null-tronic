import type { Vec2 } from '../project-model/types';
import { store } from '../state/store';

/**
 * Shared input system. Mouse/keyboard (DOM) and hand tracking (WebSocket) are both translated
 * into the same PointerInput / command stream; tools never know which device produced an event.
 *
 *   MOUSE / KEYBOARD ──┐
 *                      ├── InputSystem ── active Tool ── history.execute ── Project
 *   HAND TRACKING ─────┘
 */

export type InputSource = 'mouse' | 'hand' | 'touch' | 'assistant';

export interface PointerInput {
  phase: 'down' | 'move' | 'up';
  world: Vec2;
  source: InputSource;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** Hit tolerance in world mm (derived from the viewport zoom). */
  tolerance: number;
  /** Click count for double-click detection. */
  detail: number;
}

export interface Tool {
  id: string;
  pointer(e: PointerInput): void;
  /** Return true if the tool consumed the command. */
  command?(name: string, source: InputSource): boolean;
  reset?(): void;
}

/** Bridge from normalised coordinates (hand tracking) to a concrete viewport. */
export interface ViewportAdapter {
  kind: '2d' | '3d';
  normalizedToWorld(nx: number, ny: number): Vec2 | null;
  tolerance(): number;
  zoomAt(factor: number, nx?: number, ny?: number): void;
  panBy(dxNorm: number, dyNorm: number): void;
  /** 3D views route raw normalised pointer input to camera / picking. */
  rawPointer?(phase: 'down' | 'move' | 'up', nx: number, ny: number, source: InputSource): void;
  fit?(): void;
}

const adapters = new Map<'2d' | '3d', ViewportAdapter>();
const tools = new Map<string, Tool>();
type CommandHandler = (name: string, source: InputSource) => boolean;
let globalCommands: CommandHandler = () => false;

export function registerAdapter(a: ViewportAdapter): () => void {
  adapters.set(a.kind, a);
  return () => {
    if (adapters.get(a.kind) === a) adapters.delete(a.kind);
  };
}

export function getAdapter(kind?: '2d' | '3d'): ViewportAdapter | undefined {
  return adapters.get(kind ?? store.get().view.active);
}

export function registerTool(t: Tool): void {
  tools.set(t.id, t);
}

export function activeTool(): Tool | undefined {
  return tools.get(store.get().tool);
}

export function setGlobalCommandHandler(h: CommandHandler): void {
  globalCommands = h;
}

export function dispatchPointer(e: PointerInput): void {
  store.set({ cursorWorld: e.world });
  activeTool()?.pointer(e);
}

/**
 * Commands: tool-specific handlers get the first chance (e.g. "confirm" ends a wire), then
 * global handlers (undo, delete, view switching ...).
 */
export function dispatchCommand(name: string, source: InputSource = 'mouse'): boolean {
  const t = activeTool();
  if (t?.command?.(name, source)) return true;
  return globalCommands(name, source);
}

/** Hand-tracking pointer in normalised viewport coordinates. */
export function dispatchNormalizedPointer(phase: 'down' | 'move' | 'up', nx: number, ny: number, source: InputSource = 'hand'): void {
  const a = getAdapter();
  if (!a) return;
  if (a.kind === '3d' && a.rawPointer) {
    a.rawPointer(phase, nx, ny, source);
    return;
  }
  const world = a.normalizedToWorld(nx, ny);
  if (!world) return;
  dispatchPointer({ phase, world, source, button: 0, shift: false, ctrl: false, alt: false, tolerance: a.tolerance() * 1.6, detail: 1 });
}

// ---------------------------------------------------------------- keyboard shortcuts

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  'ctrl+z': 'undo',
  'ctrl+y': 'redo',
  'ctrl+shift+z': 'redo',
  delete: 'delete',
  backspace: 'delete',
  r: 'rotate',
  m: 'mirror',
  'ctrl+d': 'duplicate',
  'ctrl+c': 'copy',
  'ctrl+v': 'paste',
  'ctrl+a': 'select-all',
  escape: 'cancel',
  enter: 'confirm',
  s: 'tool:select',
  v: 'tool:select',
  w: 'tool:wire',
  o: 'tool:room',
  c: 'tool:circuit',
  d: 'tool:dimension',
  t: 'tool:text',
  'shift+m': 'tool:measure',
  f: 'fit',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
  '1': 'view-2d',
  '2': 'view-3d',
  '3': 'view-split',
  'ctrl+s': 'save',
  'ctrl+shift+s': 'save-as',
  'ctrl+o': 'open',
  'ctrl+n': 'new',
  'ctrl+p': 'print',
  f5: 'simulate',
  f11: 'fullscreen',
  g: 'toggle-grid',
};

const SHORTCUT_KEY = 'ntcs.shortcuts';

export function loadShortcuts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SHORTCUT_KEY);
    if (raw) return { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SHORTCUTS };
}

export function saveShortcuts(map: Record<string, string>): void {
  try {
    const diff: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) if (DEFAULT_SHORTCUTS[k] !== v) diff[k] = v;
    localStorage.setItem(SHORTCUT_KEY, JSON.stringify(diff));
  } catch {
    /* ignore */
  }
}

export function keyCombo(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (e.shiftKey && (key.length > 1 || /[a-z]/.test(key))) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}
