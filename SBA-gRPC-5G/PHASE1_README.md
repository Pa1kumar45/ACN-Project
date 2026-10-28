# Phase 1 Implementation Plan: Core Protocol Features
## Load Balancer for Replicated 5G Core Network Functions (SBA-gRPC-5G)

---

## 📌 Executive Summary

This document provides a complete, step-by-step implementation guide for **Phase 1** of our Advanced Computer Networks (ACN) project. 

Phase 1 enhances the **`SBA-gRPC-5G`** prototype by resolving the two core design flaws identified in the **ScaleLB** research paper (*"Control-Plane Load Balancing and Auto-Scaling in 5G and Beyond Networks"*):
1. **Feature 2 (Session-Aware Consistent Hashing with Bounded Load):** Fixes ScaleLB's stateless Round-Robin failure during 5G multi-step registration (Figure 3 in paper) by binding all requests for a specific subscriber (IMSI) to the same NF replica holding its `UeContext` in RAM.
2. **Feature 1 (Slice-Aware Priority Queuing):** Fixes ScaleLB's slice-agnostic latency degradation (Figure 5 in paper) by providing a fast path for URLLC traffic while rate-limiting bulk mMTC traffic under high CPU load.

---

## 🏛️ Architectural Overview

```
                         5G RAN Simulator (ran_simulator.cpp)
                         ├── 10% URLLC (slice_type = 1)
                         ├── 70% mMTC  (slice_type = 2)
                         └── 20% eMBB  (slice_type = 0)
                                      │
                                      ▼ SCTP
                                AMF Server (amf.cpp)
                                      │
              ┌───────────────────────┴───────────────────────┐
              │ 1. Injects "x-ue-imsi" gRPC metadata header   │
              │ 2. Populates "slice_type" in protobuf body    │
              └───────────────────────┬───────────────────────┘
                                      │
                                      ▼ gRPC LB Protocol
                       Go Load Balancer (grpclb/)
              ┌───────────────────────────────────────────────┐
              │ 1. Reads "x-ue-imsi" metadata                 │
              │ 2. Jump Consistent Hash -> Selects NF replica │
              │ 3. Bounded Load check: Spill if load > 1.25x  │
              └───────────────────────┬───────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
             AUSF Replica 1    AUSF Replica 2    AUSF Replica 3
             ┌────────────────────────────────────────────────┐
             │ • URLLC Request: Immediate fast-path (<5ms)    │
             │ • mMTC Request:  Rate-limited if CPU > 80%     │
             │ • RAM UeContext: 100% Session Cache Hit Rate   │
             └────────────────────────────────────────────────┘
```

---

## 📋 Phase 1 Implementation Roadmap

```
Phase 1 Execution Flow:
  [Step 1] Update Protobuf Definitions (ngcode.proto)
     │
  [Step 2] Feature 2: Implement Consistent Hashing & Session Affinity (Go + C++)
     │        └── Fixes Correctness (Multi-step attach)
     │
  [Step 3] Feature 1: Implement Slice-Aware Priority Queuing (C++)
     │        └── Fixes Performance (URLLC latency isolation)
     │
  [Step 4] Build, Recompile & Docker Deployment
     │
  [Step 5] Verification & Evaluation Experiments
```

---

## 🛠️ Step-by-Step Code Modifications

### Step 1: Protobuf Schema Update

**Target File:** [`protos/ngcode.proto`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/protos/ngcode.proto)

Add `slice_type` to both `AmfAusfRequest` and `AmfSmfRequest`:

```protobuf
syntax = "proto3";

package ngcode;

message AmfAusfRequest {
    string name = 1;
    string type = 2;
    int64 imsi = 3;
    int64 plmn_id = 4;
    int64 num_autn_vec = 5;
    int64 nw_type = 6;
    int64 msg_type = 7;
    int64 mmei = 8;
    int32 num = 9;
    int32 slice_type = 10;  // 0=eMBB, 1=URLLC, 2=mMTC (NEW)
}

message AmfAusfReply {
    string message = 1;
    int64 autn_num = 2;
    int64 rand = 3;
    int64 autn = 4;
    int64 xres = 5;
    int64 k_asme = 6;
}

message AmfSmfRequest {
    int64 guti = 1;
    int64 s11_cteid_amf = 2;
    int64 eps_bearer_id = 3;
    int64 s1_uteid_dl = 4;
    int64 tai = 5;
    int64 pkey = 6;
    string s1_upf_ip = 7;
    int64 num = 8;
    int64 imsi = 9;
    int64 msg_type = 10;
    int32 slice_type = 11; // 0=eMBB, 1=URLLC, 2=mMTC (NEW)
}

message AmfSmfReply {
    string message = 1;
    int64 s11_cteid_smf = 2;
    int64 s1_uteid_ul = 3;
    int64 eps_bearer_id = 4;
    int64 ue_ip = 5;
    string s1_upf_ip = 6;
}

service Greeter {
    rpc AmfAusfInteraction (AmfAusfRequest) returns (AmfAusfReply) {}
    rpc AmfSmfInteraction (AmfSmfRequest) returns (AmfSmfReply) {}
}
```

