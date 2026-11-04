import { parseProject, serializeProject, ProjectFormatError } from '../project-model/serialization';
import { loadProject } from '../history/history';
import { log, store } from '../state/store';
import type { Project } from '../project-model/types';

/** Save / open / autosave / recovery. Projects stay local; no server is involved. */

const AUTOSAVE_KEY = 'ntcs.autosave';
const SNAPSHOT_KEY = 'ntcs.snapshots';

interface FileHandleLike {
  name: string;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

let currentHandle: FileHandleLike | null = null;

export function download(name: string, data: Blob | string, type = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(p: Project) {
  return (p.meta.name || 'project').replace(/[^A-Za-z0-9_\- ]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'project';
}

export async function saveProject(saveAs = false): Promise<void> {
  const s = store.get();
  const text = serializeProject(s.project);
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike> };
  try {
    if (w.showSaveFilePicker && (saveAs || !currentHandle)) {
      currentHandle = await w.showSaveFilePicker({ suggestedName: s.fileName.endsWith('.ntcs.json') ? s.fileName : `${safeName(s.project)}.ntcs.json`, types: [{ description: 'NULL-TECH project', accept: { 'application/json': ['.json'] } }] });
    }
    if (currentHandle) {
      const wr = await currentHandle.createWritable();
      await wr.write(text);
      await wr.close();
      store.set({ savedRevision: s.project, fileName: currentHandle.name });
      log('info', `Saved ${currentHandle.name}`, true);
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    log('warn', `File System Access failed (${(e as Error).message}); downloading instead.`);
  }
  const name = s.fileName.endsWith('.ntcs.json') && s.fileName !== 'untitled.ntcs.json' ? s.fileName : `${safeName(s.project)}.ntcs.json`;
  download(name, text, 'application/json');
  store.set({ savedRevision: s.project, fileName: name });
  log('info', `Saved ${name} (download)`, true);
}

export function openProjectText(text: string, name: string): boolean {
  try {
    const { project, migratedFrom } = parseProject(text);
    loadProject(project, name);
    currentHandle = null;
    log('info', `Opened ${name}${migratedFrom !== null ? ` (migrated from schema v${migratedFrom})` : ''}`, true);
    return true;
  } catch (e) {
    const msg = e instanceof ProjectFormatError ? e.issues.slice(0, 6).join('; ') : (e as Error).message;
    log('error', `Could not open ${name}: ${msg}`);
    return false;
  }
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function openProjectDialog(): Promise<void> {
  const f = await pickFile('.json,.ntcs.json');
  if (!f) return;
  openProjectText(await f.text(), f.name);
}

export function autosave(): void {
  try {
    const s = store.get();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), fileName: s.fileName, project: s.project }));
  } catch {
    /* storage full or unavailable */
  }
}

export function readAutosave(): { savedAt: string; fileName: string; project: Project } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const { project } = parseProject(JSON.stringify(d.project));
    return { savedAt: d.savedAt, fileName: d.fileName, project };
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

export interface Snapshot {
  id: string;
  name: string;
  savedAt: string;
  project: Project;
}

export function listSnapshots(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function takeSnapshot(name: string): void {
  const list = listSnapshots();
  list.unshift({ id: String(Date.now()), name, savedAt: new Date().toISOString(), project: store.get().project });
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(0, 10)));
    log('info', `Snapshot "${name}" stored locally`, true);
  } catch {
    log('error', 'Snapshot could not be stored (browser storage full).');
  }
}
