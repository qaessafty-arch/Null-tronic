/**
 * NULL-TECH authoritative engineering data model.
 *
 * Every view (2D canvas, 3D viewport, schedules, drawings, exports, simulation)
 * is derived from a single `Project` value. Views never own engineering state.
 * All lengths are stored in millimetres; display units are a presentation concern.
 */

export type Id = string;
export type ProjectType = 'electronic' | 'installation' | 'control';
export type DisplayUnit = 'mm' | 'cm' | 'm';
export type Rotation = 0 | 90 | 180 | 270;

export interface Vec2 {
  x: number;
  y: number;
}

export type PropertyValue = number | string | boolean;

export interface ComponentInstance {
  id: Id;
  /** Key into the component library (e.g. "resistor"). */
  type: string;
  /** Reference designator (R1, C2, DB1 ...). */
  ref: string;
  position: Vec2;
  rotation: Rotation;
  mirror: boolean;
  /** Height of the component origin above the floor / board, mm (3D). */
  elevation: number;
  properties: Record<string, PropertyValue>;
  layer: string;
  hidden?: boolean;
}

export type Endpoint =
  | { kind: 'pin'; componentId: Id; pinId: string }
  | { kind: 'junction'; junctionId: Id };

export type ConductorRole = 'auto' | 'signal' | 'power' | 'ground' | 'control' | 'L' | 'N' | 'PE';

export interface Wire {
  id: Id;
  a: Endpoint;
  b: Endpoint;
  /** Intermediate bend points (world mm). Endpoints are resolved from `a`/`b`. */
  vertices: Vec2[];
  role: ConductorRole;
  layer: string;
}

export interface Junction {
  id: Id;
  position: Vec2;
}

export interface Room {
  id: Id;
  name: string;
  polygon: Vec2[];
  floor: number;
  /** Floor-to-ceiling height, mm. */
  height: number;
  wallThickness: number;
}

/** Single-phase circuits are connected to one line conductor; 'L123' = balanced three-phase circuit. */
export type Phase = 'L1' | 'L2' | 'L3' | 'L123';

export interface ProtectionDevice {
  kind: 'MCB' | 'RCBO';
  curve: 'B' | 'C' | 'D';
  /** Rated current In (A). `null` = let the engine suggest a value. */
  ratingA: number | null;
  /** Residual operating current for RCBO, mA. */
  residualmA: number | null;
}

export interface CableSpec {
  material: 'Cu' | 'Al';
  /** Phase conductor cross-section, mm². `null` = let the engine suggest. */
  csaMm2: number | null;
  hasNeutral: boolean;
  hasPE: boolean;
  insulation: 'PVC' | 'XLPE';
  /** Free text reference to an IEC 60364-5-52 installation method (e.g. "B1"). */
  installationMethod: string;
}

export interface Circuit {
  id: Id;
  name: string;
  boardId: Id;
  /** Devices in feed order (daisy chain from the board). */
  deviceIds: Id[];
  phase: Phase;
  category: 'lighting' | 'power';
  protection: ProtectionDevice;
  cable: CableSpec;
  /** Demand (diversity) factor applied to the connected load. User assumption. */
  demandFactor: number;
  notes: string;
}

export interface Cable {
  id: Id;
  circuitId: Id;
  fromId: Id;
  toId: Id;
  /** Plan route including both endpoints (world mm). */
  path: Vec2[];
  /** Height at which the horizontal run is installed (ceiling / tray), mm. */
  routeElevation: number;
}

export type AnnotationKind = 'line' | 'polyline' | 'circle' | 'arc' | 'text' | 'dimension';

export interface Annotation {
  id: Id;
  kind: AnnotationKind;
  points: Vec2[];
  /** circle / arc radius (mm). */
  radius?: number;
  /** arc start/end angle (degrees, CCW from +x in drawing space). */
  startAngle?: number;
  endAngle?: number;
  text?: string;
  textHeight?: number;
  closed?: boolean;
  layer: string;
}

export interface Layer {
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  lineWeight: number;
}

export type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'custom';

export interface DrawingSheet {
  id: Id;
  title: string;
  number: string;
  kind: 'schematic' | 'installation-plan' | 'lighting-plan' | 'power-plan' | 'cable-plan' | 'single-line' | 'schedule' | 'bom';
  paper: PaperSize;
  customSize?: { width: number; height: number };
  orientation: 'landscape' | 'portrait';
  /** Drawing scale denominator (1:N). 0 = fit to sheet. */
  scale: number;
  marginMm: number;
  lineWeightScale: number;
  showWatermark: boolean;
}

export interface Revision {
  id: string;
  date: string;
  description: string;
  author: string;
}

export interface AmpacityRow {
  csaMm2: number;
  material: 'Cu' | 'Al';
  insulation: 'PVC' | 'XLPE';
  installationMethod: string;
  ampacityA: number;
  source: string;
}

export interface ProjectSettings {
  displayUnit: DisplayUnit;
  gridMm: number;
  snapToGrid: boolean;
  /** Nominal phase-to-neutral voltage, V. */
  supplyVoltage: number;
  frequencyHz: number;
  supplyPhases: 1 | 3;
  voltageDropLimitLighting: number;
  voltageDropLimitOther: number;
  ampacityTable: AmpacityRow[];
  unitPrices: Record<string, number>;
  currency: string;
  conductorColors: Record<'L1' | 'L2' | 'L3' | 'N' | 'PE' | 'signal' | 'ground' | 'control' | 'power', string>;
  /** Require explicit confirmation of every previewed operation, even from mouse input. */
  alwaysConfirm: boolean;
  /** PLC program (IEC 61131-3 Structured Text subset) executed against PLC I/O during simulation. */
  plcProgram?: string;
  /** Installation: external earth-fault loop impedance Ze at the origin (Ω), measured or declared by the supplier. */
  externalLoopImpedance?: number | null;
  /** Installation: earthing system of the supply. */
  earthingSystem?: 'TN-S' | 'TN-C-S' | 'TT' | 'IT';
}

export interface ProjectMeta {
  id: Id;
  name: string;
  author: string;
  organisation: string;
  description: string;
  createdAt: string;
  modifiedAt: string;
  revision: string;
  revisions: Revision[];
  notes: string;
}

export const FORMAT_ID = 'nulltech-circuit-studio-project';
export const SCHEMA_VERSION = 1;

export interface Project {
  format: typeof FORMAT_ID;
  schemaVersion: number;
  type: ProjectType;
  meta: ProjectMeta;
  settings: ProjectSettings;
  components: Record<Id, ComponentInstance>;
  wires: Record<Id, Wire>;
  junctions: Record<Id, Junction>;
  rooms: Record<Id, Room>;
  circuits: Record<Id, Circuit>;
  cables: Record<Id, Cable>;
  annotations: Record<Id, Annotation>;
  layers: Layer[];
  sheets: DrawingSheet[];
}

/** Status vocabulary used by every check. There is intentionally no "safe" status. */
export type CheckStatus = 'valid' | 'warning' | 'error' | 'not-evaluated' | 'review';

export interface Finding {
  id: string;
  status: CheckStatus;
  code: string;
  message: string;
  /** Entities the finding refers to. */
  refs: Id[];
  /** Short explanation of the rule or calculation behind the finding. */
  basis?: string;
}
