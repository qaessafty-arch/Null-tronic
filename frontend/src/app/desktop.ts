/**
 * Desktop (Tauri) integration: native save / open dialogs. In the browser these functions are
 * never called (isDesktop() is false) and the web fallbacks (download / <input type=file>) apply.
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function desktopSave(name: string, data: Blob | string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
  if (!path) return null;
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  await writeFile(path, bytes);
  return path;
}

export async function desktopOpen(accept: string): Promise<File | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const extensions = accept.split(',').map((s) => s.trim().replace(/^\./, '').split('.').pop()!).filter(Boolean);
  const path = await open({ multiple: false, filters: extensions.length ? [{ name: 'Supported files', extensions }] : [] });
  if (!path || Array.isArray(path)) return null;
  const bytes = await readFile(path);
  return new File([bytes], path.split(/[\\/]/).pop() ?? 'file');
}
