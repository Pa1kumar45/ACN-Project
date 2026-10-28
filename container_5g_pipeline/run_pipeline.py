"""
One-Click Launcher for the Containerized 5G Pipeline & Dashboard

Usage:
    python run_pipeline.py [--port 8090] [--no-browser] [--docker]
"""

import os
import sys
import time
import socket
import webbrowser
import threading
import subprocess

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(CURRENT_DIR, "dataset")
DASHBOARD_DIR = os.path.join(CURRENT_DIR, "dashboard")

if DASHBOARD_DIR not in sys.path:
    sys.path.insert(0, DASHBOARD_DIR)

from server import run_server

def find_available_port(start_port: int = 8090) -> int:
    for p in range(start_port, start_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    return start_port

def prepare_pipeline_data():
    master_csv = os.path.join(DATASET_DIR, "master_5g_traffic_dataset.csv")
    if not os.path.exists(master_csv):
        print("[*] Generating synthetic 5G dataset traces...")
        script = os.path.join(DATASET_DIR, "generate_dataset.py")
        subprocess.run([sys.executable, script], check=True)

    benchmarks_json = os.path.join(DATASET_DIR, "models_evaluation.json")
    if not os.path.exists(benchmarks_json):
        print("[*] Training forecasters and computing benchmark metrics...")
        script = os.path.join(DATASET_DIR, "train_forecasters.py")
        subprocess.run([sys.executable, script], check=True)

def main():
    port = 8090
    auto_browser = True
    use_docker = False

    for i, arg in enumerate(sys.argv):
        if arg == "--port" and i + 1 < len(sys.argv):
            try: port = int(sys.argv[i + 1])
            except ValueError: pass
        elif arg == "--no-browser":
            auto_browser = False
        elif arg == "--docker":
            use_docker = True

    prepare_pipeline_data()

    if use_docker:
        print("[*] Launching microservices with Docker Compose...")
        try:
            subprocess.run("docker compose up -d", cwd=CURRENT_DIR, shell=True, check=True)
            print("[*] All 5G microservices running in Docker!")
        except Exception as e:
            print(f"[!] Docker compose failed ({e}). Proceeding with host dashboard.")

    target_port = find_available_port(port)
    url = f"http://localhost:{target_port}/"

    if auto_browser:
        def open_browser():
            time.sleep(1.2)
            print(f"Opening Container Pipeline Dashboard at: {url}")
            try: webbrowser.open(url)
            except Exception: pass
        threading.Thread(target=open_browser, daemon=True).start()

    run_server(port=target_port)

if __name__ == "__main__":
    main()
