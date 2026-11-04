import { log, store } from '../state/store';
import { runAC, runOperatingPoint, runTransient, type SimResult } from './simulate';
import type { SimRequest } from './worker';

let worker: Worker | null = null;
let seq = 0;
let running = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; result: SimResult }>) => {
      if (ev.data.id !== running) return; // stale result
      deliver(ev.data.result);
    };
    worker.onerror = (e) => {
      log('error', `Simulation worker error: ${e.message}`);
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function deliver(result: SimResult) {
  const s = store.get();
  store.set({ sim: { ...s.sim, result, forProject: s.project }, view: { ...s.view, bottom: true, bottomTab: 'simulation' } });
  if (!result.ok) log('error', `Simulation: ${result.error}`);
  else {
    const n = result.findings.filter((f) => f.status === 'error' || f.status === 'warning').length;
    log(n ? 'warn' : 'info', `Simulation (${result.kind}) complete${n ? ` with ${n} finding(s)` : ''}.`, n > 0);
  }
}

/** Run the configured analysis on the current project (Web Worker when available). */
export function runSimulation(statesOverride?: Record<string, boolean>): void {
  const s = store.get();
  if (s.project.type === 'installation') {
    store.set({ view: { ...s.view, bottom: true, bottomTab: 'schedule' } });
    log('info', 'Installation projects are evaluated by the calculation engine (see Schedule).', true);
    return;
  }
  const req: SimRequest = {
    id: ++seq,
    project: s.project,
    analysis: s.sim.analysis,
    states: statesOverride ?? s.sim.states,
    tstop: s.sim.tstop,
    steps: s.sim.steps,
    uic: s.sim.uic,
    fstart: s.sim.fstart,
    fstop: s.sim.fstop,
    ppd: s.sim.ppd,
  };
  running = req.id;
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (w) {
    w.postMessage(req);
    return;
  }
  const states = new Map(Object.entries(req.states));
  const r = req.analysis === 'op' ? runOperatingPoint(req.project, states) : req.analysis === 'tran' ? runTransient(req.project, req.tstop, req.steps, states, req.uic) : runAC(req.project, req.fstart, req.fstop, req.ppd);
  deliver(r);
}

/** Toggle an interactive element (switch, push button, forced PLC output) and re-run. */
export function toggleState(key: string): void {
  const s = store.get();
  const result = s.sim.result;
  const base = result && result.ok && result.kind === 'op' ? result.states : s.sim.states;
  const states = { ...base, [key]: !(base[key] ?? false) };
  store.set({ sim: { ...s.sim, states, analysis: s.sim.analysis } });
  runSimulation(states);
}
