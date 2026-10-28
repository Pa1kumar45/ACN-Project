# Implementation Plan: Containerized 5G AMF Predictive Auto-Scaler & Slice-Aware Load Balancer
**Course:** Advanced Computer Networks (ACN), Dept. of IT, NITK Surathkal  
**Project:** Predictive and Slice-Aware Load Balancing and Auto-Scaling of AMFs in 5G Core  
**Authors:** Jaivant Kosaraju (231IT028), Paluru Pavan Kumar (231IT046), Paluvadi Dinesh Manideep (231IT047)  

---

## 1. Executive Strategy: Why Avoid the Full 3GPP Network Stack?

### The Problem with Full 3GPP Stacks (Open5GS / free5GC)
* Requires raw Linux kernel SCTP modules, GTP-U tunnel interfaces (`/dev/net/tun`), MongoDB/MySQL user authentication schemas, and cryptographic SIM card algorithms (Milenage/XRES).
* Extremely fragile: simulated base stations (`UERANSIM`) crash if a single SCTP heartbeat is dropped during container scaling.
* Cannot easily scale to 5–10 AMFs on a single laptop due to RAM/CPU exhaustion.

### The Realistic Architecture: Real Container Microservices Architecture
Instead of debugging cellular radio protocol headers, we implement a **True Containerized 5G Control-Plane Emulation**:
1. **Real Docker Containers:** Network functions run as real Linux containers inside a Docker network (`5g-net`).
2. **Real Network Protocol:** Fast gRPC or HTTP/REST carrying 5G control-plane payloads with 3GPP **S-NSSAI slice headers** (URLLC, eMBB, mMTC).
3. **Real Container Lifecycle:** Real `docker run` / `docker compose scale amf=N` triggered dynamically via the **Docker Engine API** (`/var/run/docker.sock`).
4. **Real 40-Second Boot Delay:** New AMF containers experience real startup initialization latency, allowing you to visually observe the cold-start lag and how the LSTM eliminates it.

---

## 2. System Architecture & Container Topology

```
                       ┌──────────────────────────────────────────┐
                       │          ran-traffic-generator           │
                       │   Generates 5G Control Requests λ(t)     │
                       │   Tag: S-NSSAI (URLLC, eMBB, mMTC)       │
                       └────────────────────┬─────────────────────┘
                                            │ HTTP / gRPC
                                            ▼
                       ┌──────────────────────────────────────────┐
                       │           5g-smart-loadbalancer          │
                       │   1. S-NSSAI Slice Classifier            │
                       │   2. Priority Queues (URLLC Fast Lane)   │
                       │   3. mMTC Token-Bucket Throttler (>80%)  │
                       │   4. Round-Robin / Least-Loaded Dispatch │
                       └───────────┬──────────────────┬───────────┘
               Telemetric          │                  │ Real Requests
               Stream              ▼                  ▼
┌─────────────────────────┐  ┌───────────┐      ┌───────────┐      ┌───────────┐
│     lstm-autoscaler     │  │ amf-worker│      │ amf-worker│      │ amf-worker│
│  • Reads sliding window │  │   (AMF-1) │      │   (AMF-2) │      │   (AMF-N) │
│  • Forecasts λ̂(t+45s)   │  │   Active  │      │   Active  │      │  Booting  │
│  • Docker Engine API    │  └───────────┘      └───────────┘      └───────────┘
│    scale amf=N          │
└────────────┬────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      REAL-TIME GUI MONITORING DASHBOARD                │
│   • Live Docker Container Status (Booting progress, CPU, Active AMFs)  │
│   • Real-Time LSTM Forecast Curve vs Actual Arrival Rate               │
│   • URLLC vs mMTC Latency Gauges (<5ms SLA Indicator)                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Microservice Specifications

### Container 1: `amf-worker` (Horizontal AMF Replicas)
* **Role:** Represents an individual AMF instance.
* **Technology:** Python FastAPI or Go microservice.
* **Behavior:**
  * When launched, it simulates the container boot sequence: registers with Load Balancer, loads state.
  * Handles `/auth`, `/register`, `/session` requests.
  * Simulates CPU service delay $\mu \approx 10\text{ ms}$ ($100\text{ req/s}$ capacity).
  * Reports its current CPU load and active connection count via health probes (`/health`).
  * Supports graceful shutdown when entering `DRAINING` state.

### Container 2: `5g-smart-loadbalancer` (ScaleLB Extension)
* **Role:** Reverse proxy sitting between the simulated RAN and AMF worker pool.
* **Behavior:**
  * Inspects `X-5G-Slice` header:
    * `URLLC` (Slice 1): **Bypasses all queues** and immediately routes to the lowest-CPU active AMF.
    * `eMBB` (Slice 0): Standard FIFO queue.
    * `mMTC` (Slice 2): Buffered queue. If cluster CPU $>80\%$, rate-limits release via token bucket with aging.
  * Emits second-by-second request arrival telemetry to the auto-scaler.

### Container 3: `lstm-autoscaler` (Controller & Docker Socket Agent)
* **Role:** The brain that eliminates the 40s cold-start lag.
* **Behavior:**
  * Mounts `/var/run/docker.sock` to gain control of the host Docker daemon.
  * Ingests request telemetry from the Load Balancer into a 60s sliding window.
  * Runs the **LSTM Forecaster** predicting load at $t + 45\text{ s}$ ($H \ge T_{boot} + \Delta$).
  * Applies the scaling formula:
    $$N(t) = \left\lceil \frac{\hat{\lambda}(t + H)(1 + m)}{\mu \gamma} \right\rceil$$
  * When $N(t) > \text{active} + \text{booting}$, executes the Docker scale command:
    `client.services.get("amf-worker").scale(N)` or `docker compose up --scale amf-worker=N -d`
  * When forecast drops below $40\%$ utilization for a sustained period, sets target instances to `DRAINING` before stopping them (hysteresis).

### Container 4: `ran-traffic-generator`
* **Role:** Generates synthetic UE traffic.
* **Behavior:**
  * Plays back the 5 structured traces: Flash Crowd (mMTC storm), Diurnal, Ramp, Markov-Poisson, or Uniform.
  * Tags requests with random IMSI and slice ratios: $10\%$ URLLC, $20\%$ eMBB, $70\%$ mMTC.

### Container 5: `gui-dashboard` (Visual Web Interface)
* **Role:** Visualizes the entire live system.
* **Behavior:**
  * Queries `docker.sock` to display actual container status (names, memory, CPU, state: Booting, Active, Exited).
  * Shows real-time Chart.js graphs of:
    1. LSTM Prediction ($\hat{\lambda}(t+45\text{s})$) vs Incoming Load ($\lambda(t)$).
    2. Container scale-up events (exact seconds where Docker created new containers).
    3. Per-slice latencies (verifying URLLC $<5\text{ ms}$).

---

## 4. Phase-by-Phase Implementation Roadmap

### Phase 1: Build the AMF Worker Container
Create a lightweight container simulating 5G registration processing:
```python
# amf_worker.py
import time, os
from fastapi import FastAPI, Header

