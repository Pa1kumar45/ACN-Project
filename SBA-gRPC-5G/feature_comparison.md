# ScaleLB Features vs SBA-gRPC-5G Repo: Full Analysis

---

## 📄 ScaleLB Paper — Quick Summary

**Paper:** Control-Plane Load Balancing and Auto-Scaling in 5G and Beyond Networks (ScaleLB)  
**What it does:** Proposes an abstraction layer in front of AMF instances that:
1. Load-balances incoming gNB/UE signaling using **Round Robin**
2. Auto-scales AMF instances (Proactive: pre-emptive threshold-based vs. Reactive: on-demand)

**Key limitation acknowledged in paper:**  
Round Robin is slice-agnostic and stateless — it doesn't distinguish URLLC from mMTC, and it breaks multi-step registration because the 3 steps of one UE's attach may go to 3 different AMFs (no session affinity).

**Future work quote (Section VI):**
> *"Consequently, a machine learning based prediction approach can be integrated with the proposed proactive scenario to improve resource utilization. We consider this as a future research direction."*

---

## 🏛️ What the SBA-gRPC-5G Repo Already Has

| Component | What Exists |
|-----------|-------------|
| **LB Server** | Go-based gRPC External LB (`grpclb/`) |
| **Algorithms** | Random, LeastCPU, LeastResponseTime, Round Robin |
| **Discovery** | Consul (= NRF) — NFs register + advertise CPU% & response time as tags |
| **NF Protocol** | gRPC (proto3) — AmfAusfInteraction, AmfSmfInteraction |
| **Session State** | UeContext held in AMF RAM (per-UE security keys, bearer IDs) |
| **Threading** | N worker threads per NF; each handles a UE connection independently |
| **Slice Awareness** | ❌ None — no URLLC/mMTC classification anywhere |
| **Request Priority** | ❌ None — all requests are equal |
| **Consistent Hashing** | ❌ None — LB picks a server per-request, not per-UE |
| **Session Affinity** | ❌ None — follow-up auth/session messages may reach a different AMF |

---

## ⚡ Feature 1: Slice-Aware Priority Queuing

### What It Proposes
- Inspect incoming request's **slice type header** (URLLC vs mMTC vs eMBB)
- URLLC → **bypass queue**, dispatch immediately to lowest-latency AMF
- mMTC → **rate-limited buffer queue** when AMF CPU > 80%
- Goal: URLLC latency stays <5ms even under mMTC surge

### Relationship to the Existing Repo

| Dimension | Assessment |
|-----------|-----------|
| **Existence in repo** | **Completely absent.** The `ngcode.proto` has no slice type field. The balancer has no concept of traffic class. |
| **Conceptual link** | The repo's LeastCPU balancer avoids overloaded servers, but treats ALL traffic as equal priority. It doesn't protect URLLC from mMTC. |
| **Architecture fit** | Must be added in the **gRPC LB server** (`grpclb/balancer/server.go`), which already intercepts every `Servers()` request. That's the right insertion point. |
| **Proto changes needed** | Must add `slice_type` field to `AmfAusfRequest`/`AmfSmfRequest` in `ngcode.proto`, AND update the RAN simulator to set it. |
| **Solves ScaleLB gap?** | ✅ Yes — ScaleLB uses pure Round Robin with no QoS differentiation. This directly addresses the latency spike problem in heterogeneous traffic. |

### Implementation Difficulty: 🟡 **Medium**

**Why Medium (not Easy):**
- The LB server (`server.go`) currently receives only a `target` string in `ServersRequest`. The gRPC LB protocol's `ServersRequest` doesn't carry application-level metadata by default — you'd need to either:
  - (a) Extend the proto for the LB protocol itself to carry slice type, OR
  - (b) Use a **side-channel** (e.g., gRPC metadata headers) that the LB intercepts before forwarding, OR
  - (c) Run the priority logic **inside** each NF's gRPC server handler and queue requests there
- Option (c) is easiest: add a priority queue inside AUSF/SMF's `GreeterServiceImpl` — URLLC RPCs get a fast lane, mMTC get rate-limited
- The rate-limiting logic (token bucket / leaky bucket) is ~30-50 lines of Go/C++
- The slice field must propagate from RAN → proto → AMF → LB — moderate proto + C++ changes
- **Effort estimate: 3–4 days** with the existing codebase

