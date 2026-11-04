import { ProjectBuilder } from '../project-model/builder';
import { addCircuit, addRoom, addAnnotations } from '../project-model/operations';
import { makeRoom, planCircuit } from '../project-model/installation';
import { newId } from '../project-model/ids';
import type { Project } from '../project-model/types';

/**
 * Example projects. Each is built with the public model operations, so it is a genuine,
 * editable, simulatable project — not a picture. Tests in tests/engineering verify their
 * simulated values against hand calculations and ngspice.
 */

export interface ExampleDef {
  id: string;
  title: string;
  topic: string;
  type: Project['type'];
  summary: string;
  /** Recommended analysis for the example. */
  analysis: { kind: 'op' } | { kind: 'tran'; tstop: number; steps: number; uic?: boolean } | { kind: 'ac'; fstart: number; fstop: number; ppd: number };
  /** Expected results / hand calculation used in the tutorial text. */
  theory: string[];
  steps: string[];
  build: () => Project;
}

function ohmsLaw(): Project {
  const b = new ProjectBuilder('electronic', "Ohm's law");
  const v1 = b.add('vdc', { x: 0, y: 10 }, { voltage: 9 });
  const r1 = b.add('resistor', { x: 25, y: 10 }, { resistance: 1000 }, { rotation: 90 });
  const am = b.add('ammeter', { x: 12.5, y: 5 });
  const g = b.add('ground', { x: 0, y: 22.5 });
  b.wire(v1, '+', am, '+').wire(am, '-', r1, '1').wire(r1, '2', v1, '-').wire(v1, '-', g, '1');
  return b.build();
}

function series(): Project {
  const b = new ProjectBuilder('electronic', 'Series circuit');
  const v1 = b.add('vdc', { x: 0, y: 15 }, { voltage: 12 });
  const r1 = b.add('resistor', { x: 15, y: 5 }, { resistance: 1000 });
  const r2 = b.add('resistor', { x: 35, y: 5 }, { resistance: 2000 });
  const r3 = b.add('resistor', { x: 45, y: 15 }, { resistance: 3000 }, { rotation: 90 });
  const p1 = b.add('probe', { x: 25, y: 5 }, { name: 'A' });
  const g = b.add('ground', { x: 0, y: 27.5 });
  b.wire(v1, '+', r1, '1', [{ x: 0, y: 5 }]).wire(r1, '2', r2, '1').wire(r2, '2', r3, '1', [{ x: 45, y: 5 }]).wire(r3, '2', v1, '-').wire(v1, '-', g, '1');
  b.wire(p1, '1', r1, '2');
  return b.build();
}

function parallel(): Project {
  const b = new ProjectBuilder('electronic', 'Parallel circuit');
  const v1 = b.add('vdc', { x: 0, y: 15 }, { voltage: 12 });
  const r1 = b.add('resistor', { x: 20, y: 15 }, { resistance: 1000 }, { rotation: 90 });
  const r2 = b.add('resistor', { x: 35, y: 15 }, { resistance: 2000 }, { rotation: 90 });
  const a1 = b.add('ammeter', { x: 10, y: 5 });
  const g = b.add('ground', { x: 0, y: 27.5 });
  b.wire(v1, '+', a1, '+', [{ x: 0, y: 5 }]).wire(a1, '-', r1, '1', [{ x: 20, y: 5 }]).wire(r1, '1', r2, '1', [{ x: 20, y: 5 }, { x: 35, y: 5 }]);
  b.wire(r1, '2', v1, '-', [{ x: 20, y: 22.5 }, { x: 0, y: 22.5 }]).wire(r2, '2', r1, '2', [{ x: 35, y: 22.5 }, { x: 20, y: 22.5 }]).wire(v1, '-', g, '1');
  return b.build();
}

function divider(): Project {
  const b = new ProjectBuilder('electronic', 'Voltage divider');
  const v1 = b.add('vdc', { x: 0, y: 15 }, { voltage: 10 });
  const r1 = b.add('resistor', { x: 20, y: 10 }, { resistance: 10000 }, { rotation: 90 });
  const r2 = b.add('resistor', { x: 20, y: 25 }, { resistance: 4700 }, { rotation: 90 });
  const out = b.add('label', { x: 25, y: 17.5 }, { net: 'VOUT' });
  const pr = b.add('probe', { x: 20, y: 17.5 }, { name: 'VOUT' });
  const g = b.add('ground', { x: 0, y: 35 });
  b.wire(v1, '+', r1, '1', [{ x: 0, y: 5 }, { x: 20, y: 5 }]).wire(r1, '2', r2, '1').wire(r2, '2', v1, '-', [{ x: 20, y: 32.5 }, { x: 0, y: 32.5 }]).wire(v1, '-', g, '1');
  b.wire(pr, '1', r1, '2').wire(out, '1', pr, '1');
  return b.build();
}

