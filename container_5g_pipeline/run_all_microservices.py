"""
5G Microservices Orchestrator (Runs services natively or in Docker)
Launches the microservices as independent processes communicating over HTTP network sockets:
1. AMF Worker 1 (Port 8001)
2. AMF Worker 2 (Port 8002)
3. 5G Smart Load Balancer (Port 8383)
4. LSTM Auto-Scaler Controller (Port 8080)
5. Dataset Traffic Replayer (Streaming packets)
6. Pipeline Dashboard (Port 8090)
"""

import os
import sys
import time
import subprocess
import webbrowser
import threading

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICES_DIR = os.path.join(CURRENT_DIR, "services")
AMF_DIR = os.path.join(SERVICES_DIR, "amf_worker")
LB_DIR = os.path.join(SERVICES_DIR, "load_balancer")
AUTOSCALER_DIR = os.path.join(SERVICES_DIR, "autoscaler")
REPLAYER_DIR = os.path.join(SERVICES_DIR, "traffic_replayer")
DASHBOARD_DIR = os.path.join(CURRENT_DIR, "dashboard")

processes = []

def start_process(cmd, cwd, env_extra=None):
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    p = subprocess.Popen([sys.executable] + cmd, cwd=cwd, env=env)
    processes.append(p)
    return p

def main():
    print("=" * 75)
    print("  LAUNCHING 5G MICROSERVICES CLUSTER (REAL NETWORK SOCKETS & PACKETS)")
    print("=" * 75)

    # 1. Start AMF Worker Replicas
    print("[1/5] Starting AMF Worker 1 (Port 8001)...")
    start_process(["app.py"], cwd=AMF_DIR, env_extra={"AMF_ID": "amf-worker-1", "PORT": "8001"})

    print("[2/5] Starting AMF Worker 2 (Port 8002)...")
    start_process(["app.py"], cwd=AMF_DIR, env_extra={"AMF_ID": "amf-worker-2", "PORT": "8002"})

    time.sleep(1.0)

    # 2. Start Smart Load Balancer
    print("[3/5] Starting 5G Smart Load Balancer (Port 8383)...")
    start_process(["app.py"], cwd=LB_DIR, env_extra={
        "PORT": "8383",
        "AMF_ENDPOINTS": "http://127.0.0.1:8001,http://127.0.0.1:8002"
    })

    time.sleep(1.0)

    # 3. Start LSTM Auto-Scaler Daemon
    print("[4/5] Starting LSTM Predictive Auto-Scaler (Port 8080)...")
    start_process(["daemon.py"], cwd=AUTOSCALER_DIR, env_extra={
        "PORT": "8080",
        "LB_URL": "http://127.0.0.1:8383/metrics"
    })

    time.sleep(0.5)

    # 4. Start Dashboard
    print("[5/5] Starting Pipeline Dashboard (Port 8090)...")
    start_process(["server.py"], cwd=DASHBOARD_DIR)

    # 5. Start Dataset Traffic Replayer in background thread
    print("\n[*] Starting Dataset Traffic Replayer (Streaming synthetic 5G packets)...")
    replayer_env = {
        "LB_DISPATCH_URL": "http://127.0.0.1:8383/dispatch",
        "DATASET_PATH": os.path.join(CURRENT_DIR, "dataset", "flash_crowd_surge.csv"),
        "REPLAY_SPEED": "2.0"
    }
    start_process(["replayer.py"], cwd=REPLAYER_DIR, env_extra=replayer_env)

    url = "http://localhost:8090/"
    print(f"\n=========================================================================")
    print(f" [*] All 5G Microservices are LIVE and exchanging real network packets!")
    print(f" Dashboard URL: {url}")
    print(f"=========================================================================\n")

    def open_browser():
        time.sleep(1.5)
        webbrowser.open(url)
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping all microservices...")
        for p in processes:
            p.terminate()

if __name__ == "__main__":
    main()
