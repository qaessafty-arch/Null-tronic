"""Generate a deterministic hand-landmark replay (.jsonl) that drives the cursor to given
normalised viewport positions. Used by the end-to-end test with the real backend service
(run it with --no-mirror --margin 0 so landmark coordinates equal cursor coordinates).

Usage: python hand_script.py out.jsonl '[["point",0.3,0.4,0.5], ["pinch",0.3,0.4,0.3], ...]'
Each step: [pose, x, y, seconds] holds a pose with its cursor point at (x, y);
["drag", x0, y0, x1, y1, seconds] moves a pinch; ["none", seconds] shows no hand.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
from nulltech_backend.synthetic import make_hand  # noqa: E402

SIZE = 0.08
FPS = 30
# cursor reference point relative to the wrist, in palm units (see synthetic.make_hand)
CURSOR = {"pinch": (-0.55, -1.285), "point": (-0.3, -1.93), "fist": (-0.3, -1.93), "v_sign": (-0.3, -1.93), "open_palm": (-0.3, -1.93)}


def hand_at(pose, x, y):
    ox, oy = CURSOR[pose]
    return make_hand(pose, x - ox * SIZE, y - oy * SIZE, SIZE)


def main(out, steps):
    t = 0.0
    with open(out, "w", encoding="utf-8") as f:
        def emit(hands):
            nonlocal t
            f.write(json.dumps({"t": round(t, 4), "hands": [{"label": h.label, "landmarks": h.landmarks} for h in hands]}) + "\n")
            t += 1 / FPS
        for s in steps:
            if s[0] == "none":
                for _ in range(int(s[1] * FPS)):
                    emit([])
            elif s[0] == "drag":
                _, x0, y0, x1, y1, sec = s
                n = int(sec * FPS)
                for i in range(n):
                    k = i / max(n - 1, 1)
                    emit([hand_at("pinch", x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)])
            else:
                pose, x, y, sec = s
                for _ in range(int(sec * FPS)):
                    emit([hand_at(pose, x, y)])


if __name__ == "__main__":
    main(sys.argv[1], json.loads(sys.argv[2]))
