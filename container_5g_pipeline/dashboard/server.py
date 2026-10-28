"""
Backend Server for the Containerized 5G Pipeline Dashboard
Provides:
1. Static asset serving for the dashboard UI (port 8090)
2. REST API endpoints:
   - GET  /api/health
   - GET  /api/dataset-list
   - GET  /api/dataset/<name>
   - GET  /api/live-status (polls Load Balancer & Auto-Scaler)
   - GET  /api/models-benchmark
"""

import os
import sys
import json
import csv
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(os.getenv("PORT", "8090"))
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(CURRENT_DIR, "static")
DATASET_DIR = os.path.join(os.path.dirname(CURRENT_DIR), "dataset")

class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json(self, status_code: int, data: any):
        try:
            payload = json.dumps(data, indent=2).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json(200, {"status": "UP", "service": "5g-container-dashboard", "port": PORT})
            return

        elif path == "/api/dataset-list":
            files = [f for f in os.listdir(DATASET_DIR) if f.endswith(".csv")]
            self._send_json(200, {"datasets": files})
            return

        elif path.startswith("/api/dataset/"):
            dataset_name = path.split("/")[-1]
            csv_path = os.path.join(DATASET_DIR, dataset_name)
            if not os.path.exists(csv_path):
                self._send_json(404, {"error": "Dataset not found"})
                return

            rows = []
            with open(csv_path, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    rows.append({
                        "t": int(r.get("timestamp_s", 0)),
                        "rps": float(r.get("total_rps", 0)),
                        "urllc": int(r.get("urllc_reqs", 0)),
                        "embb": int(r.get("embb_reqs", 0)),
                        "mmtc": int(r.get("mmtc_reqs", 0)),
                        "amfs": int(r.get("theoretical_amfs", 1)),
                        "pattern": r.get("traffic_pattern", "")
                    })
            self._send_json(200, {"name": dataset_name, "total_seconds": len(rows), "data": rows})
            return

        elif path == "/api/models-benchmark":
            json_path = os.path.join(DATASET_DIR, "models_evaluation.json")
            if os.path.exists(json_path):
                with open(json_path, mode="r", encoding="utf-8") as f:
                    self._send_json(200, json.load(f))
            else:
                self._send_json(404, {"error": "Benchmarks not yet generated"})
            return

        elif path == "/api/config":
            try:
                req = urllib.request.Request("http://127.0.0.1:8383/config", headers={"User-Agent": "dashboard"})
                with urllib.request.urlopen(req, timeout=0.8) as resp:
                    self._send_json(200, json.loads(resp.read().decode("utf-8")))
            except Exception:
                self._send_json(200, {"priority_queue_enabled": True, "mode": "PROPOSED"})
            return

        elif path == "/api/live-status":
            # Query Load Balancer
            lb_data = {}
            try:
                req = urllib.request.Request("http://127.0.0.1:8383/metrics", headers={"User-Agent": "dashboard"})
                with urllib.request.urlopen(req, timeout=0.8) as resp:
                    lb_data = json.loads(resp.read().decode("utf-8"))
            except Exception:
                lb_data = {
                    "status": "OFFLINE", "active_amfs": 2, "last_second_rps": 35.0,
                    "urllc_mean_lat_ms": 3.18, "embb_mean_lat_ms": 14.2, "mmtc_mean_lat_ms": 16.5,
                    "priority_queue_enabled": True, "urllc_count": 12, "embb_count": 25, "mmtc_count": 88
                }

            # Query Auto-Scaler
            scaler_data = {}
            try:
                req = urllib.request.Request("http://127.0.0.1:8080/status", headers={"User-Agent": "dashboard"})
                with urllib.request.urlopen(req, timeout=0.8) as resp:
                    scaler_data = json.loads(resp.read().decode("utf-8"))
            except Exception:
                scaler_data = {"forecast_rps": 35.0, "target_amfs": 1, "scale_action": "HOLD"}

            self._send_json(200, {
                "load_balancer": lb_data,
                "autoscaler": scaler_data
            })
            return

        elif path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/config":
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                req = urllib.request.Request(
                    "http://127.0.0.1:8383/config",
                    data=body,
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=1.0) as resp:
                    self._send_json(200, json.loads(resp.read().decode("utf-8")))
            except Exception as e:
                self._send_json(200, {"status": "LOCAL_OVERRIDE", "error": str(e)})
            return

        self._send_json(404, {"error": "Not Found"})

def run_server(port: int = PORT):
    actual_port = port
    httpd = None
    for p in range(port, port + 15):
        try:
            server_address = ("127.0.0.1", p)
            httpd = HTTPServer(server_address, DashboardHandler)
            actual_port = p
            break
        except OSError:
            continue

    if httpd is None:
        print(f"Error: Could not bind dashboard to ports {port}-{port+15}")
        return

    print(f"\n=========================================================================")
    print(f" [*] Containerized 5G Pipeline Dashboard Running")
    print(f" URL: http://localhost:{actual_port}/")
    print(f"=========================================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard server...")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    run_server(PORT)
