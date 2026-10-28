"""
Backend HTTP Server for 5G Core Control-Plane Simulation GUI
Provides:
1. Static web asset serving (HTML, CSS, JS, icons)
2. REST API endpoints:
   - GET  /api/health
   - POST /api/simulate          : Runs full simulation with custom parameters, returns time-series and summary
   - GET  /api/experiment/<id>   : Runs Table I experiments (E1 to E7) and returns comparative datasets
   - POST /api/step              : Interactive stepping/streaming endpoint for live visualization
"""

import sys
import os
import json
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Dict, Any

# Add sim_engine to Python path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SIM_ENGINE_DIR = os.path.join(CURRENT_DIR, "sim_engine")
if SIM_ENGINE_DIR not in sys.path:
    sys.path.insert(0, SIM_ENGINE_DIR)

from workloads import get_workload_by_name
from simpy_model import SimPy5GCoreSimulator
from experiments import run_experiment

STATIC_DIR = os.path.join(CURRENT_DIR, "static")

class SimulationServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json(self, status_code: int, data: Any):
        payload = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json(200, {
                "status": "healthy",
                "service": "5G Core AMF Auto-Scaling Simulation Engine",
                "version": "2.0",
                "simpy_available": True
            })
            return

        elif path.startswith("/api/experiment/"):
            exp_id = path.split("/")[-1].upper()
            try:
                res = run_experiment(exp_id)
                self._send_json(200, res)
            except Exception as e:
                self._send_json(500, {"error": str(e)})
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        # Default to static file serving
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            req_data = json.loads(body)
        except Exception:
            req_data = {}

        if path == "/api/simulate":
            try:
                workload_name = req_data.get("workload", "flash_crowd")
                duration_s = int(req_data.get("duration", 200))
                policy = req_data.get("policy", "lstm")
                has_pq = bool(req_data.get("has_priority_queue", True))
                mu = float(req_data.get("mu", 100.0))
                gamma = float(req_data.get("gamma", 0.80))
                margin = float(req_data.get("margin", 0.10))
                boot_time = float(req_data.get("boot_time", 40.0))
                horizon = int(req_data.get("horizon", 45))
                u_mix = float(req_data.get("urllc_mix", 0.10))
                e_mix = float(req_data.get("embb_mix", 0.20))
                m_mix = float(req_data.get("mmtc_mix", 0.70))
                seed = int(req_data.get("seed", 42))

                rates = get_workload_by_name(workload_name, duration_s=duration_s, seed=seed)

                # Inject manual spike if requested
                spike_at = req_data.get("spike_at")
                spike_amount = req_data.get("spike_amount")
                if spike_at is not None and spike_amount is not None:
                    s_idx = int(spike_at)
                    if 0 <= s_idx < len(rates):
                        for k in range(s_idx, min(len(rates), s_idx + 25)):
                            rates[k] += float(spike_amount)

                sim = SimPy5GCoreSimulator(
                    traffic_rates=rates,
                    policy=policy,
                    has_priority_queue=has_pq,
                    mu=mu,
                    gamma=gamma,
                    safety_margin=margin,
                    boot_time=boot_time,
                    horizon=horizon,
                    slice_mix=(u_mix, e_mix, m_mix),
                    seed=seed
                )
                results = sim.run_simulation()
                self._send_json(200, results)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_json(500, {"error": str(e)})
            return

        self._send_json(404, {"error": f"Endpoint {path} not found"})


def run_server(port: int = 8050, auto_find_port: bool = True):
    httpd = None
    actual_port = port
    for p in range(port, port + 20):
        try:
            server_address = ("127.0.0.1", p)
            httpd = HTTPServer(server_address, SimulationServerHandler)
            actual_port = p
            break
        except OSError:
            if not auto_find_port:
                raise
            continue

    if httpd is None:
        print(f"Error: Could not bind to any port in range {port}-{port+20}")
        return

    print(f"\n=========================================================================")
    print(f" [*] 5G AMF Auto-Scaling & Priority Slicing Simulation GUI Server Running")
    print(f" URL: http://localhost:{actual_port}/")
    print(f"=========================================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping simulation server...")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    port = 8050
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
