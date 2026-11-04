import { defaultProperties, getDef } from '../component-library/library';
import { newId } from './ids';
import { FORMAT_ID, SCHEMA_VERSION, type ComponentInstance, type DrawingSheet, type Layer, type Project, type ProjectSettings, type ProjectType, type Vec2 } from './types';
import reference from '@shared/engineering-rules/installation-reference.json';

export function defaultLayers(type: ProjectType): Layer[] {
  const common: Layer[] = [
    { name: 'components', color: '#d8dee6', visible: true, locked: false, lineWeight: 0.25 },
    { name: 'wires', color: '#2bd97a', visible: true, locked: false, lineWeight: 0.25 },
    { name: 'annotations', color: '#9aa4b1', visible: true, locked: false, lineWeight: 0.18 },
    { name: 'underlay', color: '#5c6672', visible: true, locked: true, lineWeight: 0.13 },
  ];
  if (type === 'installation') {
    common.push(
      { name: 'architecture', color: '#9aa4b1', visible: true, locked: false, lineWeight: 0.5 },
      { name: 'cables', color: '#f2b84b', visible: true, locked: false, lineWeight: 0.35 },
    );
  }
  return common;
}

export function defaultSettings(type: ProjectType): ProjectSettings {
  return {
    displayUnit: type === 'installation' ? 'm' : 'mm',
    gridMm: type === 'installation' ? 100 : 2.5,
    snapToGrid: true,
    supplyVoltage: 230,
    frequencyHz: 50,
    supplyPhases: 1,
    conductorTempC: 70,
    voltageDropLimitLighting: reference.voltageDropLimits.lighting,
    voltageDropLimitOther: reference.voltageDropLimits.other,
    ampacityTable: [],
    unitPrices: {},
    currency: 'IQD',
    // IEC 60445 identification colours (configurable, not proof of compliance).
    conductorColors: {
      L1: '#8b5a2b',
      L2: '#1a1a1a',
      L3: '#8c8c8c',
      N: '#2f6fdb',
      PE: '#5fbf3a',
      signal: '#2bd97a',
      ground: '#8f9aa6',
      control: '#d64545',
      power: '#e5534b',
    },
    alwaysConfirm: false,
  };
}

export function defaultSheet(type: ProjectType): DrawingSheet {
  return {
    id: newId('sheet'),
    title: type === 'installation' ? 'Electrical installation plan' : type === 'control' ? 'Control wiring diagram' : 'Circuit schematic',
    number: 'E-001',
    kind: type === 'installation' ? 'installation-plan' : 'schematic',
    paper: 'A3',
    orientation: 'landscape',
    scale: type === 'installation' ? 100 : 0,
    marginMm: 10,
    lineWeightScale: 1,
    showWatermark: false,
  };
}

export function createProject(type: ProjectType, name = 'Untitled project'): Project {
  const now = new Date().toISOString();
  return {
    format: FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    type,
    meta: {
      id: newId('prj'),
      name,
      author: '',
      organisation: '',
      description: '',
      createdAt: now,
      modifiedAt: now,
      revision: 'A',
      revisions: [{ id: 'A', date: now.slice(0, 10), description: 'Initial issue', author: '' }],
      notes: '',
    },
    settings: defaultSettings(type),
    components: {},
    wires: {},
    junctions: {},
    rooms: {},
    circuits: {},
    cables: {},
    annotations: {},
    layers: defaultLayers(type),
    sheets: [defaultSheet(type)],
  };
}

/** Next free reference designator for a prefix (R1, R2 ...). */
export function nextRef(project: Project, prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[$^]/g, '\\$&')}(\\d+)$`);
  for (const c of Object.values(project.components)) {
    const m = re.exec(c.ref);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

export function makeComponent(project: Project, type: string, position: Vec2, overrides: Partial<ComponentInstance> = {}): ComponentInstance {
  const def = getDef(type);
  return {
    id: newId('cmp'),
    type,
    ref: nextRef(project, def.refPrefix),
    position: { ...position },
    rotation: 0,
    mirror: false,
    elevation: def.defaultElevation,
    properties: defaultProperties(type),
    layer: 'components',
    ...overrides,
  };
}
