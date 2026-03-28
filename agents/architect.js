'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { log, start, sendMessage, ask, pushToGithub } = require('./base-agent');

const MAX_RETRIES = 3;
const retryCounts = {};

let isDiscovering = false;
const PROMPT_MODE = 'FULL'; // Forge V3 Standard

/**
 * Manifest Management: Tracks project state and task dependencies
 */
function getManifest(projectId) {
    const manifestPath = path.join(__dirname, '..', 'src', projectId, 'manifest.json');
    if (!fs.existsSync(path.dirname(manifestPath))) fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    
    if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify({ project_id: projectId, tasks: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function saveManifest(projectId, manifest) {
    const manifestPath = path.join(__dirname, '..', 'src', projectId, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function updateTaskStatus(projectId, taskId, status, extra = {}) {
    const manifest = getManifest(projectId);
    const task = manifest.tasks.find(t => t.task_id === taskId);
    if (task) {
        task.status = status;
        Object.assign(task, extra);
        saveManifest(projectId, manifest);
        
        // Dependency Trigger: Check if any pending tasks can now start
        if (status === 'DONE') {
            dispatchNextTasks(projectId);
        }
    }
}

async function dispatchNextTasks(projectId) {
    const manifest = getManifest(projectId);
    const pendingTasks = manifest.tasks.filter(t => t.status === 'PENDING');
    
    // Sprint Gate: Get the hierarchy of current tasks
    const allTaskIds = manifest.tasks.map(t => t.task_id);
    const sprints = [...new Set(allTaskIds.map(id => id.split('-')[0]))].sort(); // S0, S1, S2...

    for (const task of pendingTasks) {
        const currentSprint = task.task_id.split('-')[0];
        const sprintIndex = sprints.indexOf(currentSprint);

        // Eğer önceki bir sprint'te hala tamamlanmamış (DONE olmayan) görev varsa, bu görevi başlatma
        if (sprintIndex > 0) {
            const previousSprints = sprints.slice(0, sprintIndex);
            const unfinishedInPrevious = manifest.tasks.filter(t => 
                previousSprints.includes(t.task_id.split('-')[0]) && t.status !== 'DONE'
            );

            if (unfinishedInPrevious.length > 0) {
                // log(`⏳ [${projectId}] Sprint Kilidi: ${currentSprint} başlatılamaz. Önceki sprintler bitmeli.`);
                continue; 
            }
        }

        const dependenciesMet = !task.depends_on || task.depends_on.every(depId => {
            const dep = manifest.tasks.find(t => t.task_id === depId);
            return dep && dep.status === 'DONE';
        });

        if (dependenciesMet) {
            log(`🎯 [${projectId}] Bağımlılıklar tamam, görev başlatılıyor: ${task.title}`);
            updateTaskStatus(projectId, task.task_id, 'IN_PROGRESS');
            sendMessage('CODER', 'WRITE_CODE', { 
                ...task, 
                project_id: projectId, 
                project_manifest: manifest 
            });
        }
    }
}

/**
 * Ajanlar arası mesaj trafiği yönetimi
 */
async function handleMessage(msg) {
    const { type, project_id, task_id, file_path, title, description, bugs } = msg;
    const prefix = `[${project_id}] `;

    switch (type) {
        case 'TASK_READY':
            // Yeni görev geldiğinde manifest'e ekle (zaten yoksa)
            const manifest = getManifest(project_id);
            if (!manifest.tasks.find(t => t.task_id === task_id)) {
                manifest.tasks.push({
                    task_id, title, desc: msg.desc, file_path, 
                    depends_on: msg.depends_on || [], 
                    status: 'PENDING'
                });
                saveManifest(project_id, manifest);
            }
            dispatchNextTasks(project_id);
            break;

        case 'CODE_FINISHED':
            log(`${prefix} Kod yazımı bitti. Test ajanı devralıyor: ${task_id}`);
            updateTaskStatus(project_id, task_id, 'TESTING');
            sendMessage('TESTER', 'RUN_TEST', msg);
            break;

        case 'TEST_PASSED':
            log(`${prefix} ✅ TEST GEÇİLDİ. GitHub'a otonom push başlatılıyor...`);
            try {
                if (!file_path || !fs.existsSync(file_path)) throw new Error("Dosya yolu bulunamadı.");
                const content = fs.readFileSync(file_path, 'utf8');
                
                await pushToGithub(project_id, file_path, content, `Otonom Onaylı Commit: ${title}`);
                log(`${prefix} 📦 GitHub mühürleme başarılı.`);
                
                updateTaskStatus(project_id, task_id, 'DONE');
                delete retryCounts[task_id];
                
                // Dokümantasyon aşamasına geç
                sendMessage('DOCS', 'WRITE_DOCS', msg);
            } catch (e) {
                log(`${prefix} ❌ GitHub Kritik Hata: ${e.message}`);
                updateTaskStatus(project_id, task_id, 'ERROR', { error: e.message });
            }
            break;

        case 'BUG_REPORT':
            retryCounts[task_id] = (retryCounts[task_id] || 0) + 1;
            
            if (retryCounts[task_id] > MAX_RETRIES) {
                log(`${prefix} ⛔ MAX RETRY (${MAX_RETRIES}) AŞILDI. Re-planning başlatılıyor.`);
                updateTaskStatus(project_id, task_id, 'FAILED');
                
                const planPrompt = `GÖREV BAŞARISIZ OLDU: ${task_id}\nHATA: ${description}\nLütfen mimariyi ve PRD kurallarını tekrar gözden geçirerek görevi revize et.`;
                const rca = await ask('ARCHITECT', planPrompt, __dirname);
                const rcaPath = path.join(__dirname, '..', 'queue', 'error', `${task_id}_RCA.md`);
                fs.writeFileSync(rcaPath, `# RE-PLANNING REPORT: ${task_id}\n\n${rca}`);
            } else {
                // Forge V3: Steering Protocol
                log(`${prefix} 🧭 STEERING: Hata analizi ve yönlendirme yapılıyor (${retryCounts[task_id]}/${MAX_RETRIES})`);
                updateTaskStatus(project_id, task_id, 'FIXING');
                
                const steerPrompt = `Kritik Hata Analizi: ${description}\n\nBu hata PRD veya Sprint kurallarına aykırı mı? Eğer öyleyse Coder'a şu yönlendirmeyi yap: "Dökümandaki X kuralına uyarak Y dosyasını Z şeklinde düzelt." Yanıtını kısa ve öz bir STEER mesajı olarak ver.`;
                const steerMessage = await ask('ARCHITECT', steerPrompt, __dirname);
                
                sendMessage('CODER', 'STEER_CODE', { 
                    ...msg, 
                    steer_instruction: steerMessage 
                });
            }
            break;
    }
}

/**
 * Otonom Proje Keşfi
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
            if (!fs.lstatSync(projectPath).isDirectory()) continue;

            const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.md') && !f.startsWith('_'));
            if (files.length === 0) continue;

            log(`🔍 [${project_id}] Multi-Doc Synthesis başlatılıyor (${files.length} dosya)...`);
            
            // Tüm dökümanları tek bir bağlamda birleştir
            let combinedContent = "";
            files.forEach(file => {
                combinedContent += `\n\n--- FILE: ${file} ---\n\n` + fs.readFileSync(path.join(projectPath, file), 'utf-8');
            });

            const planPrompt = `Sen bir Baş Mimarsın (Forge V3 - Mode: ${PROMPT_MODE}). 
            Aşağıdaki bağlantılı teknik dökümanları (PRD, Sprints, Ref) analiz et ve EKSİKSİZ bir iş listesi çıkar.

            KRİTİK KURALLAR:
            1. ID MAPPING: task_id dökümandaki başlık kodlarını (S0-1, S0-1.1 vb.) KESİN anahtar olarak kullan.
            2. MONOREPO AUTHORITY: file_path 'apps/' veya 'packages/' ile başlamak zorundadır.
            3. ATOMIC FLOW: Her kod yazma görevi için bir 'read_skill' adımı zorunludur. Coder önce dökümanı okumalı.
            4. STRICT FAIL: Dosya uzantısı olmayan (.ts, .js vb.) her yol REDDEDİLECEKTİR.
            
            TEKNİK BAĞLAM: ${combinedContent}

            Yanıtı SADECE JSON formatında ver: [{"task_id": "...", "title": "...", "desc": "...", "file_path": "...", "depends_on": ["task_id_x"]}]`;

            try {
                const res = await ask('ARCHITECT', planPrompt, __dirname);
                const match = res.match(/\[[\s\S]*\]/);
                if (!match) throw new Error("JSON üretilemedi.");
                
                const tasks = JSON.parse(match[0]);
                const manifest = getManifest(project_id);
                
                tasks.forEach(t => {
                    const isValidPath = /\.(js|ts|tsx|json|sql|md|yml|sh)$/.test(t.file_path);
                    if (isValidPath && !manifest.tasks.find(mt => mt.task_id === t.task_id)) {
                        handleMessage({ type: 'TASK_READY', project_id, ...t });
                    }
                });

                // İşlenen dosyaları mühürle
                files.forEach(file => fs.renameSync(path.join(projectPath, file), path.join(projectPath, `_${file}`)));
                log(`✅ [${project_id}] Multi-Doc Planlama tamamlandı. ${tasks.length} görev kuyruğa girdi.`);
            } catch (e) {
                log(`❌ [${project_id}] Planlama Hatası: ${e.message}`);
            }
        }
    } finally {
        isDiscovering = false;
    }
}

setInterval(discoverNewProjects, 60000);

// CLI Support: node agents/architect.js [projectId]
const cliProjectId = process.argv[2];
if (cliProjectId) {
    log(`🚀 [CLI] Proje doğrudan başlatılıyor: ${cliProjectId}`);
    // discoverNewProjects parametre alacak şekilde geliştirilebilir 
    // veya doğrudan manifest üzerinden akış tetiklenebilir.
    dispatchNextTasks(cliProjectId);
} else {
    discoverNewProjects();
}

start('ARCHITECT', handleMessage).catch(e => log(`KRİTİK HATA: ${e.message}`));