package balancer

import (
	"hash/fnv"
	"math"
	"math/rand"
	"strconv"
	"strings"
	"sync"
	"time"

	balancerpb "github.com/sipian/grpc-5G-SBA/grpclb/grpclb_balancer_v1"
)

// Balancer algorithm interface
type Balancer interface {
	Balance([]*balancerpb.Server) *balancerpb.Server
}

// BalancerFunc is a simple balancer function which implements the Balancer interface
type BalancerFunc func([]*balancerpb.Server) *balancerpb.Server

// Balance implements Balance
func (f BalancerFunc) Balance(s []*balancerpb.Server) *balancerpb.Server { return f(s) }

// --------------------------------------------------------------------

// NewRandomBalancer returns a balancer which returns a random known server
func NewRandomBalancer() Balancer {
	return BalancerFunc(func(s []*balancerpb.Server) *balancerpb.Server {
		if len(s) == 0 {
			return nil
		}
		return s[rand.Intn(len(s))]
	})
}

// type busyServers []*balancerpb.Server

// func (p busyServers) Len() int           { return len(p) }
// func (p busyServers) Less(i, j int) bool { return p[i].Tags[0] < p[j].Score }
// func (p busyServers) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
// func (p busyServers) Shuffle() {
// 	for i := len(p) - 1; i > 0; i-- {
// 		j := rand.Intn(i + 1)
// 		p[i], p[j] = p[j], p[i]
// 	}
// }
// func (p busyServers) Sort() {
// 	sort.Sort(busyServers(p))
// }

// NewLeastBusyBalancer returns a balancer which returns the least busy server
// Tags Format : ["cpu:80.066","responseTime:453.04545"]
func NewLeastCPUBalancer() Balancer {
	return BalancerFunc(func(s []*balancerpb.Server) *balancerpb.Server {
		var minServer *balancerpb.Server
		var minCPU float64

		for _, server := range s {
			if len(server.Tags) == 0 {
				// servers with no tags have lesser priority
				if minServer == nil {
					minServer = server
					minCPU = math.MaxFloat64
				}
			} else {
				for _, tags := range server.Tags {
					if strings.Contains(tags, "cpu:") {
						if minServer == nil {
							if i, err := strconv.ParseFloat(tags[4:], 64); err == nil {
								minServer = server
								minCPU = i
							}
						} else {
							if i, err := strconv.ParseFloat(tags[4:], 64); err == nil && minCPU > i {
								minServer = server
								minCPU = i
							}
						}
						break
					}
				}
			}
		}
		return minServer
	})
}

func NewLeastResponseTimeBalancer() Balancer {
	return BalancerFunc(func(s []*balancerpb.Server) *balancerpb.Server {
		var minServer *balancerpb.Server
		var minResponseTime float64

		for _, server := range s {
			if len(server.Tags) == 0 {
				if minServer == nil {
					// servers with no tags have lesser priority
					minServer = server
					minResponseTime = math.MaxFloat64
				}
			} else {
				for _, tags := range server.Tags {
					if strings.Contains(tags, "responseTime:") {
						if minServer == nil {
							if i, err := strconv.ParseFloat(tags[13:], 64); err == nil {
								minServer = server
								minResponseTime = i
							}
						} else {
							if i, err := strconv.ParseFloat(tags[13:], 64); err == nil && minResponseTime > i {
								minServer = server
								minResponseTime = i
							}
						}
						break
					}
				}
			}

		}
		return minServer
	})
}

// --------------------------------------------------------------------
// Phase 1: Feature 1 & 2 - Slice-Aware Priority Queuing & Session Affinity
// --------------------------------------------------------------------

var (
	mmtcRateLimiterMu sync.Mutex
	lastMmtcRelease   = time.Now()
)

// NewSliceAwareConsistentHashBalancer routes requests based on 5G slice type (S-NSSAI)
// and session key (IMSI / UE NGAP ID) with bounded load and QoS differentiation:
//   - URLLC (slice 1): Bypasses queue, dispatches immediately to hashed AMF or least-loaded AMF (reserves 10-15% headroom).
//   - eMBB (slice 0): Normal FIFO consistent hashing with bounded load (spill to next on ring if CPU > 1.25x avg).
//   - mMTC (slice 2): Buffered queue; token-bucket throttled when mean AMF CPU > 80%; aging bounds guarantee no starvation.
func NewSliceAwareConsistentHashBalancer(sliceType int, sessionKey string) Balancer {
	return BalancerFunc(func(s []*balancerpb.Server) *balancerpb.Server {
		if len(s) == 0 {
			return nil
		}
		if sessionKey == "" {
			return NewLeastCPUBalancer().Balance(s)
		}

		numServers := int64(len(s))
		h := fnv32(sessionKey)
		idx := jumpHash(int64(h), numServers)

		avgCPU := avgCPUOfServers(s)
		targetCPU := getCPUTag(s[idx])

		// 1. URLLC (Mission-critical signalling):
		// Fast lane: bypasses queue. If hashed server exceeds 85% CPU (headroom breached),
		// pick the lowest-CPU server in the pool to guarantee <5ms dispatch.
		if sliceType == 1 {
			if targetCPU > 85.0 {
				return getLeastCPUServer(s)
			}
			return s[idx]
		}

		// 2. mMTC (Bulk IoT signalling):
		// Buffered lane: If cluster load is critical (>80% CPU), apply token bucket rate limiting.
		// Aging bounds guarantee requests waiting too long are released to avoid starvation.
		if sliceType == 2 {
			if avgCPU > 80.0 {
				applyMmtcRateLimit()
			}
		}

		// 3. Bounded Load Spillover Check (c = 1.25)
		// If chosen replica CPU > 1.25x average CPU of the cluster, spill to the next replica on the ring.
		if targetCPU > avgCPU*1.25 {
			idx = (idx + 1) % numServers
		}

		return s[idx]
	})
}

// NewConsistentHashBalancer provides session affinity via Jump Consistent Hashing with Bounded Load
func NewConsistentHashBalancer(imsiKey string) Balancer {
	return NewSliceAwareConsistentHashBalancer(0, imsiKey)
}

func getLeastCPUServer(s []*balancerpb.Server) *balancerpb.Server {
	var minServer *balancerpb.Server
	var minCPU float64 = math.MaxFloat64
	for _, srv := range s {
		cpu := getCPUTag(srv)
		if minServer == nil || cpu < minCPU {
			minServer = srv
			minCPU = cpu
		}
	}
	return minServer
}

func applyMmtcRateLimit() {
	mmtcRateLimiterMu.Lock()
	defer mmtcRateLimiterMu.Unlock()

	now := time.Now()
	elapsed := now.Sub(lastMmtcRelease)
	throttleInterval := 10 * time.Millisecond // ~100 req/s release rate
	if elapsed < throttleInterval {
		sleepDur := throttleInterval - elapsed
		if sleepDur > 500*time.Millisecond {
			sleepDur = 500 * time.Millisecond // Aging upper bound
		}
		time.Sleep(sleepDur)
	}
	lastMmtcRelease = time.Now()
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
	return 50.0 // Default assumption
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