function ledCircuit(): Project {
  const b = new ProjectBuilder('electronic', 'LED with series resistor');
  const v1 = b.add('vdc', { x: 0, y: 10 }, { voltage: 9 });
  const r1 = b.add('resistor', { x: 15, y: 5 }, { resistance: 470 });
  const d1 = b.add('led', { x: 30, y: 5 }, { color: 'red', vf: 1.9 });
  const g1 = b.add('ground', { x: 0, y: 20 });
  const g2 = b.add('ground', { x: 35, y: 20 });
  b.wire(v1, '+', r1, '1').wire(r1, '2', d1, 'A').wire(d1, 'K', g2, '1').wire(v1, '-', g1, '1');
  return b.build();
}

function kirchhoff(): Project {
  const b = new ProjectBuilder('electronic', "Kirchhoff's laws — two-source network");
  const v1 = b.add('vdc', { x: 0, y: 15 }, { voltage: 10 });
  const v2 = b.add('vdc', { x: 50, y: 15 }, { voltage: 5 });
  const r1 = b.add('resistor', { x: 15, y: 5 }, { resistance: 1000 });
  const r2 = b.add('resistor', { x: 35, y: 5 }, { resistance: 2000 });
  const r3 = b.add('resistor', { x: 25, y: 15 }, { resistance: 3000 }, { rotation: 90 });
  const g = b.add('ground', { x: 25, y: 30 });
  const pr = b.add('probe', { x: 25, y: 5 }, { name: 'VA' });
  b.wire(v1, '+', r1, '1', [{ x: 0, y: 5 }]).wire(r1, '2', r2, '1').wire(r2, '2', v2, '+', [{ x: 50, y: 5 }]);
  b.wire(r1, '2', r3, '1', [{ x: 25, y: 5 }]).wire(r3, '2', g, '1').wire(v1, '-', g, '1', [{ x: 0, y: 25 }, { x: 25, y: 25 }]).wire(v2, '-', g, '1', [{ x: 50, y: 25 }, { x: 25, y: 25 }]);
  b.wire(pr, '1', r1, '2');
  return b.build();
}

function rcCharging(): Project {
  const b = new ProjectBuilder('electronic', 'RC charging (time constant)');
  const v1 = b.add('vdc', { x: 0, y: 15 }, { voltage: 5 });
  const r1 = b.add('resistor', { x: 15, y: 5 }, { resistance: 1000 });
  const c1 = b.add('capacitor_polarized', { x: 25, y: 15 }, { capacitance: 100e-6 }, { rotation: 90 });
  const pr = b.add('probe', { x: 25, y: 5 }, { name: 'VC' });
  const g = b.add('ground', { x: 0, y: 27.5 });
  b.wire(v1, '+', r1, '1', [{ x: 0, y: 5 }]).wire(r1, '2', c1, '+', [{ x: 25, y: 5 }]).wire(c1, '-', v1, '-', [{ x: 25, y: 22.5 }, { x: 0, y: 22.5 }]).wire(v1, '-', g, '1');
  b.wire(pr, '1', c1, '+');
  return b.build();
}

