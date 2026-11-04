# Installation calculations

Implementation: `frontend/src/calculations/installation.ts`.
Reference data: `shared/engineering-rules/installation-reference.json` (every value carries its source).

## What is calculated

| Quantity | Formula / rule | Source |
|---|---|---|
| Device apparent power | S = P / cos φ | entered P and cos φ (typical defaults are flagged as assumptions) |
| Circuit demand | S_d = Σ S × demand factor (arithmetic sum, conservative) | demand factor is a user assumption, default 1.0 |
| Design current Ib | single-phase Ib = S_d / U0; three-phase Ib = S_d / (3·U0) | — |
| Cable length | plan route length + vertical drops (route height ↔ mounting heights) | route defined in the model, never straight-line |
| Voltage drop | u = b·(ρ1·L/S·cos φ + λ·L·sin φ)·I per segment with the downstream current, ΔU % = 100·Σu/U0; ρ1 = 1.25·ρ20, λ = 0.08 mΩ/m, b = 2 (1-ph) / 1 (3-ph) | IEC 60364-5-52 Annex G (informative) |
| ΔU limits (defaults) | 3 % lighting, 5 % other | IEC 60364-5-52 Table G.52.1, installation type A; configurable |
| Breaker suggestion | smallest rated current ≥ Ib | IEC 60898-1 preferred ratings |
| Conductor suggestion | smallest IEC 60228 size ≥ 1.5 mm² Cu meeting the ΔU limit (and the user ampacity table if present) | IEC 60228; IEC 60364-5-52 Table 52.2 minimum |
| In ≤ Iz | only with a matching row in the project ampacity table | user-entered with its source; otherwise **not evaluated** |
| PE present | error if the cable has no protective conductor | IEC 60364-4-41 411.3.1.1 |
| RCD on socket circuits | *review* item if no ≤ 30 mA device is recorded | IEC 60364-4-41 411.3.3 (edition/national rules vary) |
| Board | per-phase demand, incomer overload, ways, imbalance, greedy phase-allocation suggestion | 20 % imbalance threshold is an assumption |

Every circuit result lists its formulae, inputs and assumptions (Properties ▸ Calculation details,
and the Report).

## Status vocabulary

`valid` (within supported checks) · `warning` · `error` · `not-evaluated` · `review`.
There is no "safe" status. Fault-loop impedance and disconnection time are always reported as
*not evaluated*.

## Localisation of rules

Iraqi / Kurdistan Region requirements are not encoded. All limits and tables are project
settings; the reference file can be replaced per jurisdiction once rules are validated by a
qualified engineer.

## Tests

`frontend/tests/engineering/installation.test.ts` checks every formula against independent hand
calculations (e.g. 2 kW at 20 m on 2.5 mm² Cu → 2.998 V), sizing behaviour, ampacity handling,
error states and the sample project.
