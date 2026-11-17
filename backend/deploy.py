"""Run Chroma, API and ingestion worker in one Railway container."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.request import urlopen


def memory_diagnostics():
    """Read Linux container counters without changing application behavior."""
    for name in ("memory.max", "memory.current", "memory.peak", "memory.events"):
        try:
            value = (Path("/sys/fs/cgroup") / name).read_text().strip()
            print(f"[deploy] {name}: {value}", flush=True)
        except OSError:
            pass


def main():
    processes = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    data = Path(os.environ.get("PAPERPILOT_DATA_DIR", "/data"))
    data.mkdir(parents=True, exist_ok=True)
    memory_diagnostics()
    try:
        processes.append(subprocess.Popen([
            "chroma", "run", "--host", "127.0.0.1", "--port", "8001",
            "--path", str(data / "chroma_data"),
        ]))
        for _ in range(120):
            if stopping or processes[0].poll() is not None:
                raise RuntimeError("Chroma stopped during startup")
            try:
                with urlopen("http://127.0.0.1:8001/api/v2/heartbeat", timeout=2):
                    break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError("Chroma startup timed out")
        processes.append(subprocess.Popen([
            sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0",
            "--port", os.environ.get("PORT", "8000"),
        ]))
        processes.append(subprocess.Popen([sys.executable, "worker.py"]))
        while not stopping:
            for name, process in zip(("chroma", "api", "worker"), processes):
                code = process.poll()
                if code is not None:
                    memory_diagnostics()
                    raise RuntimeError(
                        f"Required service {name} exited with code {code}; "
                        "negative codes indicate termination by a signal"
                    )
            time.sleep(1)
    finally:
        for p in processes:
            if p.poll() is None:
                p.terminate()
        for p in processes:
            try:
                p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()


if __name__ == "__main__":
    main()
