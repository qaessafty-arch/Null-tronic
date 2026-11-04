"""CLI: python -m nulltech_backend [--camera N | --replay demo|file.jsonl] [--port 8765]."""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from .camera import CameraError
from .controller import CommandController, ControllerConfig
from .server import CameraSource, IteratorSource, Service, jsonl_frames, run_service
from .simulation import ngspice_available
from .synthetic import demo_sequence


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nulltech_backend", description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--camera", type=int, default=0, help="camera index (default 0)")
    ap.add_argument("--model", help="MediaPipe Tasks hand_landmarker.task (only for MediaPipe builds without the legacy API)")
    ap.add_argument("--replay", help="'demo' for a scripted synthetic hand, or a .jsonl landmark recording")
    ap.add_argument("--record", help="record camera landmarks to this .jsonl file")
    ap.add_argument("--no-mirror", action="store_true", help="do not mirror the camera horizontally")
    ap.add_argument("--margin", type=float, default=0.12, help="unused border of the camera image (0-0.4)")
    ap.add_argument("--wait-client", action="store_true", help="start the replay only after a client connects")
    ap.add_argument("--once", action="store_true", help="play a .jsonl replay once instead of looping")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    log = logging.getLogger("nulltech")
    if a.replay == "demo":
        source = IteratorSource(demo_sequence())
    elif a.replay:
        source = IteratorSource(jsonl_frames(a.replay, loop=not a.once))
    else:
        try:
            source = CameraSource(a.camera, a.model, a.record)
        except CameraError as e:
            log.error("%s  (use --replay demo to run without a camera)", e)
            return 2
    log.info("ngspice %s", "available" if ngspice_available() else "not found (verification requests will fail)")
    service = Service(source, CommandController(ControllerConfig(mirror=not a.no_mirror, margin=a.margin)), wait_client=a.wait_client)
    try:
        asyncio.run(run_service(service, a.host, a.port))
    except KeyboardInterrupt:
        pass
    finally:
        source.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
