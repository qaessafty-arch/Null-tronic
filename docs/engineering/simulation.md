# Simulation engine

Implementation: `frontend/src/simulation/`.

## Method

Modified nodal analysis (Ho, Ruehli & Brennan 1975). Unknowns: node voltages plus branch currents
of voltage sources, inductors, op-amp outputs and transformers. Dense LU with partial pivoting.

| Analysis | Algorithm |
|---|---|
| Operating point | Newton–Raphson; SPICE `pnjlim` junction limiting; fallbacks: gmin stepping, then source stepping |
| Transient | Fixed step; backward Euler for the first step, trapezoidal afterwards; NR at every point; optional UIC (start from zero) |
| AC | Complex MNA linearised at the operating point; excitation = amplitude/phase of each sine source |

Every node has a 1 pS shunt to ground (also written into the SPICE export) so floating nodes stay
solvable; nets with no DC path to ground are reported as `FLOATING_NODE` warnings.

## Device models

| Device | Model | Parameters |
|---|---|---|
| R, C, L, V, I | ideal | — |
| Diode | Shockley + series R; Zener adds SPICE-style breakdown `-IBV·exp(-(V+BV)/(N·Vt))` | IS, N, RS, BV, IBV. Presets 1N4148 / 1N4007 use parameters as distributed in common SPICE libraries |
| LED | Shockley, N = 2, IS fitted to the entered forward voltage at 20 mA | Vf (typical values flagged as assumptions) |
| BJT | Ebers–Moll transport (= Gummel-Poon with defaults) | IS, BF, BR |
| MOSFET | Shichman–Hodges level 1 | VTO, KP, λ (W = L) |
| Op-amp | tanh-limited VCVS: `Vmid + Vhalf·tanh(A·Vd/Vhalf)` | open-loop gain, output limits |
| Transformer | ideal (Vp = n·Vs, Is = −n·Ip) | turns ratio |
| Switches, contacts | Ron 10 mΩ / Roff 1 GΩ | state |
| Logic gate | zero-delay: inputs read against VIL/VIH (CMOS 0.3/0.7·Vcc; 74LS 0.8/2.0 V), output VOH/VOL through an output resistance; undefined levels and oscillation reported | family, Vcc, Rout (assumed) |
| PLC | Structured Text scan per iteration: inputs from node voltage ≥ threshold, outputs switch a sourcing supply onto their terminal | program (Tools ▸ PLC program) |
| Relay / coil | resistor; energised above pick-up, de-energised below drop-out; iterated to a consistent state, oscillation detected | coil V, R, pick-up %, drop-out % |

Thermal voltage: kT/q at 300.15 K (SPICE TNOM = 27 °C).

## Verification

`frontend/tests/engineering/simulation.test.ts` compares with closed-form results (Ohm, series,
parallel, divider, KCL network, RC/RL transients, RC low-pass −3.01 dB / −45° at fc, ideal
transformer power balance, relay seal-in logic).
`frontend/tests/engineering/ngspice.test.ts` exports every DC example to SPICE, runs **ngspice**
and requires node-voltage agreement within 0.1 mV + 0.01 %, plus the rectifier (2 %) and
inverting amplifier transients. The suite is skipped — not passed — when ngspice is missing.

Relays, gates and the PLC share one discrete-update loop: solve → update states → re-solve until
nothing changes (oscillation, e.g. an inverter ring, is detected and reported).

## Not simulated

Gate propagation delay, flip-flops, generic ICs and microcontrollers (reported as *not evaluated*), PLC timers/counters, device capacitances,
temperature effects, noise, Monte Carlo.
