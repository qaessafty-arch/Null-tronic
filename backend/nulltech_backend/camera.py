"""Threaded webcam capture that keeps only the newest frame (no backlog of stale frames)."""
from __future__ import annotations

import threading
import time
from typing import Any


class CameraError(RuntimeError):
    """Raised with a user-facing status: 'unavailable', 'permission-denied' or 'disconnected'."""

    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status


class LatestFrameCamera:
    def __init__(self, index: int = 0, width: int = 640, height: int = 480) -> None:
        try:
            import cv2  # noqa: F401
        except ImportError as e:  # pragma: no cover - depends on optional install
            raise CameraError("unavailable", "OpenCV is not installed: pip install 'nulltech-backend[camera]'") from e
        import cv2

        self._cv2 = cv2
        self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise CameraError("unavailable", f"Cannot open camera {index} (missing device or permission denied).")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._lock = threading.Lock()
        self._frame: Any = None
        self._seq = 0
        self._stop = threading.Event()
        self.failures = 0
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            ok, frame = self.cap.read()
            if not ok:
                self.failures += 1
                time.sleep(0.05)
                continue
            self.failures = 0
            with self._lock:
                self._frame = frame  # overwrite: older frames are dropped
                self._seq += 1

    def latest(self, after_seq: int) -> tuple[int, Any]:
        """Return (seq, frame) if a newer frame than `after_seq` exists, else (after_seq, None)."""
        if self.failures > 40:
            raise CameraError("disconnected", "Camera stopped delivering frames.")
        with self._lock:
            if self._seq == after_seq:
                return after_seq, None
            return self._seq, self._frame

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=1)
        self.cap.release()
