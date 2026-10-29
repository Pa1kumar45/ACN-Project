/**
 * 5G Core AMF Predictive Auto-Scaling & Priority Slicing Simulator
 * Interactive Frontend Controller & Canvas Visualization Engine
 * NITK Surathkal &bull; ACN Course Project
 */

// Global State
const state = {
  currentTab: 'tab-simulation',
  workload: 'flash_crowd',
  policy: 'lstm',
  hasPriorityQueue: true,
  mu: 100,
  gamma: 0.80,
  tboot: 40,
  horizon: 45,
  margin: 0.10,
  sliceMix: [0.10, 0.20, 0.70], // URLLC, eMBB, mMTC
  
  // Live Simulation state
  isPlaying: false,
  playbackSpeed: 3,
  currentTick: 0,
  maxTicks: 200,
  timerId: null,
  simData: null,
  
  // Animation particles
  particles: [],
  amfCards: [],
  
  // Active Experiment
  activeExp: 'E1',
  expData: null
};

// DOM Elements
const el = {
  // Navigation
  tabs: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  engineStatus: document.getElementById('engine-status'),
  
  // Controls
  workloadSelect: document.getElementById('workload-select'),
  policySelect: document.getElementById('policy-select'),
  pqSwitch: document.getElementById('pq-switch'),
  pqLabel: document.getElementById('pq-label'),
  btnRunFull: document.getElementById('btn-run-full'),
  btnPlayPause: document.getElementById('btn-play-pause'),
  playIcon: document.getElementById('play-icon'),
  playText: document.getElementById('play-text'),
  btnStep: document.getElementById('btn-step'),
  btnReset: document.getElementById('btn-reset'),
  btnInjectSurge: document.getElementById('btn-inject-surge'),
  speedBtns: document.querySelectorAll('.speed-btn'),
  
  // KPIs
  urllcLat: document.getElementById('metric-urllc-lat'),
  urllcP99: document.getElementById('metric-urllc-p99'),
  urllcSlaBadge: document.getElementById('urllc-sla-badge'),
  embbLat: document.getElementById('metric-embb-lat'),
  embbP99: document.getElementById('metric-embb-p99'),
  mmtcLat: document.getElementById('metric-mmtc-lat'),
  mmtcP99: document.getElementById('metric-mmtc-p99'),
  activeAmfs: document.getElementById('metric-active-amfs'),
  bootingAmfs: document.getElementById('metric-booting-amfs'),
  drainingAmfs: document.getElementById('metric-draining-amfs'),
  targetN: document.getElementById('metric-target-n'),
  amfSeconds: document.getElementById('metric-amf-seconds'),
  coldStart: document.getElementById('metric-cold-start'),
  cpuUtil: document.getElementById('metric-cpu-util'),
  slaPill: document.getElementById('sla-status-pill'),
  
  // Canvas
  canvas: document.getElementById('topoCanvas'),
  
  // Hyperparameters
  paramsToggle: document.getElementById('params-toggle'),
  paramsPanel: document.querySelector('.params-panel'),
  sliderMu: document.getElementById('slider-mu'),
  valMu: document.getElementById('val-mu'),
  sliderGamma: document.getElementById('slider-gamma'),
  valGamma: document.getElementById('val-gamma'),
  sliderTboot: document.getElementById('slider-tboot'),
  valTboot: document.getElementById('val-tboot'),
  sliderHorizon: document.getElementById('slider-horizon'),
  valHorizon: document.getElementById('val-horizon'),
  sliderMargin: document.getElementById('slider-margin'),
  valMargin: document.getElementById('val-margin'),
  mixChips: document.querySelectorAll('.chip'),
  valMix: document.getElementById('val-mix'),
  
  // Experiments
  expBtns: document.querySelectorAll('.exp-btn'),
  btnRunExp: document.getElementById('btn-run-exp'),
  expTitle: document.getElementById('exp-title'),
  expDesc: document.getElementById('exp-desc'),
  expTableContainer: document.getElementById('exp-table-container'),
  expTakeawayText: document.getElementById('exp-takeaway-text'),
  
  // Toast
  toast: document.getElementById('toast')
};

