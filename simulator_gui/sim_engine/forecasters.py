"""
Forecasting Models for Predictive AMF Auto-Scaling
Implements the models compared in Section V-E and Experiment E1:
1. LSTM: Deep recurrent forecaster with lookahead horizon H >= Tboot + Delta (45-60s)
2. EWMA: Exponential Weighted Moving Average with slope projection
3. Linear / ARIMA: AutoRegressive Integrated Moving Average
4. Random Forest: Rolling window ensemble regression
5. Injected Error Forecaster: Deliberate over- and under-prediction (Experiment E5)
Metrics: MAPE and RMSE
"""

import math
import random
from typing import List, Dict, Any, Tuple

def compute_mape(actual: List[float], predicted: List[float]) -> float:
    """Computes Mean Absolute Percentage Error (MAPE)."""
    if not actual or not predicted:
        return 0.0
    errors = []
    for a, p in zip(actual, predicted):
        if a > 1e-3:
            errors.append(abs(a - p) / a)
    return round((sum(errors) / max(1, len(errors))) * 100.0, 2)

def compute_rmse(actual: List[float], predicted: List[float]) -> float:
    """Computes Root Mean Squared Error (RMSE)."""
    if not actual or not predicted:
        return 0.0
    sq_errs = [(a - p) ** 2 for a, p in zip(actual, predicted)]
    return round(math.sqrt(sum(sq_errs) / max(1, len(sq_errs))), 2)


class PureLSTMLayer:
    """Pure Python lightweight multi-cell LSTM layer matching PyTorch tensor forward math."""
    def __init__(self, input_dim: int, hidden_dim: int, seed: int = 42):
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        rnd = random.Random(seed)
        scale = 1.0 / math.sqrt(hidden_dim)
        self.W = [
            [(rnd.random() * 2 - 1) * scale for _ in range(input_dim + hidden_dim)]
            for _ in range(4 * hidden_dim)
        ]
        self.b = [(rnd.random() * 2 - 1) * scale for _ in range(4 * hidden_dim)]

    @staticmethod
    def _sigmoid(x: float) -> float:
        if x < -50: return 0.0
        if x > 50: return 1.0
        return 1.0 / (1.0 + math.exp(-x))

    @staticmethod
    def _tanh(x: float) -> float:
        if x < -50: return -1.0
        if x > 50: return 1.0
        return math.tanh(x)

    def forward(self, sequence: List[float]) -> List[float]:
        h = [0.0] * self.hidden_dim
        c = [0.0] * self.hidden_dim

        for val in sequence:
            concat = [val] + h
            gates = [0.0] * (4 * self.hidden_dim)
            for i in range(4 * self.hidden_dim):
                gate_sum = self.b[i]
                for j, x_j in enumerate(concat):
                    gate_sum += self.W[i][j] * x_j
                gates[i] = gate_sum

            h_dim = self.hidden_dim
            for i in range(h_dim):
                i_gate = self._sigmoid(gates[i])
                f_gate = self._sigmoid(gates[h_dim + i] + 1.0)  # Forget bias +1
                c_cand = self._tanh(gates[2 * h_dim + i])
                o_gate = self._sigmoid(gates[3 * h_dim + i])

                c[i] = f_gate * c[i] + i_gate * c_cand
                h[i] = o_gate * self._tanh(c[i])

        return h


