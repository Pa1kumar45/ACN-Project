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

## 1. Executive Summary

In 5G Service-Based Architecture (SBA), the **Access and Mobility Management Function (AMF)** is the primary entry point for control-plane signaling. It terminates the N2 interface from base stations (gNodeBs) and N1 Non-Access Stratum (NAS) signaling from User Equipments (UEs). 

Under sudden surges of IoT registrations (mMTC flash crowds), AMF processing capacity saturates, triggering severe queue backlogs. Recent state-of-the-art approaches like **ScaleLB** (*Dev et al., IEEE ICOIN 2025*) attempt to solve this via reactive threshold heuristics. However, ScaleLB suffers from two fundamental weaknesses:
1. **The 40-Second Cold-Start Lag:** Spinning up containerized AMFs requires $T_{\text{boot}} \approx 40\text{ s}$. Because ScaleLB is reactive, queues build up during the 40s boot delay, driving latency to $>330\text{ ms}$.
2. **Slice-Agnostic Single FIFO Queue:** ScaleLB channels all traffic through a single shared queue. Under an IoT storm, mission-critical Ultra-Reliable Low-Latency Communication (URLLC) packets are trapped behind millions of delay-tolerant sensor packets, severely violating the 3GPP sub-5ms SLA.

This project implements a complete solution to these two challenges:
* **S-NSSAI Slice-Aware Multi-Tier Priority Queuing (O1):** Non-blocking zero-queue bypass for URLLC signaling ($<5\text{ ms}$ guaranteed) and adaptive token-bucket throttling with aging for mMTC traffic.
* **LSTM Lookahead Predictive Auto-Scaling (O2):** Deep sequence forecasting with a 45-second prediction horizon ($H = 45\text{ s} \ge T_{\text{boot}} = 40\text{ s}$) that pre-provisions AMFs before traffic arrives, completely eliminating the cold-start delay.

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
        AMF3["AMF-3\n(Pre-Warmed, mu = 100 req/s)"]
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
    RULE -.->|Pre-warm Container 45s Ahead| AMF_POOL