function rectifier(): Project {
  const b = new ProjectBuilder('electronic', 'Half-wave rectifier with smoothing');
  const v1 = b.add('vac', { x: 0, y: 15 }, { amplitude: 12, frequency: 50 });
  const d1 = b.add('diode', { x: 15, y: 5 }, { model: '1N4007' });
  const c1 = b.add('capacitor_polarized', { x: 30, y: 15 }, { capacitance: 470e-6, voltageRating: 25 }, { rotation: 90 });
  const r1 = b.add('resistor', { x: 45, y: 15 }, { resistance: 1000 }, { rotation: 90 });
  const pin = b.add('probe', { x: 5, y: 5 }, { name: 'VIN' });
  const pout = b.add('probe', { x: 45, y: 5 }, { name: 'VOUT' });
  const g = b.add('ground', { x: 0, y: 27.5 });
  b.wire(v1, '+', d1, 'A', [{ x: 0, y: 5 }]).wire(d1, 'K', c1, '+', [{ x: 30, y: 5 }]).wire(c1, '+', r1, '1', [{ x: 30, y: 5 }, { x: 45, y: 5 }]);
  b.wire(r1, '2', c1, '-', [{ x: 45, y: 22.5 }, { x: 30, y: 22.5 }]).wire(c1, '-', v1, '-', [{ x: 30, y: 22.5 }, { x: 0, y: 22.5 }]).wire(v1, '-', g, '1');
  b.wire(pin, '1', v1, '+').wire(pout, '1', r1, '1');
  return b.build();
}

function transistorSwitch(): Project {
  const b = new ProjectBuilder('electronic', 'Transistor switch (NPN low-side)');
  const vcc = b.add('vdc', { x: 60, y: 15 }, { voltage: 9 });
  const vin = b.add('vdc', { x: 0, y: 25 }, { voltage: 5 });
  const rb = b.add('resistor', { x: 17.5, y: 20 }, { resistance: 10000 });
  const q1 = b.add('npn', { x: 30, y: 20 }, { bf: 100 });
  const rc = b.add('resistor', { x: 32.5, y: -5 }, { resistance: 470 }, { rotation: 90 });
  const d1 = b.add('led', { x: 32.5, y: 7.5 }, { color: 'green', vf: 2.1 }, { rotation: 90 });
  const g = b.add('ground', { x: 32.5, y: 37.5 });
  const sw = b.add('switch', { x: 7.5, y: 10 }, { closed: true });
  b.wire(vin, '+', sw, '1', [{ x: 0, y: 10 }]).wire(sw, '2', rb, '1').wire(rb, '2', q1, 'B');
  b.wire(q1, 'C', d1, 'K').wire(d1, 'A', rc, '2').wire(rc, '1', vcc, '+', [{ x: 32.5, y: -15 }, { x: 60, y: -15 }]);
  b.wire(q1, 'E', g, '1').wire(vin, '-', g, '1', [{ x: 0, y: 32.5 }, { x: 32.5, y: 32.5 }]).wire(vcc, '-', g, '1', [{ x: 60, y: 32.5 }, { x: 32.5, y: 32.5 }]);
  return b.build();
}

function invertingAmp(): Project {
  const b = new ProjectBuilder('electronic', 'Inverting op-amp amplifier');
  const vin = b.add('vac', { x: 0, y: 15 }, { amplitude: 0.5, frequency: 1000 });
  const rin = b.add('resistor', { x: 15, y: 7.5 }, { resistance: 10000 });
  const rf = b.add('resistor', { x: 32.5, y: -2.5 }, { resistance: 100000 });
  const u1 = b.add('opamp', { x: 32.5, y: 10 });
  const g = b.add('ground', { x: 0, y: 25 });
  const g2 = b.add('ground', { x: 22.5, y: 17.5 });
  const pin = b.add('probe', { x: 5, y: 7.5 }, { name: 'VIN' });
  const pout = b.add('probe', { x: 45, y: 10 }, { name: 'VOUT' });
  b.wire(vin, '+', rin, '1', [{ x: 0, y: 7.5 }]).wire(rin, '2', u1, '-').wire(u1, '-', rf, '1', [{ x: 22.5, y: 7.5 }, { x: 22.5, y: -2.5 }]).wire(rf, '2', u1, 'OUT', [{ x: 45, y: -2.5 }, { x: 45, y: 10 }]);
  b.wire(u1, '+', g2, '1', [{ x: 22.5, y: 12.5 }]).wire(vin, '-', g, '1');
  b.wire(u1, 'OUT', pout, '1').wire(pin, '1', rin, '1');
  return b.build();
}

