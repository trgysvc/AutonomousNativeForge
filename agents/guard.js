'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * ANF Guard — Real-time Proactive Monitor
 * This process runs independently and intervenes instantly when loops or stalls are detected.
 */

const BASE_DIR = path.join(__dirname, '..');
const COMM_LOG = path.join(BASE_DIR, 'llm_communication.log');
const APP_LOG  = path.join(BASE_DIR, 'sys.log');

const CHECK_INTERVAL = 10000; // 10 seconds
const STALL_THRESHOLD = 5 * 60 * 1000; // 5 minutes

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[GUARD] [${timestamp}] ${msg}`);
}

function getPids(name) {
    try {
        const out = execSync(`pgrep -f "node agents/${name}"`).toString().trim();
        return out.split('\n').filter(p => p);
    } catch (_) {
        return [];
    }
}

function restartAgent(name) {
    log(`⚠️ ${name} RESTART EDİLİYOR...`);
    const pids = getPids(name);
    pids.forEach(pid => {
        try { execSync(`kill -9 ${pid}`); } catch (_) {}
    });
    execSync(`nohup node agents/${name} > logs/${name.replace('.js','')}.log 2>&1 &`);
    log(`✅ ${name} Yeniden başlatıldı.`);
}

function monitor() {
    // 1. STALL DETECTION
    if (fs.existsSync(APP_LOG)) {
        const mtime = fs.statSync(APP_LOG).mtimeMs;
        const diff = Date.now() - mtime;
        if (diff > STALL_THRESHOLD) {
            log(`🚨 SISTEM DONDU! (Son log: ${Math.round(diff/1000)}s önce). Tüm ajanlar restart ediliyor.`);
            ['architect.js', 'coder.js', 'tester.js'].forEach(restartAgent);
            return;
        }
    }

    // 2. CONTEXT OVERFLOW DETECTION (llm_communication.log)
    if (fs.existsSync(COMM_LOG)) {
        const content = fs.readFileSync(COMM_LOG, 'utf8');
        const lastLines = content.split('\n').slice(-20).join('\n');
        
        if (lastLines.includes('finish=length') || lastLines.includes('tokens=4097')) {
            log(`🚨 CONTEXT TAŞMASI TESPİT EDİLDİ! Coder durduruluyor.`);
            restartAgent('coder.js');
            // Architect'e bir sinyal dosyası bırakılabilir veya doğrudan manifest müdahalesi yapılabilir
        }
    }

    // 3. RECURSIVE ERROR DETECTION (manifest.json)
    const manifestPath = path.join(BASE_DIR, 'src', 'aurapos', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const stuckTasks = manifest.tasks.filter(t => (t.retry_count || 0) >= 3 && t.status !== 'FAILED');
            stuckTasks.forEach(t => {
                log(`🚨 GÖREV KISIR DÖNGÜDE: ${t.task_id}. Müdahale ediliyor.`);
                // Görevi manuel olarak FAILED'a çekip Architect'i uyandır
                t.status = 'FAILED';
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                restartAgent('architect.js'); // Architect'in planlama yapması için dürt
            });
        } catch (_) {}
    }
}

log('🚀 ANF Guard (Nöbetçi Ajan) başlatıldı.');
setInterval(monitor, CHECK_INTERVAL);
monitor();
