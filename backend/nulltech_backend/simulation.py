"""ngspice batch runner used for independent verification of the built-in solver."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile

_LINE = re.compile(r"^\s*([^\s=]+)\s*=\s*([-+0-9.eE]+)\s*$")


def ngspice_available() -> bool:
    return shutil.which("ngspice") is not None


def run_operating_point(netlist: str, timeout_s: float = 20.0) -> dict[str, float]:
    """Run `.op` on a netlist (any analysis lines are replaced) and return node voltages / branch currents."""
    if not ngspice_available():
        raise RuntimeError("ngspice is not installed on this machine")
    body = re.sub(r"(?im)^\.(op|tran|ac|dc)\b.*$", "", netlist)
    body = re.sub(r"(?im)^\.end\s*$", "", body)
    # refuse control blocks / shell escapes coming from the client
    if re.search(r"(?im)^\s*\.(control|endc|include|lib)\b|^\s*shell\b", body):
        raise ValueError("netlist contains directives that are not accepted (.control/.include/.lib/shell)")
    deck = body.rstrip() + "\n.control\nop\nprint all\n.endc\n.end\n"
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "deck.cir")
        with open(path, "w", encoding="utf-8") as f:
            f.write(deck)
        proc = subprocess.run(["ngspice", "-b", path], capture_output=True, text=True, timeout=timeout_s, cwd=d)
    out: dict[str, float] = {}
    for line in proc.stdout.splitlines():
        m = _LINE.match(line)
        if m:
            out[m.group(1).lower()] = float(m.group(2))
    if not out:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[-500:] or "ngspice produced no results")
    return out