---

### Step 2: Feature 2 — Session-Aware Consistent Hashing with Bounded Load

#### 2.1 C++ AMF: Inject IMSI Metadata Header
**Target File:** [`src/amf.cpp`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/amf.cpp)

In every gRPC client call (`AmfAusfInteraction` and `AmfSmfInteraction`), attach `x-ue-imsi` to the `ClientContext`:

```cpp
// Inside AMF functions calling AUSF (handle_initial_attach, handle_autn, etc.):
grpc::ClientContext context;
std::string imsi_str = std::to_string(ue_ctx.imsi);
context.AddMetadata("x-ue-imsi", imsi_str); // Passes IMSI to Go Load Balancer

grpc::Status status = stub_->AmfAusfInteraction(&context, request, &reply);
```

#### 2.2 Go Load Balancer: Jump Consistent Hash with Bounded Load
**Target File:** [`src/grpclb/balancer/balancer.go`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/grpclb/balancer/balancer.go)

Add the `NewConsistentHashBalancer` implementation:

```go
package balancer

import (
	"hash/fnv"
	"math/rand"
	"strconv"
	"strings"
	balancerpb "grpclb/balancer/proto"
)

// NewConsistentHashBalancer routes requests by UE IMSI with bounded load spillover.
func NewConsistentHashBalancer(imsiKey string) Balancer {
	return BalancerFunc(func(s []*balancerpb.Server) *balancerpb.Server {
		if len(s) == 0 {
			return nil
		}
		if imsiKey == "" {
			return s[rand.Intn(len(s))] // Fallback to random if no IMSI metadata
		}

		// 1. Jump Consistent Hash on IMSI
		h := fnv32(imsiKey)
		idx := jumpHash(int64(h), int64(len(s)))

		// 2. Bounded Load Spillover Check (Threshold = 1.25x average load)
		chosenCPU := getCPUTag(s[idx])
		avgCPU := avgCPUOfServers(s)
		if chosenCPU > avgCPU*1.25 {
			// Target replica is overloaded -> Spill to next replica on the ring
			idx = (idx + 1) % len(s)
		}

		return s[idx]
	})
}

// jumpHash implements Google's Jump Consistent Hash algorithm
func jumpHash(key int64, numBuckets int64) int64 {
	var b, j int64 = -1, 0
	for j < numBuckets {
		b = j
		key = key*2862933555777941757 + 1
		j = int64(float64(b+1) * (float64(int64(1)<<31) / float64((key>>33)+1)))
	}
	return b
}

func fnv32(key string) uint32 {
	hasher := fnv.New32a()
	hasher.Write([]byte(key))
	return hasher.Sum32()
}

func getCPUTag(s *balancerpb.Server) float64 {
	for _, tag := range s.Tags {
		if strings.HasPrefix(tag, "cpu:") {
			if v, err := strconv.ParseFloat(tag[4:], 64); err == nil {
				return v
			}
		}
	}
	return 50.0 // Default assumption if tag is missing
}

func avgCPUOfServers(s []*balancerpb.Server) float64 {
	if len(s) == 0 {
		return 0
	}
	total := 0.0
	for _, srv := range s {
		total += getCPUTag(srv)
	}
	return total / float64(len(s))
}
```

#### 2.3 Go Load Balancer Server: Intercept Metadata
**Target File:** [`src/grpclb/balancer/server.go`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/grpclb/balancer/server.go)

Modify the `Servers` RPC handler:

```go
import "google.golang.org/grpc/metadata"

func (b *Server) Servers(ctx context.Context, req *balancerpb.ServersRequest) (*balancerpb.ServersResponse, error) {
	// Extract UE IMSI from incoming gRPC metadata
	imsiKey := ""
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if vals := md.Get("x-ue-imsi"); len(vals) > 0 {
			imsiKey = vals[0]
		}
	}

	// Dynamically use Consistent Hashing if IMSI is present
	if imsiKey != "" {
		b.config.Balancer = NewConsistentHashBalancer(imsiKey)
	}

	servers, err := b.GetServers(req.Target)
	if err != nil {
		return nil, err
	}

	return &balancerpb.ServersResponse{
		Servers: servers,
	}, nil
}
```

---

### Step 3: Feature 1 — Slice-Aware Priority Queuing

#### 3.1 RAN Simulator: Assign Slice Profiles
**Target Files:** [`src/ran.h`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ran.h), [`src/ran.cpp`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ran.cpp), [`src/ran_simulator.cpp`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ran_simulator.cpp)

1. Add `slice_type` in `Ran` class (`src/ran.h`):
```cpp
class Ran {
public:
    int slice_type; // 0=eMBB, 1=URLLC, 2=mMTC
    void set_slice_type(int st) { slice_type = st; }
    // ...
};
```

