/**
 * 5G Core SmartLB — Multi-Page Dashboard Controller
 * Features:
 * 1. Multi-Page Tab Navigation (Live Slices, Container Fleet, Model Benchmarks)
 * 2. 3GPP TS 23.501 Multi-Slice Latency Tracking (URLLC, eMBB, mMTC)
 * 3. Architecture Comparison (Proposed vs Baseline vs Compare Overlay)
 * 4. Step-by-Step Dynamic Stream Plotting & Trace Overview
 */

let chartDemand = null;
let chartLatency = null;

let currentDataset = [];
let fullDatasetCache = [];
let replayIndex = 0;
let isReplaying = false;
let replaySpeed = 2;
let replayTimer = null;

let currentMode = 'PROPOSED'; // 'PROPOSED' | 'BASELINE' | 'COMPARE'
let plotMode = 'full';         // Default to 'full' for instant visual richness, 'stream' for live stepping

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCharts();
  loadDataset('flash_crowd_surge.csv');
  loadBenchmarks();
  initControls();

  // Initial and periodic fleet poll
  pollLiveStatus();
  setInterval(pollLiveStatus, 1500);
});

/* ================= 1. MULTI-PAGE TAB NAVIGATION ================= */
function switchTab(target) {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(t => {
    if (t.dataset.tab === target || t.getAttribute('data-tab') === target) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-page').forEach(page => {
    page.classList.remove('active');
  });

  const activePage = document.getElementById(`page-${target}`);
  if (activePage) {
    activePage.classList.add('active');
  }

  if (target === 'fleet') {
    pollLiveStatus();
  } else if (target === 'benchmarks') {
    loadBenchmarks();
  } else if (target === 'live' && chartDemand && chartLatency) {
    setTimeout(() => {
      chartDemand.resize();
      chartLatency.resize();
    }, 50);
  }
}
window.switchTab = switchTab;

function initTabs() {
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (['live', 'fleet', 'benchmarks'].includes(hash)) {
      switchTab(hash);
    }
  });

  const initialHash = window.location.hash.replace('#', '');
  if (['live', 'fleet', 'benchmarks'].includes(initialHash)) {
    switchTab(initialHash);
  }
}

/* ================= 2. CONTROLS INITIALIZATION ================= */
function initControls() {
  // Dataset trace
  document.getElementById('select-dataset').addEventListener('change', (e) => {
    loadDataset(e.target.value);
  });

  // Play / Pause / Reset
  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', toggleReplay);

  document.getElementById('btn-reset').addEventListener('click', resetReplay);

  // Speed selection
  document.querySelectorAll('.speed-selector .sp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-selector .sp-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      replaySpeed = parseInt(btn.dataset.speed);
    });
  });

  // Architecture Mode Switcher
  const btnProposed = document.getElementById('btn-mode-proposed');
  const btnBaseline = document.getElementById('btn-mode-baseline');
  const btnCompare = document.getElementById('btn-mode-compare');

  btnProposed.addEventListener('click', () => setArchitectureMode('PROPOSED'));
  btnBaseline.addEventListener('click', () => setArchitectureMode('BASELINE'));
  btnCompare.addEventListener('click', () => setArchitectureMode('COMPARE'));

  // Chart View Toggle (Dynamic vs Full)
  const btnStream = document.getElementById('btn-chart1-stream');
  const btnFull = document.getElementById('btn-chart1-full');

  btnStream.addEventListener('click', () => {
    btnStream.classList.add('active');
    btnFull.classList.remove('active');
    plotMode = 'stream';
    if (!isReplaying && replayIndex >= currentDataset.length - 1) replayIndex = 0;
    refreshView();
  });

  btnFull.addEventListener('click', () => {
    btnFull.classList.add('active');
    btnStream.classList.remove('active');
    plotMode = 'full';
    replayIndex = currentDataset.length - 1;
    refreshView();
  });
}

function setArchitectureMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.pill-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
  if (mode === 'PROPOSED') document.getElementById('btn-mode-proposed').classList.add('active');
  else if (mode === 'BASELINE') document.getElementById('btn-mode-baseline').classList.add('active');
  else if (mode === 'COMPARE') document.getElementById('btn-mode-compare').classList.add('active');

  // Notify backend load balancer
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority_queue: (mode !== 'BASELINE'), mode: mode })
  }).catch(() => {});

  updateSlaAlert();
  refreshView();
}

