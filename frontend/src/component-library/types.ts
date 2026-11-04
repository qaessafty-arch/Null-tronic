import type { Primitive } from '../drawing/primitives';
import type { ProjectType, PropertyValue } from '../project-model/types';

export type PinKind = 'passive' | 'positive' | 'negative' | 'input' | 'output' | 'power' | 'ground' | 'terminal';

export interface PinDef {
  id: string;
  name: string;
  /** Local position (mm, y down) used by 2D symbol and 3D lead tips alike. */
  x: number;
  y: number;
  kind: PinKind;
}

export interface PropertyDef {
  key: string;
  label: string;
  kind: 'number' | 'string' | 'boolean' | 'select';
  unit?: string;
  default: PropertyValue;
  options?: string[];
  min?: number;
  /** Explains what the value means and where a default came from. */
  hint?: string;
  /** Values that are typical/assumed and must be confirmed by the designer. */
  assumption?: boolean;
}

export type Category =
  | 'Passive'
  | 'Sources'
  | 'Semiconductors'
  | 'Integrated circuits'
  | 'Logic'
  | 'Switching'
  | 'Connectivity'
  | 'Measurement'
  | 'Distribution'
  | 'Lighting'
  | 'Power outlets'
  | 'Loads'
  | 'Supply'
  | 'Containment'
  | 'Control devices'
  | 'PLC';

export type SimSupport = 'full' | 'interactive' | 'none';

export interface ComponentDef {
  type: string;
  name: string;
  category: Category;
  modes: ProjectType[];
  refPrefix: string;
  pins: PinDef[];
  properties: PropertyDef[];
  /** Symbol geometry in local coordinates for the given property values. */
  symbol: (props: Record<string, PropertyValue>) => Primitive[];
  /** Offset for the reference / value labels (local). */
  labelOffset: { x: number; y: number };
  /** Physical envelope, mm (length x width x height) where meaningful. */
  dimensions?: { l: number; w: number; h: number };
  defaultElevation: number;
  /** Key for the parametric 3D model builder. */
  model3d: string;
  simulation: SimSupport;
  description: string;
  /** Generic description of the datasheet parameters the user should confirm. */
  datasheet?: string;
  /** Installation load device (contributes to circuit load). */
  isLoad?: boolean;
  /** Distribution board — circuits originate here. */
  isBoard?: boolean;
  /** Primary value shown on drawings. */
  valueLabel?: (props: Record<string, PropertyValue>) => string;
}
