'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { log, withLock } = require('./base-agent');

const QUEUE = path.join(__dirname, '..', 'queue');
const PROCESSING = path.join(QUEUE, 'processing');
const INBOX = path.join(QUEUE, 'inbox');
const HEARTBEATS = path.join(QUEUE, 'heartbeats');
const PROJECTS_DIR = path.join(__dirname, '..', 'src');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECOVERY_ATTEMPTS = 3;
const CHECK_INTERVAL = 60000; // 1 minute

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
    const serviceName = `anf-${scriptName.replace('.js', '')}.service`;
    log(`⚠️ [WATCHDOG] Servis restart ediliyor: ${serviceName}`);
    try {
        execSync(`systemctl --user restart ${serviceName}`);
    } catch (e) {
        log(`❌ [WATCHDOG] Restart hatası (${serviceName}): ${e.message}`);
    }
}

/**
 * Recovers a stuck task
 */
async function recoverTask(processingFile, reason) {
    const filename = path.basename(processingFile);
    // Format: {agent}-{originalFilename}.json
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

        // 1. Move back to inbox
        if (!fs.existsSync(path.dirname(targetInbox))) fs.mkdirSync(path.dirname(targetInbox), { recursive: true });
        fs.renameSync(processingFile, targetInbox);

        // 2. Update manifest status to PENDING if it's currently marked as active
        if (projectId && taskId) {
            await withLock(`manifest-${projectId}`, async () => {
                const manifestPath = path.join(PROJECTS_DIR, projectId, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const task = manifest.tasks.find(t => t.task_id === taskId);
                    if (task && ['IN_PROGRESS', 'TESTING', 'FIXING'].includes(task.status)) {
                        const currentRecovery = (task.recovery_count || 0) + 1;
                        
                        // Append to failure_log for Architect to analyze
                        const recoveryEntry = {
                            attempt: currentRecovery,
                            timestamp: new Date().toISOString(),
                            error_type: 'SYSTEM_RECOVERY',
                            error: `WATCHDOG_ACTION: ${reason}`
                        };
                        task.failure_log = task.failure_log || [];
                        task.failure_log.push(recoveryEntry);

                        if (currentRecovery > MAX_RECOVERY_ATTEMPTS) {
                            log(`⛔ [WATCHDOG] KRİTİK DÖNGÜ: ${taskId} çok fazla dondu (${currentRecovery}). FAILED'a çekiliyor.`);
                            task.status = 'FAILED';
                            task.error = `MAX_RECOVERY_EXCEEDED: ${reason}`;
                        } else {
                            log(`🔄 [WATCHDOG] Manifest durumu sıfırlandı: ${taskId} (${projectId}) [Kurtarma: ${currentRecovery}/${MAX_RECOVERY_ATTEMPTS}]`);
                            task.status = 'PENDING';
                        }
                        
                        task.recovery_count = currentRecovery;
                        task.last_recovery = new Date().toISOString();
                        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                    }
                }
            });
        }
        
        log(`✅ [WATCHDOG] Başarıyla kurtarıldı: ${filename} -> ${agentName}/inbox`);
    } catch (err) {
        log(`❌ [WATCHDOG] Kurtarma hatası (${filename}): ${err.message}`);
    }
}

async function scan() {
    if (!fs.existsSync(PROCESSING)) return;

    // 1. CONTEXT OVERFLOW DETECTION (llm_communication.log)
    const COMM_LOG = path.join(__dirname, '..', 'llm_communication.log');
    if (fs.existsSync(COMM_LOG)) {
        try {
            const stats = fs.statSync(COMM_LOG);
            if (Date.now() - stats.mtimeMs < 30000) {
                const content = fs.readFileSync(COMM_LOG, 'utf8');
                const lastLines = content.split('\n').slice(-20).join('\n');
                if (lastLines.includes('finish=length') || lastLines.includes('tokens=4097')) {
                    log(`🚨 [WATCHDOG] CONTEXT TAŞMASI TESPİT EDİLDİ! Ajanlar resetleniyor.`);
                    ['architect.js', 'coder.js', 'tester.js'].forEach(restartAgent);
                }
            }
        } catch (e) {}
    }

    // 2. STALL DETECTION (Heartbeats & PIDs)
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
                const isRunning = isPidRunning(heartbeat.pid);
                const isStale = (now - heartbeat.timestamp) > STALE_THRESHOLD_MS;

                if (!isRunning) {
                    shouldRecover = true;
                    reason = `PID ${heartbeat.pid} artık çalışmıyor.`;
                } else if (isStale) {
                    shouldRecover = true;
                    reason = `Heartbeat çok eski (${Math.round((now - heartbeat.timestamp)/1000)}s).`;
                }
            } catch (e) {
                const stats = fs.statSync(heartbeatPath);
                if ((now - stats.mtimeMs) > STALE_THRESHOLD_MS) {
                    shouldRecover = true;
                    reason = `Heartbeat dosyası bozuk ve eski.`;
                }
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
    
    log(`✅ Watchdog döngüsü tamamlandı. Bir sonraki kontrol ${CHECK_INTERVAL / 1000}s sonra.`);
}

log('🛡️ Watchdog (Koruyucu Göz) başlatıldı.');
setInterval(scan, CHECK_INTERVAL);
scan();
