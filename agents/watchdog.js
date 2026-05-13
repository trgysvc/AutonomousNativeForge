'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { log, withLock } = require('./base-agent');

const QUEUE = path.join(__dirname, '..', 'queue');
const PROCESSING = path.join(QUEUE, 'processing');
const INBOX = path.join(QUEUE, 'inbox');
const HEARTBEATS = path.join(QUEUE, 'heartbeats');
const PROJECTS_DIR = path.join(__dirname, '..', 'src');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECOVERY_ATTEMPTS = 3;

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
                // Heartbeat file corrupted? Treat as stale if file is old
                const stats = fs.statSync(heartbeatPath);
                if ((now - stats.mtimeMs) > STALE_THRESHOLD_MS) {
                    shouldRecover = true;
                    reason = `Heartbeat dosyası bozuk ve eski.`;
                }
            }
        } else {
            // No heartbeat file. Check file age of the processing file itself
            const stats = fs.statSync(processingPath);
            if ((now - stats.mtimeMs) > STALE_THRESHOLD_MS) {
                shouldRecover = true;
                reason = `Heartbeat bulunamadı ve işlem dosyası eski.`;
            }
        }

        if (shouldRecover) {
            log(`⚠️ [WATCHDOG] Donma tespit edildi: ${file}. Sebep: ${reason}`);
            await recoverTask(processingPath, reason);
            // Clean up stale heartbeat
            if (fs.existsSync(heartbeatPath)) {
                try { fs.unlinkSync(heartbeatPath); } catch (_) {}
            }
        }
    }
}

log('🛡️ Watchdog (Koruyucu Göz) başlatıldı.');
setInterval(scan, 60000); // Her dakika tara
scan(); // İlk taramayı hemen yap
