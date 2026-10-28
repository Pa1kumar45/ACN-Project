"""
AMF Worker Microservice (5G Access and Mobility Management Function)
Simulates realistic 5G control-plane registration processing:
- Simulates cryptographic authentication and NAS state storage delay (~10ms)
- Reports real-time CPU utilization and active session count
- Implements state transitions: BOOTING -> ACTIVE -> DRAINING
"""

import os
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading

AMF_ID = os.getenv("AMF_ID", "amf-1")
SERVICE_TIME_MS = float(os.getenv("SERVICE_TIME_MS", "10.0"))  # 10ms processing delay (mu = 100 req/s)
BOOT_DELAY_SEC = float(os.getenv("BOOT_DELAY_SEC", "5.0"))      # simulated container initialization

state = {
    "status": "BOOTING",
    "boot_start": time.time(),
    "active_sessions": 0,
    "total_processed": 0,
    "cpu_utilization": 5.0
}

def check_boot():
    time.sleep(BOOT_DELAY_SEC)
    state["status"] = "ACTIVE"
    print(f"[*] {AMF_ID} container initialization complete. State: ACTIVE")

threading.Thread(target=check_boot, daemon=True).start()

class AMFWorkerHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, data: dict):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "amf_id": AMF_ID,
                "status": state["status"],
                "active_sessions": state["active_sessions"],
                "total_processed": state["total_processed"],
                "cpu_util": state["cpu_utilization"]
            })
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        if self.path == "/api/v1/ue/register":
            if state["status"] == "BOOTING":
                self._send_json(503, {"error": "AMF Still Booting", "amf_id": AMF_ID})
                return
            if state["status"] == "DRAINING":
                self._send_json(410, {"error": "AMF Draining (No new sessions)", "amf_id": AMF_ID})
                return

            slice_type = self.headers.get("X-5G-Slice", "0")
            imsi = self.headers.get("X-UE-IMSI", "unknown")

            # Simulate CPU workload / processing time
            state["active_sessions"] += 1
            t_start = time.perf_counter()

            # Burn a tiny amount of real CPU cycles to simulate 5G cryptographic auth
            end_t = time.perf_counter() + (SERVICE_TIME_MS / 1000.0)
            while time.perf_counter() < end_t:
                _ = 3.14159 * 2.71828

            processing_ms = (time.perf_counter() - t_start) * 1000.0
            state["active_sessions"] -= 1
            state["total_processed"] += 1

            self._send_json(200, {
                "status": "SUCCESS",
                "amf_id": AMF_ID,
                "imsi": imsi,
                "slice": int(slice_type),
                "processing_ms": round(processing_ms, 2)
            })

        elif self.path == "/drain":
            state["status"] = "DRAINING"
            self._send_json(200, {"status": "DRAINING", "amf_id": AMF_ID})
        else:
            self._send_json(404, {"error": "Not Found"})

    def log_message(self, format, *args):
        pass  # Suppress default noisy access logs

def run(port: int = 8000):
    server = HTTPServer(("0.0.0.0", port), AMFWorkerHandler)
    print(f"[*] AMF Worker {AMF_ID} listening on port {port}...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    run(port)