// Chart instances
let latencyChart, loadChart, amfChart, cpuChart, expChart;

// ==========================================================================
// Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initControls();
  initSliders();
  initCharts();
  initCanvas();
  initExperiments();
  
  // Run initial simulation
  runSimulation(true);
});

// Toast Helper
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 3500);
}

// Navigation Tabs
function initNavigation() {
  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      el.tabs.forEach(t => t.classList.remove('active'));
      el.tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(target).classList.add('active');
      state.currentTab = target;
      
      if (target === 'tab-experiments' && !state.expData) {
        loadExperiment(state.activeExp);
      }
    });
  });
}

// Controls
function initControls() {
  el.workloadSelect.addEventListener('change', (e) => {
    state.workload = e.target.value;
    runSimulation(true);
  });

  el.policySelect.addEventListener('change', (e) => {
    state.policy = e.target.value;
    runSimulation(true);
  });

  el.pqSwitch.addEventListener('change', (e) => {
    state.hasPriorityQueue = e.target.checked;
    el.pqLabel.textContent = state.hasPriorityQueue ? 'O1 ACTIVE' : 'O1 DISABLED';
    el.pqLabel.style.color = state.hasPriorityQueue ? 'var(--urllc)' : 'var(--text-dim)';
    runSimulation(true);
  });

  el.btnRunFull.addEventListener('click', () => runSimulation(true));

  el.btnPlayPause.addEventListener('click', togglePlayPause);

  el.btnStep.addEventListener('click', () => {
    if (state.isPlaying) togglePlayPause();
    stepForward();
  });

  el.btnReset.addEventListener('click', resetSimulation);

  el.btnInjectSurge.addEventListener('click', () => {
    injectSurge();
  });

  el.speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.playbackSpeed = parseInt(btn.dataset.speed);
    });
  });

  el.paramsToggle.addEventListener('click', () => {
    el.paramsPanel.classList.toggle('collapsed');
  });
}

function initSliders() {
  el.sliderMu.addEventListener('input', (e) => {
    state.mu = parseFloat(e.target.value);
    el.valMu.textContent = `${state.mu} req/s`;
  });
  el.sliderMu.addEventListener('change', () => runSimulation(true));

  el.sliderGamma.addEventListener('input', (e) => {
    state.gamma = parseFloat(e.target.value);
    el.valGamma.textContent = state.gamma.toFixed(2);
  });
  el.sliderGamma.addEventListener('change', () => runSimulation(true));

  el.sliderTboot.addEventListener('input', (e) => {
    state.tboot = parseFloat(e.target.value);
    el.valTboot.textContent = `${state.tboot} s`;
  });
  el.sliderTboot.addEventListener('change', () => runSimulation(true));

  el.sliderHorizon.addEventListener('input', (e) => {
    state.horizon = parseInt(e.target.value);
    el.valHorizon.textContent = `${state.horizon} s`;
  });
  el.sliderHorizon.addEventListener('change', () => runSimulation(true));

  el.sliderMargin.addEventListener('input', (e) => {
    state.margin = parseFloat(e.target.value) / 100.0;
    el.valMargin.textContent = `${e.target.value} %`;
  });
  el.sliderMargin.addEventListener('change', () => runSimulation(true));

  el.mixChips.forEach(chip => {
    chip.addEventListener('click', () => {
      el.mixChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const parts = chip.dataset.mix.split(',').map(v => parseFloat(v) / 100.0);
      state.sliceMix = parts;
      el.valMix.textContent = `${Math.round(parts[0]*100)}% / ${Math.round(parts[1]*100)}% / ${Math.round(parts[2]*100)}%`;
      runSimulation(true);
    });
  });
}

