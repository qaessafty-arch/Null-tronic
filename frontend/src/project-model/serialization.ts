import { LIBRARY } from '../component-library/library';
import { defaultLayers, defaultSettings } from './factory';
import { FORMAT_ID, SCHEMA_VERSION, type Project } from './types';

/**
 * Native project format: UTF-8 JSON, extension `.ntcs.json`. Documented in
 * docs/engineering/project-format.md and shared/schemas/project.schema.json.
 */

export class ProjectFormatError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid project file:\n- ${issues.join('\n- ')}`);
  }
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Ordered migrations: index i upgrades schemaVersion i -> i+1. */
const MIGRATIONS: Migration[] = [
  // v0 -> v1: pre-release files had no layers/sheets/settings defaults and stored `items` instead of `components`.
  (raw) => {
    const type = (raw.type as Project['type']) ?? 'electronic';
    const out: Record<string, unknown> = { ...raw };
    if (raw.items && !raw.components) out.components = raw.items;
    delete out.items;
    out.settings = { ...defaultSettings(type), ...((raw.settings as object) ?? {}) };
    out.layers = raw.layers ?? defaultLayers(type);
    out.sheets = raw.sheets ?? [];
    out.schemaVersion = 1;
    return out;
  },
];

export function migrate(raw: Record<string, unknown>): { data: Record<string, unknown>; migratedFrom: number | null } {
  let v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  const from = v;
  let data = raw;
  if (v > SCHEMA_VERSION) throw new ProjectFormatError([`File schema version ${v} is newer than this application supports (${SCHEMA_VERSION}).`]);
  while (v < SCHEMA_VERSION) {
    data = MIGRATIONS[v](data);
    v += 1;
  }
  return { data, migratedFrom: from === SCHEMA_VERSION ? null : from };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown) => isObj(v) && isNum(v.x) && isNum(v.y);

/** Structural validation with precise messages. Returns a list of issues (empty = valid). */
export function validateProjectData(d: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (d.format !== FORMAT_ID) issues.push(`"format" must be "${FORMAT_ID}"`);
  if (!['electronic', 'installation', 'control'].includes(d.type as string)) issues.push('"type" must be electronic | installation | control');
  if (!isObj(d.meta) || typeof d.meta.name !== 'string') issues.push('"meta.name" missing');
  if (!isObj(d.settings)) issues.push('"settings" missing');
  for (const key of ['components', 'wires', 'junctions', 'rooms', 'circuits', 'cables', 'annotations']) {
    if (!isObj(d[key])) issues.push(`"${key}" must be an object keyed by id`);
  }
  if (issues.length) return issues;
  const comps = d.components as Record<string, Record<string, unknown>>;
  for (const [id, c] of Object.entries(comps)) {
    if (c.id !== id) issues.push(`component ${id}: id mismatch`);
    if (!LIBRARY[c.type as string]) issues.push(`component ${id}: unknown type "${String(c.type)}"`);
    if (!isVec(c.position)) issues.push(`component ${id}: invalid position`);
    if (![0, 90, 180, 270].includes(c.rotation as number)) issues.push(`component ${id}: rotation must be 0/90/180/270`);
    if (!isObj(c.properties)) issues.push(`component ${id}: properties missing`);
  }
  const juncs = d.junctions as Record<string, Record<string, unknown>>;
  for (const [id, j] of Object.entries(juncs)) if (!isVec(j.position)) issues.push(`junction ${id}: invalid position`);
  const checkEndpoint = (wid: string, e: unknown) => {
    if (!isObj(e)) return issues.push(`wire ${wid}: endpoint missing`);
    if (e.kind === 'pin') {
      const c = comps[e.componentId as string];
      if (!c) return issues.push(`wire ${wid}: references missing component ${String(e.componentId)}`);
      const def = LIBRARY[c.type as string];
      if (def && !def.pins.some((pp) => pp.id === e.pinId)) issues.push(`wire ${wid}: component ${String(c.ref)} has no pin ${String(e.pinId)}`);
    } else if (e.kind === 'junction') {
      if (!juncs[e.junctionId as string]) issues.push(`wire ${wid}: references missing junction ${String(e.junctionId)}`);
    } else issues.push(`wire ${wid}: invalid endpoint kind`);
    return 0;
  };
  for (const [id, w] of Object.entries(d.wires as Record<string, Record<string, unknown>>)) {
    checkEndpoint(id, w.a);
    checkEndpoint(id, w.b);
    if (!Array.isArray(w.vertices) || !w.vertices.every(isVec)) issues.push(`wire ${id}: invalid vertices`);
  }
  for (const [id, r] of Object.entries(d.rooms as Record<string, Record<string, unknown>>)) {
    if (!Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every(isVec)) issues.push(`room ${id}: polygon needs >= 3 points`);
  }
  for (const [id, c] of Object.entries(d.circuits as Record<string, Record<string, unknown>>)) {
    if (!comps[c.boardId as string]) issues.push(`circuit ${id}: board ${String(c.boardId)} missing`);
    if (!Array.isArray(c.deviceIds)) issues.push(`circuit ${id}: deviceIds missing`);
  }
  for (const [id, c] of Object.entries(d.cables as Record<string, Record<string, unknown>>)) {
    if (!Array.isArray(c.path) || c.path.length < 2 || !c.path.every(isVec)) issues.push(`cable ${id}: path needs >= 2 points`);
    if (!(d.circuits as Record<string, unknown>)[c.circuitId as string]) issues.push(`cable ${id}: circuit ${String(c.circuitId)} missing`);
  }
  return issues;
}

export function parseProject(text: string): { project: Project; migratedFrom: number | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectFormatError([`Not valid JSON: ${(e as Error).message}`]);
  }
  if (!isObj(raw)) throw new ProjectFormatError(['Top level must be an object']);
  const { data, migratedFrom } = migrate(raw);
  const issues = validateProjectData(data);
  if (issues.length) throw new ProjectFormatError(issues);
  const project = data as unknown as Project;
  // forward-fill settings added after a file was written within the same schema version
  project.settings = { ...defaultSettings(project.type), ...project.settings };
  return { project, migratedFrom };
}
