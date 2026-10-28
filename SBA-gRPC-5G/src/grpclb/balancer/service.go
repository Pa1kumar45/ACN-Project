package balancer

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"

	balancerpb "github.com/sipian/grpc-5G-SBA/grpclb/grpclb_balancer_v1"
	"google.golang.org/grpc/grpclog"
)

type service struct {
	target    string
	discovery Discovery
	endpoints []*balancerpb.Server

	mu sync.RWMutex

	closing, closed chan struct{}
}

func newService(target string, discovery Discovery, discoveryInterval time.Duration) (*service, error) {
	s := &service{
		target:    target,
		discovery: discovery,
		endpoints: make([]*balancerpb.Server, 0),

		closing: make(chan struct{}),
		closed:  make(chan struct{}),
	}
	if err := s.updateBackends(); err != nil {
		return nil, err
	}

	go s.loop(discoveryInterval)
	go s.mlScalingLoop()
	return s, nil
}

func (s *service) mlScalingLoop() {
	mlURL := os.Getenv("ML_AUTOSCALER_URL")
	if mlURL == "" {
		mlURL = "http://127.0.0.1:8080/predict"
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	client := &http.Client{Timeout: 3 * time.Second}

	for {
		select {
		case <-s.closing:
			return
		case <-ticker.C:
			resp, err := client.Get(mlURL)
			if err != nil {
				continue
			}
			var res struct {
				PredictedRPS float64 `json:"predicted_rps"`
				ScaleUp      bool    `json:"scale_up"`
				ScaleTo      int     `json:"scale_to"`
				CurrentAMFs  int     `json:"current_amfs"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&res); err == nil {
				if res.ScaleUp {
					log.Warnf("[PROACTIVE ML AUTOSCALER] Traffic surge forecasted! Predicted RPS: %.1f. Scaling AMF pool up to %d instances (45s head start)",
						res.PredictedRPS, res.ScaleTo)
				}
			}
			resp.Body.Close()
		}
	}
}

func (s *service) Servers() []*balancerpb.Server {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.endpoints
}

func (s *service) Close() {
	close(s.closing)
	<-s.closed
}

func (s *service) loop(discoveryInterval time.Duration) {
	t := time.NewTicker(discoveryInterval)
	defer t.Stop()

	for {
		select {
		case <-s.closing:
			close(s.closed)
			return
		case <-t.C:
			err := s.updateBackends()
			if err != nil {
				grpclog.Printf("error on service discovery of %s: %s", s.target, err)
			}
		}
	}
}

func (s *service) updateBackends() error {
	endpoints, err := s.discovery.Resolve(s.target)
	if err != nil {
		return err
	}

	log.Debugf("Updating endpoints for %s : %v", s.target, endpoints)

	s.mu.Lock()
	s.endpoints = endpoints
	s.mu.Unlock()
	return nil
}