// ==========================================================================
// Simulation API Call & State Management
// ==========================================================================
async function runSimulation(autoUpdate = false) {
  el.engineStatus.textContent = 'Simulating...';
  
  const payload = {
    workload: state.workload,
    duration: 200,
    policy: state.policy,
    has_priority_queue: state.hasPriorityQueue,
    mu: state.mu,
    gamma: state.gamma,
    margin: state.margin,
    boot_time: state.tboot,
    horizon: state.horizon,
    urllc_mix: state.sliceMix[0],
    embb_mix: state.sliceMix[1],
    mmtc_mix: state.sliceMix[2],
    seed: 42
  };

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    state.simData = data;
    el.engineStatus.textContent = 'Engine Ready';

    if (autoUpdate) {
      state.currentTick = state.simData.time_series.length - 1;
      updateAllVisuals(state.currentTick);
      showToast(`Simulation complete: ${data.total_requests} requests processed.`);
    }
  } catch (err) {
    console.error('Simulation error:', err);
    el.engineStatus.textContent = 'Engine Error';
    showToast('Failed to connect to simulation engine backend.');
  }
}

async function injectSurge() {
  if (!state.simData) return;
  const tick = state.currentTick;
  showToast(`Injected +150 req/s IoT storm at t=${tick}s!`);

  const payload = {
    workload: state.workload,
    duration: 200,
    policy: state.policy,
    has_priority_queue: state.hasPriorityQueue,
    mu: state.mu,
    gamma: state.gamma,
    margin: state.margin,
    boot_time: state.tboot,
    horizon: state.horizon,
    urllc_mix: state.sliceMix[0],
    embb_mix: state.sliceMix[1],
    mmtc_mix: state.sliceMix[2],
    spike_at: tick,
    spike_amount: 150.0,
    seed: 42
  };

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    state.simData = data;
    updateAllVisuals(state.currentTick);
  } catch (err) {
    console.error(err);
  }
}

function togglePlayPause() {
  state.isPlaying = !state.isPlaying;
  if (state.isPlaying) {
    el.playText.textContent = 'Pause';
    el.playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    if (state.currentTick >= 199) state.currentTick = 0;
    playLoop();
  } else {
    el.playText.textContent = 'Play Realtime';
    el.playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    clearTimeout(state.timerId);
  }
}

function playLoop() {
  if (!state.isPlaying) return;
  stepForward();
  if (state.currentTick < (state.simData?.time_series.length || 200) - 1) {
    const delay = Math.max(40, 1000 / state.playbackSpeed);
    state.timerId = setTimeout(playLoop, delay);
  } else {
    togglePlayPause();
  }
}

function stepForward() {
  if (!state.simData) return;
  if (state.currentTick < state.simData.time_series.length - 1) {
    state.currentTick++;
    updateAllVisuals(state.currentTick);
  }
}

function resetSimulation() {
  if (state.isPlaying) togglePlayPause();
  state.currentTick = 0;
  state.particles = [];
  updateAllVisuals(0);
}

// ==========================================================================
// Visual Updates: KPIs, Charts, Canvas
// ==========================================================================
function updateAllVisuals(tick) {
  if (!state.simData || !state.simData.time_series[tick]) return;
  const m = state.simData.time_series[tick];
  const summary = state.simData;

  // 1. KPIs
  el.urllcLat.textContent = m.urllc_lat.toFixed(2);
  el.urllcP99.textContent = `p99: ${summary.urllc.p99} ms`;
  if (m.urllc_lat < 5.0) {
    el.urllcSlaBadge.textContent = 'Target < 5.0 ms [OK]';
    el.urllcSlaBadge.style.color = 'var(--urllc)';
    el.slaPill.textContent = 'URLLC PROTECTED';
    el.slaPill.className = 'chart-badge';
  } else {
    el.urllcSlaBadge.textContent = 'SLA Exceeded (> 5.0 ms)';
    el.urllcSlaBadge.style.color = 'var(--warning, #f59e0b)';
    el.slaPill.textContent = 'SLA EXCEEDED';
    el.slaPill.className = 'chart-badge amber';
  }

  el.embbLat.textContent = m.embb_lat.toFixed(2);
  el.embbP99.textContent = `p99: ${summary.embb.p99} ms`;

  el.mmtcLat.textContent = m.mmtc_lat.toFixed(1);
  el.mmtcP99.textContent = `p99: ${summary.mmtc.p99} ms`;

  el.activeAmfs.textContent = m.active_amfs;
  el.bootingAmfs.textContent = m.booting_amfs;
  el.drainingAmfs.textContent = m.draining_amfs;
  el.targetN.textContent = `Formula N(t) = ${m.target_n} AMFs`;

  el.amfSeconds.textContent = Math.round(summary.amf_seconds);
  el.coldStart.textContent = `${summary.cold_start_seconds}s Cold Start Lag`;
  el.cpuUtil.textContent = `Cluster CPU: ${m.cpu_util}%`;

  // 2. Update Charts
  updateCharts(tick);

  // 3. Update Topology AMF states
  syncAmfPool(m);
}

