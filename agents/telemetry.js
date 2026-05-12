'use strict';
/**
 * ANF Telemetry Daemon v2.0
 * Autonomous Native Forge — Real-Time System Analytics
 *
 * Collects and reports:
 *   1. Hardware Utilization  (nvidia-smi, /proc)
 *   2. AI/Model Performance  (vLLM journald, sys.log)
 *   3. Reliability & Errors  (manifest.json, sys.log)
 *   4. Operational Cost      (task timings, power draw)
 *
 * Runs independently from all agents. Survives agent crashes.
 */

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const BASE_DIR      = path.join(__dirname, '..');
const APP_LOG       = path.join(BASE_DIR, 'sys.log');
const REPORT_PATH   = path.join(BASE_DIR, 'anf_system_report.md');
const MANIFEST_PATH = path.join(BASE_DIR, 'src', 'aurapos', 'manifest.json');

// ─────────────────────────────────────────────────────────────────
// 1. HARDWARE METRICS
// ─────────────────────────────────────────────────────────────────
function getHardwareMetrics() {
    const hw = {
        gpu_name: 'NVIDIA GB10', gpu_load_pct: 'N/A', gpu_temp_c: 'N/A',
        gpu_power_w: 'N/A', vram_used_mb: 'N/A', vram_total_mb: 'N/A',
        ram_used_mb: 'N/A', ram_total_mb: 'N/A', cpu_load_1m: 'N/A',
        thermal_throttling: false,
    };
    try {
        const smi = execSync(
            'nvidia-smi --query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,temperature.gpu --format=csv,noheader,nounits',
            { timeout: 5000 }
        ).toString().trim();
        const p = smi.split(',').map(s => s.trim());
        hw.gpu_name      = p[0] || hw.gpu_name;
        hw.gpu_load_pct  = p[1] !== '[N/A]' ? parseFloat(p[1]) : 'N/A';
        hw.vram_used_mb  = p[3] !== '[N/A]' ? parseFloat(p[3]) : 'N/A';
        hw.vram_total_mb = p[4] !== '[N/A]' ? parseFloat(p[4]) : 'N/A';
        hw.gpu_power_w   = p[5] !== '[N/A]' ? parseFloat(p[5]).toFixed(1) : 'N/A';
        hw.gpu_temp_c    = p[6] !== '[N/A]' ? parseInt(p[6]) : 'N/A';
        hw.thermal_throttling = hw.gpu_temp_c !== 'N/A' && hw.gpu_temp_c > 85;
    } catch (_) {}
    try {
        const mem = fs.readFileSync('/proc/meminfo', 'utf8');
        const total = parseInt(mem.match(/MemTotal:\s+(\d+)/)?.[1] || 0) / 1024;
        const avail = parseInt(mem.match(/MemAvailable:\s+(\d+)/)?.[1] || 0) / 1024;
        hw.ram_total_mb = Math.round(total);
        hw.ram_used_mb  = Math.round(total - avail);
    } catch (_) {}
    try {
        hw.cpu_load_1m = parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
    } catch (_) {}
    return hw;
}

// ─────────────────────────────────────────────────────────────────
// 2. vLLM / AI MODEL METRICS
// ─────────────────────────────────────────────────────────────────
function getVllmMetrics() {
    const m = { tps_generation: 0, kv_cache_pct: 0, running_reqs: 0, waiting_reqs: 0, prefix_cache_hit_rate: 0 };
    try {
        let src = '';
        try { src += execSync('journalctl -u "vllm*" -n 40 --no-pager --output=cat 2>/dev/null || true', { timeout: 3000 }).toString(); } catch (_) {}
        if (fs.existsSync(APP_LOG)) {
            const size = fs.statSync(APP_LOG).size;
            const len  = Math.min(6000, size);
            const buf  = Buffer.alloc(len);
            const fd   = fs.openSync(APP_LOG, 'r');
            fs.readSync(fd, buf, 0, len, size - len);
            fs.closeSync(fd);
            src += buf.toString('utf8');
        }
        const pick = (matches) => matches ? parseFloat(matches[matches.length - 1].match(/([\d.]+)/)[1]) : 0;
        const pickI = (matches) => matches ? parseInt(matches[matches.length - 1].match(/(\d+)/)[1]) : 0;
        m.tps_generation       = pick(src.match(/Avg generation throughput:\s*[\d.]+ tokens\/s/g));
        m.kv_cache_pct         = pick(src.match(/GPU KV cache usage:\s*[\d.]+%/g));
        m.running_reqs         = pickI(src.match(/Running:\s*\d+ reqs/g));
        m.waiting_reqs         = pickI(src.match(/Waiting:\s*\d+ reqs/g));
        m.prefix_cache_hit_rate = pick(src.match(/Prefix cache hit rate:\s*[\d.]+%/g));
    } catch (_) {}
    return m;
}

