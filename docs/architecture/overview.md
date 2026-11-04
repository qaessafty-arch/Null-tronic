# Architecture

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Web application (React + TypeScript + Vite) + optional local Python service.** No Electron/Tauri shell yet. | Runs offline from a local build, prints through the browser's print system, saves through the File System Access API (download fallback), and WebGL covers 3D. Webcam processing lives in Python because MediaPipe/OpenCV are mature there. A desktop shell is a packaging step that does not change the architecture (see below). |
| 2 | **One immutable project model** (`frontend/src/project-model`). | Every view is a pure function of it: 2D canvas and every drawing exporter consume the same primitive list (`drawing/scene.ts`); the 3D scene is synchronised from it (`viewport-3d/scene3d.ts`); nets are *derived* (`connectivity.ts`), never stored. 2D and 3D cannot diverge. |
| 3 | **All edits are pure operations wrapped in history commands** (`project-model/operations.ts`, `history/history.ts`). | Undo/redo is snapshot-based with structural sharing; the same code path serves mouse, keyboard, hand, assistant and importers. |
| 4 | **Shared input system** (`input-system/input.ts`). | DOM events and hand-tracking messages become the same `PointerInput` / command stream. Tools (`engineering-tools/tools.ts`) do not know the input device. |
| 5 | **Preview → validate → confirm.** | Tools produce a `Preview` with status valid / warning / invalid. Invalid never commits. Warnings, hand input and assistant proposals are staged and need an explicit confirm (Enter, toolbar button, fist) or reject (Esc, V-sign). |
| 6 | **Built-in MNA simulator in TypeScript, ngspice as independent reference.** | Works with no install; runs in a Web Worker. Every DC example and two transients are compared with ngspice in CI. The backend can run ngspice on demand ("Verify with ngspice"). |
| 7 | **Engineering reference data in `shared/engineering-rules/*.json` with sources.** | No standard table is hard-coded without a citation; current-carrying capacity tables are intentionally not shipped (user-entered with source). |
| 8 | **Millimetres everywhere internally.** | Display units are presentation only. |

### Desktop packaging evaluation

Tauri is the preferred shell for a later release: small footprint, native file dialogs, can spawn
the Python service as a sidecar, and serves the same Vite build. Electron would also work but adds
~150 MB and a second JS runtime with no functional gain here. Until then the app runs as a local
web app (`npm run build && npm run preview`, or any static server).

## Data flow

```
             ┌────────────── Mouse / keyboard (DOM) ───────────────┐
             │                                                     ▼
 Webcam → camera.py (latest frame) → tracker.py (MediaPipe) → gestures.py (state machine)
        → controller.py (One Euro, commands) → server.py (ws://127.0.0.1:8765)
        → hand-tracking/client.ts ──────────────────────────► input-system (PointerInput / commands)
                                                                     │
                                                         active Tool (preview + validation)
                                                                     │ confirm
                                                         history.execute(operation)
                                                                     │
                                                              Project (immutable)
                     ┌───────────────┬──────────────┬───────────────┼────────────────┬──────────────┐
                 2D canvas       3D scene sync   simulation     calculations      drawings/exports
```

The service never receives or modifies the project; its only outputs are messages in
`shared/commands/input-commands.schema.json` (plus answers to explicit `simulate` requests).

## Module map

| Module | Responsibility |
|---|---|
| `project-model/` | types, factory, operations, connectivity (union-find nets), geometry, serialization + migrations + validation, builder, installation helpers |
| `component-library/` | component definitions: pins, properties (with assumption flags), IEC-style symbols, 3D model keys, simulation support level |
| `simulation/` | `circuit.ts` (model → elements), `solver.ts` (MNA, NR, transient, AC), `simulate.ts` (analyses, findings), `spice.ts`, worker |
| `calculations/` | installation engine, validation, BOM, SI units |
| `drawing/`, `printing/`, `export/` | primitives, scene, single-line diagram, sheet composition, SVG/PDF/DXF writers, DXF/SPICE importers |
| `viewport-2d/`, `viewport-3d/` | views; 3D models are parametric with pins at library coordinates |
| `input-system/`, `engineering-tools/`, `history/`, `state/` | shared input, tools, commands, store |
| `hand-tracking/` | WebSocket client |
| `assistant/` | offline rule-based assistant behind an `AssistantProvider` interface |

## Performance

- 3D sync is incremental: each entity has a content hash; only changed entities are rebuilt.
- Simulation runs in a Web Worker; stale results are ignored and flagged.
- 2D draws are coalesced with `requestAnimationFrame`; scene primitives are cached per project revision.
- Camera capture overwrites a single frame slot; the processor always takes the newest frame.