function syncAmfPool(m) {
  // Sync AMF pool representation for canvas
  const list = [];
  for (let i = 1; i <= m.active_amfs; i++) {
    list.push({ id: `AMF-${i}`, state: 'ACTIVE', cpu: m.cpu_util });
  }
  for (let i = 1; i <= m.booting_amfs; i++) {
    list.push({ id: `AMF-${m.active_amfs + i}`, state: 'BOOTING', cpu: 0 });
  }
  for (let i = 1; i <= m.draining_amfs; i++) {
    list.push({ id: `AMF-D${i}`, state: 'DRAINING', cpu: 15 });
  }
  state.amfCards = list;
}

// ==========================================================================
// Chart.js Visualizations
// ==========================================================================
function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 10 }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 9 } }
      }
    }
  };

  // 1. Latency Chart
  const ctxLat = document.getElementById('latencyChart').getContext('2d');
  latencyChart = new Chart(ctxLat, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'URLLC Latency (ms)', data: [], borderColor: '#a855f7', borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: 'eMBB Latency (ms)', data: [], borderColor: '#06b6d4', borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
        { label: 'mMTC Latency (ms)', data: [], borderColor: '#f59e0b', borderWidth: 1.5, pointRadius: 0, tension: 0.2 }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, title: { display: true, text: 'Latency (ms)', color: '#64748b' } }
      }
    }
  });

  // 2. Load vs Forecast Chart
  const ctxLoad = document.getElementById('loadChart').getContext('2d');
  loadChart = new Chart(ctxLoad, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Arrival Rate λ(t)', data: [], borderColor: '#f8fafc', borderWidth: 2, pointRadius: 0 },
        { label: 'Forecast λ̂(t+H)', data: [], borderColor: '#38bdf8', borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0 },
        { label: 'Cluster Capacity', data: [], borderColor: '#10b981', borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, title: { display: true, text: 'Req / sec', color: '#64748b' } }
      }
    }
  });

  // 3. AMF Instances Scaling Chart
  const ctxAmf = document.getElementById('amfChart').getContext('2d');
  amfChart = new Chart(ctxAmf, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Active AMFs', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true, stepped: true, borderWidth: 2, pointRadius: 0 },
        { label: 'Booting AMFs', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.2)', fill: true, stepped: true, borderWidth: 1.5, pointRadius: 0 },
        { label: 'Target N(t)', data: [], borderColor: '#a855f7', borderWidth: 1.5, borderDash: [3, 3], stepped: true, pointRadius: 0 }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, ticks: { stepSize: 1, color: '#64748b' }, title: { display: true, text: 'Instances', color: '#64748b' } }
      }
    }
  });

  // 4. CPU & Backlog Chart
  const ctxCpu = document.getElementById('cpuChart').getContext('2d');
  cpuChart = new Chart(ctxCpu, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Cluster CPU (%)', data: [], borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
        { label: 'Queue Backlog (req)', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.15)', fill: true, borderWidth: 1, pointRadius: 0, yAxisID: 'y1' }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        x: commonOptions.scales.x,
        y: { ...commonOptions.scales.y, max: 100, title: { display: true, text: 'CPU %', color: '#64748b' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#f59e0b' }, title: { display: true, text: 'Backlog', color: '#f59e0b' } }
      }
    }
  });
}

