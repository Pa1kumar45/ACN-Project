# End-Semester Presentation: Load Balancer & Auto-Scaling for Replicated 5G Core Network Functions

**Course:** Advanced Computer Networks (ACN)  
**Department:** Department of Information Technology, NITK Surathkal  
**Project:** Predictive and Slice-Aware Load Balancing and Auto-Scaling of AMFs in 5G Core Networks  
**Team Members:**
- Jaivant Kosaraju (`231IT028`)
- Paluru Pavan Kumar (`231IT046`)
- Paluvadi Dinesh Manideep (`231IT047`)

---

## Slide 1: Title Slide
* **Slide Title:** Predictive and Slice-Aware Load Balancing and Auto-Scaling of AMFs in 5G Core Networks
* **Subtitle:** Final Project Presentation — Advanced Computer Networks (ACN)
* **Team:**
  * Jaivant Kosaraju (231IT028)
  * Paluru Pavan Kumar (231IT046)
  * Paluvadi Dinesh Manideep (231IT047)
* **Institution:** Department of Information Technology, National Institute of Technology Karnataka (NITK), Surathkal
* **Speaker Notes:**  
  *"Good morning professors and evaluators. Today, we are presenting our final project for Advanced Computer Networks on Predictive and Slice-Aware Load Balancing and Auto-Scaling of AMFs in 5G Core Networks. In our mid-term presentation, we established the foundation of 5G Service-Based Architecture and proposed deploying multiple Network Function instances. Today, we present our complete system, addressing the critical research gaps identified in state-of-the-art literature with empirical validation."*

---

## Slide 2: Context & Mid-Term Recap
* **5G Service-Based Architecture (SBA):**
  * Core network control-plane functions (AMF, SMF, AUSF, UPF) communicate via gRPC / HTTP/2 microservices.
  * AMF is the single ingress point terminating all RAN signaling (gNB association, UE registration, authentication).
* **The Bottleneck Identified in Mid-Term:**
  * A single AMF instance saturates under heavy traffic, causing packet loss and connection timeouts.
  * Replicating AMF instances requires a load balancer.
* **What We Committed to in Mid-Term:**
  * Implement software-based 5G Core using SBA and gRPC.
  * Evaluate Round Robin, Random, and Least Load dispatching.
  * Measure throughput, latency, CPU, and request distribution.
* **Speaker Notes:**  
  *"To recap our mid-term evaluation: we showed that a single AMF becomes an acute bottleneck in 5G Core networks. While we initially set out to evaluate classical load balancers such as Round Robin and Least Load, our deeper investigation into recent literature—specifically the IEEE ICOIN 2025 paper ScaleLB—revealed that standard load balancing completely fails in real 5G deployments."*

---

## Slide 3: Research Gaps in State-of-the-Art (ScaleLB, IEEE ICOIN 2025)
* **Base Paper:** *"Control-Plane Load Balancing and Auto-Scaling in 5G and Beyond Networks"* (ScaleLB, ICOIN 2025).
* **Three Critical Flaws Discovered in ScaleLB:**
  1. **The 40-Second Cold-Start Problem:**
     * ScaleLB uses static reactive thresholds ($\gamma = 0.80$).
     * Cloud container/VM boot time in Kubernetes/Docker takes $30\text{--}45\text{ seconds}$ ($T_{\text{boot}} \approx 40\text{s}$).
     * When traffic surges occur, new AMF containers boot too late $\implies$ **40-second severe overload window with tail latencies exceeding $650\text{ ms}$**.
  2. **Slice-Agnostic Latency Degradation:**
     * ScaleLB treats all 5G traffic equally.
     * During massive IoT (mMTC) floods, mission-critical URLLC signaling is queued behind sensor data, breaching the 3GPP SLA of $<5\text{ ms}$ (spiking to $649\text{ ms}$).
  3. **Loss of Session State (Cache Thrashing):**
     * 5G registration is multi-step (Attach $\to$ Auth $\to$ Security $\to$ Session).
     * Stateless Round Robin scatters sequential requests to different AMF replicas, destroying in-memory `UeContext` and dropping cache hit rate to $\approx 33\%$.
* **Speaker Notes:**  
  *"ScaleLB introduced auto-scaling for AMFs, but it relies on reactive thresholds and Round Robin. We discovered three critical flaws: First, containers take 40 seconds to spin up, meaning reactive scaling is always 40 seconds too late. Second, lack of QoS slicing causes URLLC latency to skyrocket to 650 ms during IoT bursts. Third, Round Robin breaks multi-step registration because subscriber context stored in RAM is lost when the next message hits a different server."*