```

---

## 3. Mathematical Formulation & Core Algorithms

### 3.1. Slice-Aware Priority Queuing (O1)
Every incoming request carries an S-NSSAI header consisting of Slice/Service Type (SST):
* **URLLC (SST = 1):** Bypasses shared queue buffers ($W_q = 0\text{ ms}$). Dispatched directly to the lowest-loaded active AMF:
  $$\text{Target AMF} = \arg\min_{i \in \mathcal{A}_{\text{active}}} \text{CPU}_i(t)$$
  Active AMFs maintain 10--15% capacity headroom exclusively for URLLC.
* **eMBB (SST = 0):** Standard FIFO queue for high-throughput mobile traffic.
* **mMTC (SST = 2):** When cluster CPU utilization exceeds $\gamma = 0.80$, token bucket limits mMTC release rate:
  $$R_{\text{mMTC}}(t) = \max\Big(0.10 \cdot C(t), \, C(t) \cdot (1 - \text{CPU}(t))\Big)$$
  To avoid starvation, waiting packets accumulate priority via the aging formula:
  $$P_i(t) = P_{\text{base}} + \omega_{\text{age}} \cdot (t - t_{\text{arrive}, i})$$

### 3.2. LSTM Lookahead Predictive Auto-Scaling (O2)
* **Observation Window:** Sliding 60-second vector $\mathbf{w}_t = [\lambda(t-59), \dots, \lambda(t)] \in \mathbb{R}^{60}$.
* **Lookahead Horizon:** $H = 45\text{ s} \ge T_{\text{boot}} = 40\text{ s}$ (ensures newly ordered AMFs finish booting *before* the surge peak arrives).
* **Target Capacity Formula:**
  $$N^*(t) = \left\lceil \frac{\hat{\lambda}(t + H) \cdot (1 + m)}{\mu \cdot \gamma} \right\rceil$$
  Where:
  * $\mu = 100\text{ req/s}$ (service capacity per AMF instance)
  * $\gamma = 0.80$ (target CPU utilization threshold)
  * $m = 0.10$ (10% safety margin factor)
* **Scale-In Hysteresis:** 30-second cooldown window to prevent container thrashing, combined with graceful connection draining.

---

## 4. Key Experimental Results

Evaluated against the ScaleLB Figure 5 flash crowd surge ($35 \to 320\text{ req/s}$, 10% URLLC, 20% eMBB, 70% mMTC):

| Scaling Configuration | Cold-Start Lag (s) | URLLC p99 Latency (ms) | mMTC p99 Latency (ms) | URLLC SLA (< 5.0ms) | AMF-seconds (Resource Cost) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **ScaleLB Reactive** *(ICOIN 2025)* | 54 s | 338.7 ms | 339.3 ms | **FAIL (25.8% violation)** | 647 |
| **ScaleLB Proactive** *($\gamma = 0.80$)* | 55 s | 334.1 ms | 336.5 ms | **FAIL (25.8% violation)** | 649 |
| **Warm Standby** *(1 permanent spare)* | 0 s | 32.9 ms | 32.7 ms | **PASS** | 1024 |
| **O1 Only:** Slice Priority Queue | 54 s | 11.1 ms | 508.6 ms | **PASS** | 647 |
| **O2 Only:** LSTM Prediction | 40 s | 333.1 ms | 336.5 ms | **FAIL (18.3% violation)** | 807 |
| **Proposed Full System (O1 + O2)** | **0 s** | **3.15 ms** | **499.9 ms** | **PASS (0.0% violation)** | **807** |

### Key Takeaways:
1. **Cold-Start Elimination:** LSTM pre-warming eliminates the 54-second overload period of ScaleLB.
2. **URLLC Protection:** Priority queuing guarantees URLLC latency of **3.15 ms**, fully compliant with 3GPP standards.
3. **Resource Efficiency:** The proposed system uses **21.2% fewer AMF-seconds** than Warm Standby (807 vs 1024 AMF-s).

---

## 5. Repository Structure & Deliverables

```
├── ACN_Final_Report.tex         # Complete Final Report in IEEE Conference format (LaTeX)
├── presentation.tex             # 14-Slide End Presentation in LaTeX Beamer
├── presentation.pdf             # Compiled LaTeX Beamer Presentation PDF
├── figures/                     # Vector diagrams and platform screenshots
│   ├── platform_dashboard.png   # Real-time traffic demand & LSTM lookahead dashboard
│   ├── amf_container_fleet.png  # AMF worker container fleet lifecycle visualizer
│   └── latency_isolation.png    # Per-slice latency isolation and 3GPP SLA verification
├── run_midreport_comparison.py  # Standalone terminal verification script (zero dependencies)
├── container_5g_pipeline/       # Production microservice & interactive dashboard
│   ├── dashboard/               # Clean academic web interface (port 8090)
│   ├── dataset/                 # 5G traffic traces (flash crowd, diurnal, linear ramp)
│   ├── services/                # AMF worker, load balancer, autoscaler, traffic replayer
│   ├── docker-compose.yml       # Docker Compose orchestration
│   └── run_pipeline.py          # Dashboard launcher script
└── README.md                    # Master documentation
```

---

## 6. How to Build & Run

### A. Compile the LaTeX Report (IEEE Conference Format)
You can compile locally with `pdflatex` or upload [`ACN_Final_Report.tex`](file:///home/dinesh/Desktop/course_projects/ACN_project/ACN-Project/ACN_Final_Report.tex) directly to [Overleaf](https://www.overleaf.com):
```bash
pdflatex ACN_Final_Report.tex
```

### B. Compile the LaTeX Beamer Presentation
Compile the 14-slide presentation deck directly:
```bash
pdflatex presentation.tex
```
The output is saved as [`presentation.pdf`](file:///home/dinesh/Desktop/course_projects/ACN_project/ACN-Project/presentation.pdf).

### C. Run the Interactive Web Dashboard
Run the dashboard server with zero external dependencies:
```bash
python container_5g_pipeline/run_pipeline.py
```
Open **`http://localhost:8090`** in your browser to inspect the real-time dataset replay, 45-second LSTM lookahead, and live AMF container scaling.

### D. Run the Benchmark Verification Script
Execute the terminal benchmark across all 6 configurations and all 3 traffic traces:
```bash
python run_midreport_comparison.py
```