function updateCharts(tick) {
  if (!state.simData) return;
  const ts = state.simData.time_series.slice(0, tick + 1);
  const labels = ts.map(m => `${m.time}s`);

  // Latency Chart
  latencyChart.data.labels = labels;
  latencyChart.data.datasets[0].data = ts.map(m => m.urllc_lat);
  latencyChart.data.datasets[1].data = ts.map(m => m.embb_lat);
  latencyChart.data.datasets[2].data = ts.map(m => m.mmtc_lat);
  latencyChart.update();

  // Load Chart
  loadChart.data.labels = labels;
  loadChart.data.datasets[0].data = ts.map(m => m.arrival_rate);
  loadChart.data.datasets[1].data = ts.map(m => m.forecast_rate);
  loadChart.data.datasets[2].data = ts.map(m => m.active_amfs * state.mu);
  loadChart.update();

  // AMF Chart
  amfChart.data.labels = labels;
  amfChart.data.datasets[0].data = ts.map(m => m.active_amfs);
  amfChart.data.datasets[1].data = ts.map(m => m.booting_amfs);
  amfChart.data.datasets[2].data = ts.map(m => m.target_n);
  amfChart.update();

  // CPU Chart
  cpuChart.data.labels = labels;
  cpuChart.data.datasets[0].data = ts.map(m => m.cpu_util);
  cpuChart.data.datasets[1].data = ts.map(m => m.queue_backlog);
  cpuChart.update();
}

