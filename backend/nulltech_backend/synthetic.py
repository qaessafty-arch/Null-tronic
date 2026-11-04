"""Synthetic hand landmarks for camera-free demos and deterministic tests.

Produces anatomically plausible 21-point hands (image coordinates, y down) in the five
default poses. Used by `--replay demo` and by the test-suite; it is not a substitute for
validating the tracker on real camera input.
"""
from __future__ import annotations

import math
from typing import Iterator

from .landmarks import Hand

POSES = ("point", "pinch", "open_palm", "fist", "v_sign")

# finger base offsets (x, y) in palm units relative to the wrist
_BASE = {"index": (-0.30, -0.95), "middle": (-0.05, -1.00), "ring": (0.20, -0.95), "pinky": (0.42, -0.85)}
_LEN = {"index": (0.45, 0.28, 0.25), "middle": (0.5, 0.3, 0.26), "ring": (0.46, 0.28, 0.24), "pinky": (0.36, 0.22, 0.2)}


def _finger(name: str, extended: bool) -> list[tuple[float, float]]:
    bx, by = _BASE[name]
    a, b, c = _LEN[name]
    if extended:
        return [(bx, by), (bx, by - a), (bx, by - a - b), (bx, by - a - b - c)]
    return [(bx, by), (bx, by - 0.35), (bx + 0.05, by - 0.15), (bx + 0.05, by + 0.05)]


def make_hand(pose: str, cx: float = 0.5, cy: float = 0.7, size: float = 0.12, label: str = "Right", rotation_deg: float = 0.0) -> Hand:
    if pose not in POSES:
        raise ValueError(pose)
    ext = {
        "point": {"index"},
        "pinch": set(),
        "open_palm": {"index", "middle", "ring", "pinky"},
        "fist": set(),
        "v_sign": {"index", "middle"},
    }[pose]
    pts: list[tuple[float, float]] = [(0.0, 0.0)]
    # thumb
    if pose == "open_palm":
        pts += [(-0.35, -0.25), (-0.6, -0.45), (-0.8, -0.6), (-0.95, -0.75)]
    elif pose == "pinch":
        pts += [(-0.35, -0.25), (-0.5, -0.55), (-0.55, -0.9), (-0.55, -1.25)]
    else:
        pts += [(-0.35, -0.25), (-0.45, -0.5), (-0.35, -0.7), (-0.15, -0.75)]
    for name in ("index", "middle", "ring", "pinky"):
        if pose == "pinch" and name == "index":
            pts += [(-0.30, -0.95), (-0.40, -1.30), (-0.50, -1.42), (-0.55, -1.32)]
        else:
            pts += _finger(name, name in ext)
    r = math.radians(rotation_deg)
    cos, sin = math.cos(r), math.sin(r)
    out = []
    for x, y in pts:
        xr, yr = x * cos - y * sin, x * sin + y * cos
        out.append((cx + xr * size, cy + yr * size, 0.0))
    return Hand(out, label)


def demo_sequence(fps: float = 30.0) -> Iterator[tuple[float, list[Hand]]]:
    """A looping scripted session: point around, pinch-drag, release, fist, V-sign, open palm."""
    t = 0.0
    dt = 1.0 / fps

    def hold(pose: str, x: float, y: float, seconds: float):
        nonlocal t
        for _ in range(int(seconds * fps)):
            yield t, [make_hand(pose, x, y)]
            t += dt

    def move(pose: str, a: tuple[float, float], b: tuple[float, float], seconds: float):
        nonlocal t
        n = int(seconds * fps)
        for i in range(n):
            k = i / max(n - 1, 1)
            yield t, [make_hand(pose, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)]
            t += dt

    while True:
        yield from move("point", (0.7, 0.75), (0.4, 0.6), 1.5)
        yield from hold("pinch", 0.4, 0.6, 0.4)
        yield from move("pinch", (0.4, 0.6), (0.6, 0.55), 1.0)
        yield from hold("point", 0.6, 0.55, 0.5)
        yield from hold("fist", 0.6, 0.55, 0.6)
        yield from hold("point", 0.5, 0.6, 0.6)
        yield from hold("v_sign", 0.5, 0.6, 0.6)
        yield from hold("open_palm", 0.5, 0.6, 0.8)
        for _ in range(int(0.5 * fps)):
            yield t, []
            t += dt
