"""Gesture recognition: per-frame classification + a debounced state machine.

Per-frame features are scale-invariant (normalised by palm size). The state machine requires a
gesture to be stable for N consecutive frames before it changes state, uses hysteresis for the
pinch, and enforces a cool-down so a held fist / V-sign fires its command exactly once.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .landmarks import (
    FINGERS,
    INDEX_MCP,
    INDEX_TIP,
    PINKY_MCP,
    THUMB_IP,
    THUMB_TIP,
    WRIST,
    Point,
    dist,
    joint_angle,
    palm_size,
)

GESTURES = ("none", "point", "pinch", "open_palm", "fist", "v_sign")


@dataclass
class GestureConfig:
    pinch_on: float = 0.32   # thumb-index distance / palm size to start a pinch
    pinch_off: float = 0.45  # ... to release (hysteresis)
    stable_frames: int = 4   # frames a non-pinch gesture must persist
    pinch_frames: int = 2    # pinch reacts faster (it drives dragging)
    cooldown_s: float = 0.6  # minimum time between discrete commands
    straight_deg: float = 150.0  # PIP angle above which a finger counts as extended


@dataclass
class Features:
    extended: dict[str, bool]
    thumb_extended: bool
    pinch_ratio: float
    palm: float
    #: wrist→index-tip distance / palm size; small in a fist even when thumb and index touch
    index_reach: float


def finger_extended(lm: Sequence[Point], finger: str, cfg: GestureConfig) -> bool:
    mcp, pip, dip, tip = FINGERS[finger]
    straight = joint_angle(lm[mcp], lm[pip], lm[dip]) > cfg.straight_deg and joint_angle(lm[pip], lm[dip], lm[tip]) > cfg.straight_deg - 20
    farther = dist(lm[WRIST], lm[tip]) > dist(lm[WRIST], lm[pip]) * 1.08
    return straight and farther


def features(lm: Sequence[Point], cfg: GestureConfig) -> Features:
    palm = palm_size(lm)
    ext = {f: finger_extended(lm, f, cfg) for f in FINGERS}
    thumb_ext = dist(lm[THUMB_TIP], lm[PINKY_MCP]) > dist(lm[THUMB_IP], lm[PINKY_MCP]) * 1.05 and dist(lm[THUMB_TIP], lm[INDEX_MCP]) > 0.55 * palm
    return Features(ext, thumb_ext, dist(lm[THUMB_TIP], lm[INDEX_TIP]) / palm, palm, dist(lm[WRIST], lm[INDEX_TIP]) / palm)


def classify(f: Features, pinching: bool, cfg: GestureConfig) -> str:
    """Instantaneous gesture. `pinching` selects the hysteresis threshold."""
    threshold = cfg.pinch_off if pinching else cfg.pinch_on
    e = f.extended
    n_ext = sum(e.values())
    if f.pinch_ratio < threshold and f.index_reach > 1.1 and not (e["middle"] and e["ring"] and e["pinky"] and not pinching):
        return "pinch"
    if n_ext == 4 and f.thumb_extended:
        return "open_palm"
    if n_ext == 0 and not f.thumb_extended:
        return "fist"
    if e["index"] and e["middle"] and not e["ring"] and not e["pinky"]:
        return "v_sign"
    if e["index"] and not e["middle"] and not e["ring"] and not e["pinky"]:
        return "point"
    if n_ext == 0:
        return "fist"
    return "none"


@dataclass
class GestureEvent:
    kind: str  # 'enter' | 'exit'
    gesture: str


@dataclass
class GestureStateMachine:
    cfg: GestureConfig = field(default_factory=GestureConfig)
    state: str = "none"
    _candidate: str = "none"
    _count: int = 0

    def reset(self) -> list[GestureEvent]:
        ev = [GestureEvent("exit", self.state)] if self.state != "none" else []
        self.state = "none"
        self._candidate = "none"
        self._count = 0
        return ev

    def update(self, lm: Sequence[Point]) -> list[GestureEvent]:
        g = classify(features(lm, self.cfg), self.state == "pinch", self.cfg)
        if g == self._candidate:
            self._count += 1
        else:
            self._candidate = g
            self._count = 1
        need = self.cfg.pinch_frames if (g == "pinch" or self.state == "pinch") else self.cfg.stable_frames
        if g != self.state and self._count >= need:
            events = [GestureEvent("exit", self.state), GestureEvent("enter", g)]
            self.state = g
            return [e for e in events if e.gesture != "none"]
        return []
