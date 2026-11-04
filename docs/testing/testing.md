# Testing

Run everything from the repository root: `npm test` (frontend, backend, e2e).

| Suite | Command | What it proves |
|---|---|---|
| Engineering (simulation) | `cd frontend && npx vitest run tests/engineering` | solver vs closed-form results; every DC example and two transients vs **ngspice** |
| Engineering (installation) | same | Ib, route lengths, voltage drop, breaker/size selection, ampacity handling vs hand calculations |
| Integration (exchange) | `npx vitest run tests/integration` | native round-trip & migration, malformed-file rejection, PDF structure (xref offsets, page sizes), SVG, DXF export→import geometry, SPICE import/export round-trip |
| Integration (input) | same | mouse and hand produce identical models; preview/confirm/reject; invalid ops refused; undo/redo; wires follow moved parts; circuit tool; 3D lead tips coincide with 2D pins |
| Backend | `cd backend && python -m pytest` | gesture classification (all poses × scale × tilt), state machine debouncing, hysteresis, One Euro behaviour, controller commands (pause/resume, confirm once, hand-loss release, two-hand pan/zoom), WebSocket protocol, origin restriction, ngspice runner and its input sanitising |
| End-to-end | `node tests/e2e/workflows.mjs` | the five workflows below in Chromium against the real app; workflow 3 drives the app through the real Python service |

E2E workflows:
1. New electronic circuit → V + R + ground → wires → simulate (I = 9 mA checked) → save → reopen → PDF export.
2. Installation sample → place light + socket → create circuit (preview + confirm) → schedule → 3D → 3-sheet PDF.
3. Hand tracking: place a resistor (pinch / release / fist), wire it (pinch-drag / fist), undo, redo.
4. The same operations with mouse/keyboard; resulting connectivity must equal workflow 3.
5. Import DXF (metres) as rooms → place a device → export DXF; geometry, text and layers preserved.

Results are reported only for suites that actually ran. The ngspice suite is skipped when
ngspice is absent; the live-camera path is not exercised in automated tests (no camera).