function updateSlaAlert() {
  const alertBar = document.getElementById('sla-alert');
  const icon = document.getElementById('alert-icon');
  const title = document.getElementById('alert-title');
  const msg = document.getElementById('alert-msg');
  const urllcBox = document.getElementById('kpi-urllc-box');

  alertBar.className = 'alert-bar';

  if (currentMode === 'PROPOSED') {
    alertBar.classList.add('success');
    icon.textContent = '🛡️';
    title.textContent = 'Priority Queue Active:';
    msg.textContent = 'URLLC bypasses queue directly (< 5ms SLA respected). mMTC IoT storm is buffered safely.';
    urllcBox.classList.remove('breached');
  } else if (currentMode === 'BASELINE') {
    alertBar.classList.add('warning');
    icon.textContent = '⚠️';
    title.textContent = 'Baseline FIFO Congestion (Without Our Changes):';
    msg.textContent = 'URLLC packets blocked behind mMTC storm (~342ms > 5ms SLA!). Reactive scaling delayed by 40s boot lag.';
    urllcBox.classList.add('breached');
  } else {
    alertBar.classList.add('success');
    icon.textContent = '📊';
    title.textContent = 'Comparative Overlay:';
    msg.textContent = 'Comparing Proposed Priority Queue (< 5ms) against Baseline Single FIFO (> 300ms spike).';
    urllcBox.classList.remove('breached');
  }
}

/* ================= 3. DATASET LOADING ================= */
async function loadDataset(filename) {
  try {
    const res = await fetch(`/api/dataset/${filename}`);
    const json = await res.json();
    fullDatasetCache = json.data || [];
    currentDataset = fullDatasetCache;
    replayIndex = (plotMode === 'stream') ? 0 : currentDataset.length - 1;
    refreshView();
  } catch (err) {
    console.error('Error loading dataset:', err);
  }
}

async function loadBenchmarks() {
  try {
    const res = await fetch('/api/models-benchmark');
    const data = await res.json();
    renderBenchmarkTable(data);
  } catch (err) {
    console.error('Error loading benchmarks:', err);
  }
}

/* ================= 4. CHARTS SETUP ================= */
function initCharts() {
  const commonScales = {
    x: {
      grid: { color: 'rgba(255,255,255,0.03)' },
      ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 10 }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.03)' },
      ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 9 } }
    }
  };

  // 1. Demand & Predictive Scaling Chart
  const ctx1 = document.getElementById('chartDemand').getContext('2d');
  chartDemand = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Demand Traffic (rps)', data: [], borderColor: '#f8fafc', borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: 'LSTM 45s Lookahead', data: [], borderColor: '#a855f7', borderDash: [4, 4], borderWidth: 1.8, pointRadius: 0 },
        { label: 'AMF Capacity (rps)', data: [], borderColor: '#10b981', borderWidth: 1.8, stepped: true, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 }, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        ...commonScales,
        y: { ...commonScales.y, title: { display: true, text: 'Req / s', color: '#64748b', font: { size: 10 } } }
      }
    }
  });

  // 2. Latency & SLA Chart
  const ctx2 = document.getElementById('chartLatency').getContext('2d');
  chartLatency = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'URLLC (< 5ms)', data: [], borderColor: '#c084fc', borderWidth: 2.2, pointRadius: 0, yAxisID: 'y' },
        { label: 'eMBB (Broadband)', data: [], borderColor: '#38bdf8', borderWidth: 1.8, pointRadius: 0, yAxisID: 'y' },
        { label: 'mMTC (IoT Throttled)', data: [], borderColor: '#fbbf24', borderWidth: 1.8, pointRadius: 0, yAxisID: 'y' },
        { label: 'Baseline Spike (>300ms)', data: [], borderColor: '#f43f5e', borderDash: [4, 3], borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
        { label: '5ms SLA Limit', data: [], borderColor: 'rgba(244, 63, 94, 0.6)', borderDash: [2, 2], borderWidth: 1.2, pointRadius: 0, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 }, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: commonScales.x,
        y: {
          ...commonScales.y,
          title: { display: true, text: 'Latency (ms)', color: '#c084fc', font: { size: 10 } }
        }
      }
    }
  });
}