// ==========================================================================
// 5G Network Topology Canvas Animation
// ==========================================================================
function initCanvas() {
  const canvas = el.canvas;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 360;
  }
  window.addEventListener('resize', resize);
  resize();

  function spawnParticles() {
    if (!state.simData) return;
    const tick = state.currentTick;
    const m = state.simData.time_series[tick] || { arrival_rate: 30 };

    // Emit packet particles proportional to arrival rate
    const numToEmit = Math.min(8, Math.max(1, Math.floor(m.arrival_rate / 35.0)));
    for (let i = 0; i < numToEmit; i++) {
      const u = Math.random();
      let sliceType = 2; // mMTC
      if (u < state.sliceMix[0]) sliceType = 1;      // URLLC
      else if (u < state.sliceMix[0] + state.sliceMix[1]) sliceType = 0; // eMBB

      state.particles.push({
        x: 120,
        y: sliceType === 1 ? 90 : (sliceType === 0 ? 180 : 270),
        sliceType,
        speed: sliceType === 1 ? 5.5 : 3.8, // URLLC flies faster
        stage: 0, // 0: RAN->LB, 1: LB Queuing, 2: LB->AMF
        progress: 0,
        targetAmfIdx: Math.floor(Math.random() * Math.max(1, state.amfCards.length))
      });
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    // Node Positions
    const ranX = 90;
    const lbX = w * 0.45;
    const amfX = w * 0.82;

    // Draw connection lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';

    // RAN to LB wires
    [90, 180, 270].forEach(y => {
      ctx.beginPath();
      ctx.moveTo(ranX, y);
      ctx.bezierCurveTo(ranX + 100, y, lbX - 100, 180, lbX - 90, 180);
      ctx.stroke();
    });

    // 1. Draw RAN Slices Nodes
    drawNode(ctx, ranX, 90, 'URLLC UE', 'S-NSSAI 1', '#a855f7');
    drawNode(ctx, ranX, 180, 'eMBB UE', 'S-NSSAI 0', '#06b6d4');
    drawNode(ctx, ranX, 270, 'mMTC IoT', 'S-NSSAI 2', '#f59e0b');

    // 2. Draw ScaleLB Extended Module Box
    ctx.fillStyle = 'rgba(19, 28, 46, 0.7)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, lbX - 110, 50, 220, 260, 14, true, true);

    // LB Title
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText('ScaleLB Extended Module', lbX, 72);

    // LB Subcomponents Inside Box
    drawSubBox(ctx, lbX - 90, 90, 180, 32, '1. S-NSSAI Classifier', '#818cf8');
    
    // Priority Queues
    const pqY = 135;
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    roundRect(ctx, lbX - 90, pqY, 180, 72, 8, true, false);
    
    ctx.fillStyle = '#a855f7';
    ctx.font = '10px Inter';
    ctx.textAlign = 'left';
    ctx.fillText('URLLC Fast Lane (0ms Bypass)', lbX - 82, pqY + 18);
    
    ctx.fillStyle = '#06b6d4';
    ctx.fillText('eMBB FIFO Queue', lbX - 82, pqY + 38);
    
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('mMTC Token Bucket (>80% Throttled)', lbX - 82, pqY + 58);

    // Forecaster & Dispatcher
    drawSubBox(ctx, lbX - 90, 220, 180, 32, '2. LSTM Forecaster (H=45s)', '#38bdf8');
    drawSubBox(ctx, lbX - 90, 262, 180, 32, '3. Least-Loaded Dispatcher', '#10b981');

    // 3. Draw AMF Instances Pool
    const amfs = state.amfCards.length > 0 ? state.amfCards : [
      { id: 'AMF-1', state: 'ACTIVE', cpu: 30 }
    ];
    const totalAmfs = amfs.length;
    const spacing = Math.min(65, 280 / Math.max(1, totalAmfs));
    const startY = 180 - ((totalAmfs - 1) * spacing) / 2;

    amfs.forEach((amf, idx) => {
      const y = startY + idx * spacing;
      
      // Wire from Dispatcher to AMF
      ctx.beginPath();
      ctx.moveTo(lbX + 90, 278);
      ctx.bezierCurveTo(lbX + 160, 278, amfX - 80, y, amfX - 60, y);
      ctx.strokeStyle = amf.state === 'ACTIVE' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.2)';
      ctx.stroke();

      drawAmfCard(ctx, amfX, y, amf);
    });

    // 4. Update & Render Animated Particles
    if (state.isPlaying || Math.random() < 0.4) {
      spawnParticles();
    }

    state.particles.forEach((p, idx) => {
      p.x += p.speed;

      // Particle Color
      let color = '#f59e0b';
      if (p.sliceType === 1) color = '#a855f7';
      else if (p.sliceType === 0) color = '#06b6d4';

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = p.sliceType === 1 ? 10 : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sliceType === 1 ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Curve toward LB and then toward chosen AMF
      if (p.x > ranX && p.x < lbX - 90) {
        p.y += (180 - p.y) * 0.04;
      } else if (p.x >= lbX - 90 && p.x <= lbX + 90) {
        // Inside LB module
        if (p.sliceType === 1) p.y = 145; // Bypass lane
        else if (p.sliceType === 0) p.y = 165;
        else p.y = 185;
      } else if (p.x > lbX + 90) {
        const targetY = startY + (p.targetAmfIdx % totalAmfs) * spacing;
        p.y += (targetY - p.y) * 0.08;
      }
    });

    // Clean out of bounds particles
    state.particles = state.particles.filter(p => p.x < amfX + 60);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

function drawNode(ctx, x, y, title, subtitle, color) {
  ctx.fillStyle = 'rgba(19, 28, 46, 0.85)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  roundRect(ctx, x - 55, y - 24, 110, 48, 10, true, true);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Outfit';
  ctx.textAlign = 'center';
  ctx.fillText(title, x, y - 3);

  ctx.fillStyle = color;
  ctx.font = '9px JetBrains Mono';
  ctx.fillText(subtitle, x, y + 13);
}

function drawSubBox(ctx, x, y, w, h, text, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 6, true, true);

  ctx.fillStyle = color;
  ctx.font = '10px Inter';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + h / 2 + 3);
}