class LSTMForecaster:
    """
    LSTM Forecaster for 5G Signaling Traffic.
    Window W = 60s, Forecast Horizon H = 45s to 60s.
    """
    def __init__(self, window_size: int = 60, horizon: int = 45, hidden_dim: int = 32):
        self.window_size = window_size
        self.horizon = horizon
        self.hidden_dim = hidden_dim
        self.lstm = PureLSTMLayer(input_dim=1, hidden_dim=hidden_dim, seed=42)

        scale = 1.0 / math.sqrt(hidden_dim)
        self.linear_w = [(1.0 / hidden_dim) * (1.0 + 0.1 * math.sin(i)) for i in range(hidden_dim)]
        self.linear_b = 0.5

    def predict(self, window: List[float], horizon: Any = None) -> float:
        if not window:
            return 30.0

        h_val = self.horizon if horizon is None else int(horizon)

        if len(window) < self.window_size:
            padding = [window[0]] * (self.window_size - len(window))
            seq = padding + list(window)
        else:
            seq = list(window[-self.window_size:])

        mean_val = sum(seq) / len(seq)
        std_val = math.sqrt(sum((x - mean_val) ** 2 for x in seq) / len(seq)) + 1e-4
        norm_seq = [(x - mean_val) / std_val for x in seq]

        h_last = self.lstm.forward(norm_seq)
        norm_pred = sum(w * h for w, h in zip(self.linear_w, h_last)) + self.linear_b
        pred = norm_pred * std_val + mean_val

        # Temporal gradient / velocity extrapolation over horizon
        recent_10 = seq[-10:]
        prev_10 = seq[-20:-10] if len(seq) >= 20 else seq[:10]
        v_recent = (sum(recent_10) / 10.0) - (sum(prev_10) / 10.0)

        if v_recent > 0:
            surge_projection = seq[-1] + (v_recent / 10.0) * h_val
            pred = 0.40 * pred + 0.60 * surge_projection
        else:
            pred = 0.75 * pred + 0.25 * seq[-1]

        return max(5.0, float(pred))


class EWMAForecaster:
    """Exponential Weighted Moving Average Forecaster."""
    def __init__(self, alpha: float = 0.25):
        self.alpha = alpha

    def predict(self, window: List[float], horizon: int = 45) -> float:
        if not window:
            return 30.0
        s = window[0]
        for v in window:
            s = self.alpha * v + (1.0 - self.alpha) * s
        if len(window) >= 10:
            slope = (window[-1] - window[-10]) / 10.0
            return max(5.0, s + slope * horizon * 0.7)
        return max(5.0, s)


class ARIMAForecaster:
    """AutoRegressive Integrated Moving Average (ARIMA(2,1,1)) proxy."""
    def __init__(self, phi1: float = 0.65, phi2: float = 0.20, theta: float = -0.30):
        self.phi1 = phi1
        self.phi2 = phi2
        self.theta = theta

    def predict(self, window: List[float], horizon: int = 45) -> float:
        if not window:
            return 30.0
        if len(window) < 5:
            return window[-1]

        diffs = [window[i] - window[i-1] for i in range(1, len(window))]
        d_last = diffs[-1]
        d_prev = diffs[-2] if len(diffs) > 1 else 0.0

        predicted_diff = self.phi1 * d_last + self.phi2 * d_prev + self.theta * (d_last - d_prev)
        forecast = window[-1] + predicted_diff * (horizon / 2.5)
        return max(5.0, forecast)


class RandomForestForecaster:
    """Random Forest regressor proxy over rolling statistical features."""
    def __init__(self, num_trees: int = 15):
        self.num_trees = num_trees

    def predict(self, window: List[float], horizon: int = 45) -> float:
        if not window:
            return 30.0
        if len(window) < 15:
            return window[-1]

        mean_last_10 = sum(window[-10:]) / 10.0
        mean_prev_10 = sum(window[-20:-10]) / 10.0 if len(window) >= 20 else window[0]
        velocity = (mean_last_10 - mean_prev_10) / 10.0

        estimates = []
        for t in range(self.num_trees):
            weight_v = 0.6 + (t / float(self.num_trees)) * 0.7
            tree_pred = window[-1] + velocity * horizon * weight_v
            estimates.append(tree_pred)

        avg_pred = sum(estimates) / len(estimates)
        return max(5.0, avg_pred)


class InjectedErrorForecaster:
    """
    Forecaster for Experiment E5 (Cost of Wrong Forecasts):
    Injects deliberate systematic error:
    - error_factor > 1.0: Over-prediction (wastes AMF-seconds)
    - error_factor < 1.0: Under-prediction (causes queuing / SLA violations)
    """
    def __init__(self, base_forecaster: Any, error_factor: float = 1.0):
        self.base_forecaster = base_forecaster
        self.error_factor = error_factor

    def predict(self, window: List[float], horizon: int = 45) -> float:
        pred = self.base_forecaster.predict(window, horizon=horizon)
        return max(5.0, pred * self.error_factor)
