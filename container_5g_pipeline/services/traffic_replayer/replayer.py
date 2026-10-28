"""
Synthetic 5G Dataset Traffic Replayer
Reads the generated CSV dataset line by line and sends real HTTP/gRPC control requests
to the 5G Smart Load Balancer with slice headers (URLLC, eMBB, mMTC).
"""

import os
import time
import csv
import urllib.request
import threading
from typing import List, Dict, Any

LB_DISPATCH_URL = os.getenv("LB_DISPATCH_URL", "http://127.0.0.1:8383/dispatch")
DATASET_PATH = os.getenv("DATASET_PATH", "../dataset/flash_crowd_surge.csv")
REPLAY_SPEED = float(os.getenv("REPLAY_SPEED", "2.0"))  # 2x playback speed

replayer_state = {
    "is_running": True,
    "current_second": 0,
    "total_seconds": 240,
    "total_sent": 0,
    "successful_dispatches": 0,
    "failed_dispatches": 0,
    "active_dataset": "flash_crowd_surge.csv"
}

def send_request(slice_type: int, imsi: str):
    try:
        req = urllib.request.Request(
            LB_DISPATCH_URL,
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "X-5G-Slice": str(slice_type),
                "X-UE-IMSI": str(imsi)
            }
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status == 200:
                replayer_state["successful_dispatches"] += 1
            else:
                replayer_state["failed_dispatches"] += 1
    except Exception:
        replayer_state["failed_dispatches"] += 1

def start_replayer():
    print(f"[*] Starting 5G Dataset Replayer: {DATASET_PATH} -> {LB_DISPATCH_URL}")
    if not os.path.exists(DATASET_PATH):
        print(f"[!] Dataset not found at {DATASET_PATH}. Waiting...")
        return

    rows: List[Dict[str, Any]] = []
    with open(DATASET_PATH, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)

    replayer_state["total_seconds"] = len(rows)
    print(f"[*] Loaded {len(rows)} seconds of traffic from dataset.")

    for idx, row in enumerate(rows):
        if not replayer_state["is_running"]:
            break

        replayer_state["current_second"] = idx
        t_sec = int(row.get("timestamp_s", idx))
        total_rps = float(row.get("total_rps", 35.0))
        u_count = int(row.get("urllc_reqs", 3))
        e_count = int(row.get("embb_reqs", 7))
        m_count = int(row.get("mmtc_reqs", 24))

        # Sample a subset of actual HTTP requests to maintain high fidelity without socket exhaustion
        # (e.g. 1 request per ~15 rps)
        sample_ratio = max(1, int(total_rps / 15.0))

        threads = []
        for _ in range(max(1, u_count // sample_ratio)):
            t = threading.Thread(target=send_request, args=(1, f"100000000000{idx%50:02d}"))
            threads.append(t)
            t.start()

        for _ in range(max(1, e_count // sample_ratio)):
            t = threading.Thread(target=send_request, args=(0, f"200000000000{idx%50:02d}"))
            threads.append(t)
            t.start()

        for _ in range(max(1, m_count // sample_ratio)):
            t = threading.Thread(target=send_request, args=(2, f"300000000000{idx%50:02d}"))
            threads.append(t)
            t.start()

        replayer_state["total_sent"] += (u_count + e_count + m_count)
        print(f"[REPLAY t={t_sec:03d}s] RPS: {total_rps:>5.1f} | URLLC: {u_count} | eMBB: {e_count} | mMTC: {m_count} -> LB Sent")

        # Sleep adjusted by playback speed
        time.sleep(1.0 / max(0.1, REPLAY_SPEED))

    print("[*] Dataset replay finished.")

if __name__ == "__main__":
    start_replayer()