function relayControl(): Project {
  const b = new ProjectBuilder('electronic', 'Relay control of an LED');
  const v1 = b.add('vdc', { x: 0, y: 15 }, { voltage: 12 });
  const s1 = b.add('pushbutton', { x: 12.5, y: 0 });
  const k1 = b.add('relay', { x: 30, y: 15 }, { coilVoltage: 12, coilResistance: 400 });
  const r1 = b.add('resistor', { x: 45, y: 0 }, { resistance: 680 });
  const d1 = b.add('led', { x: 55, y: 15 }, { color: 'yellow', vf: 2.0 }, { rotation: 90 });
  const g = b.add('ground', { x: 0, y: 35 });
  b.wire(v1, '+', s1, '1', [{ x: 0, y: 0 }]).wire(s1, '2', k1, 'A1', [{ x: 25, y: 0 }]);
  b.wire(k1, 'A2', g, '1', [{ x: 25, y: 30 }, { x: 0, y: 30 }]).wire(v1, '-', g, '1');
  b.wire(k1, 'COM', v1, '+', [{ x: 35, y: 27.5 }, { x: -5, y: 27.5 }, { x: -5, y: 0 }, { x: 0, y: 0 }]);
  b.wire(k1, 'NO', r1, '1', [{ x: 32.5, y: 0 }]).wire(r1, '2', d1, 'A', [{ x: 55, y: 0 }]).wire(d1, 'K', g, '1', [{ x: 55, y: 30 }, { x: 0, y: 30 }]);
  return b.build();
}

function motorStarter(): Project {
  // Direct-on-line starter control circuit with seal-in contact (24 V DC control supply).
  const b = new ProjectBuilder('control', 'DOL motor starter — control circuit');
  const v1 = b.add('vdc', { x: 0, y: 40 }, { voltage: 24 }, { ref: 'G1' });
  const f1 = b.add('overload_nc', { x: 20, y: 10 }, {}, { ref: 'F1' });
  const s0 = b.add('pb_nc', { x: 20, y: 25 }, {}, { ref: 'S0' });
  const s1 = b.add('pb_no', { x: 20, y: 40 }, {}, { ref: 'S1' });
  const k1a = b.add('contact_no', { x: 35, y: 40 }, { tag: 'K1' }, { ref: 'K1.1' });
  const k1 = b.add('coil', { x: 20, y: 60 }, { tag: 'K1', coilVoltage: 24, coilResistance: 200 }, { ref: 'K1' });
  const k1b = b.add('contact_no', { x: 55, y: 40 }, { tag: 'K1' }, { ref: 'K1.2' });
  const h1 = b.add('lamp', { x: 55, y: 60 }, { resistance: 480, color: 'green' }, { ref: 'H1' });
  const g = b.add('ground', { x: 0, y: 75 });
  b.wire(v1, '+', f1, '95', [{ x: 0, y: 0 }, { x: 20, y: 0 }]).wire(f1, '96', s0, '11').wire(s0, '12', s1, '13');
  b.wire(s1, '13', k1a, '13', [{ x: 20, y: 32.5 }, { x: 35, y: 32.5 }]).wire(s1, '14', k1, 'A1', [{ x: 20, y: 50 }]).wire(k1a, '14', s1, '14', [{ x: 35, y: 50 }, { x: 20, y: 50 }]);
  b.wire(k1, 'A2', g, '1', [{ x: 20, y: 70 }, { x: 0, y: 70 }]).wire(v1, '-', g, '1');
  b.wire(k1b, '13', f1, '95', [{ x: 55, y: 0 }, { x: 20, y: 0 }]).wire(k1b, '14', h1, 'X1').wire(h1, 'X2', g, '1', [{ x: 55, y: 70 }, { x: 0, y: 70 }]);
  return b.build();
}

function plcIo(): Project {
  const b = new ProjectBuilder('control', 'PLC input / output wiring');
  const v1 = b.add('vdc', { x: 0, y: 20 }, { voltage: 24 }, { ref: 'G1' });
  const s1 = b.add('pb_no', { x: 20, y: 10 }, {}, { ref: 'S1' });
  const i0 = b.add('plc_input', { x: 35, y: 15 }, { address: 'I0.0' }, { ref: 'I0' });
  const q0 = b.add('plc_output', { x: 45, y: 35 }, { address: 'Q0.0', state: false }, { ref: 'Q0' });
  const h1 = b.add('lamp', { x: 60, y: 40 }, { resistance: 480 }, { ref: 'H1' });
  const g = b.add('ground', { x: 0, y: 55 });
  b.wire(v1, '+', s1, '13', [{ x: 0, y: 5 }, { x: 20, y: 5 }]).wire(s1, '14', i0, '1', [{ x: 20, y: 15 }]).wire(v1, '-', g, '1');
  b.wire(q0, '1', h1, 'X1', [{ x: 60, y: 35 }]).wire(h1, 'X2', g, '1', [{ x: 60, y: 50 }, { x: 0, y: 50 }]);
  // input reference resistor so the input reads 0 V when the button is released
  const r = b.add('resistor', { x: 30, y: 30 }, { resistance: 4700 }, { rotation: 90 });
  b.wire(r, '1', i0, '1', [{ x: 30, y: 15 }]).wire(r, '2', g, '1', [{ x: 30, y: 50 }, { x: 0, y: 50 }]);
  return b.build();
}