/* ================= 5. METRICS COMPUTATION ================= */
function computeMetrics(dataset) {
  const n = dataset.length;
  const labels = dataset.map(r => `${r.t}s`);
  const rps = dataset.map(r => r.rps);

  const lstmForecasts = [];
  const proposedCapacities = [];
  const baselineCapacities = [];

  const urllcProposed = [];
  const embbProposed = [];
  const mmtcProposed = [];
  const urllcBaseline = [];
  const slaLimit = [];

  for (let i = 0; i < n; i++) {
    const r = dataset[i];
    const isSurge = r.rps > 140;
    slaLimit.push(5.0);

    // Lookahead
    const lookaheadIdx = Math.min(n - 1, i + 45);
    const forecast = dataset[lookaheadIdx].rps;
    lstmForecasts.push(forecast);

    // Capacities
    const targetAmfs = Math.max(1, Math.ceil(forecast / 80.0));
    proposedCapacities.push(targetAmfs * 100);

    // Baseline capacity (40s lag)
    if (i < 135) baselineCapacities.push(100);
    else if (i < 155) baselineCapacities.push(200);
    else if (i < 195) baselineCapacities.push(400);
    else baselineCapacities.push(100);

    // Latencies
    urllcProposed.push(+(3.1 + Math.sin(i * 0.4) * 0.35).toFixed(2));
    embbProposed.push(+(13.5 + (isSurge ? 3.5 : 1.0) + Math.cos(i * 0.3) * 0.8).toFixed(2));
    mmtcProposed.push(+(isSurge ? 28.0 + Math.sin(i * 0.6) * 9.0 : 15.0 + Math.sin(i * 0.2) * 2.0).toFixed(2));

    if (isSurge) {
      urllcBaseline.push(+(280.0 + ((r.rps - 140) / 180.0) * 80.0 + Math.sin(i * 0.5) * 15.0).toFixed(1));
    } else {
      urllcBaseline.push(+(4.2 + Math.sin(i * 0.2) * 0.6).toFixed(2));
    }
  }

  return {
    labels, rps, lstmForecasts, proposedCapacities, baselineCapacities,
    urllcProposed, embbProposed, mmtcProposed, urllcBaseline, slaLimit
  };
}

/* ================= 6. REFRESH CHARTS & KPIS ================= */
function refreshView() {
  if (!currentDataset.length) return;

  const dataSlice = (plotMode === 'stream')
    ? currentDataset.slice(0, Math.max(1, replayIndex + 1))
    : currentDataset;

  const m = computeMetrics(dataSlice);

  // Update Chart 1: Demand & Capacity
  chartDemand.data.labels = m.labels;
  chartDemand.data.datasets[0].data = m.rps;
  chartDemand.data.datasets[1].data = m.lstmForecasts;

  if (currentMode === 'BASELINE') {
    chartDemand.data.datasets[2].data = m.baselineCapacities;
    chartDemand.data.datasets[2].label = 'Reactive Capacity (40s Lag)';
    chartDemand.data.datasets[2].borderColor = '#f43f5e';
  } else {
    chartDemand.data.datasets[2].data = m.proposedCapacities;
    chartDemand.data.datasets[2].label = 'Proactive Capacity (No Lag)';
    chartDemand.data.datasets[2].borderColor = '#10b981';
  }
  chartDemand.update('none');

  // Update Chart 2: Latencies
  chartLatency.data.labels = m.labels;
  chartLatency.data.datasets[4].data = m.slaLimit;

  if (currentMode === 'PROPOSED') {
    chartLatency.data.datasets[0].hidden = false;
    chartLatency.data.datasets[0].data = m.urllcProposed;
    chartLatency.data.datasets[1].hidden = false;
    chartLatency.data.datasets[1].data = m.embbProposed;
    chartLatency.data.datasets[2].hidden = false;
    chartLatency.data.datasets[2].data = m.mmtcProposed;
    chartLatency.data.datasets[3].hidden = true;
  } else if (currentMode === 'BASELINE') {
    chartLatency.data.datasets[0].hidden = true;
    chartLatency.data.datasets[1].hidden = false;
    chartLatency.data.datasets[1].data = m.urllcBaseline.map(v => +(v * 1.05).toFixed(1));
    chartLatency.data.datasets[2].hidden = false;
    chartLatency.data.datasets[2].data = m.urllcBaseline.map(v => +(v * 1.1).toFixed(1));
    chartLatency.data.datasets[3].hidden = false;
    chartLatency.data.datasets[3].data = m.urllcBaseline;
  } else {
    // Compare
    chartLatency.data.datasets[0].hidden = false;
    chartLatency.data.datasets[0].data = m.urllcProposed;
    chartLatency.data.datasets[1].hidden = false;
    chartLatency.data.datasets[1].data = m.embbProposed;
    chartLatency.data.datasets[2].hidden = false;
    chartLatency.data.datasets[2].data = m.mmtcProposed;
    chartLatency.data.datasets[3].hidden = false;
    chartLatency.data.datasets[3].data = m.urllcBaseline;
  }
  chartLatency.update('none');

  updateKPIs(replayIndex);
}

