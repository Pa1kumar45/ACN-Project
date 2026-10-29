# Predictive and Slice-Aware Load Balancing and Auto-Scaling for 5G Core AMFs

### Academic Context
* **Course:** Advanced Computer Networks (ACN)
* **Department:** Department of Information Technology
* **Institution:** National Institute of Technology Karnataka (NITK), Surathkal
* **Team Members:**
  * **Jaivant Kosaraju** — Reg No: `231IT028`
  * **Paluru Pavan Kumar** — Reg No: `231IT046`
  * **Paluvadi Dinesh Manideep** — Reg No: `231IT047`

---

## 1. About the Project

In 5G Service-Based Architecture (SBA), the **Access and Mobility Management Function (AMF)** handles control-plane signaling (N1 Non-Access Stratum and N2 reference points). Under massive surges of IoT registrations (mMTC flash crowds), conventional setups experience severe performance degradation due to two fundamental architectural bottlenecks:

1. **The 40-Second Cold-Start Lag:** Reactive threshold autoscaling (such as *ScaleLB*, IEEE ICOIN 2025) triggers scaling only after servers are already overloaded. New container instances require a 40-second boot delay ($T_{\text{boot}} = 40\text{ s}$), during which incoming requests accumulate in queues and drive latency above 330 ms.
2. **Head-of-Line Blocking (Single Shared FIFO Queue):** Standard round-robin dispatchers route all slices through a single FIFO buffer. Mission-critical **URLLC** messages are trapped behind millions of delay-tolerant **mMTC** packets, causing massive violations of the 3GPP sub-5ms latency SLA.

### Proposed Solution
* **S-NSSAI Multi-Tier Priority Queuing (O1):** Non-blocking fast-path bypass for URLLC signaling ($< 5\text{ ms}$ guaranteed) combined with adaptive token-bucket rate limiting and aging for mMTC traffic.
* **LSTM Predictive Auto-Scaling (O2):** Sequence-to-sequence forecaster with a 45-second prediction horizon ($H = 45\text{ s} \ge T_{\text{boot}} = 40\text{ s}$) that pre-provisions AMF container replicas *before* the traffic peak arrives, completely eliminating the cold-start delay.

---

## 2. System Architecture

```mermaid
flowchart TD
    subgraph RAN["5G Radio Access Network (UEs & gNodeBs)"]
        U1["URLLC Slices (SST = 1)"]
        U2["eMBB Slices (SST = 0)"]
        U3["mMTC Slices (SST = 2)"]
    end

    subgraph LB["Ingress Smart Load Balancer"]
        CL["S-NSSAI Slice Classifier"]
        Q1["URLLC Fast Path\n(0ms Bypass / Headroom Reservation)"]
        Q2["eMBB Standard Queue\n(FIFO Buffer)"]
        Q3["mMTC Token Bucket\n(Rate-Limited >80% CPU + Aging)"]
        DISP["Least-Loaded AMF Dispatcher\n(min CPU)"]
    end

    subgraph AMF_POOL["5G Core AMF Container Fleet"]
        AMF1["AMF-1\n(Active, mu = 100 req/s)"]
        AMF2["AMF-2\n(Active, mu = 100 req/s)"]
        AMF3["AMF-N\n(Scaled on Demand, mu = 100 req/s)"]
    end

    subgraph AUTOSCALER["Predictive Autoscaling Controller"]
        LSTM["LSTM Time-Series Forecaster\n(Window W = 60s, Horizon H = 45s)"]
        RULE["Dimensioning Formula\nN*(t) = ceil( lambda_hat * (1+m) / (mu * gamma) )"]
    end

    U1 -->|N1/N2 NAS| CL
    U2 -->|N1/N2 NAS| CL
    U3 -->|N1/N2 NAS| CL

    CL -->|SST = 1| Q1
    CL -->|SST = 0| Q2
    CL -->|SST = 2| Q3

    Q1 --> DISP
    Q2 --> DISP
    Q3 --> DISP

    DISP --> AMF1
    DISP --> AMF2
    DISP --> AMF3

    CL -.->|Telemetry lambda(t)| LSTM
    LSTM --> RULE
    RULE -.->|Scale AMF Containers 45s Ahead| AMF_POOL
```

---

## 3. Mathematical Formulation & Core Algorithms

### 3.1. Slice-Aware Multi-Tier Priority Queuing (O1)
Every control-plane request carries a 3GPP **S-NSSAI** header with Slice/Service Type (SST):
* **URLLC (SST = 1):** Bypasses all shared queue buffers ($W_q = 0\text{ ms}$). Dispatched directly to the lowest-loaded active AMF instance:
  $$\text{Target AMF} = \arg\min_{i \in \mathcal{A}_{\text{active}}} \text{CPU}_i(t)$$
  Active AMFs reserve a 10--15% capacity headroom exclusively for non-blocking URLLC ingress.
