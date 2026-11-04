"""Hand landmark conventions (MediaPipe Hands 21-point topology)."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

FINGERS = {
    "index": (INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP),
    "middle": (MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP),
    "ring": (RING_MCP, RING_PIP, RING_DIP, RING_TIP),
    "pinky": (PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP),
}

Point = Sequence[float]  # (x, y[, z]) normalised image coordinates, y down


@dataclass
class Hand:
    """One detected hand: 21 landmarks plus handedness label ("Left"/"Right")."""

    landmarks: list[tuple[float, float, float]]
    label: str = "Right"
    score: float = 1.0

    def __post_init__(self) -> None:
        if len(self.landmarks) != 21:
            raise ValueError(f"expected 21 landmarks, got {len(self.landmarks)}")


def dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def palm_size(lm: Sequence[Point]) -> float:
    """Wrist to middle-finger MCP distance: a scale reference independent of camera distance."""
    return max(dist(lm[WRIST], lm[MIDDLE_MCP]), 1e-6)


def joint_angle(a: Point, b: Point, c: Point) -> float:
    """Angle ABC in degrees (180 = straight)."""
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return 180.0
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def palm_orientation(lm: Sequence[Point], label: str) -> str:
    """'palm' if the palm faces the camera, else 'back' (uses the 2D cross product of the palm)."""
    v1 = (lm[INDEX_MCP][0] - lm[WRIST][0], lm[INDEX_MCP][1] - lm[WRIST][1])
    v2 = (lm[PINKY_MCP][0] - lm[WRIST][0], lm[PINKY_MCP][1] - lm[WRIST][1])
    cross = v1[0] * v2[1] - v1[1] * v2[0]
    facing = cross < 0 if label == "Right" else cross > 0
    return "palm" if facing else "back"
