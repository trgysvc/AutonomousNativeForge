'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { log, start, sendMessage, ask, pushToGithub } = require('./base-agent');

const MAX_RETRIES = 3;
const retryCounts = {};

let isDiscovering = false;

/**
 * Ajanlar arası mesaj trafiği yönetimi
 */
async function handleMessage(msg) {
    const { type, project_id, task_id, file_path, title, description, bugs } = msg;
    const prefix = `[${project_id}] `;

    switch (type) {
        case 'TASK_READY':
            log(`${prefix} Görev dağıtılıyor: ${title}`);
            sendMessage('CODER', 'WRITE_CODE', msg);
            break;

        case 'CODE_FINISHED':
            log(`${prefix} Kod yazımı bitti. Test ajanı devralıyor: ${task_id}`);
            sendMessage('TESTER', 'RUN_TEST', msg);
            break;

        case 'TEST_PASSED':
            log(`${prefix} ✅ TEST GEÇİLDİ. GitHub'a otonom push başlatılıyor...`);
            try {
                if (!file_path || !fs.existsSync(file_path)) throw new Error("Dosya yolu bulunamadı.");
                const content = fs.readFileSync(file_path, 'utf8');
                
                await pushToGithub(project_id, file_path, content, `Otonom Onaylı Commit: ${title}`);
                log(`${prefix} 📦 GitHub mühürleme başarılı.`);
                
                // Dokümantasyon aşamasına geç
                sendMessage('DOCS', 'WRITE_DOCS', msg);
                delete retryCounts[task_id];
            } catch (e) {
                log(`${prefix} ❌ GitHub Kritik Hata: ${e.message}`);
            }
            break;

        case 'BUG_REPORT':
            retryCounts[task_id] = (retryCounts[task_id] || 0) + 1;
            
            // Kritik hata kontrolü (Severity: HIGH varsa direkt escalate)
            const hasHighSeverity = Array.isArray(bugs) && bugs.some(b => b.severity === 'HIGH');
            
            if (hasHighSeverity || retryCounts[task_id] > MAX_RETRIES) {
                const reason = hasHighSeverity ? "KRİTİK HATA (HIGH SEVERITY)" : "MAX RETRY (3) AŞILDI";
                log(`${prefix} ⛔ ${reason}. Görev durduruldu. RCA üretiliyor.`);
                
                const rcaPath = path.join(__dirname, '..', 'queue', 'error', `${task_id}_RCA.md`);
                const errorDetail = bugs ? (Array.isArray(bugs) ? JSON.stringify(bugs, null, 2) : bugs) : (description || 'Bilinmeyen hata');
                
                const rcaContent = `# ROOT CAUSE ANALYSIS: ${task_id}
PROJE: ${project_id}
GÖREV: ${title}
SEBEP: ${reason}
HATA DETAYI:
${errorDetail}
ZAMAN: ${new Date().toISOString()}

Bu görev ${retryCounts[task_id]} deneme sonrası durduruldu. Manuel müdahale gerekiyor.`;
                
                if (!fs.existsSync(path.dirname(rcaPath))) fs.mkdirSync(path.dirname(rcaPath), { recursive: true });
                fs.writeFileSync(rcaPath, rcaContent);
                
                sendMessage('DOCS', 'WRITE_ERROR_REPORT', msg);
            } else {
                log(`${prefix} 🔄 SELF-HEALING: Hata düzeltme isteği (${retryCounts[task_id]}/${MAX_RETRIES})`);
                sendMessage('CODER', 'FIX_CODE', msg);
            }
            break;
    }
}

/**
 * Otonom Proje Keşfi (docs/reference taraması)
 */
async function discoverNewProjects() {
    if (isDiscovering) return;
    isDiscovering = true;
    
    try {
        const refDir = path.join(__dirname, '..', 'docs', 'reference');
        if (!fs.existsSync(refDir)) return;

        const projects = fs.readdirSync(refDir);
        for (const project_id of projects) {
            const projectPath = path.join(refDir, project_id);
            
            if (fs.lstatSync(projectPath).isDirectory()) {
                const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.md') && !f.startsWith('_'));
                
                for (const file of files) {
                    log(`📄 Yeni döküman tespit edildi: [${project_id}] ${file}`);
                    const fullPath = path.join(projectPath, file);
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    
                    const planPrompt = `Sen bir Baş Mimarsın. Aşağıdaki teknik dökümanı analiz et ve uygulanabilir, atomik yazılım görevlerine böl. 
                    Her görev için ilgili programlama dilinin standartlarına uygun (örneğin Node.js için src/utils/...), profesyonel bir dosya yolu belirle.

                    DÖKÜMAN:
                    ${content}
                    
                    Yanıtı SADECE şu JSON formatında ver: [{"task_id": "...", "title": "...", "desc": "...", "file_path": "..."}]`;
                    
                    try {
                        log(`🧠 [${project_id}] İçin iş planı DeepSeek-R1 ile hesaplanıyor...`);
                        const res = await ask('ARCHITECT', planPrompt, __dirname);
                        const match = res.match(/\[[\s\S]*\]/);
                        if (!match) throw new Error("Geçerli bir görev listesi (JSON) üretilemedi.");
                        
                        const projectConfigPath = path.join(__dirname, '..', 'src', project_id, 'config.json');
                        let projectDocs = "";
                        if (fs.existsSync(projectConfigPath)) {
                            try {
                                const pConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
                                if (pConfig.documentation_links) {
                                    projectDocs = Array.isArray(pConfig.documentation_links) 
                                        ? pConfig.documentation_links.join('\n') 
                                        : pConfig.documentation_links;
                                }
                            } catch (err) {
                                log(`⚠️ [${project_id}] Konfigürasyon okuma hatası: ${err.message}`);
                            }
                        }

                        const tasks = JSON.parse(match[0]);
                        tasks.forEach(t => {
                            handleMessage({ 
                                type: 'TASK_READY', 
                                project_id, 
                                doc_context: projectDocs,
                                ...t 
                            });
                        });

                        // Dökümanı mühürle (tekrar okunmasın)
                        fs.renameSync(fullPath, path.join(projectPath, `_${file}`));
                        log(`✅ [${project_id}] Planlama tamamlandı. ${tasks.length} görev kuyruğa girdi.`);
                    } catch (e) {
                        log(`❌ [${project_id}] Planlama Hatası: ${e.message}`);
                    }
                }
            }
        }
    } finally {
        isDiscovering = false;
    }
}

// Otonom döngüleri başlat
setInterval(discoverNewProjects, 60000);
discoverNewProjects();

start('ARCHITECT', handleMessage).catch(e => log(`KRİTİK HATA: ${e.message}`));