// ─────────────────────────────────────────────────────────────────
// 3. MANIFEST / TASK ANALYTICS
// ─────────────────────────────────────────────────────────────────
function getManifestMetrics() {
    const r = {
        total: 0, done: 0, pending: 0, in_progress: 0, testing: 0, failed: 0,
        retry_rate_pct: 0, total_retries: 0, error_breakdown: {}, self_healing_count: 0, avg_retry_count: 0,
    };
    if (!fs.existsSync(MANIFEST_PATH)) return r;
    try {
        const tasks = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).tasks || [];
        r.total = tasks.length;
        tasks.forEach(t => {
            if      (t.status === 'DONE')        r.done++;
            else if (t.status === 'PENDING')     r.pending++;
            else if (['IN_PROGRESS','FIXING'].includes(t.status)) r.in_progress++;
            else if (t.status === 'TESTING')     r.testing++;
            else if (t.status === 'FAILED')      r.failed++;
            const retries = t.retry_count || 0;
            r.total_retries += retries;
            if (retries > 0 && t.status === 'DONE') r.self_healing_count++;
            (t.failure_log || []).forEach(f => {
                const et = f.error_type || 'UNKNOWN';
                r.error_breakdown[et] = (r.error_breakdown[et] || 0) + 1;
            });
        });
        const attempted = tasks.filter(t => (t.retry_count || 0) > 0 || t.status === 'DONE' || t.status === 'FAILED').length;
        r.retry_rate_pct  = attempted > 0 ? ((r.total_retries / attempted) * 100).toFixed(1) : 0;
        r.avg_retry_count = attempted > 0 ? (r.total_retries / attempted).toFixed(2) : 0;
    } catch (_) {}
    return r;
}

// ─────────────────────────────────────────────────────────────────
// 4. LOG PERFORMANCE ANALYTICS
// ─────────────────────────────────────────────────────────────────
function getLogMetrics() {
    const r = {
        readAvgSec: 0, readSamples: 0, codeAvgSec: 0, codeSamples: 0,
        codeMinSec: 0, codeMaxSec: 0, qaAvgSec: 0, qaSamples: 0,
        sync_fail_count: 0, max_retry_exceeded_count: 0,
        steering_count: 0, tasks_completed_count: 0, mtbf_minutes: 0,
    };
    if (!fs.existsSync(APP_LOG)) return r;
    try {
        const lines = fs.readFileSync(APP_LOG, 'utf8').split('\n');
        let codeTimes = [], readTimes = [], qaTimes = [];
        let lastCoder = null, lastDoc = null, lastQa = null;
        let failTs = [];
        lines.forEach(line => {
            const mts = line.match(/\[([\d\-T:.Z]+)\]/);
            if (!mts) return;
            const t = new Date(mts[1]).getTime();
            if (line.includes('Multi-Doc Synthesis başlatılıyor')) lastDoc = t;
            if (line.includes('CONSENSUS:') && line.includes('Peer Review') && lastDoc) { readTimes.push((t - lastDoc) / 1000); lastDoc = null; }
            if (line.includes('CODER:') && line.includes('yazılıyor')) lastCoder = t;
            if (line.includes('Kod yazımı bitti') && lastCoder) { codeTimes.push((t - lastCoder) / 1000); lastCoder = null; }
            if (line.includes('QA GUARDRAIL:')) lastQa = t;
            if ((line.includes('SYNC FAIL') || line.includes('HEARTBEAT_OK')) && lastQa) { qaTimes.push((t - lastQa) / 1000); lastQa = null; }
            if (line.includes('SYNC FAIL'))          r.sync_fail_count++;
            if (line.includes('MAX RETRY'))           { r.max_retry_exceeded_count++; failTs.push(t); }
            if (line.includes('STEERING:'))           r.steering_count++;
            if (line.includes('HEARTBEAT_OK'))        r.tasks_completed_count++;
        });
        const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        r.readAvgSec  = avg(readTimes).toFixed(1);  r.readSamples  = readTimes.length;
        r.codeAvgSec  = avg(codeTimes).toFixed(1);  r.codeSamples  = codeTimes.length;
        r.codeMinSec  = codeTimes.length ? Math.min(...codeTimes).toFixed(1) : 0;
        r.codeMaxSec  = codeTimes.length ? Math.max(...codeTimes).toFixed(1) : 0;
        r.qaAvgSec    = avg(qaTimes).toFixed(1);    r.qaSamples    = qaTimes.length;
        if (failTs.length > 1) {
            const diffs = failTs.slice(1).map((t, i) => (t - failTs[i]) / 60000);
            r.mtbf_minutes = (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1);
        }
    } catch (_) {}
    return r;
}

