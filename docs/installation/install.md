# Installation, development and release build

## Requirements

- Node.js ≥ 20 and npm
- Python ≥ 3.10 (for hand tracking / ngspice verification)
- Optional: ngspice (verification, cross-validation tests), a webcam

## Application

```bash
cd frontend
npm install
npm run dev        # development server, http://localhost:5173
npm run build      # type-check + production build into frontend/dist
npm run preview    # serve the production build locally
```

The production build is static files: open it offline from any local static server.

## Local service

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e '.[camera,dev]'
python -m nulltech_backend                 # camera 0
python -m nulltech_backend --camera 1 -v   # another camera, verbose
python -m nulltech_backend --replay demo   # no camera
```

If your MediaPipe build has no `mediapipe.solutions` module, download `hand_landmarker.task`
from the MediaPipe model page and pass `--model path/to/hand_landmarker.task`.

## ngspice

Debian/Ubuntu: `apt install ngspice`; macOS: `brew install ngspice`; Windows: install from
ngspice.sourceforge.io and add it to `PATH`. Used by `Simulation ▸ Verify with ngspice` and by
the cross-validation tests (skipped, not passed, when absent).

## Release build checklist

1. `npm test` at the repository root (all suites green).
2. `cd frontend && npm run build`.
3. Package `frontend/dist` with the `backend/` wheel (`pip wheel backend`).
4. Desktop app (Tauri v2): install Rust and the Tauri prerequisites for your OS (Linux:
   `libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev build-essential`), then
   `cd frontend && npm run desktop:build` (installers in `src-tauri/target/release/bundle/`) or
   `npm run desktop:dev` for development. The hand-tracking service is started separately.
