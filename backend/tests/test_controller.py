from nulltech_backend.controller import CommandController, ControllerConfig
from nulltech_backend.synthetic import make_hand


def run(ctrl, frames, t0=0.0, fps=30):
    out = []
    t = t0
    for hands in frames:
        out += ctrl.process(hands, t)
        t += 1 / fps
    return out, t


def kinds(msgs):
    return [(m["type"], m.get("phase") or m.get("name")) for m in msgs if m["type"] != "pointer" or m["phase"] != "move"]


def test_point_pinch_release_produces_down_then_up():
    c = CommandController()
    frames = [[make_hand("point", 0.5, 0.6)]] * 6 + [[make_hand("pinch", 0.5, 0.6)]] * 6 + [[make_hand("point", 0.5, 0.6)]] * 6
    msgs, _ = run(c, frames)
    assert kinds(msgs) == [("pointer", "down"), ("pointer", "up")]
    moves = [m for m in msgs if m.get("phase") == "move"]
    assert moves and all(0 <= m["x"] <= 1 and 0 <= m["y"] <= 1 for m in moves)


def test_fist_confirms_once_while_held_and_v_sign_rejects():
    c = CommandController()
    msgs, t = run(c, [[make_hand("point")]] * 6 + [[make_hand("fist")]] * 40)
    assert kinds(msgs).count(("command", "confirm")) == 1
    msgs, _ = run(c, [[make_hand("point")]] * 6 + [[make_hand("v_sign")]] * 10, t0=t)
    assert ("command", "reject") in kinds(msgs)


def test_open_palm_pauses_and_pointing_resumes():
    c = CommandController()
    msgs, t = run(c, [[make_hand("point")]] * 6 + [[make_hand("open_palm")]] * 8)
    assert ("command", "cancel") in kinds(msgs) and ("command", "pause") in kinds(msgs)
    assert c.paused
    msgs, _ = run(c, [[make_hand("fist")]] * 8 + [[make_hand("point")]] * 8, t0=t)
    assert ("command", "confirm") not in kinds(msgs)  # ignored while paused
    assert ("command", "resume") in kinds(msgs)


def test_losing_the_hand_mid_drag_releases_the_pointer():
    c = CommandController(ControllerConfig(lost_timeout_s=0.2))
    msgs, t = run(c, [[make_hand("point")]] * 6 + [[make_hand("pinch")]] * 6)
    assert ("pointer", "down") in kinds(msgs)
    msgs, _ = run(c, [[]] * 15, t0=t)
    assert ("pointer", "up") in kinds(msgs)


def test_mirroring_and_margin_mapping():
    c = CommandController(ControllerConfig(margin=0.1, mirror=True))
    assert c._map(0.1, 0.1) == (1.0, 0.0)
    assert c._map(0.9, 0.9) == (0.0, 1.0)
    x, y = c._map(0.5, 0.5)
    assert abs(x - 0.5) < 1e-9 and abs(y - 0.5) < 1e-9


def test_two_hand_pinch_spread_emits_zoom_and_pan():
    c = CommandController()
    frames = []
    for i in range(20):
        d = 0.1 + i * 0.01
        frames.append([make_hand("pinch", 0.5 - d, 0.6 + i * 0.01, label="Left"), make_hand("pinch", 0.5 + d, 0.6 + i * 0.01, label="Right")])
    msgs, _ = run(c, frames)
    zooms = [m for m in msgs if m["type"] == "zoom"]
    assert zooms and all(m["factor"] > 1 for m in zooms)
    assert any(m["type"] == "pan" for m in msgs)
    assert not any(m["type"] == "pointer" and m["phase"] == "down" for m in msgs)


def test_calibration_sets_thresholds_in_range():
    c = CommandController()
    r = c.calibrate(make_hand("open_palm"))
    assert 0.15 <= r["pinch_on"] <= 0.45 and r["pinch_off"] > r["pinch_on"]
