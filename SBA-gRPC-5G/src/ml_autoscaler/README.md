# 5G SBA Control-Plane LSTM Predictive Auto-Scaler

## 📌 Overview
This module implements **Objective 2** of the project: **LSTM-Based Predictive Auto-Scaling for Replicated 5G Core Network Functions**, extending the research paper:
> *Dev, Bera and Tiwari, "Control-Plane Load Balancing and Auto-Scaling in 5G and Beyond Networks", ICOIN 2025 (ScaleLB)*.

### The Problem Addressed
In ScaleLB, auto-scaling is reactive or strictly threshold-based:
$$\text{Scaling Condition: } \frac{B}{A \times \alpha} \ge \gamma \quad \text{or} \quad \frac{B}{A \times \alpha} > 1.0$$
Because an AMF container in Kubernetes / Docker takes **~40 seconds to spin up**, scaling *after* a traffic surge arrives causes signaling messages to backlog, driving URLLC latency from $<5\text{ ms}$ up to $>45\text{ ms}$ (ScaleLB Fig. 5).

### Our Solution
1. **Time-Series Forecaster (`lstm_forecaster.py`):**
   - Ingests the past 60 seconds of control-plane request arrival rates.
   - Predicts traffic volume $45\text{ to }60\text{ seconds}$ ahead ($H \ge 45\text{s} > \text{boot lag}$).
2. **Predictive Auto-Scaler (`autoscaler.py`):**
   - Applies the mathematical scaling formula:
     $$N = \left\lceil \frac{f \times (1 + m)}{\mu \times \gamma} \right\rceil$$
     where:
     - $f$ = Predicted request rate at $t + H$
     - $m$ = Safety margin ($10\%$)
     - $\mu$ = Capacity per AMF instance ($100\text{ req/s}$)
     - $\gamma$ = Target utilization factor ($0.80$)
     - $N$ = Target active AMF count
   - When $N > \text{active AMFs}$, the boot signal is sent **immediately**, so the new AMF is fully operational the exact second the surge arrives!
3. **Benchmark Comparison (`baselines.py` & `benchmark_evaluation.py`):**
   - Evaluates performance against:
     - **ScaleLB Reactive / Threshold**
     - **EWMA**
     - **ARIMA**
     - **Random Forest**

---

## 🚀 Running the Microservice

### 1. Launch the REST API
```bash
python server.py
# Listens on http://0.0.0.0:8080
```

### 2. Available Endpoints
- `GET /predict`: Returns the current forecast, target AMF count, and proactive scaling decision.
- `POST /metrics`: Accepts incoming telemetry (`{"rps": 120.5}`).
- `GET /status`: Pool health, capacity, active vs booting AMF instances.
- `GET /evaluate`: Runs an automated benchmark comparing LSTM vs baselines.

### 3. Run Benchmark CLI
```bash
python benchmark_evaluation.py
```
