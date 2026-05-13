'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { log, withLock, sendMessage } = require('./base-agent');

const QUEUE = path.join(__dirname, '..', 'queue');
const PROCESSING = path.join(QUEUE, 'processing');
const INBOX = path.join(QUEUE, 'inbox');
const HEARTBEATS = path.join(QUEUE, 'heartbeats');
const PROJECTS_DIR = path.join(__dirname, '..', 'src');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECOVERY_ATTEMPTS = 3;
const CHECK_INTERVAL = 60000; // 1 minute

// Crash Tracking (Karantina için)
const crashHistory = {}; // { agentName: [timestamps] }
const CRASH_LIMIT = 3; 
const CRASH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Checks if a PID is still running
 */
function isPidRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Force restarts an agent service via systemd
 */
function restartAgent(scriptName) {
    const agentName = scriptName.replace('.js', '');
    const serviceName = `anf-${agentName}.service`;
    
    // Crash history check
    const now = Date.now();
    crashHistory[agentName] = (crashHistory[agentName] || []).filter(t => (now - t) < CRASH_WINDOW_MS);
    crashHistory[agentName].push(now);

    if (crashHistory[agentName].length > CRASH_LIMIT) {
        log(`🚨 [WATCHDOG] KARANTİNA: ${agentName} sürekli çöküyor! Otomatik onarım başlatılıyor.`);
        triggerSelfHealing(agentName);
        return;
    }

    log(`⚠️ [WATCHDOG] Servis restart ediliyor: ${serviceName}`);
    try {
        execSync(`systemctl --user restart ${serviceName}`);
    } catch (e) {
        log(`❌ [WATCHDOG] Restart hatası (${serviceName}): ${e.message}`);
    }
}

/**
 * Self-Healing Protocol: Diagnose and ask Architect for a fix
 */
async function triggerSelfHealing(agentName) {
    const agentFile = `${agentName}.js`;
    const agentLog = path.join(LOGS_DIR, `${agentName}.log`);
    let logSnippet = "";

    try {
        if (fs.existsSync(agentLog)) {
            const content = fs.readFileSync(agentLog, 'utf8');
            logSnippet = content.split('\n').slice(-50).join('\n');
        }

        log(`🩺 [WATCHDOG] Öz-Onarım tetiklendi: ${agentName}. Architect'e raporlanıyor...`);
        
        // Architect'e "Sistem Bütünlük İhlali" görevi gönder
        sendMessage('ARCHITECT', 'SYSTEM_INTEGRITY_VIOLATION', {
            agent_name: agentName,
            agent_file: path.join(__dirname, agentFile),
            error_log: logSnippet,
            timestamp: new Date().toISOString()
        });

    } catch (e) {
        log(`❌ [WATCHDOG] Teşhis hatası: ${e.message}`);
    }
}

/**
 * Recovers a stuck task
 */
async function recoverTask(processingFile, reason) {
    const filename = path.basename(processingFile);
    const parts = filename.split('-');
    if (parts.length < 2) return;
    
    const agentName = parts[0];
    const originalName = parts.slice(1).join('-');
    const targetInbox = path.join(INBOX, agentName, originalName);

    log(`🔍 [WATCHDOG] Kurtarma başlatılıyor: ${filename}`);

    try {
        const taskData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const projectId = taskData.project_id;
        const taskId = taskData.task_id;

        if (!fs.existsSync(path.dirname(targetInbox))) fs.mkdirSync(path.dirname(targetInbox), { recursive: true });
        fs.renameSync(processingFile, targetInbox);

        if (projectId && taskId) {
            await withLock(`manifest-${projectId}`, async () => {
                const manifestPath = path.join(PROJECTS_DIR, projectId, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const task = manifest.tasks.find(t => t.task_id === taskId);
                    if (task && ['IN_PROGRESS', 'TESTING', 'FIXING'].includes(task.status)) {
                        const currentRecovery = (task.recovery_count || 0) + 1;
                        
                        task.failure_log = task.failure_log || [];
                        task.failure_log.push({
                            attempt: currentRecovery,
                            timestamp: new Date().toISOString(),
                            error_type: 'SYSTEM_RECOVERY',
                            error: `WATCHDOG_ACTION: ${reason}`
                        });

                        if (currentRecovery > MAX_RECOVERY_ATTEMPTS) {
                            task.status = 'FAILED';
                            task.error = `MAX_RECOVERY_EXCEEDED: ${reason}`;
                        } else {
                            task.status = 'PENDING';
                        }
                        
                        task.recovery_count = currentRecovery;
                        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                    }
                }
            });
        }
        log(`✅ [WATCHDOG] Başarıyla kurtarıldı: ${filename}`);
    } catch (err) {
        log(`❌ [WATCHDOG] Kurtarma hatası: ${err.message}`);
    }
}

