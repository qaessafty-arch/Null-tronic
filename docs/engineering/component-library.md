# Component library

Generated from `frontend/src/component-library/library.ts` (59 definitions). Do not edit by hand: run `npm run gen:docs` in `frontend/`.

Each definition provides pins (local mm coordinates shared by the 2D symbol and the 3D model), typed properties, an IEC 60617-style symbol, a parametric 3D model key and its simulation support (`full`, `interactive` = user-operated state, `none` = documented but not simulated).

Properties marked * carry typical/assumed defaults that must be confirmed from datasheets or design rules; the UI flags them as **assumed**.

| Name | Type | Category | Modes | Pins | Simulation | Properties |
|---|---|---|---|---|---|---|
| Resistor | `resistor` | Passive | electronic, control | 1 2 | full | resistance (Ω), powerRating (W), tolerance (%) |
| Capacitor (non-polarised) | `capacitor` | Passive | electronic | 1 2 | full | capacitance (F), voltageRating (V) |
| Electrolytic capacitor | `capacitor_polarized` | Passive | electronic | + - | full | capacitance (F), voltageRating (V) |
| Inductor | `inductor` | Passive | electronic | 1 2 | full | inductance (H), currentRating (A) |
| DC voltage source | `vdc` | Sources | electronic, control | + - | full | voltage (V) |
| AC voltage source (sine) | `vac` | Sources | electronic, control | + - | full | amplitude (V), frequency (Hz), offset (V), phase (°) |
| DC current source | `idc` | Sources | electronic | + - | full | current (A) |
| Diode | `diode` | Semiconductors | electronic, control | A K | full | model, is (A), n, rs (Ω), maxCurrent (A) |
| LED | `led` | Semiconductors | electronic, control | A K | full | color, vf (V)*, maxCurrent (A)* |
| Zener diode | `zener` | Semiconductors | electronic | A K | full | vz (V), izt (A), is (A), n, powerRating (W) |
| NPN transistor | `npn` | Semiconductors | electronic | B C E | full | bf*, br, is (A) |
| PNP transistor | `pnp` | Semiconductors | electronic | B C E | full | bf*, br, is (A) |
| N-channel MOSFET | `nmos` | Semiconductors | electronic | G D S | full | vth (V)*, k (A/V²)*, lambda (1/V) |
| P-channel MOSFET | `pmos` | Semiconductors | electronic | G D S | full | vth (V)*, k (A/V²)*, lambda (1/V) |
| Operational amplifier | `opamp` | Integrated circuits | electronic | - + OUT | full | gain, vsatPos (V), vsatNeg (V) |
| AND gate | `gate_and` | Logic | electronic, control | A B Y | none | family |
| OR gate | `gate_or` | Logic | electronic, control | A B Y | none | family |
| NAND gate | `gate_nand` | Logic | electronic, control | A B Y | none | family |
| NOR gate | `gate_nor` | Logic | electronic, control | A B Y | none | family |
| XOR gate | `gate_xor` | Logic | electronic, control | A B Y | none | family |
| NOT gate | `gate_not` | Logic | electronic, control | A Y | none | family |
| Switch (SPST) | `switch` | Switching | electronic, control | 1 2 | interactive | closed, rOn (Ω) |
| Push button (NO) | `pushbutton` | Switching | electronic | 1 2 | interactive | pressed |
| Relay (SPDT) | `relay` | Switching | electronic, control | A1 A2 COM NO NC | full | coilVoltage (V), coilResistance (Ω), pickupPercent (% of rated)*, dropoutPercent (% of rated)* |
| Transformer | `transformer` | Passive | electronic, installation | P1 P2 S1 S2 | full | ratio, ratingVA (VA) |
| Ground (0 V reference) | `ground` | Connectivity | electronic, control | 1 | full | — |
| Net label | `label` | Connectivity | electronic, control | 1 | full | net |
| Terminal | `terminal` | Connectivity | electronic, control | 1 | full | label |
| Connector (2-pin header) | `connector2` | Connectivity | electronic, control | 1 2 | full | pitch (mm) |
| Generic IC (DIP-8) | `ic8` | Integrated circuits | electronic | 1 2 3 4 5 6 7 8 | none | part |
| Microcontroller (DIP-28) | `mcu` | Integrated circuits | electronic, control | 1 2 3 4 5 6 7 8 9 10 11 12 13 14 28 27 26 25 24 23 22 21 20 19 18 17 16 15 | none | part |
| Voltage probe | `probe` | Measurement | electronic, control | 1 | full | name |
| Current probe (ammeter) | `ammeter` | Measurement | electronic, control | + - | full | — |
| Distribution board | `db` | Distribution | installation | T | none | ways, incomerA (A), location |
| Luminaire (ceiling) | `light` | Lighting | installation | T | none | power (W), powerFactor*, lumens (lm) |
| Light switch (1-way) | `switch_1way` | Lighting | installation | T | none | gangs |
| Socket outlet | `socket` | Power outlets | installation | T | none | power (W)*, powerFactor*, ratingA (A) |
| Air conditioner | `ac_unit` | Loads | installation | T | none | power (W), powerFactor* |
| Water heater | `water_heater` | Loads | installation | T | none | power (W), powerFactor |
| Motor | `motor` | Loads | installation, control | 1 2 | full | power (W), powerFactor*, resistance (Ω) |
| Fixed appliance | `appliance` | Loads | installation | T | none | description, power (W), powerFactor |
| Junction box | `junction_box` | Containment | installation | T | none | — |
| Cable tray (segment) | `cable_tray` | Containment | installation | T | none | length (mm), width (mm) |
| Earth electrode | `earth_electrode` | Supply | installation | T | none | resistance (Ω) |
| Grid connection | `grid_supply` | Supply | installation | T | none | earthing, ratingA (A) |
| Solar PV input | `solar_input` | Supply | installation | T | none | powerKw (kW) |
| Generator input | `generator_input` | Supply | installation | T | none | kva (kVA) |
| Push button NO (start) | `pb_no` | Control devices | control | 13 14 | interactive | pressed |
| Push button NC (stop) | `pb_nc` | Control devices | control | 11 12 | interactive | pressed |
| Emergency stop | `estop` | Control devices | control | 11 12 | interactive | pressed |
| Limit switch NO | `limit_switch` | Control devices | control | 13 14 | interactive | pressed |
| Overload relay contact NC | `overload_nc` | Control devices | control | 95 96 | interactive | pressed |
| Contactor / relay coil | `coil` | Control devices | control | A1 A2 | full | tag, coilVoltage (V), coilResistance (Ω), pickupPercent (% of rated)*, dropoutPercent (% of rated)* |
| Auxiliary contact NO | `contact_no` | Control devices | control | 13 14 | full | tag |
| Auxiliary contact NC | `contact_nc` | Control devices | control | 21 22 | full | tag |
| Indicator lamp | `lamp` | Control devices | control, electronic | X1 X2 | full | resistance (Ω), color |
| Circuit breaker (control) | `mcb` | Control devices | control | 1 2 | interactive | ratingA (A), curve, closed |
| PLC digital input | `plc_input` | PLC | control | 1 | full | address, threshold (V) |
| PLC digital output | `plc_output` | PLC | control | 1 | interactive | address, state, voltage (V) |

## Adding a component

1. Add a `ComponentDef` to `library.ts` (pins on the 2.5 mm grid for schematics).
2. Map it to elements in `simulation/circuit.ts` (or leave `simulation: 'none'` — it is then reported as *not evaluated*).
3. Add a 3D builder case in `viewport-3d/models.ts` whose lead tips land on the pin coordinates (verified by `tests/integration/input-system.test.ts`).
4. Regenerate this file.
