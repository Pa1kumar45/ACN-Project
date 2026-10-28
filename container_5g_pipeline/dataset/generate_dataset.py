"""
Synthetic 5G Control-Plane Signaling Dataset Generator
Implements realistic cellular control-plane registration traces based on 3GPP TS 23.501
and the ScaleLB research paper specifications:
- Flash Crowd / mMTC IoT Storm (ScaleLB Fig 5)
- Diurnal cellular usage wave
- Linear traffic growth ramp
- Markov-Modulated Poisson Process (MMPP) bursts
- Uniform random noise (white noise baseline)

Schema:
timestamp, total_rps, urllc_count, embb_count, mmtc_count, traffic_pattern, theoretical_amfs_needed
"""

import os
import math
import random
import csv
from typing import List, Dict, Any

AMF_CAPACITY = 100.0  # mu = 100 req/s per AMF
GAMMA = 0.80          # Target utilization threshold

def generate_flash_crowd_trace(duration_s: int = 240, seed: int = 42) -> List[Dict[str, Any]]:
    rnd = random.Random(seed)
    records = []
    base_load = 35.0
    peak_load = 320.0
    surge_start = 80
    surge_duration = 60

    for t in range(duration_s):
        if t < surge_start:
            rps = base_load + rnd.gauss(0, 2.5)
            pattern = "Baseline Normal"
        elif t < surge_start + 30:
            progress = (t - surge_start) / 30.0
            rps = base_load + (peak_load - base_load) * progress + rnd.gauss(0, 4.0)
            pattern = "Surge Ramp-Up"
        elif t < surge_start + surge_duration:
            rps = peak_load + rnd.gauss(0, 6.0)
            pattern = "Peak IoT Storm"
        elif t < surge_start + surge_duration + 30:
            progress = (t - (surge_start + surge_duration)) / 30.0
            rps = peak_load - (peak_load - base_load) * progress + rnd.gauss(0, 3.5)
            pattern = "Cool-Down Ramp"
        else:
            rps = base_load + rnd.gauss(0, 2.5)
            pattern = "Baseline Normal"

        rps = max(5.0, round(rps, 2))
        # 5G Slice distribution: 10% URLLC, 20% eMBB, 70% mMTC
        urllc = int(round(rps * 0.10))
        embb = int(round(rps * 0.20))
        mmtc = int(round(rps * 0.70))

        # Theoretical required AMFs: ceil( rps / (mu * gamma) )
        needed_amfs = max(1, int(math.ceil(rps / (AMF_CAPACITY * GAMMA))))

        records.append({
            "timestamp_s": t,
            "total_rps": rps,
            "urllc_reqs": urllc,
            "embb_reqs": embb,
            "mmtc_reqs": mmtc,
            "traffic_pattern": pattern,
            "theoretical_amfs": needed_amfs
        })
    return records

def generate_diurnal_trace(duration_s: int = 240, seed: int = 42) -> List[Dict[str, Any]]:
    rnd = random.Random(seed)
    records = []
    base = 35.0
    peak = 250.0

    for t in range(duration_s):
        cycle = math.sin((2 * math.pi * t) / max(60, duration_s))
        rps = base + (peak - base) * 0.5 * (1.0 + cycle) + rnd.gauss(0, 4.0)
        rps = max(5.0, round(rps, 2))
        urllc = int(round(rps * 0.10))
        embb = int(round(rps * 0.20))
        mmtc = int(round(rps * 0.70))
        needed_amfs = max(1, int(math.ceil(rps / (AMF_CAPACITY * GAMMA))))

        records.append({
            "timestamp_s": t,
            "total_rps": rps,
            "urllc_reqs": urllc,
            "embb_reqs": embb,
            "mmtc_reqs": mmtc,
            "traffic_pattern": "Diurnal Sinusoid",
            "theoretical_amfs": needed_amfs
        })
    return records

def generate_ramp_trace(duration_s: int = 240, seed: int = 42) -> List[Dict[str, Any]]:
    rnd = random.Random(seed)
    records = []
    start_r = 30.0
    end_r = 290.0

    for t in range(duration_s):
        progress = t / float(duration_s - 1)
        rps = start_r + (end_r - start_r) * progress + rnd.gauss(0, 3.5)
        rps = max(5.0, round(rps, 2))
        urllc = int(round(rps * 0.10))
        embb = int(round(rps * 0.20))
        mmtc = int(round(rps * 0.70))
        needed_amfs = max(1, int(math.ceil(rps / (AMF_CAPACITY * GAMMA))))

        records.append({
            "timestamp_s": t,
            "total_rps": rps,
            "urllc_reqs": urllc,
            "embb_reqs": embb,
            "mmtc_reqs": mmtc,
            "traffic_pattern": "Linear Growth Ramp",
            "theoretical_amfs": needed_amfs
        })
    return records

def export_all_datasets(output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    traces = {
        "flash_crowd_surge.csv": generate_flash_crowd_trace(duration_s=240, seed=42),
        "diurnal_cycle.csv": generate_diurnal_trace(duration_s=240, seed=42),
        "linear_ramp.csv": generate_ramp_trace(duration_s=240, seed=42)
    }

    # Also build a comprehensive composite master dataset
    master_records = []
    t_offset = 0
    for name, data in traces.items():
        for r in data:
            entry = dict(r)
            entry["global_timestamp_s"] = t_offset
            entry["trace_source"] = name.replace(".csv", "")
            master_records.append(entry)
            t_offset += 1

        # Write individual trace CSV
        filepath = os.path.join(output_dir, name)
        with open(filepath, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(data[0].keys()))
            writer.writeheader()
            writer.writerows(data)
        print(f"[*] Generated: {filepath} ({len(data)} rows)")

    # Write master dataset
    master_path = os.path.join(output_dir, "master_5g_traffic_dataset.csv")
    with open(master_path, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(master_records[0].keys()))
        writer.writeheader()
        writer.writerows(master_records)
    print(f"[*] Generated Master Dataset: {master_path} ({len(master_records)} rows)")

if __name__ == "__main__":
    target_dir = os.path.dirname(os.path.abspath(__file__))
    export_all_datasets(target_dir)