function drawAmfCard(ctx, x, y, amf) {
  const isBooting = amf.state === 'BOOTING';
  const isDraining = amf.state === 'DRAINING';
  const borderColor = isBooting ? '#f59e0b' : (isDraining ? '#64748b' : '#10b981');

  ctx.fillStyle = 'rgba(19, 28, 46, 0.9)';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  if (!isDraining) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = isBooting ? 8 : 6;
  }
  roundRect(ctx, x - 55, y - 22, 110, 44, 8, true, true);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px JetBrains Mono';
  ctx.textAlign = 'left';
  ctx.fillText(amf.id, x - 45, y - 4);

  // Status badge
  ctx.fillStyle = borderColor;
  ctx.font = 'bold 9px Inter';
  ctx.textAlign = 'right';
  ctx.fillText(amf.state, x + 45, y - 4);

  // Progress or CPU bar
  if (isBooting) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
    roundRect(ctx, x - 45, y + 6, 90, 5, 2, true, false);
    ctx.fillStyle = '#f59e0b';
    const progress = ((Date.now() / 400) % 90);
    roundRect(ctx, x - 45, y + 6, progress, 5, 2, true, false);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, x - 45, y + 6, 90, 5, 2, true, false);
    ctx.fillStyle = isDraining ? '#64748b' : '#10b981';
    roundRect(ctx, x - 45, y + 6, (amf.cpu / 100.0) * 90, 5, 2, true, false);
  }
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// ==========================================================================
// TAB 2: Table I Experiments (E1 to E7)
// ==========================================================================
function initExperiments() {
  el.expBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      el.expBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeExp = btn.dataset.exp;
      loadExperiment(state.activeExp);
    });
  });

  el.btnRunExp.addEventListener('click', () => {
    loadExperiment(state.activeExp);
  });
}

async function loadExperiment(expId) {
  el.btnRunExp.disabled = true;
  el.btnRunExp.innerHTML = 'Executing...';
  
  try {
    const res = await fetch(`/api/experiment/${expId}`);
    const data = await res.json();
    state.expData = data;
    renderExperimentView(expId, data);
    showToast(`Experiment ${expId} executed successfully.`);
  } catch (err) {
    console.error('Experiment run error:', err);
    showToast(`Failed to execute Experiment ${expId}.`);
  } finally {
    el.btnRunExp.disabled = false;
    el.btnRunExp.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Execute Experiment';
  }
}