**Why NOT Hard:**
- The insertion point (LB `server.go` or NF's gRPC handler) is clear and isolated
- No distributed state is needed — each worker thread handles its own queue
- No database changes needed

---

## 🔑 Feature 2: Session-Aware Consistent Hashing with Bounded Load

### What It Proposes
- Hash the UE's **SUPI/IMSI** → always route to the same AMF replica
- All 3 steps (Registration → Authentication → Session Setup) hit the **same AMF**
- AMF uses in-RAM `UeContext` → zero DB lookup on follow-up steps
- Bounded load: if one AMF is overwhelmed, **spillover** to next AMF on the hash ring

### Relationship to the Existing Repo

| Dimension | Assessment |
|-----------|-----------|
| **Existence in repo** | **Partially present** — `UeContext` is already stored in AMF RAM (not a DB). The hard part (consistent routing) is missing. |
| **The exact problem** | AMF's `handle_initial_attach()` creates a `UeContext` with IMSI→GUTI mapping. But if Auth Response (step 2) hits a **different AMF**, that AMF has no `UeContext` → crash/failure. |
| **Current LB behavior** | LeastCPU picks the lowest-CPU AMF for every single request independently — no session affinity at all. Step 2 easily hits a different AMF than Step 1. |
| **What must be added** | In the LB server (`server.go`): extract IMSI from the gRPC request metadata, hash it with consistent hashing (e.g., `jump hash` or `rendezvous hash`), always pick the same AMF bucket. |
| **Bounded load component** | Track load per AMF bucket; if `load(AMF_i) > threshold × (total_load / n_AMFs)`, spill to AMF_i+1 on the ring. |
| **Solves ScaleLB gap?** | ✅ Yes — ScaleLB's Round Robin causes session context misses. This directly fixes it and matches the 33%→>90% cache hit claim. |

### Implementation Difficulty: 🔴 **Hard** (harder than Feature 1)

**Why Hard:**
1. **Proto extraction problem:** The LB server currently only sees a `target` string (which NF service to route to). It does NOT see the IMSI or request body. To do consistent hashing by IMSI, you must:
   - Pass IMSI as **gRPC metadata** from the AMF client side, AND
   - Extract it in the LB server's `Servers()` RPC handler
   - This requires modifying both the C++ gRPC client code (AMF calls to AUSF/SMF) and the Go LB server
   
2. **Consistent hash ring implementation:** Must implement or import a consistent hash library in Go, map IMSI → ring position → AMF server.

3. **Bounded load math:** Must track in-flight request count per AMF atomically (mutex/atomic counters in Go) and implement the spillover logic correctly.

4. **State during AMF scale-out:** When a NEW AMF replica is added (auto-scaling), some IMSI hash buckets migrate. If a UE is mid-registration, its context is still on the old AMF but new requests route to new AMF → context miss. Needs a session migration or "sticky until completion" strategy.

5. **Multi-step message sequencing:** Steps 1→2→3 of registration happen on the same SCTP connection (TCP-like). But gRPC calls from AMF to AUSF are independent RPCs. Need to ensure all 3 internal RPCs for the same UE carry the same IMSI tag.

- **Effort estimate: 1–2 weeks** with careful design

**Why NOT Easy:**
- The LB protocol boundary makes IMSI extraction non-trivial (it's in the application body, not the LB protocol header)
- Bounded load + consistent hash have subtle correctness requirements
- Scale-out migration is architecturally complex

---

## 📊 Side-by-Side Comparison Table

| Aspect | Feature 1: Slice-Aware Priority | Feature 2: Session-Consistent Hashing |
|--------|--------------------------------|---------------------------------------|
| **Exists in repo?** | ❌ Completely missing | ⚠️ Partial (UeContext in RAM, no affinity routing) |
| **Fixes ScaleLB's?** | Latency spikes (Fig. 5) | Session context miss (Fig. 3 failure) |
| **Where to implement** | Inside NF gRPC handlers OR LB `server.go` | LB `server.go` + C++ gRPC client metadata |
| **Proto changes?** | Yes — add `slice_type` field | Minimal — pass IMSI as gRPC metadata |
| **New data structures** | Priority queue + token bucket rate limiter | Consistent hash ring + per-AMF counters |
| **Distributed state?** | No — per-thread queues | Yes — shared AMF load counters (+ migration risk) |
| **Difficulty** | 🟡 Medium | 🔴 Hard |
| **Estimated effort** | 3–4 days | 1–2 weeks |
| **Risk** | Low — isolated logic | Medium-High — correctness + scale-out edge cases |
| **Novelty vs repo** | High — entirely new dimension | Medium-High — new routing but leverages existing UeContext |
| **Novelty vs ScaleLB** | High — ScaleLB has no QoS | High — ScaleLB has no session affinity |

---

## 🧠 Recommended Implementation Order

> [!IMPORTANT]
> **Do Feature 2 (Consistent Hashing) FIRST**, then Feature 1 (Priority Queuing).

**Reasoning:**
- Feature 2 directly fixes a *correctness* problem (broken multi-step registration) — without it, Feature 1's fast-lane URLLC might still fail on step 2 of registration
- Feature 1 is a *performance optimization* that requires Feature 2 to be stable underneath it
- Evaluating both: measure (a) cache hit rate improvement [Feature 2], then (b) URLLC latency under mixed load [Feature 1]

---

## 🔗 How Both Features Fit Into the Existing Repo Architecture

```
RAN (ran_simulator.cpp)
  │  add slice_type to S1AP packet & gRPC metadata  ← Feature 1 change
  │
  ▼ SCTP
AMF (amf_server.cpp)
  │  extract IMSI → set as gRPC metadata header     ← Feature 2 change
  │  inspect slice_type → URLLC vs mMTC             ← Feature 1 change
  │
  ▼ gRPC (with IMSI in metadata + slice_type)
Load Balancer (grpclb/balancer/server.go)
  │  consistent hash on IMSI → pick AMF             ← Feature 2 NEW
  │  bounded load → spillover if needed             ← Feature 2 NEW
  │  priority: URLLC bypass, mMTC rate-limit        ← Feature 1 NEW
  │
  ├──► AUSF replica 1  (GreeterServiceImpl)
  ├──► AUSF replica 2  ← UeContext already in RAM ✅
  └──► AUSF replica 3
```