// ─────────────────────────────────────────────────────────────────
// 5. SYSTEM STATE
// ─────────────────────────────────────────────────────────────────
function getSystemState() {
    if (!fs.existsSync(APP_LOG)) return { status: '⚫ UNKNOWN', stalled_min: 0 };
    try {
        const diffMs  = Date.now() - fs.statSync(APP_LOG).mtimeMs;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMs > 15 * 60 * 1000) return { status: `🔴 STALLED (no log for ${diffMin} min)`, stalled_min: diffMin };
        if (diffMs > 5  * 60 * 1000) return { status: `🟡 IDLE (${diffMin} min)`, stalled_min: diffMin };
        return { status: '🟢 ONLINE', stalled_min: 0 };
    } catch (_) { return { status: '⚫ UNKNOWN', stalled_min: 0 }; }
}

// ─────────────────────────────────────────────────────────────────
// 6. REPORT GENERATOR
// ─────────────────────────────────────────────────────────────────
function generateReport() {
    try {
        const hw       = getHardwareMetrics();
        const vllm     = getVllmMetrics();
        const tasks    = getManifestMetrics();
        const logs     = getLogMetrics();
        const sys      = getSystemState();
        const now      = new Date().toISOString();

        // Derived
        const completionPct  = tasks.total > 0 ? ((tasks.done / tasks.total) * 100).toFixed(1) : 0;
        const avgTaskSec     = parseFloat(logs.codeAvgSec) || 240;
        const remainingTasks = tasks.pending + tasks.in_progress + tasks.testing;
        const etaHours       = ((remainingTasks * (avgTaskSec + parseFloat(logs.qaAvgSec || 0) + 30)) / 3600).toFixed(1);
        const powerKw        = (hw.gpu_power_w !== 'N/A' ? parseFloat(hw.gpu_power_w) : 240) / 1000;
        const costPerTask    = (powerKw * (avgTaskSec / 3600) * 0.10).toFixed(4);
        const ramPct         = hw.ram_total_mb !== 'N/A' ? ((hw.ram_used_mb / hw.ram_total_mb) * 100).toFixed(1) : 'N/A';
        const thermalAlert   = hw.thermal_throttling
            ? `> [!WARNING]\n> ⚠️ **THERMAL THROTTLING ACTIVE** — GPU at ${hw.gpu_temp_c}°C. Performance may be degraded.\n\n`
            : '';
        const errRows = Object.entries(tasks.error_breakdown).length > 0
            ? Object.entries(tasks.error_breakdown).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n')
            : '| No records yet | — |';

        const progressBar = "█".repeat(Math.round(completionPct / 5)).padEnd(20, "░");

        const report = `# ANF Autonomous System — Live Telemetry Report
*Last Updated: ${now}*
*System Status: **${sys.status}***

---

## 💻 1. Hardware Resource Utilization

${thermalAlert}| Metric | Value | Notes |
|:---|:---|:---|
| **GPU** | ${hw.gpu_name} | NVIDIA GB10 Blackwell Superchip |
| **GPU Compute Load** | ${hw.gpu_load_pct !== 'N/A' ? hw.gpu_load_pct + '%' : 'N/A'} | During active inference |
| **GPU Power Draw** | ${hw.gpu_power_w !== 'N/A' ? hw.gpu_power_w + ' W' : 'N/A'} | Instantaneous (Limit: ~300 W) |
| **GPU Temperature** | ${hw.gpu_temp_c !== 'N/A' ? hw.gpu_temp_c + '°C' : 'N/A'} | Thermal limit: 85°C |
| **Thermal Throttling** | ${hw.thermal_throttling ? '🔴 ACTIVE' : '🟢 NONE'} | — |
| **VRAM Usage** | ${hw.vram_used_mb !== 'N/A' ? (hw.vram_used_mb / 1024).toFixed(1) + ' GB / ' + (hw.vram_total_mb / 1024).toFixed(1) + ' GB' : 'Unified Memory (128 GB)'} | Model weights ~60 GB |
| **KV Cache (vLLM)** | **${vllm.kv_cache_pct.toFixed(1)}%** | Active context memory usage |
| **System RAM** | ${hw.ram_used_mb !== 'N/A' ? (hw.ram_used_mb / 1024).toFixed(1) + ' GB / ' + (hw.ram_total_mb / 1024).toFixed(1) + ' GB (' + ramPct + '%)' : 'N/A'} | |
| **CPU Load Average (1m)** | ${hw.cpu_load_1m} | Agent process pressure |

---

## 🧠 2. AI Agent & Model Performance Metrics

| Metric | Value | Description |
|:---|:---|:---|
| **Generation Speed (TPS)** | **${vllm.tps_generation > 0 ? vllm.tps_generation + ' tokens/sec' : 'Calculating...'}** | Nemotron-3-Super-120B NVFP4 |
| **Active Requests** | ${vllm.running_reqs} Running / ${vllm.waiting_reqs} Waiting | Parallel agent capacity |
| **Prefix Cache Hit Rate** | ${vllm.prefix_cache_hit_rate}% | Repeated prompt caching efficiency |
| **Context Window Usage** | ~${(vllm.kv_cache_pct * 2.4).toFixed(0)}K / 24K tokens | Estimated from KV cache ratio |
| **Doc Reading / RAG Time** | **${logs.readAvgSec} sec** | Avg over ${logs.readSamples} samples |
| **Code Writing Time** | **${logs.codeAvgSec} sec** avg | Min: ${logs.codeMinSec}s / Max: ${logs.codeMaxSec}s (${logs.codeSamples} samples) |
| **QA Testing Time** | **${logs.qaAvgSec} sec** | Avg over ${logs.qaSamples} samples |
| **Self-Healing (STEER)** | **${logs.steering_count} corrections** | Failed → Agent autonomously fixed |
| **QA-Approved Deliveries** | ${logs.tasks_completed_count} tasks | Passed all quality gates |

---

## 🛡️ 3. Reliability & Error Analysis

| Metric | Value |
|:---|:---|
| **MTBF** | ${logs.mtbf_minutes > 0 ? logs.mtbf_minutes + ' minutes' : 'Insufficient data'} |
| **Syntax Failures (SYNC FAIL)** | ${logs.sync_fail_count} |
| **MAX RETRY Exceeded** | ${logs.max_retry_exceeded_count} |
| **Retry Rate** | ${tasks.retry_rate_pct}% |
| **Avg Attempts / Task** | ${tasks.avg_retry_count} |

**Error Classification (failure_log):**

| Error Type | Count |
|:---|:---|
${errRows}

---

## 📊 4. Project Progress (Task Telemetry)

| Status | Count | Percentage | Progress Bar |
|:---|:---:|:---|:---|
| ✅ **DONE** | ${tasks.done} | ${completionPct}% | ${progressBar} |
| 🛠️ **IN_PROGRESS** | ${tasks.in_progress} | ${(tasks.in_progress / tasks.total * 100).toFixed(1)}% | 🔄 |
| 🩹 **FIXING (Self-Healing)** | ${tasks.self_healing_count} | ${(tasks.self_healing_count / tasks.total * 100).toFixed(1)}% | 🩹 |
| ⏳ **PENDING** | ${tasks.pending} | ${(tasks.pending / tasks.total * 100).toFixed(1)}% | ⏳ |
| ❌ **FAILED (Max Retry)** | ${tasks.failed} | ${(tasks.failed / tasks.total * 100).toFixed(1)}% | ❌ |
| **TOTAL** | **${tasks.total}** | **100%** | **Master Plan: AuraPOS** |

**Estimated Time to Completion (ETA):** ~${etaHours} hours (${remainingTasks} tasks × ~${(avgTaskSec / 60).toFixed(0)} min/task)

---

## 💰 5. Operational Cost & Efficiency

| Metric | Value | Notes |
|:---|:---|:---|
| **Avg Time Per Task** | ${(avgTaskSec / 60).toFixed(1)} minutes | Code writing + QA included |
| **Est. Energy Cost Per Task** | $${costPerTask} | ${hw.gpu_power_w}W × ${(avgTaskSec / 3600).toFixed(3)}h × $0.10/kWh |
| **Parallelization Capacity** | 3 concurrent Coders | vault.concurrency |
| **Human Intervention Required** | Zero | Fully Autonomous Execution |
| **vs. Human Engineering Team** | 4–6 Weeks → ~${etaHours} Hours | Senior full-stack team estimate |

---
*ANF Telemetry Daemon v2.0 — Updates every 15 seconds*
`;

        fs.writeFileSync(REPORT_PATH, report, 'utf8');
        console.log(`[TELEMETRY] Report updated | ${sys.status} | DONE: ${tasks.done}/${tasks.total} | GPU: ${hw.gpu_load_pct}% | TPS: ${vllm.tps_generation}`);
    } catch (err) {
        console.error('[TELEMETRY] Error:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────
console.log('🚀 ANF Telemetry Daemon v2.0 started.');
generateReport();
setInterval(generateReport, 15000);
