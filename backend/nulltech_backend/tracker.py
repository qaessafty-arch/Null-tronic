"""MediaPipe hand-landmark wrapper (optional dependency).

Supports the legacy `mediapipe.solutions.hands` API and the newer Tasks API
(`HandLandmarker`, needs a `hand_landmarker.task` model file passed with --model).
"""
from __future__ import annotations

from typing import Any

from .camera import CameraError
from .landmarks import Hand


class HandTracker:
    def __init__(self, max_hands: int = 2, model_path: str | None = None, min_detection: float = 0.6, min_tracking: float = 0.5) -> None:
        try:
            import mediapipe as mp
        except ImportError as e:  # pragma: no cover
            raise CameraError("unavailable", "MediaPipe is not installed: pip install 'nulltech-backend[camera]'") from e
        self.mp = mp
        self._legacy = None
        self._tasks = None
        solutions = getattr(mp, "solutions", None)
        if solutions is not None and hasattr(solutions, "hands") and not model_path:
            self._legacy = solutions.hands.Hands(static_image_mode=False, max_num_hands=max_hands, model_complexity=0, min_detection_confidence=min_detection, min_tracking_confidence=min_tracking)
        else:
            if not model_path:
                raise CameraError("unavailable", "This MediaPipe version needs the Tasks model: pass --model path/to/hand_landmarker.task")
            from mediapipe.tasks import python as mpt
            from mediapipe.tasks.python import vision

            opts = vision.HandLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model_path), num_hands=max_hands, running_mode=vision.RunningMode.VIDEO, min_hand_detection_confidence=min_detection, min_tracking_confidence=min_tracking)
            self._tasks = vision.HandLandmarker.create_from_options(opts)

    def process(self, bgr_frame: Any, timestamp_ms: int) -> list[Hand]:
        import cv2

        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        hands: list[Hand] = []
        if self._legacy is not None:
            res = self._legacy.process(rgb)
            if res.multi_hand_landmarks:
                for lms, hd in zip(res.multi_hand_landmarks, res.multi_handedness):
                    c = hd.classification[0]
                    hands.append(Hand([(p.x, p.y, p.z) for p in lms.landmark], c.label, c.score))
        else:
            image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
            res = self._tasks.detect_for_video(image, timestamp_ms)
            for lms, hd in zip(res.hand_landmarks, res.handedness):
                hands.append(Hand([(p.x, p.y, p.z) for p in lms], hd[0].category_name, hd[0].score))
        # most confident first; keep labels unique (MediaPipe can label both hands the same)
        hands.sort(key=lambda h: -h.score)
        seen: set[str] = set()
        for h in hands:
            if h.label in seen:
                h.label = "Left" if h.label == "Right" else "Right"
            seen.add(h.label)
        return hands

    def close(self) -> None:
        if self._legacy is not None:
            self._legacy.close()
        if self._tasks is not None:
            self._tasks.close()
