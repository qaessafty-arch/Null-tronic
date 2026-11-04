/// <reference lib="webworker" />
import { runAC, runOperatingPoint, runTransient } from './simulate';
import type { Project } from '../project-model/types';

/** Simulation runs off the UI thread so large transients never freeze the workspace. */
export interface SimRequest {
  id: number;
  project: Project;
  analysis: 'op' | 'tran' | 'ac';
  states: Record<string, boolean>;
  tstop: number;
  steps: number;
  uic: boolean;
  fstart: number;
  fstop: number;
  ppd: number;
}

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const r = ev.data;
  const states = new Map(Object.entries(r.states));
  let result;
  try {
    if (r.analysis === 'op') result = runOperatingPoint(r.project, states);
    else if (r.analysis === 'tran') result = runTransient(r.project, r.tstop, r.steps, states, r.uic);
    else result = runAC(r.project, r.fstart, r.fstop, r.ppd);
  } catch (e) {
    result = { kind: r.analysis, ok: false, error: (e as Error).message, findings: [], timestamp: new Date().toISOString() };
  }
  (self as unknown as Worker).postMessage({ id: r.id, result });
};
