import pytest

from nulltech_backend.gestures import GestureConfig, GestureStateMachine, classify, features
from nulltech_backend.landmarks import Hand, palm_orientation
from nulltech_backend.synthetic import POSES, make_hand


@pytest.mark.parametrize("pose", POSES)
@pytest.mark.parametrize("rot", [-35, 0, 35])
@pytest.mark.parametrize("size", [0.06, 0.12, 0.25])
def test_each_pose_is_recognised_at_any_scale_and_tilt(pose, rot, size):
    cfg = GestureConfig()
    h = make_hand(pose, size=size, rotation_deg=rot)
    assert classify(features(h.landmarks, cfg), False, cfg) == pose


def test_pinch_hysteresis_keeps_a_wider_release_threshold():
    cfg = GestureConfig(pinch_on=0.1, pinch_off=0.45)
    h = make_hand("pinch")
    f = features(h.landmarks, cfg)
    f.pinch_ratio = 0.3  # between on and off
    assert classify(f, False, cfg) != "pinch"
    assert classify(f, True, cfg) == "pinch"


def test_state_machine_requires_stable_frames():
    sm = GestureStateMachine(GestureConfig(stable_frames=4))
    fist = make_hand("fist").landmarks
    assert [sm.update(fist) for _ in range(3)] == [[], [], []]
    events = sm.update(fist)
    assert [(e.kind, e.gesture) for e in events] == [("enter", "fist")]
    # a single noisy frame does not change state
    sm.update(make_hand("open_palm").landmarks)
    assert sm.state == "fist"


def test_wrong_landmark_count_rejected():
    with pytest.raises(ValueError):
        Hand([(0, 0, 0)] * 20)


def test_palm_orientation_flips_with_mirroring():
    h = make_hand("open_palm")
    mirrored = [(1 - x, y, z) for x, y, z in h.landmarks]
    assert palm_orientation(h.landmarks, "Right") != palm_orientation(mirrored, "Right")