* **eMBB (SST = 0):** Standard FIFO queue for normal mobile broadband signaling.
* **mMTC (SST = 2):** When cluster CPU utilization exceeds $\gamma = 0.80$, release rate is throttled by a token bucket:
  $$R_{\text{mMTC}}(t) = \max\Big(0.10 \cdot C(t), \, C(t) \cdot (1 - \text{CPU}(t))\Big)$$
  To avoid indefinite starvation during prolonged surges, packets accumulate priority via dynamic aging:
  $$P_i(t) = P_{\text{base}} + \omega_{\text{age}} \cdot (t - t_{\text{arrive}, i})$$

### 3.2. LSTM Lookahead Predictive Auto-Scaling (O2)
* **Observation Window:** Sliding 60-second historical traffic vector $\mathbf{w}_t = [\lambda(t-59), \dots, \lambda(t)] \in \mathbb{R}^{60}$.
* **Lookahead Condition:** Lookahead horizon $H = 45\text{ s} \ge T_{\text{boot}} = 40\text{ s}$ ensures newly ordered AMF containers finish their boot sequence *before* the traffic surge peak arrives.
* **Target AMF Dimensioning Formula:**
  $$N^*(t) = \left\lceil \frac{\hat{\lambda}(t + H) \cdot (1 + m)}{\mu \cdot \gamma} \right\rceil$$
  Where:
  * $\hat{\lambda}(t + H)$ = LSTM forecast arrival rate at $t + 45\text{ s}$
  * $\mu = 100\text{ req/s}$ = AMF service capacity (mean cryptographic auth service time $T_s = 10\text{ ms}$)
  * $\gamma = 0.80$ = Target CPU utilization threshold (80%)
  * $m = 0.10$ = Safety margin factor (10%)
* **Scale-In Hysteresis:** 30-second cooldown window to prevent container thrashing when traffic fluctuates.

---

## 4. Commands to Run

### A. Run the Interactive Web Dashboard (Simulation Mode)
Launches the full interactive web dashboard with zero external dependencies (no Docker required):
```bash
python container_5g_pipeline/run_pipeline.py
```
* Opens automatically in your browser at **`http://localhost:8090`**.
* Interactive trace replay across 3 workload patterns: Flash Crowd Surge, Diurnal Cycle, Linear Ramp.
* Policy toggles: **Proposed (LSTM + Slicing)**, **Baseline (ScaleLB FIFO)**, and **Comparison Overlay**.
* Live per-slice latency curves (URLLC, eMBB, mMTC) and AMF container fleet lifecycle cards.

---

### B. Run with Live Docker Containers
To dynamically spawn and scale real Linux containers visible in `docker ps`:
```bash
# 1. Start the Docker service on your machine
sudo systemctl start docker

# 2. Launch the pipeline with Docker integration enabled
python container_5g_pipeline/run_pipeline.py --docker
```
* Starts with 1 base AMF worker container (`amf-worker-1`).
* Click **Run** on the dashboard: as the surge approaches ($t \approx 30\text{s}$), the LSTM forecaster anticipates load 45s ahead and scales Docker to `amf-worker-2`, `3`, `4`, `5`.
* Run `docker ps` in another terminal to watch the containers actively spin up in real time.
* Click **Reset** on the dashboard to scale back to 1 AMF container.

---

### C. Run the Terminal Benchmark
Executes a standalone benchmark comparing ScaleLB Baseline vs Proposed Framework across all 3 traffic traces:
```bash
python run_midreport_comparison.py
```

---

## 5. Key Performance Summary

Evaluated on the ScaleLB Figure 5 flash crowd surge ($35 \to 320\text{ req/s}$):

| Metric | ScaleLB Baseline (Reactive + FIFO) | Proposed Framework (O1 + O2) | 3GPP Target |
| :--- | :---: | :---: | :---: |
| **URLLC p99 Latency** | **338.7 ms (Queue Overload)** | **3.40 ms** | **< 5.0 ms (SLA PASS)** |
| **eMBB Mean Latency** | 119.8 ms | **11.35 ms** | Sub-20 ms |
| **mMTC Mean Latency** | 125.1 ms | **14.00 ms** | Delay Tolerant |
| **Container Cold-Start Lag** | 54 seconds | **0 seconds (Pre-Warmed)** | 0 s |
| **3GPP sub-5ms SLA Verdict** | **FAIL (25.8% Violation)** | **PASS (100% Compliant)** | PASS |

