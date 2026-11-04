# NULL-TECH CIRCUIT STUDIO

Electrical engineering design, simulation and visualisation: electronic circuits, building
electrical installations and control circuits, in 2D and 3D, driven by mouse/keyboard **or**
webcam hand tracking.

> Engineering assistance software. No result in this application means "safe" or "compliant".
> Every design must be verified by a qualified engineer against the applicable standards.

## What works today

| Area | Status |
|---|---|
| Authoritative project model (one model → 2D, 3D, drawings, exports, simulation) | ✅ tested |
| Component library: 59 parts (passives, sources, semiconductors, op-amp, logic, relays, installation devices, control devices, PLC I/O) | ✅ |
| Schematic editor: place / move / rotate / mirror / duplicate / copy / paste / delete, wires with junctions, net labels, snapping | ✅ |
| Simulator (built-in MNA): DC operating point, transient (trapezoidal), AC sweep; diodes, LEDs, Zeners, BJTs, MOSFETs, op-amps, ideal transformer, relays/contactors with pick-up/drop-out, **logic gates** (74HC / 74LS / CD4000 thresholds) | ✅ cross-validated against **ngspice** |
| Installation design: rooms, devices, circuits from boards, cables routed **through cable trays** (or orthogonal L-routes), route-based lengths, Ib, voltage drop (IEC 60364-5-52 Annex G method), breaker & conductor-size suggestions, **earth-fault loop impedance Zs and disconnection checks (TN / TT, IEC 60364-4-41)**, breaking capacity, board/phase summaries, BOM, cost (user prices only) | ✅ tested against hand calculations |
| Control systems: start/stop seal-in, E-stop, overload, PLC I/O with a **PLC program in IEC 61131-3 Structured Text** (Boolean subset) executed in the simulation, interactive buttons | ✅ |
| 3D viewport (Three.js): parametric models with lead tips on the 2D pin coordinates, wires/cables, rooms, LED glow from simulation, move gizmo that edits the model, ortho/persp, presets, section, explode, hide/isolate, measure | ✅ |
| Drawings: A0–A4/custom sheets, ISO frame with zones, title block, scales, schedules, BOM, single-line diagram; vector PDF, SVG, PNG/JPEG, browser print | ✅ |
| Exchange: native `.ntcs.json` (versioned, validated, migrated), DXF R12 export + import, SPICE export + import (subset), GLB/glTF/OBJ/STL | ✅ |
| Shared input system: mouse, keyboard, hand tracking → same tools, preview → validate → confirm/reject, undo/redo | ✅ e2e-tested |
| Hand tracking service (Python): OpenCV latest-frame capture, MediaPipe landmarks, gesture state machine, One Euro smoothing, WebSocket | ✅ logic tested; camera path needs real hardware (see limitations) |
| Local engineering assistant (offline, rule-based, proposals go through preview/validation) | ✅ |
| Desktop app (Tauri v2, native save/open dialogs) | ✅ builds & launches on Linux; installers not yet produced |
| Examples & tutorials (13), lab/engineering report | ✅ |

Not implemented: IFC, PLC timers/counters and vendor protocols, short-circuit between live conductors,
selectivity and cable thermal withstand, built-in ampacity tables (you enter them with their source). See
[docs/known-limitations.md](docs/known-limitations.md).

## Quick start

```bash
# 1. the application
cd frontend
npm install
npm run dev            # http://localhost:5173

# desktop app (needs Rust + Tauri prerequisites): npm run desktop:dev

# 2. optional: hand tracking + ngspice verification service
cd ../backend
pip install -e '.[camera]'           # websockets, opencv-python, mediapipe
python -m nulltech_backend            # webcam 0, ws://127.0.0.1:8765
python -m nulltech_backend --replay demo   # no camera: scripted synthetic hand
```

In the app: **Help ▸ Examples & tutorials** opens real, simulatable projects; the hand icon in the
toolbar connects the tracking service.

## Repository layout

```
frontend/   React + TypeScript + Vite application (all engineering logic is UI-independent)
  src/project-model  authoritative model, operations, connectivity, serialization
  src/simulation     MNA solver, circuit builder, SPICE export, Web Worker
  src/calculations   installation engine, validation, BOM, units
  src/drawing, printing, export   primitives → canvas / SVG / PDF / DXF
  src/input-system, engineering-tools, history   shared input → tools → undoable commands
  src/viewport-2d, viewport-3d   views derived from the model
backend/    Python local service (hand tracking, ngspice runner)
shared/     JSON schemas, input-command protocol, engineering reference data with sources
tests/e2e   browser workflows against the real app and the real service
docs/       architecture, engineering references, installation, testing, gestures, roadmap
```

## Tests

```bash
npm test            # from the repo root: frontend unit/integration/engineering, backend, e2e
```

Details and what each suite proves: [docs/testing/testing.md](docs/testing/testing.md).

## Documentation

- [Architecture & decisions](docs/architecture/overview.md)
- [Project file format](docs/engineering/project-format.md)
- [Simulation engine](docs/engineering/simulation.md)
- [Installation calculations & references](docs/engineering/calculations.md)
- [Component library](docs/engineering/component-library.md)
- [Gestures & hand tracking](docs/gestures.md)
- [Installation & release build](docs/installation/install.md)
- [Known limitations](docs/known-limitations.md) · [Roadmap](docs/roadmap.md)
