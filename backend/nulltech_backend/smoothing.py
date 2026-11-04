"""One Euro filter (Casiez, Roussel & Vogel, CHI 2012) for low-latency cursor smoothing."""
from __future__ import annotations

import math


class LowPass:
    def __init__(self) -> None:
        self.y: float | None = None

    def __call__(self, x: float, alpha: float) -> float:
        self.y = x if self.y is None else alpha * x + (1 - alpha) * self.y
        return self.y


def _alpha(cutoff: float, dt: float) -> float:
    tau = 1.0 / (2 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class OneEuroFilter:
    """Adaptive low-pass: heavy smoothing when still (no jitter), light when moving (low lag)."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.02, d_cutoff: float = 1.0) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x = LowPass()
        self.dx = LowPass()
        self.t_prev: float | None = None
        self.x_prev: float | None = None

    def reset(self) -> None:
        self.x = LowPass()
        self.dx = LowPass()
        self.t_prev = None
        self.x_prev = None

    def __call__(self, x: float, t: float) -> float:
        if self.t_prev is None or self.x_prev is None or t <= self.t_prev:
            self.t_prev = t
            self.x_prev = x
            self.dx(0.0, 1.0)
            return self.x(x, 1.0)
        dt = t - self.t_prev
        dx = (x - self.x_prev) / dt
        edx = self.dx(dx, _alpha(self.d_cutoff, dt))
        cutoff = self.min_cutoff + self.beta * abs(edx)
        y = self.x(x, _alpha(cutoff, dt))
        self.t_prev = t
        self.x_prev = x
        return y


class PointFilter:
    """One Euro filter on both axes."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.02) -> None:
        self.fx = OneEuroFilter(min_cutoff, beta)
        self.fy = OneEuroFilter(min_cutoff, beta)

    def configure(self, min_cutoff: float | None = None, beta: float | None = None) -> None:
        for f in (self.fx, self.fy):
            if min_cutoff is not None:
                f.min_cutoff = min_cutoff
            if beta is not None:
                f.beta = beta

    def reset(self) -> None:
        self.fx.reset()
        self.fy.reset()

    def __call__(self, x: float, y: float, t: float) -> tuple[float, float]:
        return self.fx(x, t), self.fy(y, t)
