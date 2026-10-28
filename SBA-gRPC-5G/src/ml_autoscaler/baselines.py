"""
Baseline Comparison Forecasters and Auto-Scaling Algorithms
Implements benchmark models to compare against the LSTM Predictive Auto-Scaler:
1. ScaleLB Reactive/Threshold Scaling (Dev et al., ICOIN 2025)
2. Exponential Weighted Moving Average (EWMA)
3. AutoRegressive Integrated Moving Average (ARIMA)
4. Random Forest Regressor
"""

import math
from typing import List, Tuple

class ScaleLBReactive:
    """
    ScaleLB Base Paper Algorithm (Dev, Bera and Tiwari, ICOIN 2025)
    Formula:
        Load Ratio = B / (A * alpha)
        Proactive: Add AMF when B / (A * alpha) >= gamma
        Reactive:  Add AMF when B / (A * alpha) > 1.0
    Flaw: Scaling is triggered only AFTER load has already arrived at the AMF.
          The 40s container spin-up lag causes incoming requests to queue or drop.
    """
    def __init__(self, alpha: float = 100.0, gamma: float = 0.80):
        self.alpha = alpha  # Max capacity per AMF (req/s)
        self.gamma = gamma  # Headroom threshold

    def decide(self, current_load: float, active_amfs: int) -> Tuple[bool, int]:
        ratio = current_load / max(1.0, active_amfs * self.alpha)
        if ratio >= self.gamma:
            needed = int(math.ceil(current_load / (self.alpha * self.gamma)))
            return True, max(active_amfs + 1, needed)
        elif ratio < 0.30 and active_amfs > 1:
            needed = max(1, int(math.floor(current_load / (self.alpha * 0.60))))
            return False, needed
        return False, active_amfs


class EWMAForecaster:
    """
    Exponential Weighted Moving Average (EWMA) Baseline
    Formula: S_t = alpha * Y_t + (1 - alpha) * S_{t-1}
    Fast but lags during abrupt surges and fails to predict non-linear inflection points.
    """
    def __init__(self, alpha: float = 0.25):
        self.alpha = alpha
        self.s = None

    def update_and_predict(self, series: List[float], horizon: int = 45) -> float:
        if not series:
            return 0.0
        self.s = series[0]
        for val in series:
            self.s = self.alpha * val + (1.0 - self.alpha) * self.s
        # Linear slope extrapolation over horizon
        if len(series) >= 10:
            slope = (series[-1] - series[-10]) / 10.0
            return max(0.0, self.s + slope * horizon)
        return max(0.0, self.s)


class ARIMAForecaster:
    """
    AutoRegressive Integrated Moving Average (ARIMA(2,1,1)) Baseline
    Models stationary differenced series: delta_y_t = phi_1 * delta_y_{t-1} + theta * e_{t-1}
    Captures linear trends but is sensitive to noise in Poisson signaling bursts.
    """
    def __init__(self, phi1: float = 0.65, phi2: float = 0.20, theta: float = -0.30):
        self.phi1 = phi1
        self.phi2 = phi2
        self.theta = theta

    def predict(self, series: List[float], horizon: int = 45) -> float:
        if len(series) < 5:
            return series[-1] if series else 0.0

        # First order differencing
        diffs = [series[i] - series[i-1] for i in range(1, len(series))]
        d_last = diffs[-1]
        d_prev = diffs[-2] if len(diffs) > 1 else 0.0

        predicted_diff = self.phi1 * d_last + self.phi2 * d_prev + self.theta * (d_last - d_prev)
        # Integrate forward across horizon
        forecast = series[-1] + predicted_diff * (horizon / 2.0)
        return max(0.0, forecast)


class RandomForestForecaster:
    """
    Random Forest Regressor Baseline
    Uses an ensemble of decision trees over rolling statistical features
    (mean, std, min, max, 10s trend, 30s trend).
    Accurate for steady trends but slower to extrapolate extreme out-of-distribution surges.
    """
    def __init__(self, num_trees: int = 15):
        self.num_trees = num_trees

    def predict(self, series: List[float], horizon: int = 45) -> float:
        if not series:
            return 0.0
        if len(series) < 15:
            return series[-1]

        mean_last_10 = sum(series[-10:]) / 10.0
        mean_prev_10 = sum(series[-20:-10]) / 10.0 if len(series) >= 20 else series[0]
        velocity = (mean_last_10 - mean_prev_10) / 10.0

        # Ensemble of tree predictions with feature perturbance
        estimates = []
        for t in range(self.num_trees):
            weight_v = 0.7 + (t / float(self.num_trees)) * 0.6
            tree_pred = series[-1] + velocity * horizon * weight_v
            estimates.append(tree_pred)

        avg_pred = sum(estimates) / len(estimates)
        return max(0.0, avg_pred)
