import { useSyncExternalStore, useRef } from 'react';
import { createProject } from '../project-model/factory';
import type { Finding, Id, Project, Vec2 } from '../project-model/types';
import type { Primitive } from '../drawing/primitives';
import type { SimResult } from '../simulation/simulate';

/**
 * Application state. The engineering model lives only in `project`; everything else is view or
 * session state. Undo/redo stores immutable project snapshots (structural sharing keeps this cheap).
 */

export type ToolId = 'select' | 'place' | 'wire' | 'room' | 'circuit' | 'dimension' | 'text' | 'pan' | 'measure';
export type ViewMode = '2d' | '3d' | 'split';
export type BottomTab = 'validation' | 'simulation' | 'schedule' | 'bom' | 'console' | 'report';

export interface HistoryEntry {
  label: string;
  project: Project;
}

export interface Preview {
  prims: Primitive[];
  status: 'valid' | 'warning' | 'invalid';
  messages: string[];
  /** Optional label shown near the cursor (dimensions, lengths). */
  label?: { at: Vec2; text: string };
}

export interface PendingOperation {
  label: string;
  apply: (p: Project) => Project;
  preview: Preview;
  /** Called after confirm with the new project (e.g. to select created entities). */
  after?: (p: Project) => void;
}

export interface LogEntry {
  t: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface HandState {
  enabled: boolean;
  connection: 'disconnected' | 'connecting' | 'connected' | 'error';
  url: string;
  camera: string;
  fps: number;
  hands: number;
  gesture: string;
  paused: boolean;
  cursor: { x: number; y: number } | null;
  pinching: boolean;
  landmarks: number[][][];
  message: string;
}

export interface AppState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  savedRevision: Project | null;
  fileName: string;
  selection: Id[];
  hover: { id: Id | null; pin?: { componentId: Id; pinId: string } | null };
  tool: ToolId;
  placeType: string | null;
  placeRotation: 0 | 90 | 180 | 270;
  preview: Preview | null;
  pending: PendingOperation | null;
  view: {
    mode: ViewMode;
    active: '2d' | '3d';
    theme: 'dark' | 'light';
    left: boolean;
    right: boolean;
    bottom: boolean;
    bottomTab: BottomTab;
    leftWidth: number;
    rightWidth: number;
    bottomHeight: number;
    fullscreen: boolean;
    showGrid: boolean;
    hidden3d: Id[];
    exploded: number;
    realistic: boolean;
    section: number | null;
    ortho: boolean;
  };
  sim: {
    result: SimResult | null;
    states: Record<string, boolean>;
    analysis: 'op' | 'tran' | 'ac';
    tstop: number;
    steps: number;
    uic: boolean;
    fstart: number;
    fstop: number;
    ppd: number;
    /** project revision the result belongs to (stale detection) */
    forProject: Project | null;
  };
  hand: HandState;
  log: LogEntry[];
  toasts: { id: number; level: 'info' | 'warn' | 'error'; text: string }[];
  dialog: null | 'new' | 'print' | 'settings' | 'hand' | 'examples' | 'about' | 'assistant' | 'recovery' | 'import' | 'project' | 'shortcuts' | 'plc';
  cursorWorld: Vec2 | null;
  findings: Finding[];
}

const initialProject = createProject('electronic', 'Untitled circuit');

export const initialState: AppState = {
  project: initialProject,
  past: [],
  future: [],
  savedRevision: initialProject,
  fileName: 'untitled.ntcs.json',
  selection: [],
  hover: { id: null, pin: null },
  tool: 'select',
  placeType: null,
  placeRotation: 0,
  preview: null,
  pending: null,
  view: {
    mode: '2d',
    active: '2d',
    theme: 'dark',
    left: true,
    right: true,
    bottom: true,
    bottomTab: 'validation',
    leftWidth: 248,
    rightWidth: 300,
    bottomHeight: 230,
    fullscreen: false,
    showGrid: true,
    hidden3d: [],
    exploded: 0,
    realistic: true,
    section: null,
    ortho: false,
  },
  sim: { result: null, states: {}, analysis: 'op', tstop: 0.01, steps: 500, uic: false, fstart: 1, fstop: 1e6, ppd: 20, forProject: null },
  hand: { enabled: false, connection: 'disconnected', url: 'ws://127.0.0.1:8765', camera: 'unknown', fps: 0, hands: 0, gesture: 'none', paused: false, cursor: null, pinching: false, landmarks: [], message: '' },
  log: [],
  toasts: [],
  dialog: null,
  cursorWorld: null,
  findings: [],
};

type Listener = () => void;

class Store {
  private state: AppState = initialState;
  private listeners = new Set<Listener>();
  get = (): AppState => this.state;
  set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  /** Replace the whole state (tests). */
  reset = (s: AppState = initialState): void => {
    this.state = s;
    this.listeners.forEach((l) => l());
  };
}

export const store = new Store();

/** Select a slice; re-renders only when the selected value changes (Object.is). */
export function useStore<T>(selector: (s: AppState) => T): T {
  const ref = useRef<{ s: AppState; v: T } | null>(null);
  const get = () => {
    const s = store.get();
    if (ref.current && ref.current.s === s) return ref.current.v;
    const v = selector(s);
    if (ref.current && Object.is(ref.current.v, v)) {
      ref.current = { s, v: ref.current.v };
      return ref.current.v;
    }
    ref.current = { s, v };
    return v;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}

let toastId = 0;
export function log(level: LogEntry['level'], text: string, toast = level !== 'info'): void {
  const entry: LogEntry = { t: new Date().toLocaleTimeString(), level, text };
  store.set((s) => ({ log: [...s.log.slice(-499), entry] }));
  if (toast) notify(level, text);
}

export function notify(level: 'info' | 'warn' | 'error', text: string): void {
  const id = ++toastId;
  store.set((s) => ({ toasts: [...s.toasts.slice(-4), { id, level, text }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === 'error' ? 7000 : 4000);
}

export function setView(patch: Partial<AppState['view']>): void {
  store.set((s) => ({ view: { ...s.view, ...patch } }));
}