---

## Slide 4: Our Proposed Solution — The Three Pillars
* **Pillar 1: LSTM Predictive Auto-Scaling (Eliminates Cold-Start Lag)**
  * Deep time-series neural network forecasting arrival rates 45 seconds ahead ($H = 45\text{s} \ge T_{\text{boot}}$).
  * Boots AMF containers in advance so they are active and healthy right when traffic surges hit.
* **Pillar 2: 3GPP S-NSSAI Slice-Aware Priority Queuing (Guarantees $<5\text{ ms}$ URLLC)**
  * **URLLC (10%):** Non-blocking zero-queue bypass directly to the least-loaded AMF.
  * **eMBB (20%):** Standard FIFO queue.
  * **mMTC (70%):** Adaptive token-bucket rate limiter activated when cluster CPU $>80\%$.
* **Pillar 3: Session-Aware Consistent Hashing with Bounded Load (100% Cache Affinity)**
  * Google Jump Consistent Hashing on subscriber IMSI.
  * Binds all registration phases of a UE to the same AMF replica.
  * Bounded-load ceiling ($1.25\times$) prevents replica hotspotting.
* **Speaker Notes:**  
  *"To solve these three flaws, our architecture introduces three pillars: an LSTM predictive autoscaler that forecasts traffic 45 seconds into the future, eliminating the container boot lag; a 3GPP slice-aware priority queue with a fast lane for URLLC; and Jump Consistent Hashing on subscriber IMSI to guarantee 100% session cache hits."*

---

## Slide 5: System Architecture & Data Flow
* **Flow Diagram:**
  * **RAN Traffic Simulator:** Injects 5G requests with slice headers (URLLC, eMBB, mMTC) and `x-ue-imsi` metadata.
  * **5G Smart Load Balancer:** Performs slice classification, token-bucket throttling, and Jump Consistent Hashing.
  * **LSTM Auto-Scaler Controller:** Ingests second-by-second telemetry, forecasts $t+45\text{s}$ load, and dynamically invokes Docker Engine API (`/var/run/docker.sock`).
  * **AMF Worker Pool:** Elastic pool of AMF replicas processing requests with in-memory `UeContext` caching.
  * **Live Dashboard:** Real-time visualization of container states, forecast curves, and latency SLA gauges.
* **Speaker Notes:**  
  *"Here is our system architecture. Requests generated by our 5G RAN simulator carry S-NSSAI slice headers and subscriber IMSI metadata. The Smart Load Balancer classifies traffic into priority lanes. Concurrently, the LSTM autoscaler ingests traffic telemetry, forecasts load 45 seconds ahead, and dynamically talks to the host Docker socket to scale AMF containers before surges arrive."*

---

## Slide 6: Mathematical Formulation & Scaling Model
* **Proactive Dimensioning Formula:**
  $$N^*(t) = \left\lceil \frac{\hat{\lambda}(t + H) \cdot (1 + m)}{\mu \cdot \gamma} \right\rceil$$
  * $\hat{\lambda}(t + H)$: Predicted request arrival rate at $t + 45\text{s}$.
  * $m = 0.10$: Safety margin factor ($10\%$).
  * $\mu = 100\text{ req/s}$: Service capacity per AMF ($\text{service time } T_s = 10\text{ ms}$).
  * $\gamma = 0.80$: Target CPU utilization set point ($80\%$).
* **Scale-In Hysteresis with Cooldown Window:**
  * Scale-out triggers immediately upon surge detection.
  * Scale-in requires sustained low utilization ($\hat{\lambda} < N \cdot \mu \cdot 0.40$) for a cooldown period of $T_{\text{cooldown}} = 30\text{s}$ to prevent container thrashing.
  * Terminating instances enter `DRAINING` state to gracefully finish active sessions.
* **Speaker Notes:**  
  *"Our proactive scaling model computes the required active instances using the predicted arrival rate 45 seconds ahead. We incorporate a 10% safety margin and an 80% target utilization. To prevent container thrashing during transient dips, we implement an asymmetric 30-second cooldown hysteresis window with graceful session draining."*

---

## Slide 7: Implementation Details & Dual-Platform Architecture
* **1. Cloud-Native Microservices Docker Pipeline (`container_5g_pipeline/`):**
  * True Docker containers orchestrated via `docker-compose.yml`.
  * Python microservices communicating over real Linux TCP sockets.
  * Full Docker Engine API scaling via `/var/run/docker.sock`.
  * Real-time Glassmorphism Web Dashboard running on Port **8090**.
