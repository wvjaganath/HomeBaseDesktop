"""HomeBase: runs the plane tracker (its-a-plane-python) headless in a container.

The tracker keeps its state (config, caches, logs, counters, maps) as files
next to its code. Here the code is read-only (/opt/tracker/app) and the state
lives on the /data volume: /data/app mirrors the code tree with symlinks, while
the files and folders the tracker writes are real files under /data/app.

It also restarts the tracker when its web UI asks to (the "Restart" button
writes .restart_requested because systemctl isn't available here), and stops
the tracker and its Flask child together.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

CODE = Path(os.environ.get("TRACKER_CODE", "/opt/tracker/app"))
DATA = Path(os.environ.get("TRACKER_DATA", "/data/app"))

# Top-level JSON files the tracker updates at runtime (caches). Seeded from the
# shipped copy on first start, then owned by /data. Other JSON stays read-only.
WRITABLE_JSON = {"airlines.json", "airports.json", "airports_custom.json", "nationalparks.json"}
# Directories the tracker writes into.
WRITABLE_DIRS = {Path("config"), Path("web/static/maps")}
# Directories that must be real (so writable children can live inside them).
REAL_PARENTS = {Path("web"), Path("web/static")}


def link(src: Path, dst: Path) -> None:
    if dst.is_symlink():
        if os.readlink(dst) == str(src):
            return
        dst.unlink()
    elif dst.exists():
        return  # a real file/dir the tracker created: leave it
    dst.symlink_to(src)


def build_overlay(rel: Path = Path(".")) -> None:
    src_dir, dst_dir = CODE / rel, DATA / rel
    dst_dir.mkdir(parents=True, exist_ok=True)
    for entry in sorted(src_dir.iterdir()):
        r = rel / entry.name if rel != Path(".") else Path(entry.name)
        dst = DATA / r
        if entry.is_dir():
            if r in WRITABLE_DIRS:
                if dst.is_symlink():
                    dst.unlink()
                dst.mkdir(parents=True, exist_ok=True)
            elif r in REAL_PARENTS:
                if dst.is_symlink():
                    dst.unlink()
                build_overlay(r)
            else:
                link(entry, dst)
        elif rel == Path(".") and entry.name in WRITABLE_JSON:
            if dst.is_symlink():
                dst.unlink()
            if not dst.exists():
                shutil.copyfile(entry, dst)
        else:
            link(entry, dst)


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    build_overlay()
    flag = DATA / ".restart_requested"
    flag.unlink(missing_ok=True)

    stopping = False

    def on_signal(signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    while not stopping:
        print("[HomeBase] starting the plane tracker", flush=True)
        # Own process group: its-a-plane.py starts the Flask web app as a child.
        # Run via runpy from /data/app (not the symlinked script directly), so
        # Python imports the tracker's modules through /data/app and their
        # __file__-relative paths point at the writable state, not the code.
        boot = f"import runpy, sys; sys.path.insert(0, {str(DATA)!r}); runpy.run_path({str(DATA / 'its-a-plane.py')!r}, run_name='__main__')"
        proc = subprocess.Popen([sys.executable, "-c", boot], cwd=DATA, start_new_session=True)
        restart = False
        while proc.poll() is None and not stopping:
            if flag.exists():
                flag.unlink(missing_ok=True)
                print("[HomeBase] restart requested from the web UI", flush=True)
                restart = True
                break
            time.sleep(1)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=10)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        else:
            # Exited on its own: make sure its Flask child goes too.
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        if stopping:
            break
        if not restart:
            code = proc.returncode
            print(f"[HomeBase] tracker exited with code {code}; restarting in 10 s", flush=True)
            for _ in range(10):
                if stopping:
                    break
                time.sleep(1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
