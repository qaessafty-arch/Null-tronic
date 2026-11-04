"""Command controller: turns tracked hands + gesture states into protocol messages.

It knows nothing about tools or the project; it only emits the shared input commands
(pointer move/down/up, confirm, reject, pause, resume, zoom, pan). The application decides
what each command means for the active tool.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .gestures import GestureConfig, GestureStateMachine
from .landmarks import INDEX_TIP, THUMB_TIP, Hand, dist
from .smoothing import PointFilter

Message = dict[str, Any]


@dataclass
class ControllerConfig:
    margin: float = 0.12        # unused border of the camera image (reach the viewport edges comfortably)
    mirror: bool = True         # selfie view: moving right moves the cursor right
    min_cutoff: float = 1.0     # One Euro parameters
    beta: float = 4.0           # speed coefficient for normalised coordinates (units/s)
    lost_timeout_s: float = 0.35  # release an active drag when the hand disappears this long
    gesture: GestureConfig = field(default_factory=GestureConfig)


class HandChannel:
    def __init__(self, cfg: ControllerConfig) -> None:
        self.sm = GestureStateMachine(cfg.gesture)
        self.filter = PointFilter(cfg.min_cutoff, cfg.beta)
        self.last_seen = 0.0
        self.cursor: tuple[float, float] | None = None


class CommandController:
    def __init__(self, cfg: ControllerConfig | None = None) -> None:
        self.cfg = cfg or ControllerConfig()
        self.channels: dict[str, HandChannel] = {}
        self.primary: str | None = None
        self.paused = False
        self.last_command_t = -1e9
        self.two_hand_prev: tuple[float, float, float] | None = None
        self.gesture = "none"

    # ---------------------------------------------------------------- config
    def configure(self, **kw: Any) -> None:
        g = self.cfg.gesture
        if "pinch_on" in kw:
            g.pinch_on = float(kw["pinch_on"])
        if "pinch_off" in kw:
            g.pinch_off = max(float(kw["pinch_off"]), g.pinch_on + 0.02)
        if "stable_frames" in kw:
            g.stable_frames = max(1, int(kw["stable_frames"]))
        if "margin" in kw:
            self.cfg.margin = min(max(float(kw["margin"]), 0.0), 0.4)
        if "min_cutoff" in kw:
            self.cfg.min_cutoff = float(kw["min_cutoff"])
            for ch in self.channels.values():
                ch.filter.configure(min_cutoff=self.cfg.min_cutoff)
        if "beta" in kw:
            self.cfg.beta = float(kw["beta"])
            for ch in self.channels.values():
                ch.filter.configure(beta=self.cfg.beta)

    def calibrate(self, hand: Hand) -> dict[str, float]:
        """Set pinch thresholds from a relaxed open hand: thumb-index gap defines the scale."""
        from .gestures import features

        f = features(hand.landmarks, self.cfg.gesture)
        relaxed = f.pinch_ratio
        self.cfg.gesture.pinch_on = max(0.15, min(0.45, relaxed * 0.35))
        self.cfg.gesture.pinch_off = self.cfg.gesture.pinch_on + 0.13
        return {"pinch_on": self.cfg.gesture.pinch_on, "pinch_off": self.cfg.gesture.pinch_off}

    # ---------------------------------------------------------------- helpers
    def _map(self, x: float, y: float) -> tuple[float, float]:
        m = self.cfg.margin
        if self.cfg.mirror:
            x = 1.0 - x
        nx = (x - m) / max(1 - 2 * m, 1e-6)
        ny = (y - m) / max(1 - 2 * m, 1e-6)
        return min(max(nx, 0.0), 1.0), min(max(ny, 0.0), 1.0)

    def _command(self, name: str, t: float, out: list[Message], force: bool = False) -> None:
        if not force and t - self.last_command_t < self.cfg.gesture.cooldown_s:
            return
        self.last_command_t = t
        out.append({"type": "command", "name": name, "t": t})

    # ---------------------------------------------------------------- main step
    def process(self, hands: list[Hand], t: float | None = None) -> list[Message]:
        """Consume one frame of detections, return protocol messages."""
        t = time.monotonic() if t is None else t
        out: list[Message] = []
        seen = set()
        for h in hands[:2]:
            ch = self.channels.setdefault(h.label, HandChannel(self.cfg))
            ch.last_seen = t
            seen.add(h.label)
        # lost hands: release drags, reset filters
        for label, ch in list(self.channels.items()):
            if label not in seen and t - ch.last_seen > self.cfg.lost_timeout_s:
                if ch.sm.state == "pinch" and label == self.primary and ch.cursor and not self.paused:
                    out.append({"type": "pointer", "phase": "up", "x": ch.cursor[0], "y": ch.cursor[1], "t": t})
                ch.sm.reset()
                ch.filter.reset()
                del self.channels[label]
                if self.primary == label:
                    self.primary = None
        if not hands:
            self.two_hand_prev = None
            self.gesture = "none"
            return out
        # primary hand: keep the first one we locked on to
        if self.primary not in seen:
            self.primary = hands[0].label
        by_label = {h.label: h for h in hands}

        # two-hand navigation: both hands pinching → pan (midpoint) and zoom (spread)
        if len(hands) >= 2:
            states = []
            evs: dict[str, tuple[str, list]] = {}
            for h in hands[:2]:
                sm = self.channels[h.label].sm
                prev = sm.state
                evs[h.label] = (prev, sm.update(h.landmarks))
                states.append(sm.state)
            if all(s == "pinch" for s in states):
                pts = [self._map(*self._pinch_point(h)) for h in hands[:2]]
                mx, my = (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2
                spread = max(dist(pts[0], pts[1]), 1e-3)
                if self.two_hand_prev and not self.paused:
                    px, py, ps = self.two_hand_prev
                    if abs(mx - px) + abs(my - py) > 0.002:
                        out.append({"type": "pan", "dx": mx - px, "dy": my - py, "t": t})
                    ratio = spread / ps
                    if abs(ratio - 1) > 0.01:
                        out.append({"type": "zoom", "factor": ratio, "t": t})
                self.two_hand_prev = (mx, my, spread)
                self.gesture = "two-hand"
                return out
            self.two_hand_prev = None
            primary = by_label[self.primary]  # type: ignore[index]
            prev, events = evs.get(primary.label, (self.channels[primary.label].sm.state, []))
            return out + self._single(primary, prev, events, t)

        primary = by_label[self.primary]  # type: ignore[index]
        ch = self.channels[primary.label]
        prev = ch.sm.state
        events = ch.sm.update(primary.landmarks)
        return out + self._single(primary, prev, events, t)

    @staticmethod
    def _pinch_point(h: Hand) -> tuple[float, float]:
        a = h.landmarks[THUMB_TIP]
        b = h.landmarks[INDEX_TIP]
        return (a[0] + b[0]) / 2, (a[1] + b[1]) / 2

    def _single(self, h: Hand, prev_state: str, events: list, t: float) -> list[Message]:
        out: list[Message] = []
        ch = self.channels[h.label]
        state = ch.sm.state
        self.gesture = state
        raw = self._pinch_point(h) if state == "pinch" else h.landmarks[INDEX_TIP][:2]
        cx, cy = ch.filter(*self._map(raw[0], raw[1]), t)
        ch.cursor = (cx, cy)
        entered = {e.gesture for e in events if e.kind == "enter"}
        exited = {e.gesture for e in events if e.kind == "exit"}

        if "open_palm" in entered:
            if not self.paused:
                self.paused = True
                if prev_state == "pinch":
                    out.append({"type": "pointer", "phase": "up", "x": cx, "y": cy, "t": t})
                self._command("cancel", t, out, force=True)
                self._command("pause", t, out, force=True)
            return out
        if self.paused:
            if state in ("point",):
                self.paused = False
                self._command("resume", t, out, force=True)
            else:
                return out
        if "fist" in entered:
            self._command("confirm", t, out)
            return out
        if "v_sign" in entered:
            self._command("reject", t, out)
            return out
        if state in ("point", "pinch") or "pinch" in exited:
            if "pinch" in exited:
                out.append({"type": "pointer", "phase": "up", "x": cx, "y": cy, "t": t})
            out.append({"type": "pointer", "phase": "move", "x": cx, "y": cy, "t": t})
            if "pinch" in entered:
                out.append({"type": "pointer", "phase": "down", "x": cx, "y": cy, "t": t})
        return out