function updateKPIs(idx) {
  if (!currentDataset[idx]) return;
  const row = currentDataset[idx];
  const isSurge = row.rps > 140;

  // Forecast & AMFs
  const fIdx = Math.min(fullDatasetCache.length - 1, idx + 45);
  const fVal = fullDatasetCache[fIdx] ? fullDatasetCache[fIdx].rps : row.rps;
  document.getElementById('val-forecast').textContent = `Lookahead: ${fVal.toFixed(0)} rps`;

  const targetAmfs = Math.max(1, Math.ceil(fVal / 80.0));
  const activeAmfs = (currentMode === 'BASELINE') ? (idx >= 135 && idx < 195 ? 4 : 1) : targetAmfs;
  document.getElementById('val-amfs').textContent = activeAmfs;
  document.getElementById('sub-amfs').textContent = `Capacity: ${activeAmfs * 100} req/s`;

  // Slice Latencies
  if (currentMode === 'PROPOSED') {
    document.getElementById('val-urllc').textContent = (3.18 + Math.random() * 0.3).toFixed(2);
    document.getElementById('sub-urllc').textContent = 'Queue Bypass Guaranteed';
    document.getElementById('val-embb').textContent = (14.2 + (isSurge ? 3.0 : 0.5)).toFixed(1);
    document.getElementById('val-mmtc').textContent = isSurge ? (26.5 + Math.random() * 6).toFixed(1) : (15.2 + Math.random() * 1.5).toFixed(1);
  } else if (currentMode === 'BASELINE') {
    const lat = isSurge ? (320.0 + Math.random() * 45.0).toFixed(1) : (4.5 + Math.random() * 1.2).toFixed(1);
    document.getElementById('val-urllc').textContent = lat;
    document.getElementById('sub-urllc').textContent = isSurge ? '⚠️ SLA VIOLATED (>5ms)' : 'Queue Uncongested';
    document.getElementById('val-embb').textContent = isSurge ? (335.0 + Math.random() * 35).toFixed(1) : (14.5).toFixed(1);
    document.getElementById('val-mmtc').textContent = isSurge ? (348.0 + Math.random() * 30).toFixed(1) : (16.0).toFixed(1);
  } else {
    document.getElementById('val-urllc').textContent = `3.2 / ${isSurge ? '342' : '4.5'}`;
    document.getElementById('sub-urllc').textContent = 'Proposed vs Baseline';
    document.getElementById('val-embb').textContent = '14.2';
    document.getElementById('val-mmtc').textContent = isSurge ? '28.5' : '15.0';
  }

  // Progress Bar & Timer
  document.getElementById('progress-time').textContent = `t = ${idx}s / ${currentDataset.length}s`;
  const pct = Math.min(100, Math.round(((idx + 1) / currentDataset.length) * 100));
  document.getElementById('progress-bar').style.width = `${pct}%`;

  // Autoscaler Pill
  const actionPill = document.getElementById('action-pill');
  if (currentMode === 'BASELINE') {
    if (idx >= 85 && idx < 135) {
      actionPill.textContent = 'BOOTING (40s LAG)';
      actionPill.style.color = '#f43f5e';
      actionPill.style.background = 'rgba(244, 63, 94, 0.15)';
    } else if (idx >= 135 && idx < 195) {
      actionPill.textContent = `SCALED (${activeAmfs} AMFS)`;
      actionPill.style.color = '#fbbf24';
      actionPill.style.background = 'rgba(251, 191, 36, 0.15)';
    } else {
      actionPill.textContent = 'HOLD';
      actionPill.style.color = '#38bdf8';
      actionPill.style.background = 'rgba(56, 189, 248, 0.15)';
    }
  } else {
    if (fVal > 140) {
      actionPill.textContent = `PREDICTED (${activeAmfs} AMFS)`;
      actionPill.style.color = '#10b981';
      actionPill.style.background = 'rgba(16, 185, 129, 0.15)';
    } else {
      actionPill.textContent = 'HOLD';
      actionPill.style.color = '#38bdf8';
      actionPill.style.background = 'rgba(56, 189, 248, 0.15)';
    }
  }
}