app = FastAPI()
AMF_ID = os.getenv("AMF_ID", "amf-1")

@app.post("/api/v1/ue/register")
def register(x_slice_type: int = Header(default=0)):
    # Simulate cryptographic 5G auth / NAS processing (10ms)
    time.sleep(0.010)
    return {"status": "SUCCESS", "amf_id": AMF_ID, "slice": x_slice_type}

@app.get("/health")
def health():
    return {"status": "ACTIVE", "amf_id": AMF_ID}
```

### Phase 2: Build the Slice-Aware Load Balancer
A reverse proxy in Python (or Go) with priority lanes:
```python
# load_balancer.py
import queue, time
from fastapi import FastAPI, Header, Response
import httpx

app = FastAPI()
urllc_queue = queue.Queue()
embb_queue = queue.Queue()
mmtc_queue = queue.Queue()

# Active AMF discovery pool
ACTIVE_AMFS = ["http://amf-1:8000"]

@app.post("/dispatch")
async def dispatch(x_slice: int = Header(default=0)):
    # URLLC: Instant bypass
    if x_slice == 1:
        target = select_least_loaded_amf()
        async with httpx.AsyncClient() as client:
            return (await client.post(f"{target}/api/v1/ue/register", headers={"x-slice-type": "1"})).json()

    # mMTC: Check CPU, buffer if > 80%
    if x_slice == 2 and get_cluster_cpu() > 80.0:
        apply_token_bucket_delay()

    target = select_least_loaded_amf()
    async with httpx.AsyncClient() as client:
        return (await client.post(f"{target}/api/v1/ue/register", headers={"x-slice-type": str(x_slice)})).json()
```

### Phase 3: Build the LSTM Auto-Scaler Docker Agent
Controls Docker containers in real time:
```python
# autoscaler_daemon.py
import docker, time, math
from lstm_forecaster import LSTMForecaster

client = docker.from_env()
forecaster = LSTMForecaster(window_size=60, horizon=45)
history = []

while True:
    current_rps = fetch_current_rps_from_lb()
    history.append(current_rps)
    
    # Run LSTM forecast 45s ahead
    pred_rps = forecaster.predict(history[-60:])
    target_n = math.ceil((pred_rps * 1.10) / (100.0 * 0.80))
    target_n = max(1, min(6, target_n))

    # Scale real Docker containers!
    current_containers = len(client.containers.list(filters={"name": "amf-worker"}))
    if target_n > current_containers:
        print(f"[LSTM PREDICTOR] Surge predicted in 45s! Scaling AMF containers from {current_containers} to {target_n}")
        # Scale via Docker Compose or Docker API
        os.system(f"docker compose up --scale amf-worker={target_n} -d --no-recreate")
        
    time.sleep(1)
```

### Phase 4: `docker-compose.yml` (The Complete Deployment)
```yaml
version: '3.8'

services:
  loadbalancer:
    build: ./services/loadbalancer
    ports:
      - "8383:8383"
    networks:
      - 5g-net

  amf-worker:
    build: ./services/amf_worker
    deploy:
      replicas: 1
    networks:
      - 5g-net

  autoscaler:
    build: ./services/autoscaler
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - 5g-net

  gui-dashboard:
    build: ./services/gui
    ports:
      - "8050:8050"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - 5g-net

networks:
  5g-net:
    driver: bridge
```

---

## 5. What This Gives You in Your Final Presentation & Viva

1. **Live Demonstration:**
   * Open the GUI on your screen.
   * Click **"Inject Flash Crowd"**.
   * The audience sees the **LSTM graph detect the slope and predict the 320 req/s surge 45s early**.
   * Open a side terminal with `docker ps`: they watch **`amf-worker-2`, `amf-worker-3`, and `amf-worker-4` containers actively start up and transition to healthy before the traffic wave hits**!
   * The URLLC latency gauge remains firmly under $5\text{ ms}$, while baseline comparison spikes to $400\text{ ms}$.
2. **Zero Fragility:** No broken SCTP kernel modules, no crashed databases, no simulator limitations—just clean, reliable, modern cloud-native container architecture.