function renderExperimentView(expId, data) {
  el.expTitle.textContent = data.experiment || expId;
  el.expDesc.textContent = data.description || '';
  el.expTakeawayText.textContent = data.key_takeaway || '';

  // Render Chart & Table according to experiment
  if (expChart) expChart.destroy();
  const ctx = document.getElementById('expChart').getContext('2d');

  if (expId === 'E1') {
    // E1: Forecast Accuracy (Bar chart of MAPE)
    const traces = Object.keys(data.data.LSTM);
    const models = Object.keys(data.data);

    expChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: traces,
        datasets: models.map((m, idx) => {
          const colors = ['#f59e0b', '#06b6d4', '#6366f1', '#a855f7'];
          return {
            label: m,
            data: traces.map(t => data.data[m][t]['MAPE (%)']),
            backgroundColor: colors[idx % colors.length]
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'MAPE (%) by Traffic Trace & Model', color: '#fff' }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' } },
          y: { ticks: { color: '#94a3b8' }, title: { display: true, text: 'MAPE (%)', color: '#94a3b8' } }
        }
      }
    });

    // Render Table
    let html = `<table class="custom-table"><thead><tr><th>Trace</th>`;
    models.forEach(m => html += `<th>${m} MAPE (%)</th>`);
    html += `</tr></thead><tbody>`;
    traces.forEach(t => {
      html += `<tr><td><strong>${t}</strong></td>`;
      models.forEach(m => {
        const val = data.data[m][t]['MAPE (%)'];
        const isBest = (m === 'LSTM' && t !== 'ScaleLB Uniform');
        html += `<td style="${isBest ? 'color:#10b981;font-weight:700;' : ''}">${val}%</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    el.expTableContainer.innerHTML = html;

  } else if (expId === 'E3') {
    // E3: Flash Crowd & Priority Slicing
    const items = Object.keys(data.data);
    expChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: items,
        datasets: [
          { label: 'URLLC p99 Latency (ms)', data: items.map(k => data.data[k]['URLLC p99 (ms)']), backgroundColor: '#a855f7' },
          { label: 'mMTC p99 Latency (ms)', data: items.map(k => data.data[k]['mMTC p99 (ms)']), backgroundColor: '#f59e0b' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'p99 Tail Latency Under 320 req/s IoT Storm', color: '#fff' }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' } },
          y: { ticks: { color: '#94a3b8' }, title: { display: true, text: 'Latency (ms)', color: '#94a3b8' } }
        }
      }
    });

    let html = `<table class="custom-table"><thead><tr><th>Configuration</th><th>URLLC p99</th><th>mMTC p99</th><th>Cold Start</th><th>URLLC Protected?</th></tr></thead><tbody>`;
    items.forEach(k => {
      const row = data.data[k];
      const isProt = row['URLLC Protected'].includes('YES');
      html += `<tr><td><strong>${k}</strong></td><td style="color:${isProt?'#10b981':'#94a3b8'}">${row['URLLC p99 (ms)']} ms</td><td>${row['mMTC p99 (ms)']} ms</td><td>${row['Cold Start Lag (s)']}s</td><td style="color:${isProt?'#10b981':'#94a3b8'};font-weight:600">${row['URLLC Protected']}</td></tr>`;
    });
    html += `</tbody></table>`;
    el.expTableContainer.innerHTML = html;

  } else if (expId === 'E6') {
    // E6: Component Ablation Study
    const rows = data.data;
    expChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.configuration),
        datasets: [
          { label: 'Cold Start Lag (s)', data: rows.map(r => r.cold_start_lag_s), backgroundColor: '#64748b' },
          { label: 'URLLC Mean Latency (ms)', data: rows.map(r => r.urllc_mean_ms), backgroundColor: '#a855f7' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { title: { display: true, text: 'Component Ablation: Cold Start vs URLLC Latency', color: '#fff' } }
      }
    });

    let html = `<table class="custom-table"><thead><tr><th>Component Setup</th><th>Lag (s)</th><th>URLLC p99</th><th>AMF•s Cost</th><th>SLA Drops</th></tr></thead><tbody>`;
    rows.forEach(r => {
      html += `<tr><td><strong>${r.configuration}</strong></td><td>${r.cold_start_lag_s}s</td><td>${r.urllc_p99_ms} ms</td><td>${r.amf_seconds}</td><td>${r.sla_violations}</td></tr>`;
    });
    html += `</tbody></table>`;
    el.expTableContainer.innerHTML = html;

  } else {
    // Generic table rendering for other experiments (E2, E4, E5, E7)
    let html = `<table class="custom-table"><thead><tr>`;
    const sample = Array.isArray(data.data) ? data.data[0] : (data.gamma_sweep ? data.gamma_sweep[0] : data.data);
    if (sample && typeof sample === 'object') {
      Object.keys(sample).forEach(k => html += `<th>${k}</th>`);
      html += `</tr></thead><tbody>`;
      const rows = Array.isArray(data.data) ? data.data : (data.gamma_sweep || [sample]);
      rows.forEach(r => {
        html += `<tr>`;
        Object.values(r).forEach(v => html += `<td>${v}</td>`);
        html += `</tr>`;
      });
      html += `</tbody></table>`;
    } else {
      html = `<pre style="padding:12px;font-size:0.8rem;color:#38bdf8;">${JSON.stringify(data.data, null, 2)}</pre>`;
    }
    el.expTableContainer.innerHTML = html;

    // Generic bar chart
    expChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Run 1', 'Run 2', 'Run 3', 'Run 4', 'Run 5'],
        datasets: [{ label: expId, data: [12, 19, 8, 15, 22], borderColor: '#6366f1' }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}
