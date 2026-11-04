import { store, log, type PendingOperation } from '../state/store';
import type { Project } from '../project-model/types';

/**
 * Command history. Every modification of the authoritative model goes through `execute`, so
 * undo/redo works identically for mouse, keyboard, hand tracking, the assistant and importers.
 */

const MAX_HISTORY = 200;

export function execute(label: string, fn: (p: Project) => Project): boolean {
  const s = store.get();
  let next: Project;
  try {
    next = fn(s.project);
  } catch (e) {
    log('error', `${label} failed: ${(e as Error).message}`);
    return false;
  }
  if (next === s.project) return false;
  const sel = s.selection.filter((id) => idExists(next, id));
  store.set({
    project: next,
    past: [...s.past.slice(-(MAX_HISTORY - 1)), { label, project: s.project }],
    future: [],
    selection: sel,
  });
  log('info', label);
  return true;
}

export function idExists(p: Project, id: string): boolean {
  return !!(p.components[id] || p.wires[id] || p.junctions[id] || p.rooms[id] || p.circuits[id] || p.cables[id] || p.annotations[id]);
}

export function undo(): void {
  const s = store.get();
  const last = s.past[s.past.length - 1];
  if (!last) return;
  store.set({
    project: last.project,
    past: s.past.slice(0, -1),
    future: [{ label: last.label, project: s.project }, ...s.future],
    selection: s.selection.filter((id) => idExists(last.project, id)),
    pending: null,
    preview: null,
  });
  log('info', `Undo: ${last.label}`);
}

export function redo(): void {
  const s = store.get();
  const next = s.future[0];
  if (!next) return;
  store.set({
    project: next.project,
    future: s.future.slice(1),
    past: [...s.past, { label: next.label, project: s.project }],
    selection: s.selection.filter((id) => idExists(next.project, id)),
  });
  log('info', `Redo: ${next.label}`);
}

/** Replace the project entirely (open / new). Clears history. */
export function loadProject(p: Project, fileName: string): void {
  store.set({ project: p, past: [], future: [], selection: [], pending: null, preview: null, savedRevision: p, fileName, sim: { ...store.get().sim, result: null, states: {}, forProject: null } });
}

/** Stage an operation for explicit confirmation (preview stays visible). */
export function stage(op: PendingOperation): void {
  store.set({ pending: op, preview: op.preview });
}

export function confirmPending(): boolean {
  const s = store.get();
  const op = s.pending;
  if (!op) return false;
  if (op.preview.status === 'invalid') {
    log('warn', `Cannot confirm: ${op.preview.messages.join('; ')}`);
    return false;
  }
  store.set({ pending: null, preview: null });
  const ok = execute(op.label, op.apply);
  if (ok && op.after) op.after(store.get().project);
  return ok;
}

export function rejectPending(): boolean {
  const s = store.get();
  if (!s.pending) return false;
  store.set({ pending: null, preview: null });
  log('info', `Rejected: ${s.pending.label}`);
  return true;
}

export function isDirty(): boolean {
  const s = store.get();
  return s.project !== s.savedRevision;
}