async function scan() {
    if (!fs.existsSync(PROCESSING)) return;

    // 1. CONTEXT OVERFLOW DETECTION
    const COMM_LOG = path.join(__dirname, '..', 'llm_communication.log');
    if (fs.existsSync(COMM_LOG)) {
        try {
            const stats = fs.statSync(COMM_LOG);
            if (Date.now() - stats.mtimeMs < 30000) {
                const content = fs.readFileSync(COMM_LOG, 'utf8');
                const lastLines = content.split('\n').slice(-20).join('\n');
                if (lastLines.includes('finish=length') || lastLines.includes('tokens=4097')) {
                    log(`🚨 [WATCHDOG] CONTEXT TAŞMASI TESPİT EDİLDİ!`);
                    ['architect.js', 'coder.js', 'tester.js'].forEach(restartAgent);
                }
            }
        } catch (e) {}
    }

    // 2. STALL DETECTION
    const files = fs.readdirSync(PROCESSING).filter(f => f.endsWith('.json'));
    const now = Date.now();

    for (const file of files) {
        const processingPath = path.join(PROCESSING, file);
        const taskId = file.replace('.json', '');
        const heartbeatPath = path.join(HEARTBEATS, `${taskId}.heartbeat`);

        let shouldRecover = false;
        let reason = '';

        if (fs.existsSync(heartbeatPath)) {
            try {
                const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));
                if (!isPidRunning(heartbeat.pid)) {
                    shouldRecover = true;
                    reason = `PID ${heartbeat.pid} artık çalışmıyor.`;
                } else if ((now - heartbeat.timestamp) > STALE_THRESHOLD_MS) {
                    shouldRecover = true;
                    reason = `Heartbeat çok eski.`;
                }
            } catch (e) {
                shouldRecover = true;
                reason = `Heartbeat dosyası bozuk.`;
            }
        } else {
            const stats = fs.statSync(processingPath);
            if ((now - stats.mtimeMs) > STALE_THRESHOLD_MS) {
                shouldRecover = true;
                reason = `Heartbeat bulunamadı ve işlem dosyası eski.`;
            }
        }

        if (shouldRecover) {
            log(`⚠️ [WATCHDOG] Donma tespit edildi: ${file}. Sebep: ${reason}`);
            await recoverTask(processingPath, reason);
            if (fs.existsSync(heartbeatPath)) {
                try { fs.unlinkSync(heartbeatPath); } catch (_) {}
            }
        }
    }
    
    // 3. HOUSEKEEPING (Non-destructive Archiving)
    try {
        // Log Rotation (llm_communication.log > 100MB) - TIMESTAMPED to prevent data loss
        if (fs.existsSync(COMM_LOG)) {
            const stats = fs.statSync(COMM_LOG);
            if (stats.size > 100 * 1024 * 1024) { // 100MB
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const archiveName = `${COMM_LOG}.${timestamp}.archive`;
                log(`🧹 [WATCHDOG] Log rotasyonu: llm_communication.log arşivlendi -> ${archiveName}`);
                fs.renameSync(COMM_LOG, archiveName);
            }
        }
        // Task history (DONE/ERROR) will be kept FOREVER as per user request.
    } catch (e) {
        log(`⚠️ [WATCHDOG] Housekeeping hatası: ${e.message}`);
    }
    
    log(`✅ Watchdog döngüsü tamamlandı. Bir sonraki kontrol ${CHECK_INTERVAL / 1000}s sonra.`);
}

async function handleMessage(msg) {
    const { type, script } = msg;
    if (type === 'RESTART_AGENT' && script) {
        const agentName = script.replace('.js', '');
        log(`🛡️ [WATCHDOG] Onarım onayı alındı. ${agentName} karantinadan çıkarılıyor.`);
        crashHistory[agentName] = []; // Karantinayı sıfırla
        restartAgent(script);
    }
}

log('🛡️ Watchdog (Koruyucu Göz) başlatıldı.');
const { start } = require('./base-agent');
start('WATCHDOG', handleMessage);

setInterval(scan, CHECK_INTERVAL);
scan();
