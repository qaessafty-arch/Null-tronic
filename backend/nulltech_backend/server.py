"""Local WebSocket service: streams input commands to the application and answers requests.

Binds to 127.0.0.1 by default and accepts browser connections only from localhost origins.
Messages follow shared/commands/input-commands.schema.json. Incoming client messages:
  {"type":"hello"} · {"type":"config", ...} · {"type":"calibrate"} ·
  {"type":"simulate","netlist":..., "requestId":...}
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Iterator

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

from .camera import CameraError
from .controller import CommandController
from .landmarks import Hand
from .simulation import run_operating_point

log = logging.getLogger("nulltech")


# ---------------------------------------------------------------- frame sources
class Source:
    camera_status = "ok"

    async def frames(self) -> AsyncIterator[tuple[float, list[Hand]]]:  # pragma: no cover - interface
        raise NotImplementedError
        yield

    def close(self) -> None:
        pass


class IteratorSource(Source):
    """Replays (t, hands) tuples in real time (demo or recorded JSONL)."""

    camera_status = "replay"

    def __init__(self, it: Iterator[tuple[float, list[Hand]]], realtime: bool = True) -> None:
        self.it = it
        self.realtime = realtime

    async def frames(self) -> AsyncIterator[tuple[float, list[Hand]]]:
        start = time.monotonic()
        t0: float | None = None
        for t, hands in self.it:
            if t0 is None:
                t0 = t
            if self.realtime:
                delay = (t - t0) - (time.monotonic() - start)
                if delay > 0:
                    await asyncio.sleep(delay)
            else:
                await asyncio.sleep(0)
            yield t, hands


def jsonl_frames(path: str, loop: bool = True) -> Iterator[tuple[float, list[Hand]]]:
    while True:
        offset = 0.0
        last = 0.0
        with open(path, encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                d = json.loads(line)
                last = d["t"] + offset
                yield last, [Hand([tuple(p) for p in h["landmarks"]], h.get("label", "Right"), h.get("score", 1.0)) for h in d.get("hands", [])]
        if not loop:
            return
        offset = last + 0.5


class CameraSource(Source):
    """Webcam + MediaPipe; frames are processed in a worker thread, newest frame only."""

    def __init__(self, index: int = 0, model: str | None = None, record: str | None = None) -> None:
        from .camera import LatestFrameCamera
        from .tracker import HandTracker

        self.camera = LatestFrameCamera(index)
        self.tracker = HandTracker(model_path=model)
        self.record = open(record, "w", encoding="utf-8") if record else None
        self.t0 = time.monotonic()

    async def frames(self) -> AsyncIterator[tuple[float, list[Hand]]]:
        loop = asyncio.get_running_loop()
        seq = 0
        while True:
            try:
                seq, frame = self.camera.latest(seq)
            except CameraError as e:
                self.camera_status = e.status
                raise
            if frame is None:
                await asyncio.sleep(0.004)
                continue
            t = time.monotonic()
            hands = await loop.run_in_executor(None, self.tracker.process, frame, int((t - self.t0) * 1000))
            if self.record:
                self.record.write(json.dumps({"t": t - self.t0, "hands": [{"label": h.label, "score": h.score, "landmarks": h.landmarks} for h in hands]}) + "\n")
            yield t, hands

    def close(self) -> None:
        self.camera.close()
        self.tracker.close()
        if self.record:
            self.record.close()


# ---------------------------------------------------------------- service
@dataclass
class Service:
    source: Source
    controller: CommandController = field(default_factory=CommandController)
    clients: set[ServerConnection] = field(default_factory=set)
    fps: float = 0.0
    last_hands: list[Hand] = field(default_factory=list)
    message: str = ""
    #: start consuming the source only once a client is connected (deterministic replays)
    wait_client: bool = False

    async def broadcast(self, msg: dict[str, Any]) -> None:
        if not self.clients:
            return
        data = json.dumps(msg, separators=(",", ":"))
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except Exception:  # noqa: BLE001 - client went away
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def status(self) -> dict[str, Any]:
        return {
            "type": "status",
            "camera": self.source.camera_status,
            "fps": round(self.fps, 1),
            "hands": len(self.last_hands),
            "gesture": self.controller.gesture,
            "paused": self.controller.paused,
            "landmarks": [[[round(p[0], 4), round(p[1], 4), round(p[2], 4)] for p in h.landmarks] for h in self.last_hands],
            "message": self.message,
        }

    async def handle(self, ws: ServerConnection) -> None:
        self.clients.add(ws)
        await ws.send(json.dumps(self.status()))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self.on_message(ws, msg)
        finally:
            self.clients.discard(ws)

    async def on_message(self, ws: ServerConnection, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "config":
            self.controller.configure(**{k: v for k, v in msg.items() if k != "type"})
            self.message = "Settings applied"
        elif kind == "calibrate":
            if self.last_hands:
                res = self.controller.calibrate(self.last_hands[0])
                self.message = f"Calibrated pinch: on {res['pinch_on']:.2f}, off {res['pinch_off']:.2f}"
            else:
                self.message = "Calibration needs a hand in view"
        elif kind == "simulate":
            rid = msg.get("requestId")
            loop = asyncio.get_running_loop()
            try:
                vectors = await loop.run_in_executor(None, run_operating_point, str(msg.get("netlist", "")))
                await ws.send(json.dumps({"type": "result", "requestId": rid, "ok": True, "vectors": vectors}))
            except Exception as e:  # noqa: BLE001 - reported to the client
                await ws.send(json.dumps({"type": "result", "requestId": rid, "ok": False, "error": str(e)}))

    async def pump(self) -> None:
        """Consume frames, run gesture/command pipeline, broadcast commands and periodic status."""
        last_status = 0.0
        count = 0
        window = time.monotonic()
        while self.wait_client and not self.clients:
            await asyncio.sleep(0.05)
        if self.wait_client:
            await asyncio.sleep(0.5)  # let the client finish its handshake / UI setup
        try:
            async for t, hands in self.source.frames():
                self.last_hands = hands
                for m in self.controller.process(hands, t):
                    await self.broadcast(m)
                count += 1
                now = time.monotonic()
                if now - window >= 1.0:
                    self.fps = count / (now - window)
                    count = 0
                    window = now
                if now - last_status > 0.15:
                    last_status = now
                    await self.broadcast(self.status())
        except CameraError as e:
            self.message = str(e)
            log.error("camera: %s", e)
            await self.broadcast(self.status())


def _origin_ok(origin: str | None) -> bool:
    if origin is None:
        return True  # non-browser client
    return origin.startswith(("http://localhost", "http://127.0.0.1", "https://localhost", "https://127.0.0.1", "tauri://", "file://"))


async def run_service(service: Service, host: str = "127.0.0.1", port: int = 8765, ready: asyncio.Event | None = None) -> None:
    def process_request(conn: ServerConnection, request: Request) -> Response | None:
        if not _origin_ok(request.headers.get("Origin")):
            return Response(403, "Forbidden", Headers([("Content-Type", "text/plain")]), b"origin not allowed\n")
        return None

    async with serve(service.handle, host, port, process_request=process_request):
        log.info("listening on ws://%s:%d", host, port)
        if ready:
            ready.set()
        await service.pump()
        await asyncio.Future()  # keep serving requests (e.g. simulate) after a source ends