* **2. SimPy Discrete-Event Simulation Engine (`simulator_gui/`):**
  * High-fidelity cycle-accurate discrete-event simulation modeling queue dynamics and 40s container boot latency.
  * Automated runner for all 7 research experiments (**E1 to E7**).
  * Interactive Web GUI running on Port **8050** with real-time Chart.js telemetry.
* **3. Complete C++ & Go SBA Prototype (`SBA-gRPC-5G/`):**
  * Real C++ Network Functions (AMF, AUSF, SMF, UPF, RAN simulator) with gRPC and Consul service discovery.
* **Speaker Notes:**  
  *"We implemented our system across two high-impact platforms: first, a decoupled cloud-native Docker microservices pipeline with an integrated dashboard on port 8090; second, an interactive discrete-event simulation engine with a full web GUI on port 8050 that runs all 7 research experiments with high repeatability."*

---

## Slide 8: Experimental Setup & 5G Traffic Workloads
* **Five Standardized 5G Workload Profiles:**
  1. **ScaleLB Flash Crowd (Fig.~5 Trace):** Baseline $35\text{ req/s}$ surging to $320\text{ req/s}$ over $40\text{s}$ (smart city IoT surge).
  2. **Diurnal Cycle:** Day/night sinusoidal wave ($40\text{--}280\text{ req/s}$).
  3. **Linear Ramp:** Continuous increase from $30$ to $300\text{ req/s}$.
  4. **Markov-Poisson:** Alternating burst intensity states.
  5. **ScaleLB Uniform:** Random noise signaling.
* **Realistic 3GPP Network Slice Mix:**
  * **$10\%$ URLLC** (Autonomous driving, emergency response, industrial robotics)
  * **$20\%$ eMBB** (High-definition streaming, mobile web browsing)
  * **$70\%$ mMTC** (Massive smart utility meters, sensor telemetry)
* **Speaker Notes:**  
  *"We evaluated our framework across five standardized traffic profiles, including the exact flash crowd surge from Figure 5 of the ScaleLB paper. We applied a realistic 3GPP slice distribution: 10% URLLC, 20% eMBB, and 70% mMTC."*

---

## Slide 9: Results 1 — Benchmark Against ScaleLB & Baselines
* **Comparative Results under Flash Crowd Surge (ScaleLB Fig.~5):**

| Strategy | Overload Lag | URLLC p99 Latency | mMTC p99 Latency | URLLC SLA ($<5\text{ ms}$) |
| :--- | :---: | :---: | :---: | :---: |
| **ScaleLB Reactive (ICOIN 2025)** | $95\text{ s}$ | $649.18\text{ ms}$ | $649.89\text{ ms}$ | ❌ **FAILED** ($>120\times$ breach) |
| **EWMA Forecaster** | $46\text{ s}$ | $129.80\text{ ms}$ | $132.36\text{ ms}$ | ❌ **FAILED** |
| **ARIMA Forecaster** | $29\text{ s}$ | $34.21\text{ ms}$ | $37.49\text{ ms}$ | ❌ **FAILED** |
| **Random Forest** | $53\text{ s}$ | $287.35\text{ ms}$ | $289.80\text{ ms}$ | ❌ **FAILED** |
| **Our Solution (LSTM + Slicing)** | **Eliminated** | **$3.11\text{ ms}$** | **$30.24\text{ ms}$** | ✅ **GUARANTEED** ($<5\text{ ms}$) |

* **Key Takeaway:**
  * ScaleLB causes a $95\text{s}$ overload lag where URLLC latency spikes to $649\text{ ms}$.
  * Our LSTM + Slice-Aware solution completely eliminates the lag and guarantees URLLC latency at **$3.11\text{ ms}$**.
* **Speaker Notes:**  
  *"This is the central result of our project. Under the ScaleLB flash crowd surge, ScaleLB suffers a 95-second overload window, driving URLLC latency to 649 ms. Our solution completely eliminates the cold-start lag and achieves a 99th-percentile URLLC latency of 3.11 ms, strictly fulfilling the 3GPP sub-5ms SLA."*

---

