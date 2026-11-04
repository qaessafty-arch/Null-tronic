# Hand tracking & gestures

The Python service (`backend/`) turns webcam frames into **input commands only**
(`shared/commands/input-commands.schema.json`). The application feeds them into the same input
system as the mouse; the active tool decides their meaning. The service cannot edit the project.

## Pipeline

| Stage | Module | Notes |
|---|---|---|
| Capture | `camera.py` | background thread, buffer size 1, newest frame overwrites older ones (no backlog) |
| Landmarks | `tracker.py` | MediaPipe Hands (legacy API or Tasks `hand_landmarker.task` via `--model`), up to 2 hands |
| Features | `gestures.py` | scale-invariant (normalised by wrist→middle-MCP), joint angles, thumb–index distance, palm orientation |
| State machine | `gestures.py` | N stable frames to change gesture (default 4; pinch 2), pinch hysteresis (0.32 / 0.45 × palm) |
| Smoothing | `smoothing.py` | One Euro filter (Casiez et al. 2012) — low jitter at rest, low lag in motion |
| Commands | `controller.py` | cursor mapping (mirror, active-region margin), cool-down 0.6 s for discrete commands, release on hand loss |
| Transport | `server.py` | `ws://127.0.0.1:8765`, localhost origins only, status messages with fps / gesture / landmarks |

## Default gestures

| Gesture | Command | Typical effect |
|---|---|---|
| Index finger pointing | `pointer move` | move the cursor |
| Thumb–index pinch | `pointer down` | select, start drag, start/finish a wire, place (placing commits on release) |
| Release pinch | `pointer up` | finish the drag / stroke |
| Open palm (held) | `cancel` + `pause` | cancel the current preview, ignore the hand until it points again (`resume`) |
| Fist (held) | `confirm` | accept the previewed operation |
| V-sign (held) | `reject` | reject the preview / cancel |
| Two hands pinching, moving | `pan` | pan the view |
| Two hands pinching, spreading | `zoom` | zoom about the cursor |

Every hand-initiated operation is staged as a preview and needs **confirm**. In the 3D view a
pinch-drag orbits and a pinch-tap selects.

## Settings (Hand tracking dialog)

Cursor smoothing (One Euro min cut-off), pinch thresholds, stable-frame count, active camera
region; **Calibrate pinch** derives thresholds from a relaxed open hand. Settings are sent to the
service at runtime.

## Robustness

Camera missing / permission denied → service exits with a clear message (use `--replay demo`);
camera stops delivering frames → status `disconnected`; hand leaves the view during a drag → a
`pointer up` is emitted after 0.35 s; multiple hands → the first tracked hand stays primary;
low frame rate → the state machine counts frames, the One Euro filter uses real timestamps; the
client reconnects with exponential back-off. Mouse and keyboard stay active at all times.

## Testing without a camera

`python -m nulltech_backend --replay demo` streams a scripted synthetic hand.
`--record session.jsonl` records real landmarks; `--replay session.jsonl` replays them.
The e2e test generates landmark scripts with `tests/e2e/hand_script.py`.

**Not verified in CI:** the live webcam + MediaPipe path (no camera in CI). Gesture logic,
smoothing, protocol and the full app integration are tested with synthetic landmarks.
