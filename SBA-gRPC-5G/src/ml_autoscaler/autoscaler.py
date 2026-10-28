"""
Predictive Auto-Scaler Core Engine
Implements the mathematical scaling formulation from the methodology:
    N = ceil( (f * (1 + m)) / (mu * gamma) )
Where:
    f     = Forecasted request rate at t + H (req/s) from LSTM
    m     = Safety margin / headroom buffer (e.g. 0.10)
    mu    = Service capacity of one AMF instance (req/s)
    gamma = Target operational threshold (e.g. 0.80)
    N     = Target number of AMF replicas needed
"""

import math
import time
from typing import Dict, Any, Tuple
from lstm_forecaster import LSTMForecaster

class PredictiveAutoScaler:
    def __init__(self,
                 mu: float = 100.0,       # Capacity per AMF instance (req/s)
                 gamma: float = 0.80,     # Target utilization threshold
                 margin: float = 0.10,    # 10% safety margin
                 horizon: int = 45,       # Forecast horizon in seconds (exceeds ~40s boot)
                 amf_boot_time: float = 40.0,
                 scale_down_cooldown: float = 60.0):
        self.mu = mu
        self.gamma = gamma
        self.margin = margin
        self.horizon = horizon
        self.amf_boot_time = amf_boot_time
        self.scale_down_cooldown = scale_down_cooldown

        self.forecaster = LSTMForecaster(window_size=60, horizon=horizon)

        self.active_amfs = 1
        self.booting_amfs = 0
        self.last_scale_time = time.time()
        self.boot_start_time = 0.0

    def evaluate_scaling(self, window_history: list) -> Dict[str, Any]:
        """
        Evaluates the current traffic history using LSTM and determines whether
        a proactive scale-up or scale-down is required.
        """
        now = time.time()

        # Check if any booting AMF has finished its ~40s boot time
        if self.booting_amfs > 0 and (now - self.boot_start_time) >= self.amf_boot_time:
            self.active_amfs += self.booting_amfs
            self.booting_amfs = 0

        # Run LSTM forecast
        predicted_f = self.forecaster.predict(window_history)

        # Apply the exact mathematical formulation from Image 2:
        # N = ceil( (f * (1 + m)) / (mu * gamma) )
        numerator = predicted_f * (1.0 + self.margin)
        denominator = self.mu * self.gamma
        target_N = int(math.ceil(numerator / max(1e-3, denominator)))
        target_N = max(1, target_N)

        effective_amfs = self.active_amfs + self.booting_amfs

        scale_up = False
        scale_down = False
        action_msg = "Hold (Capacity Adequate)"

        if target_N > effective_amfs:
            # Shortfall detected! Boot AMFs immediately 45s ahead of surge
            shortfall = target_N - effective_amfs
            scale_up = True
            self.booting_amfs += shortfall
            self.boot_start_time = now
            self.last_scale_time = now
            action_msg = f"PROACTIVE SCALE-UP: Booting {shortfall} new AMF(s) now to hide 40s cold-start lag"
        elif target_N < self.active_amfs and (now - self.last_scale_time) >= self.scale_down_cooldown:
            # Scale down slowly after cooldown to avoid flapping
            scale_down = True
            self.active_amfs = target_N
            self.last_scale_time = now
            action_msg = f"SCALE-DOWN: Draining excess AMF(s), new active count = {self.active_amfs}"

        return {
            "predicted_rps": round(predicted_f, 2),
            "current_rps": round(window_history[-1], 2) if window_history else 0.0,
            "target_amfs": target_N,
            "active_amfs": self.active_amfs,
            "booting_amfs": self.booting_amfs,
            "effective_amfs": self.active_amfs + self.booting_amfs,
            "scale_up": scale_up,
            "scale_down": scale_down,
            "scale_to": target_N,
            "action": action_msg,
            "horizon_seconds": self.horizon,
            "formula": f"ceil({round(predicted_f,1)} * {1.0+self.margin} / ({self.mu} * {self.gamma})) = {target_N}"
        }