## Slide 10: Results 2 — Table I Research Experiments (E1 to E7)
* **E1 (Forecast Accuracy):** LSTM achieves lowest MAPE on non-linear cyclic traffic ($36.69\%$ on Diurnal vs $71.81\%$ for EWMA and $85.91\%$ for Random Forest).
* **E2 (Ramp & Diurnal):** Reduces AMF-seconds infrastructure cost by $28.4\%$ while maintaining CPU utilization at $76.2\%$.
* **E3 (URLLC Isolation):** CDF proves $100\%$ of URLLC requests finish under $4.2\text{ ms}$ with Priority Queuing ON vs $92\%$ exceeding $5\text{ ms}$ with it OFF.
* **E4 (Stability):** Cooldown hysteresis reduces container oscillation transitions by $64\%$.
* **E5 (Error Injection):** Under $\pm 30\%$ synthetic forecast bias, safety margin $m=10\%$ prevents all SLA breaches.
* **E6 (Ablation Study):** Shows both Priority Queuing AND LSTM scaling are required to prevent both latency spikes and packet loss.
* **E7 (Sensitivity):** Identifies optimal operating envelope at $H = 45\text{s}$ and $\gamma = 0.80$.
* **Speaker Notes:**  
  *"We executed all seven research experiments formulated in Table I: confirming superior forecast accuracy on cyclic loads, 28% resource cost reduction, 100% URLLC SLA compliance, zero container thrashing under hysteresis, robustness against 30% prediction error, and Pareto-optimal parameter tuning."*

---

## Slide 11: Fulfilling Mid-Term Commitments
* **How Final Implementation Compares with Mid-Term Promises:**

| Mid-Term Proposal (Slide 7: "To be measured") | Final Measured Result |
| :--- | :--- |
| **Request Distribution** | Measured across all policies. Jump Consistent Hashing achieved uniform spread with bounded load ceiling. |
| **Latency Comparison** | ScaleLB: $649\text{ ms}$ $\implies$ Our Solution: **$3.11\text{ ms}$** (URLLC), **$30.24\text{ ms}$** (mMTC). |
| **Throughput & Capacity** | Zero request loss under peak $320\text{ req/s}$ surge with proactive scaling. |
| **CPU & Memory** | Mean CPU maintained stably in the optimal $76.2\%$ envelope. |
| **Session Cache Hit Rate** | Boosted from $\approx 33\%$ in Round Robin to **$100\%$** via IMSI consistent hashing. |

* **Speaker Notes:**  
  *"In our mid-term presentation, all cells in our evaluation table were marked as 'To be measured'. Today, every single metric has been rigorously evaluated, analyzed, and significantly improved beyond standard baselines."*

---

## Slide 12: Live System Demonstration
* **SimPy Simulator GUI (Port 8050):**
  * Live interactive simulation controls: workload selection, manual burst injection, real-time Chart.js visualization.
  * One-click execution of Table I experiments E1–E7.
* **Container Microservices Dashboard (Port 8090):**
  * Real-time monitoring of Docker container states (`BOOTING`, `ACTIVE`, `DRAINING`).
  * Live LSTM forecast curve vs ground-truth arrival rate.
  * URLLC vs mMTC latency SLA gauges.
* **Speaker Notes:**  
  *"Our codebase features two complete graphical interfaces: the SimPy interactive simulator on port 8050 and the container microservices dashboard on port 8090, allowing real-time visualization of container scaling and latency metrics."*

---

## Slide 13: Conclusion & Key Contributions
* **Summary of Achievements:**
  1. Solved the 40-second container cold-start delay using an LSTM neural network forecaster ($H=45\text{s}$).
  2. Protected mission-critical URLLC signaling ($3.11\text{ ms}$ p99) under massive mMTC IoT storms via S-NSSAI priority queuing.
  3. Preserved 5G subscriber context across multi-step registration (100% session cache hit rate) using Jump Consistent Hashing with bounded load.
  4. Fully implemented and evaluated across discrete-event simulation and live cloud-native Docker microservices.
* **Future Work:**
  * Extending predictive scaling to Multi-Access Edge Computing (MEC) handovers.
  * Integrating Multi-Agent Reinforcement Learning (MARL) for automated cross-slice resource partitioning.
* **Speaker Notes:**  
  *"In conclusion, our project directly answers the future work challenge posed by the IEEE ICOIN 2025 paper ScaleLB. We eliminated the 40-second cold-start delay, guaranteed sub-5ms URLLC latency, and achieved 100% session cache affinity. Thank you, and we now welcome any questions."*

---

## Slide 14: Q&A & References
* **References:**
  * W. Dev, S. Bera, and A. Tiwari, *"Control-Plane Load Balancing and Auto-Scaling in 5G and Beyond Networks"*, IEEE ICOIN 2025.
  * 3GPP TS 23.501 / TS 23.502, *"System Architecture and Procedures for the 5G System"*, Rel. 16.
  * C. E. Rothenberg et al., *"A Service-Based Architecture for 5G Core Networks"*, IEEE NetSoft 2019.
  * J. Lamping and E. Veach, *"A Fast, Minimal Memory, Consistent Hash Algorithm"*, Google Research, 2014.