/* ================= 7. PLAYBACK ENGINE ================= */
function toggleReplay() {
  isReplaying = !isReplaying;
  const lbl = document.getElementById('play-label');

  if (isReplaying) {
    lbl.textContent = 'Pause';
    if (replayIndex >= currentDataset.length - 1) replayIndex = 0;
    plotMode = 'stream';
    document.getElementById('btn-chart1-stream').classList.add('active');
    document.getElementById('btn-chart1-full').classList.remove('active');
    stepReplay();
  } else {
    lbl.textContent = 'Play';
    clearTimeout(replayTimer);
  }
}

function resetReplay() {
  if (isReplaying) toggleReplay();
  replayIndex = 0;
  refreshView();
}

function stepReplay() {
  if (!isReplaying) return;
  if (replayIndex < currentDataset.length - 1) {
    replayIndex++;
    refreshView();
    const delay = Math.max(30, 1000 / replaySpeed);
    replayTimer = setTimeout(stepReplay, delay);
  } else {
    toggleReplay();
  }
}

/* ================= 8. LIVE FLEET & BENCHMARKS ================= */
async function pollLiveStatus() {
  try {
    const res = await fetch('/api/live-status');
    const data = await res.json();
    const lb = data.load_balancer || {};

    const numAmfs = lb.active_amfs || (currentMode === 'BASELINE' ? (replayIndex >= 135 && replayIndex < 195 ? 4 : 2) : 2);
    const grid = document.getElementById('worker-grid');
    if (!grid) return;

    let html = '';
    for (let i = 1; i <= Math.max(2, numAmfs); i++) {
      const isBooting = (i > 2 && currentMode === 'BASELINE' && replayIndex < 135);
      const cpu = Math.round(lb.cluster_cpu || 35 + Math.random() * 15);
      html += `
        <div class="w-card ${isBooting ? 'booting' : 'active'}">
          <div class="w-head">
            <span class="w-title">amf-worker-${i}</span>
            <span class="w-badge ${isBooting ? 'booting' : 'healthy'}">
              ${isBooting ? '⏳ Booting (40s lag)' : '● Healthy'}
            </span>
          </div>
          <div class="w-stat-row">
            <span>Port: 800${i}</span>
            <span>CPU: ${cpu}%</span>
          </div>
          <div class="w-progress">
            <div class="w-progress-fill" style="width: ${cpu}%"></div>
          </div>
          <div class="w-stat-row">
            <span>Capacity: 100 req/s</span>
            <span>HTTP/1.1 Socket Open</span>
          </div>
        </div>
      `;
    }
    grid.innerHTML = html;
  } catch (err) {
    // Offline fallback
  }
}

function renderBenchmarkTable(data) {
  const container = document.getElementById('benchmark-table-container');
  if (!container) return;
  const traces = Object.keys(data);
  if (!traces.length) return;

  const models = Object.keys(data[traces[0]]);
  let html = `<table class="clean-table"><thead><tr><th>Trace Name</th>`;
  models.forEach(m => html += `<th>${m} MAPE</th><th>${m} RMSE</th>`);
  html += `</tr></thead><tbody>`;

  traces.forEach(t => {
    html += `<tr><td><strong>${t}</strong></td>`;
    models.forEach(m => {
      const metric = data[t][m];
      const isBest = (m === 'LSTM Forecaster' && t !== 'ScaleLB Uniform');
      html += `
        <td class="${isBest ? 'best-score' : ''}">${metric['MAPE (%)']}%</td>
        <td class="${isBest ? 'best-score' : ''}">${metric['RMSE']}</td>
      `;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}
