"""Run Chroma, API and ingestion worker in one Railway container."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.request import urlopen


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
            if any(p.poll() is not None for p in processes):
                raise RuntimeError("A required service exited; restarting container")
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
