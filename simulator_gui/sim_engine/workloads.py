"""
Workload Generators for 5G Core Control-Plane Traffic
Implements the 5 structured traces specified in Section V-C of the paper:
1. Diurnal: Sinusoidal day/night baseline with Gaussian noise.
2. Ramp: Steady linear ramp-up of control-plane registrations.
3. Flash Crowd / mMTC Storm: Sudden massive burst of IoT registrations.
4. Markov-Modulated Poisson Bursts: State-switching between low, medium, and burst rates.
5. Paper-Like Uniform Random: Unpredictable uniform arrivals (ScaleLB baseline).
"""

import math
import random
from typing import List, Dict, Any

def generate_diurnal_workload(duration_s: int = 240, base_load: float = 40.0, peak_load: float = 240.0, noise_std: float = 6.0, seed: int = 42) -> List[float]:
    """Generates diurnal traffic following a sinusoidal cycle with Gaussian noise."""
    rnd = random.Random(seed)
    rates = []
    # One cycle over the duration
    for t in range(duration_s):
        cycle = math.sin((2 * math.pi * t) / max(60, duration_s))
        # Scale between base_load and peak_load
        rate = base_load + (peak_load - base_load) * 0.5 * (1.0 + cycle)
        noise = rnd.gauss(0, noise_std)
        rates.append(max(5.0, round(rate + noise, 2)))
    return rates

def generate_ramp_workload(duration_s: int = 240, start_rate: float = 30.0, end_rate: float = 300.0, noise_std: float = 5.0, seed: int = 42) -> List[float]:
    """Generates a steady linear ramp-up in signaling traffic."""
    rnd = random.Random(seed)
    rates = []
    for t in range(duration_s):
        progress = t / float(max(1, duration_s - 1))
        rate = start_rate + (end_rate - start_rate) * progress + rnd.gauss(0, noise_std)
        rates.append(max(5.0, round(rate, 2)))
    return rates

def generate_flash_crowd_workload(duration_s: int = 240, base_load: float = 35.0, peak_load: float = 320.0, surge_start: int = 80, surge_duration: int = 60, seed: int = 42) -> List[float]:
    """
    Generates the flash crowd / mMTC storm traffic surge from ScaleLB Figure 5:
    - Normal baseline before surge_start
    - Sharp surge over 30s
    - Sustained peak for surge_duration
    - Gradual cool-down
    """
    rnd = random.Random(seed)
    rates = []
    ramp_up = 30
    peak_end = surge_start + surge_duration
    ramp_down = 30

    for t in range(duration_s):
        if t < surge_start:
            rate = base_load + rnd.gauss(0, 3.0)
        elif t < surge_start + ramp_up:
            progress = (t - surge_start) / float(ramp_up)
            rate = base_load + (peak_load - base_load) * progress + rnd.gauss(0, 5.0)
        elif t < peak_end:
            rate = peak_load + rnd.gauss(0, 8.0)
        elif t < peak_end + ramp_down:
            progress = (t - peak_end) / float(ramp_down)
            rate = peak_load - (peak_load - base_load) * progress + rnd.gauss(0, 4.0)
        else:
            rate = base_load + rnd.gauss(0, 3.0)
        rates.append(max(5.0, round(rate, 2)))
    return rates

def generate_markov_poisson_workload(duration_s: int = 240, seed: int = 42) -> List[float]:
    """
    Markov-Modulated Poisson Process (MMPP):
    3 States:
      State 0 (Idle/Low): ~30 req/s
      State 1 (Normal):   ~90 req/s
      State 2 (Burst):    ~260 req/s
    """
    rnd = random.Random(seed)
    # Transition probability matrix (per-second check)
    # [ [P00, P01, P02], [P10, P11, P12], [P20, P21, P22] ]
    states_means = [30.0, 95.0, 260.0]
    current_state = 0
    rates = []

    for _ in range(duration_s):
        u = rnd.random()
        if current_state == 0:
            if u < 0.05:
                current_state = 1
            elif u < 0.07:
                current_state = 2
        elif current_state == 1:
            if u < 0.06:
                current_state = 0
            elif u < 0.12:
                current_state = 2
        else:  # current_state == 2 (Burst)
            if u < 0.15:
                current_state = 1
            elif u < 0.22:
                current_state = 0

        target_rate = states_means[current_state]
        # Poisson sample or Gaussian approximation
        sample = rnd.gauss(target_rate, math.sqrt(target_rate))
        rates.append(max(5.0, round(sample, 2)))
    return rates

def generate_uniform_workload(duration_s: int = 240, min_rate: float = 40.0, max_rate: float = 240.0, seed: int = 42) -> List[float]:
    """
    ScaleLB paper-like uniform random arrivals.
    Demonstrates paper's hypothesis that prediction models offer little gain on unstructured white noise.
    """
    rnd = random.Random(seed)
    rates = []
    for _ in range(duration_s):
        rate = rnd.uniform(min_rate, max_rate)
        rates.append(round(rate, 2))
    return rates

def get_workload_by_name(name: str, duration_s: int = 200, seed: int = 42) -> List[float]:
    name_clean = name.lower().replace(" ", "_").replace("-", "_")
    if "flash" in name_clean or "surge" in name_clean or "storm" in name_clean:
        return generate_flash_crowd_workload(duration_s=duration_s, seed=seed)
    elif "diurnal" in name_clean or "sinusoid" in name_clean:
        return generate_diurnal_workload(duration_s=duration_s, seed=seed)
    elif "ramp" in name_clean:
        return generate_ramp_workload(duration_s=duration_s, seed=seed)
    elif "markov" in name_clean or "poisson" in name_clean or "burst" in name_clean:
        return generate_markov_poisson_workload(duration_s=duration_s, seed=seed)
    elif "uniform" in name_clean:
        return generate_uniform_workload(duration_s=duration_s, seed=seed)
    else:
        return generate_flash_crowd_workload(duration_s=duration_s, seed=seed)
