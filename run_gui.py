"""
5G AMF Predictive Auto-Scaling & Priority Slicing Simulator
GUI Launcher Script

Usage:
    python run_gui.py [--port 8050] [--no-browser]
"""

import sys
import os
import time
import webbrowser
import threading

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SIM_GUI_DIR = os.path.join(CURRENT_DIR, "simulator_gui")
if SIM_GUI_DIR not in sys.path:
    sys.path.insert(0, SIM_GUI_DIR)

from server import run_server

import socket

def find_available_port(start_port: int = 8050) -> int:
    for p in range(start_port, start_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    return start_port

def main():
    port = 8050
    auto_browser = True

    for i, arg in enumerate(sys.argv):
        if arg == "--port" and i + 1 < len(sys.argv):
            try:
                port = int(sys.argv[i + 1])
            except ValueError:
                pass
        elif arg == "--no-browser":
            auto_browser = False

    target_port = find_available_port(port)
    url = f"http://localhost:{target_port}/"

    if auto_browser:
        def open_browser():
            time.sleep(1.2)
            print(f"Opening browser at: {url}")
            try:
                webbrowser.open(url)
            except Exception:
                pass

        threading.Thread(target=open_browser, daemon=True).start()

    run_server(port=target_port)

if __name__ == "__main__":
    main()