export function sampleInstallation(): Project {
  const b = new ProjectBuilder('installation', 'Residential flat — sample installation');
  let p = b.project;
  const rooms = [
    makeRoom('Living room', 0, 0, 6000, 4500),
    makeRoom('Bedroom', 6000, 0, 4000, 4500),
    makeRoom('Kitchen', 0, 4500, 4000, 3500),
    makeRoom('Hall', 4000, 4500, 3000, 3500),
    makeRoom('Bathroom', 7000, 4500, 3000, 3500),
  ];
  rooms.forEach((r) => (p = addRoom(p, r)));
  b.project = p;
  const db = b.add('db', { x: 5500, y: 7600 }, { ways: 12, location: 'Hall' }, { ref: 'DB1' });
  const l = [
    b.add('light', { x: 1500, y: 2250 }, { power: 18 }),
    b.add('light', { x: 4500, y: 2250 }, { power: 18 }),
    b.add('light', { x: 8000, y: 2250 }, { power: 18 }),
    b.add('light', { x: 2000, y: 6250 }, { power: 24 }),
    b.add('light', { x: 5500, y: 6000 }, { power: 12 }),
    b.add('light', { x: 8500, y: 6250 }, { power: 12 }),
  ];
  const sw = [b.add('switch_1way', { x: 5800, y: 300 }), b.add('switch_1way', { x: 6300, y: 4200 }), b.add('switch_1way', { x: 3700, y: 4800 })];
  const so = [
    b.add('socket', { x: 300, y: 1500 }),
    b.add('socket', { x: 300, y: 3500 }),
    b.add('socket', { x: 3000, y: 4300 }),
    b.add('socket', { x: 9700, y: 1500 }),
    b.add('socket', { x: 7000, y: 300 }),
  ];
  const ks = [b.add('socket', { x: 300, y: 5500 }, { power: 1000 }), b.add('socket', { x: 2000, y: 7700 }, { power: 1000 })];
  const ac = b.add('ac_unit', { x: 3000, y: 300 }, { power: 1500 });
  const wh = b.add('water_heater', { x: 9500, y: 7500 }, { power: 2000 });
  p = b.project;
  const c1 = planCircuit(p, db.id, [l[4].id, l[3].id, l[0].id, l[1].id, sw[0].id, sw[2].id], { name: 'C1', phase: 'L1', notes: 'Lighting — kitchen, living, hall' });
  p = addCircuit(p, c1.circuit, c1.cables);
  const c2 = planCircuit(p, db.id, [l[5].id, l[2].id, sw[1].id], { name: 'C2', phase: 'L1', notes: 'Lighting — bedroom, bathroom' });
  p = addCircuit(p, c2.circuit, c2.cables);
  const c3 = planCircuit(p, db.id, [so[2].id, so[1].id, so[0].id, so[4].id, so[3].id], { name: 'C3', phase: 'L1', notes: 'General sockets' });
  p = addCircuit(p, c3.circuit, c3.cables);
  const c4 = planCircuit(p, db.id, [ks[1].id, ks[0].id], { name: 'C4', phase: 'L1', notes: 'Kitchen sockets' });
  p = addCircuit(p, c4.circuit, c4.cables);
  const c5 = planCircuit(p, db.id, [ac.id], { name: 'C5', phase: 'L1', notes: 'Air conditioner — dedicated' });
  p = addCircuit(p, c5.circuit, c5.cables);
  const c6 = planCircuit(p, db.id, [wh.id], { name: 'C6', phase: 'L1', notes: 'Water heater — dedicated', protection: { kind: 'RCBO', curve: 'B', ratingA: null, residualmA: 30 } });
  p = addCircuit(p, c6.circuit, c6.cables);
  p = addAnnotations(p, [{ id: newId('ann'), kind: 'text', points: [{ x: 0, y: -600 }], text: 'GROUND FLOOR — ELECTRICAL LAYOUT', textHeight: 250, layer: 'annotations' }]);
  return p;
}

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'ohms-law',
    title: "Ohm's law",
    topic: 'DC fundamentals',
    type: 'electronic',
    summary: 'A 9 V source drives a 1 kΩ resistor through an ammeter.',
    analysis: { kind: 'op' },
    theory: ['I = V / R = 9 V / 1000 Ω = 9 mA', 'P = V·I = 81 mW'],
    steps: ['Place a DC voltage source (V) and set 9 V.', 'Place a resistor (R) and set 1 kΩ.', 'Add a current probe in series.', 'Connect the loop and add a Ground.', 'Run Simulation ▸ Operating point and read the ammeter current.'],
    build: ohmsLaw,
  },
  {
    id: 'series',
    title: 'Series resistors',
    topic: 'DC fundamentals',
    type: 'electronic',
    summary: 'Three resistors in series share the same current.',
    analysis: { kind: 'op' },
    theory: ['R_total = 1k + 2k + 3k = 6 kΩ', 'I = 12 V / 6 kΩ = 2 mA', 'V(A) = 12 − 2 mA·1 kΩ = 10 V'],
    steps: ['Build the loop V1 → R1 → R2 → R3 → V1.', 'Simulate and confirm the same current flows in each resistor.', 'Check that the voltage drops add up to 12 V (KVL).'],
    build: series,
  },
  {
    id: 'parallel',
    title: 'Parallel resistors',
    topic: 'DC fundamentals',
    type: 'electronic',
    summary: 'Two branches across one source; branch currents add (KCL).',
    analysis: { kind: 'op' },
    theory: ['I1 = 12/1k = 12 mA, I2 = 12/2k = 6 mA', 'I_total = 18 mA; R_eq = 666.7 Ω'],
    steps: ['Connect R1 and R2 across the same two nodes.', 'Measure total current with the ammeter.', 'Compare with V / R_eq.'],
    build: parallel,
  },
  {
    id: 'divider',
    title: 'Voltage divider',
    topic: 'DC fundamentals',
    type: 'electronic',
    summary: '10 kΩ over 4.7 kΩ from 10 V.',
    analysis: { kind: 'op' },
    theory: ['Vout = Vin · R2/(R1+R2) = 10 · 4.7/14.7 = 3.197 V'],
    steps: ['Stack R1 over R2 across the source.', 'Label the middle node VOUT.', 'Simulate and compare with the divider formula.'],
    build: divider,
  },
  {
    id: 'kirchhoff',
    title: "Kirchhoff's laws",
    topic: 'Network analysis',
    type: 'electronic',
    summary: 'Two sources feeding a common node through R1/R2 with R3 to ground.',
    analysis: { kind: 'op' },
    theory: ['KCL at A: (10−VA)/1k + (5−VA)/2k = VA/3k', '6(10 − VA) + 3(5 − VA) = 2·VA  ⇒  VA = 75/11 = 6.818 V'],
    steps: ['Build the network.', 'Write KCL at node A by hand.', 'Simulate and compare VA.'],
    build: kirchhoff,
  },
  {
    id: 'led',
    title: 'LED with series resistor',
    topic: 'Semiconductors',
    type: 'electronic',
    summary: 'Sizing a resistor so that an LED runs below its maximum current.',
    analysis: { kind: 'op' },
    theory: ['I ≈ (Vs − Vf)/R = (9 − 1.9)/470 ≈ 15 mA', 'Exact value from the diode equation is slightly different because Vf depends on current.'],
    steps: ['Place source, resistor, LED, ground.', 'Simulate and read the LED current.', 'Change R to 100 Ω and observe the over-current error.'],
    build: ledCircuit,
  },
  {
    id: 'rc',
    title: 'RC charging',
    topic: 'Transients',
    type: 'electronic',
    summary: 'Capacitor charging through a resistor from 0 V (UIC).',
    analysis: { kind: 'tran', tstop: 0.5, steps: 500, uic: true },
    theory: ['τ = R·C = 1 kΩ · 100 µF = 0.1 s', 'Vc(τ) = 5·(1 − e⁻¹) = 3.16 V'],
    steps: ['Build R in series with C.', 'Run a transient of 0.5 s with "start from zero".', 'Read Vc at 0.1 s.'],
    build: rcCharging,
  },
  {
    id: 'rectifier',
    title: 'Half-wave rectifier',
    topic: 'Power electronics',
    type: 'electronic',
    summary: '12 Vpk 50 Hz, 1N4007, 470 µF reservoir, 1 kΩ load.',
    analysis: { kind: 'tran', tstop: 0.1, steps: 2000 },
    theory: ['Peak output ≈ 12 − Vf ≈ 11.2 V', 'Ripple ≈ I/(f·C) ≈ 11 mA/(50·470 µF) ≈ 0.47 V'],
    steps: ['Build the circuit.', 'Run a 100 ms transient.', 'Compare VIN and VOUT; measure ripple.'],
    build: rectifier,
  },
  {
    id: 'bjt-switch',
    title: 'Transistor switch',
    topic: 'Semiconductors',
    type: 'electronic',
    summary: 'An NPN transistor switching an LED load from a 5 V signal.',
    analysis: { kind: 'op' },
    theory: ['Ib ≈ (5 − 0.7)/10k ≈ 0.43 mA', 'Ic(max) ≈ (9 − 2.1 − 0.1)/470 ≈ 14 mA < β·Ib → saturated'],
    steps: ['Simulate with S1 closed (LED on).', 'Toggle S1 open in the simulation panel and re-run.'],
    build: transistorSwitch,
  },
  {
    id: 'inverting-amp',
    title: 'Inverting amplifier',
    topic: 'Operational amplifiers',
    type: 'electronic',
    summary: 'Gain = −Rf/Rin = −10.',
    analysis: { kind: 'tran', tstop: 0.003, steps: 600 },
    theory: ['Av = −Rf/Rin = −100k/10k = −10', '0.5 Vpk in → 5 Vpk out, inverted'],
    steps: ['Build the amplifier.', 'Run a 3 ms transient.', 'Run AC analysis to see the flat (ideal) gain of 20 dB.'],
    build: invertingAmp,
  },
  {
    id: 'relay',
    title: 'Relay control',
    topic: 'Control',
    type: 'electronic',
    summary: 'A push button energises a relay, whose NO contact lights an LED.',
    analysis: { kind: 'op' },
    theory: ['Coil current = 12 V / 400 Ω = 30 mA when the button is pressed'],
    steps: ['Simulate: the LED is off.', 'Press S1 in the simulation panel: the relay picks up and the LED turns on.'],
    build: relayControl,
  },
  {
    id: 'dol-starter',
    title: 'Motor starter (DOL) control',
    topic: 'Control',
    type: 'control',
    summary: 'Start/stop circuit with a seal-in contact and run lamp.',
    analysis: { kind: 'op' },
    theory: ['Pressing S1 energises K1; K1.1 seals in so K1 stays on after S1 is released.', 'S0 or F1 opening drops K1.'],
    steps: ['Simulate: K1 off.', 'Press S1 → K1 on, H1 lit.', 'Release S1 → K1 stays on (seal-in).', 'Press S0 → K1 drops out.'],
    build: motorStarter,
  },
  {
    id: 'plc-io',
    title: 'PLC I/O wiring',
    topic: 'PLC',
    type: 'control',
    summary: 'A push button wired to a sourcing input and an output driving a lamp.',
    analysis: { kind: 'op' },
    theory: ['Input I0.0 reads ON when its terminal is ≥ 15 V.', 'Force Q0.0 to light H1 (no PLC program execution yet).'],
    steps: ['Simulate and press S1: I0.0 turns ON.', 'Force Q0.0 on: H1 receives 24 V.'],
    build: plcIo,
  },
  {
    id: 'flat',
    title: 'Residential flat installation',
    topic: 'Installation design',
    type: 'installation',
    summary: 'Five rooms, six final circuits, loads, cable routes and a distribution board.',
    analysis: { kind: 'op' },
    theory: ['Circuit current Ib = P / (U·cos φ)', 'Voltage drop per IEC 60364-5-52 Annex G method using conductor resistivity at operating temperature'],
    steps: ['Open the installation schedule (bottom panel).', 'Inspect C3 voltage drop and suggested breaker.', 'Open the 3D view to inspect routes.', 'Generate the drawing sheet and print to PDF.'],
    build: sampleInstallation,
  },
];
