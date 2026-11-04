import math
import random

from nulltech_backend.smoothing import OneEuroFilter


def test_one_euro_reduces_jitter_on_a_still_target():
    random.seed(1)
    f = OneEuroFilter(min_cutoff=1.0, beta=0.0)
    raw, out = [], []
    for i in range(300):
        x = 0.5 + random.gauss(0, 0.01)
        raw.append(x)
        out.append(f(x, i / 60))
    sd = lambda v: math.sqrt(sum((a - 0.5) ** 2 for a in v[100:]) / len(v[100:]))
    assert sd(out) < sd(raw) * 0.4


def test_one_euro_follows_fast_motion_with_small_lag():
    f = OneEuroFilter(min_cutoff=1.0, beta=4.0)
    y = 0.0
    for i in range(60):
        y = f(i / 60, i / 60)  # ramp 1 unit/s
    assert abs(y - 59 / 60) < 0.05


def test_first_sample_passes_through():
    assert OneEuroFilter()(0.3, 0.0) == 0.3
