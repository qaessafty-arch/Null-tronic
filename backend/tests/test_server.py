import asyncio
import json
import socket

import pytest
from websockets.asyncio.client import connect

from nulltech_backend.server import IteratorSource, Service, run_service
from nulltech_backend.simulation import ngspice_available
from nulltech_backend.synthetic import make_hand


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def scripted():
    t = 0.0
    for pose, n in [("point", 8), ("pinch", 8), ("point", 8), ("fist", 10)]:
        for _ in range(n):
            yield t, [make_hand(pose, 0.5, 0.6)]
            t += 1 / 60


async def _collect(port, until, timeout=5.0):
    msgs = []
    async with connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"type": "hello"}))

        async def read():
            async for raw in ws:
                m = json.loads(raw)
                msgs.append(m)
                if until(msgs):
                    return
        await asyncio.wait_for(read(), timeout)
    return msgs


def test_stream_follows_shared_protocol():
    async def main():
        port = free_port()
        ready = asyncio.Event()

        def slow_start():
            yield from [(0.0, [])] * 1
            yield from scripted()

        svc = Service(IteratorSource(slow_start(), realtime=True))
        task = asyncio.create_task(run_service(svc, port=port, ready=ready))
        await ready.wait()
        try:
            return await _collect(port, lambda ms: any(m.get("name") == "confirm" for m in ms))
        finally:
            task.cancel()

    msgs = asyncio.run(main())
    types = {m["type"] for m in msgs}
    assert {"status", "pointer", "command"} <= types
    phases = [m["phase"] for m in msgs if m["type"] == "pointer" and m["phase"] != "move"]
    assert phases == ["down", "up"]
    for m in msgs:
        if m["type"] == "pointer":
            assert 0 <= m["x"] <= 1 and 0 <= m["y"] <= 1


def test_browser_origin_restricted_to_localhost():
    async def main():
        port = free_port()
        ready = asyncio.Event()
        svc = Service(IteratorSource(iter([]), realtime=False))
        task = asyncio.create_task(run_service(svc, port=port, ready=ready))
        await ready.wait()
        try:
            with pytest.raises(Exception):
                async with connect(f"ws://127.0.0.1:{port}", origin="https://evil.example"):
                    pass
            async with connect(f"ws://127.0.0.1:{port}", origin="http://localhost:5173") as ws:
                assert json.loads(await ws.recv())["type"] == "status"
        finally:
            task.cancel()

    asyncio.run(main())


@pytest.mark.skipif(not ngspice_available(), reason="ngspice not installed")
def test_simulate_request_runs_ngspice():
    async def main():
        port = free_port()
        ready = asyncio.Event()
        svc = Service(IteratorSource(iter([]), realtime=False))
        task = asyncio.create_task(run_service(svc, port=port, ready=ready))
        await ready.wait()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.recv()  # status
                await ws.send(json.dumps({"type": "simulate", "requestId": "r1", "netlist": "t\nV1 a 0 DC 12\nR1 a b 2k\nR2 b 0 1k\n.op\n.end\n"}))
                while True:
                    m = json.loads(await ws.recv())
                    if m["type"] == "result":
                        return m
        finally:
            task.cancel()

    m = asyncio.run(main())
    assert m["ok"] and abs(m["vectors"]["b"] - 4.0) < 1e-6


def test_simulate_rejects_control_blocks():
    from nulltech_backend.simulation import run_operating_point
    if not ngspice_available():
        pytest.skip("ngspice not installed")
    with pytest.raises(ValueError):
        run_operating_point("t\nR1 a 0 1k\n.control\nshell rm -rf /\n.endc\n.end\n")
