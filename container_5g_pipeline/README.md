# Containerized 5G AMF Auto-Scaling & Priority Slicing Pipeline

**Course:** Advanced Computer Networks (ACN), Dept of IT, NITK Surathkal  
**Project:** Predictive and Slice-Aware Load Balancing and Auto-Scaling of AMFs in 5G Core  
**Authors:** Jaivant Kosaraju (231IT028), Paluru Pavan Kumar (231IT046), Paluvadi Dinesh Manideep (231IT047)  

---

## 📌 Architecture Overview

This directory provides the complete, decoupled **Synthetic Dataset + Microservices Container Pipeline**:
1. **Synthetic 5G Control-Plane Dataset (`dataset/`):** Generates standardized CSV traces with exact 5G slice breakdowns (URLLC, eMBB, mMTC).
2. **Offline ML Benchmarking (`dataset/train_forecasters.py`):** Trains the LSTM forecaster against EWMA, ARIMA, and Random Forest, evaluating MAPE (%) and RMSE.
3. **Container Microservices (`services/`):**
   - `amf_worker/`: AMF container simulating ~10ms processing delay.
   - `load_balancer/`: Reverse proxy with URLLC fast-lane bypass, eMBB FIFO, mMTC token-bucket throttler, and consistent session hashing.
   - `autoscaler/`: LSTM daemon controlling the Docker daemon (`/var/run/docker.sock`) to scale AMF containers 45s ahead of surges.
   - `traffic_replayer/`: Replays dataset rows as real network packets into the Load Balancer.
4. **Visual Dashboard (`dashboard/`):** Web GUI on port **8090** displaying the Ground-Truth dataset curve, live LSTM prediction, container scaling events, and URLLC/mMTC latency gauges.

---

## 🚀 How to Run

### Step 1: Run the Pipeline & Dashboard
```powershell
cd "c:\Users\jaiva\Projects\ACN-Project\container_5g_pipeline"
python run_pipeline.py
```
This will:
1. Verify synthetic datasets (`dataset/*.csv`).
2. Train and benchmark the forecasting models.
3. Start the Dashboard at **`http://localhost:8090/`** and automatically open your browser.

---

### Step 2: (Optional) Run with Docker Compose
If you have Docker Desktop running:
```powershell
docker compose up -d
```
This boots the `5g-smart-loadbalancer`, `amf-worker-1`, `5g-lstm-autoscaler`, and `5g-traffic-replayer` containers inside the Docker bridge network `5g-net`.

---

## 📁 Directory Structure

```
container_5g_pipeline/
│
├── run_pipeline.py             <-- One-click runner
├── docker-compose.yml          <-- Multi-container orchestrator
│
├── dataset/                    <-- Stage 1: Synthetic Dataset & Model Benchmarks
│   ├── generate_dataset.py     <-- Generates CSV traces
│   ├── train_forecasters.py    <-- Evaluates LSTM, EWMA, ARIMA, RF
│   ├── flash_crowd_surge.csv   <-- ScaleLB Fig 5 surge trace
│   ├── diurnal_cycle.csv       <-- Diurnal sinusoid trace
│   ├── linear_ramp.csv         <-- Linear growth trace
│   └── models_evaluation.json  <-- Saved benchmark results
│
├── services/                   <-- Stage 2: Container Microservices
│   ├── amf_worker/             <-- AMF replica (app.py + Dockerfile)
│   ├── load_balancer/          <-- S-NSSAI priority proxy (app.py + Dockerfile)
│   ├── autoscaler/             <-- LSTM Docker controller (daemon.py + Dockerfile)
│   └── traffic_replayer/       <-- Dataset packet replayer (replayer.py + Dockerfile)
│
└── dashboard/                  <-- Stage 3: Visual Web Dashboard (Port 8090)
    ├── server.py               <-- Backend REST server
    └── static/
        ├── index.html          <-- UI markup
        ├── styles.css          <-- Dark theme glassmorphism design
        └── app.js              <-- Chart.js & live status poller
```
