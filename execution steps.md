# Complete 5G SBA + ML Auto-Scaling Execution Guide (PowerShell & Docker)

---

## ⚡ Mode 1: Rapid Verification & Benchmark Mode (No Docker Required)

### Step 1: Run Comparative Benchmark
Simulates the ScaleLB paper's traffic burst (Figure 5) and compares ScaleLB Reactive vs EWMA vs ARIMA vs Random Forest vs Our LSTM + Slicing:

```powershell
cd "c:\Users\Home\Downloads\All pdf documents\7th Sem\ACN\Project\SBA-gRPC-5G\src\ml_autoscaler"
python benchmark_evaluation.py
```

### Step 2: Run the ML Auto-Scaler REST API
```powershell
cd "c:\Users\Home\Downloads\All pdf documents\7th Sem\ACN\Project\SBA-gRPC-5G\src\ml_autoscaler"
python server.py
```

Test endpoints in another PowerShell terminal:
```powershell
# Query prediction
curl.exe http://localhost:8080/predict

# Send real-time traffic spike
curl.exe -X POST http://localhost:8080/metrics -H "Content-Type: application/json" -d '{\"rps\": 260.0}'

# Check cluster state
curl.exe http://localhost:8080/status
```

---

## 🏛️ Mode 2: Full End-to-End 5G Core Architecture (Docker + SBA)

### Step 1: Network & Containers (Already Running!)
You already have the network and containers started:
- `consul`, `ausf`, `smf`, `upf`, `amf`, `sink`, `ran`

Verify:
```powershell
docker ps
```

---

### Step 2: Start the Python LSTM Auto-Scaler
From your host PowerShell:
```powershell
cd "c:\Users\Home\Downloads\All pdf documents\7th Sem\ACN\Project\SBA-gRPC-5G\src\ml_autoscaler"
Start-Process python -ArgumentList "server.py"
```
*(This starts `server.py` in its own background process listening on port 8080)*

---

### Step 3: Recompile Protobuf Stubs & C++ Binaries
Since Go, Protobuf compiler (`protoc`), and gRPC C++ toolchains are installed inside the Docker image, run this inside the `ausf` container:

```powershell
docker exec -it ausf bash
```

Inside the container shell:
```bash
# 1. Compile Protobuf definitions
cd /code/protos
protoc -I=. --cpp_out=. --grpc_out=. --plugin=protoc-gen-grpc=`which grpc_cpp_plugin` ngcode.proto
cp ngcode.pb.h ngcode.grpc.pb.h ngcode.pb.cc ngcode.grpc.pb.cc ../src/

# 2. Compile C++ Network Functions
cd /code/src
make clean
make ausf.out
make smf.out
make upf.out
make amf.out
make sink.out
make ransim.out

# 3. Exit back to host PowerShell
exit
```

---

### Step 4: Build & Launch the Go Load Balancer (`grpclb`)
Inside the `ausf` container (or any container that has Go):

```powershell
docker exec -it ausf bash
```

Inside container:
```bash
cd /code/src/grpclb
# Set ML autoscaler URL to host
export ML_AUTOSCALER_URL="http://host.docker.internal:8080/predict"

# Build load balancer
go build -o grpclb_server ./cmd/grpc-lb-consul

# Launch load balancer connecting to Consul
./grpclb_server --addr 0.0.0.0:8383 --consul consul:8500
```
*(Leave this terminal running to observe dynamic balancing & proactive ML scale logs)*

---

### Step 5: Start the 5G Network Functions (In Order)
Open separate PowerShell tabs for each:

#### Tab 1: AUSF
```powershell
docker exec -it ausf bash
```
Inside container:
```bash
cd /code/src
export LD_LIBRARY_PATH=/usr/local/lib/
service mysql restart
./ausf.out 10
```

#### Tab 2: SMF
```powershell
docker exec -it smf bash
```
Inside container:
```bash
cd /code/src
export LD_LIBRARY_PATH=/usr/local/lib/
./smf.out 10
```

#### Tab 3: UPF
```powershell
docker exec -it upf bash
```
Inside container:
```bash
cd /code/src
export LD_LIBRARY_PATH=/usr/local/lib/
./upf.out 10 10 10
```

#### Tab 4: AMF
```powershell
docker exec -it amf bash
```
Inside container:
```bash
cd /code/src
export LD_LIBRARY_PATH=/usr/local/lib/
./amf.out 10
```

#### Tab 5: SINK
```powershell
docker exec -it sink bash
```
Inside container:
```bash
cd /code/src
export LD_LIBRARY_PATH=/usr/local/lib/
./settings.sh
./sink.out 10
```

---

### Step 6: Launch RAN Traffic Simulator
In a new PowerShell tab:
```powershell
docker exec -it ran bash
```
Inside container:
```bash
cd /code/src
export LD_LIBRARY_PATH=/usr/local/lib/
./settings.sh

# Run 100 UEs for 15 seconds (10% URLLC, 70% mMTC, 20% eMBB)
./ransim.out 100 15
```

---

### 📊 Verification
- **URLLC Latency Isolation:** Check `responseTimesRAN.txt` in `/code/src` — URLLC latencies remain $<5\text{ ms}$.
- **Proactive Scaling Logs:** Look at the Go Load Balancer output to see proactive scale triggers.
- **Session Cache Hits:** AMF logs will confirm 100% session cache hits via Jump Consistent Hashing on IMSI.