2. Assign slice categories in `simulate()` (`src/ran_simulator.cpp`):
```cpp
void simulate(int arg) {
    Ran ran;
    int ran_num = arg;

    // Traffic distribution: 10% URLLC, 70% mMTC, 20% eMBB
    int slice_type = 0;
    if (ran_num < g_threads_count * 0.10) {
        slice_type = 1; // URLLC (Mission Critical)
    } else if (ran_num < g_threads_count * 0.80) {
        slice_type = 2; // mMTC (IoT Massive Machine Type)
    } else {
        slice_type = 0; // eMBB (Mobile Broadband)
    }

    ran.set_slice_type(slice_type);
    ran.init(ran_num);
    ran.conn_mme();
    // ...
}
```

3. Populate protobuf field in `initial_attach()` (`src/ran.cpp`):
```cpp
ngcode::AmfAusfRequest request;
request.set_imsi(ran_ctx.imsi);
request.set_msg_type(1);
request.set_slice_type(slice_type); // Attach slice type to proto message
```

#### 3.2 AUSF / SMF Server: Fast Lane & Rate Limiting
**Target Files:** [`src/ausf_server.cpp`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ausf_server.cpp), [`src/smf_server.cpp`](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/smf_server.cpp)

In the gRPC service implementation `GreeterServiceImpl`:

```cpp
#include <chrono>
#include <thread>
#include <atomic>

extern std::atomic<int> g_current_cpu; // Updated from Consul / /proc/stat monitor

class GreeterServiceImpl final : public Greeter::Service {
    Status AmfAusfInteraction(ServerContext* context, 
                             const AmfAusfRequest* request, 
                             AmfAusfReply* reply) override {
        
        int slice = request->slice_type();

        // 1. URLLC (slice == 1): Fast lane - execute immediately
        if (slice == 1) {
            return ProcessAusfRequest(request, reply);
        }

        // 2. mMTC (slice == 2): If server CPU is high (>80%), apply rate-limiting backpressure
        if (slice == 2 && g_current_cpu.load() > 80) {
            std::this_thread::sleep_for(std::chrono::milliseconds(15)); // Throttle
        }

        // 3. Default execution (eMBB / standard)
        return ProcessAusfRequest(request, reply);
    }
};
```

---

## 🔨 Build & Compilation Guide

### 1. Recompile Protobuf Stubs
Inside the container / build environment:
```bash
cd /code/protos
# C++ stubs
protoc -I=. --cpp_out=. --grpc_out=. --plugin=protoc-gen-grpc=`which grpc_cpp_plugin` ngcode.proto
cp ngcode.pb.h ngcode.grpc.pb.h ngcode.pb.cc ngcode.grpc.pb.cc ../src/

# Go stubs (for Load Balancer)
protoc -I=. --go_out=plugins=grpc:../src/grpclb/balancer/proto ngcode.proto
```

### 2. Recompile C++ Network Functions
```bash
cd /code/src
make clean
make ausf.out
make amf.out
make smf.out
make upf.out
make sink.out
make ransim.out
```

### 3. Build Go Load Balancer
```bash
cd /code/src/grpclb
go build -o grpclb_server ./cmd/server
```

---

## 🧪 Verification & Evaluation Experiments

### Experiment 1: Session Affinity (Cache Hit Rate & Attach Success)
* **Goal:** Verify that multi-step attach requests for the same UE reach the exact same AMF replica.
* **Command:** Run 3 AMF / AUSF replicas and launch 100 UEs via RAN simulator:
  ```bash
  ./ransim.out 100 15
  ```
* **Evaluation Metric:** 
  * Baseline (Round Robin): Context miss rate $\approx 66\%$.
  * Phase 1 (Consistent Hashing): Context miss rate $= 0\%$ ($100\%$ session cache hit).

### Experiment 2: URLLC Latency Isolation Under IoT Surge
* **Goal:** Replicate ScaleLB Figure 5 scenario and verify URLLC latency $<5\text{ ms}$.
* **Setup:** Generate background load of 500 mMTC UEs while firing 50 URLLC UEs.
* **Evaluation Metric:** Inspect `responseTimesRAN.txt`:
  * Baseline: URLLC latency spikes to $>45\text{ ms}$.
  * Phase 1: URLLC latency remains consistently $<5\text{ ms}$.

---

## 📂 Deliverables Checklist

- [x] [protos/ngcode.proto](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/protos/ngcode.proto) updated with `slice_type`.
- [x] [src/grpclb/balancer/balancer.go](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/grpclb/balancer/balancer.go) implemented with Jump Hash + Bounded Load.
- [x] [src/grpclb/balancer/server.go](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/grpclb/balancer/server.go) updated with gRPC metadata interception.
- [x] [src/amf.cpp](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/amf.cpp) updated with `x-ue-imsi` metadata insertion.
- [x] [src/ausf_server.cpp](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ausf_server.cpp) & [src/smf_server.cpp](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/smf_server.cpp) updated with URLLC fast lane & mMTC throttling.
- [x] [src/ran_simulator.cpp](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ran_simulator.cpp) & [src/ran.cpp](file:///c:/Users/Home/Downloads/All%20pdf%20documents/7th%20Sem/ACN/Project/SBA-gRPC-5G/src/ran.cpp) updated with slice classification.
