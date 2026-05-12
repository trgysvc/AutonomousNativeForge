'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { jsonrepair } = require('jsonrepair');
const { log, start, sendMessage, ask, pushToGithub, NIM_CONFIG, ensureBranch, createPullRequest } = require('./base-agent');
const { notify } = require('./notifier');
const { research } = require('./researcher');

const MAX_RETRIES = 3;
// Planlama başarısız olursa dosyaları sonsuz döngüden korur
const planFailCounts = {};
const MAX_PLAN_FAILS = 3;

function parseJsonRobust(raw) {
    try {
        return JSON.parse(raw);
    } catch (_) {
        return JSON.parse(jsonrepair(raw));
    }
}
// retryCounts moved to manifest.json (task.retry_count) for persistence across restarts

let isDiscovering = false;
const PROMPT_MODE = 'FULL'; // Forge V3 Standard
// TOKEN_LIMIT: Tahmin (chars/4) gerçek tokenizer'dan ~1.22x düşük sayıyor.
// 24576 context (vLLM max-model-len) - 1.22 düzeltme - 10000 output tamponu = ~12000 güvenli içerik sınırı.
const TOKEN_LIMIT = 12000;

/**
 * Token Estimation: Heuristic for character-to-token count (approx 4 chars/token)
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

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

/**
 * Active Recall: Record a lesson learned from a failure
 */
async function recordLesson(projectId, taskId, description) {
    const lessonPrompt = `Bu görev başarısız oldu: ${taskId}\nHata: ${description}\n\nBundan çıkarılması gereken 'Evrensel bir Ders' var mı? (Örn: 'X kütüphanesi yerine Y kullanılmalı'). 
    Eğer varsa dersi JSON formatında ver: {"global": true/false, "context": ["tag1"], "rule": "..."}.
    Global true ise tüm Forge için geçerli, false ise sadece bu proje (${projectId}) için geçerlidir. 
    Eğer ders yoksa "NO_LESSON" dön.`;

    try {
        const res = await ask('ARCHITECT', lessonPrompt, __dirname);
        if (res.includes("NO_LESSON")) return;

        const match = res.match(/\{[\s\S]*\}/);
        if (!match) return;
        const lesson = JSON.parse(match[0]);

        const filePath = lesson.global 
            ? path.join(__dirname, '..', 'common_lessons.json')
            : path.join(__dirname, '..', 'src', projectId, 'knowledge.json');

        let data = { lessons: [] };
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        lesson.id = `${taskId}_${Date.now()}`;
        data.lessons.push({
            id: lesson.id,
            context: lesson.context,
            rule: lesson.rule,
            severity: "CRITICAL"
        });

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        log(`🧠 BELLEK GÜNCELLENDİ: ${lesson.global ? 'Global' : projectId} dersi işlendi.`);
    } catch (e) {
        log(`⚠️ Ders kaydedilemedi: ${e.message}`);
    }
}

function updateTaskStatus(projectId, taskId, status, extra = {}) {
    const manifest = getManifest(projectId);
    const task = manifest.tasks.find(t => t.task_id === taskId);
    if (task) {
        task.status = status;
        Object.assign(task, extra);
        saveManifest(projectId, manifest);
        
        // Dependency Trigger: Check if any pending tasks can now start
        if (status === 'DONE' || status === 'FAILED') {
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

        // Eğer önceki bir sprint'te hala tamamlanmamış (DONE veya FAILED olmayan) görev varsa, bu görevi başlatma
        if (sprintIndex > 0) {
            const previousSprints = sprints.slice(0, sprintIndex);
            const unfinishedInPrevious = manifest.tasks.filter(t => 
                previousSprints.includes(t.task_id.split('-')[0]) && t.status !== 'DONE' && t.status !== 'FAILED'
            );

            if (unfinishedInPrevious.length > 0) {
                // log(`⏳ [${projectId}] Sprint Kilidi: ${currentSprint} başlatılamaz. Önceki sprintler bitmeli.`);
                continue; 
            }
        }

        const dependenciesMet = !task.depends_on || task.depends_on.every(depId => {
            const dep = manifest.tasks.find(t => t.task_id === depId);
            return dep && (dep.status === 'DONE' || dep.status === 'FAILED');
        });

        if (dependenciesMet) {
            log(`🎯 [${projectId}] Bağımlılıklar tamam, görev başlatılıyor: ${task.title}`);
            updateTaskStatus(projectId, task.task_id, 'IN_PROGRESS');

            // Context Files: Planlamada belirtilen + tamamlanan bağımlılıkların çıktı dosyaları
            // Coder bu dosyaların içeriğini okuyarak mevcut kod tabanıyla uyumlu yazar.
            const depContextFiles = (task.depends_on || [])
                .map(depId => manifest.tasks.find(t => t.task_id === depId))
                .filter(dep => dep && dep.file_path && fs.existsSync(dep.file_path))
                .map(dep => dep.file_path);
            const plannedContextFiles = task.context_files || [];
            const contextFiles = [...new Set([...plannedContextFiles, ...depContextFiles])];

            sendMessage('CODER', 'WRITE_CODE', {
                ...task,
                project_id: projectId,
                project_manifest: manifest,
                context_files: contextFiles
            });
        }
    }
}

/**
 * Sprint tamamlandığında feature branch'tan main'e PR açar.
 * Tüm sprint görevleri DONE değilse sessizce çıkar.
 */
async function checkSprintCompletion(projectId, sprintId, branchName) {
    const manifest = getManifest(projectId);
    const sprintTasks = manifest.tasks.filter(t => t.task_id.split('-')[0] === sprintId);
    if (sprintTasks.length === 0 || !sprintTasks.every(t => t.status === 'DONE')) return;

    log(`🏁 [${projectId}] Sprint ${sprintId} TAMAMLANDI! PR açılıyor: ${branchName} → main`);
    await notify('SPRINT_COMPLETE', { project_id: projectId, sprint_id: sprintId, task_count: sprintTasks.length, branch: branchName });

    const taskList = sprintTasks.map(t => `- ${t.task_id}: ${t.title}`).join('\n');
    const prBody = `## Sprint ${sprintId} Tamamlandı\n\nANF tarafından özerk olarak üretilen, test geçmiş dosyalar.\n\n### Görevler:\n${taskList}\n\n> 🤖 Bu PR Autonomous Native Forge tarafından otomatik açılmıştır.`;

    try {
        const prUrl = await createPullRequest(projectId, branchName, `[ANF] Sprint ${sprintId} Tamamlandı`, prBody);
        if (prUrl) {
            log(`✅ [${projectId}] PR açıldı: ${prUrl}`);
            await notify('PR_OPENED', { project_id: projectId, sprint_id: sprintId, pr_url: prUrl, branch: branchName });
        }
    } catch (e) {
        log(`⚠️ [${projectId}] PR açılamadı: ${e.message}`);
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
            log(`${prefix} ✅ TEST GEÇİLDİ.`);
            try {
                if (!file_path || !fs.existsSync(file_path)) throw new Error("Dosya yolu bulunamadı.");
                const content = fs.readFileSync(file_path, 'utf8');
                const sprintId = task_id.split('-')[0];
                const branchName = `feature/sprint-${sprintId.toLowerCase()}`;

                try {
                    await ensureBranch(project_id, branchName);
                    await pushToGithub(project_id, file_path, content, `[${task_id}] ${title}`, branchName);
                    log(`${prefix} 📦 ${branchName} branch'ına push edildi.`);
                } catch (gitErr) {
                    log(`${prefix} ⚠️ GitHub push atlandı: ${gitErr.message}`);
                }

                updateTaskStatus(project_id, task_id, 'DONE');
                delete retryCounts[task_id];
                await notify('TASK_DONE', { project_id, task_id, title, file_path });
                sendMessage('DOCS', 'WRITE_DOCS', msg);
                await checkSprintCompletion(project_id, sprintId, branchName);
            } catch (e) {
                log(`${prefix} ❌ Kritik Hata: ${e.message}`);
                updateTaskStatus(project_id, task_id, 'ERROR', { error: e.message });
            }
            break;

        case 'BUG_REPORT': {
            // Read retry_count from manifest (persistent across restarts)
            const manifest_br = getManifest(project_id);
            const taskObj_br = manifest_br.tasks.find(t => t.task_id === task_id);
            const currentRetry = (taskObj_br?.retry_count || 0) + 1;

            // Append to failure_log in manifest — persistent failure history
            const failureEntry = {
                attempt: currentRetry,
                timestamp: new Date().toISOString(),
                error_type: msg.error_type || 'UNKNOWN',
                error: (description || '').substring(0, 800) // limit size
            };
            const existingLog = taskObj_br?.failure_log || [];
            const failure_log = [...existingLog, failureEntry];

            // Write incremented retry_count + failure_log back to manifest immediately
            updateTaskStatus(project_id, task_id, taskObj_br?.status || 'FIXING', { retry_count: currentRetry, failure_log });

            if (currentRetry > MAX_RETRIES) {
                log(`${prefix} ⛔ MAX RETRY (${MAX_RETRIES}) AŞILDI. Re-planning başlatılıyor.`);
                updateTaskStatus(project_id, task_id, 'FAILED', { retry_count: currentRetry, failure_log });
                await notify('TASK_FAILED', { project_id, task_id, title, description, retries: MAX_RETRIES });

                const planPrompt = `GÖREV BAŞARISIZ OLDU: ${task_id}\nHATA GEÇMİŞİ:\n${failure_log.map(f => `- Deneme ${f.attempt} [${f.error_type}]: ${f.error}`).join('\n')}\nLütfen mimariyi ve PRD kurallarını tekrar gözden geçirerek görevi revise et.`;
                const rca = await ask('ARCHITECT', planPrompt, __dirname);
                const rcaPath = path.join(__dirname, '..', 'queue', 'error', `${task_id}_RCA.md`);
                fs.writeFileSync(rcaPath, `# RE-PLANNING REPORT: ${task_id}\n\n${rca}`);
            } else {
                // Forge V3: Steering Protocol
                log(`${prefix} 🧭 STEERING: Hata analizi ve yönlendirme yapılıyor (${currentRetry}/${MAX_RETRIES})`);
                updateTaskStatus(project_id, task_id, 'FIXING', { retry_count: currentRetry });

                // Active Recall: Check if this should be a lesson
                if (currentRetry >= 2) {
                    recordLesson(project_id, task_id, description);
                }
                
                const steerPrompt = `Kritik Hata Analizi: ${description}\n\nBu hata PRD veya Sprint kurallarına aykırı mı? Eğer öyleyse Coder'a şu yönlendirmeyi yap: "Dökümandaki X kuralına uyarak Y dosyasını Z şeklinde düzelt." Yanıtını kısa ve öz bir STEER mesajı olarak ver.`;
                const steerMessage = await ask('ARCHITECT', steerPrompt, __dirname);
                
                sendMessage('CODER', 'STEER_CODE', { 
                    ...msg, 
                    steer_instruction: steerMessage 
                });
            }
            break;
        }
            
        case 'DOCS_COMPLETE':
            log(`${prefix} 📄 Dokümantasyon tamamlandı. Sistem durumu güncelleniyor...`);
            sendMessage('DOCS', 'UPDATE_STATE', { 
                ...msg, 
                project_manifest: getManifest(project_id) 
            });
            break;
    }
}

/**
 * Otonom Proje Keşfi
 *
 * Dahili dizin (ANF içindeki docs/reference/): İşlendikten sonra dosyalar `_` prefix ile mühürlenir.
 * Harici dizin (vault.json > reference_dir): Dosyalar salt okunur. Manifest varlığı ile tekrar işleme engellenir.
 */
async function discoverNewProjects() {
    if (isDiscovering) return;
    isDiscovering = true;

    try {
        const defaultRefDir = path.join(__dirname, '..', 'docs', 'reference');
        const refDir = NIM_CONFIG.reference_dir || defaultRefDir;
        const isExternal = refDir !== defaultRefDir;

        if (!fs.existsSync(refDir)) {
            log(`⚠️ Referans dizini bulunamadı: ${refDir}`);
            return;
        }

        const projects = fs.readdirSync(refDir);
        for (const project_id of projects) {
            const projectPath = path.join(refDir, project_id);
            if (!fs.lstatSync(projectPath).isDirectory()) continue;

            let files;
            if (isExternal) {
                // Harici dizin: `_` filtresi yok, manifest tabanlı tekrar işleme engeli
                files = fs.readdirSync(projectPath).filter(f => f.endsWith('.md'));
                if (files.length === 0) continue;
                const existingManifest = getManifest(project_id);
                if (existingManifest.tasks.length > 0) continue; // Zaten planlandı
            } else {
                // Dahili dizin: `_` ile başlayanlar zaten işlenmiş sayılır
                files = fs.readdirSync(projectPath).filter(f => f.endsWith('.md') && !f.startsWith('_'));
                if (files.length === 0) continue;
            }

            // Sprint sırasına göre sırala: master_system → prd → sprint0 → sprint1 → ...
            const sprintOrder = (name) => {
                if (name.includes('master_system')) return 0;
                if (name.includes('prd'))           return 1;
                const m = name.match(/sprint(\d+)/i);
                return m ? 2 + parseInt(m[1]) : 50;
            };
            files.sort((a, b) => sprintOrder(a) - sprintOrder(b));

            // Token limitine sığacak kadar dosya al (greedy batch)
            // Skill dosyasını da sayıyoruz — sadece şablon değil, skill içeriği de context'e giriyor
            const skillPath = path.join(__dirname, 'architect.md');
            const skillTokens = fs.existsSync(skillPath) ? estimateTokens(fs.readFileSync(skillPath, 'utf-8')) : 0;
            const PROMPT_OVERHEAD = 1200 + skillTokens; // şablon + skill içeriği
            let batchFiles = [];
            let combinedContent = "";
            for (const file of files) {
                const piece = `\n\n--- FILE: ${file} ---\n\n` + fs.readFileSync(path.join(projectPath, file), 'utf-8');
                if (batchFiles.length > 0 && estimateTokens(combinedContent + piece) + PROMPT_OVERHEAD > TOKEN_LIMIT) {
                    log(`⏭️ [${project_id}] "${file}" bu tura sığmadı, sonraki iterasyona bırakıldı.`);
                    break;
                }
                batchFiles.push(file);
                combinedContent += piece;
            }

            log(`🔍 [${project_id}] Multi-Doc Synthesis başlatılıyor (${batchFiles.length}/${files.length} dosya, ~${estimateTokens(combinedContent) + PROMPT_OVERHEAD} token)...`);

            // Researcher: PRD içindeki URL'leri tara ve planlama bağlamını zenginleştir.
            // Devre dışı bırakmak için: vault.json > global.researcher_enabled = false
            let researchContext = '';
            if (NIM_CONFIG.researcher_enabled !== false) {
                researchContext = await research(combinedContent);
            }

            const planPrompt = `Sen bir Baş Mimarsın (Forge V3 - Mode: ${PROMPT_MODE}).
            Aşağıdaki teknik dökümanları analiz et ve EKSİKSİZ bir görev listesi çıkar.

            KRİTİK KURALLAR:
            1. ID MAPPING: task_id olarak dökümandaki başlık kodlarını (S0-1, S0-1.1 vb.) AYNEN kullan. Yoksa S0-1, S0-2 şeklinde üret.
            2. FILE PATH: file_path'i PRD'deki dizin yapısından türet. Monorepo ise apps/ veya packages/; tekil modül ise src/; döküman ne söylüyorsa onu uygula. ASLA tahmin etme.
            3. ATOMICITY: Her görev tek bir dosya üretmeli veya güncellemeli.
            4. STRICT FAIL: Dosya uzantısı olmayan her yol geçersizdir (.ts, .js, .py, .sql vb. zorunlu).
            5. BAĞIMLILIK: depends_on alanı ile sprint sırasına sadık kal; bağımlı görev başlamadan önce bağımlılığı tamamlanmış olmalı.

            TEKNİK BAĞLAM:
            ${combinedContent}${researchContext}

            Yanıtı SADECE JSON array olarak ver:
            [{"task_id": "...", "title": "...", "desc": "...", "file_path": "...", "depends_on": ["task_id_x"], "context_files": ["opsiyonel/paylasilan/types.ts"]}]

            context_files: Bu görevin yazılabilmesi için Coder'ın önceden okuması gereken mevcut dosyaların listesi (tip tanımları, interface'ler, paylaşılan yardımcı fonksiyonlar). Yalnızca planda daha önce yaratılacak dosyaları referans ver. Yoksa boş bırak.`;

            try {
                // Phase 1: Initial Planning
                const rawPlan = await ask('ARCHITECT', planPrompt, __dirname);
                const match = rawPlan.match(/\[[\s\S]*\]/);
                if (!match) throw new Error("JSON üretilemedi.");
                let tasks = parseJsonRobust(match[0]);

                // Phase 2: Peer Review (Consensus)
                log(`⚖️ CONSENSUS: [${project_id}] Peer Review başlatılıyor...`);

                // Token cap: review prompt'larının context overflow yapmasını önler
                const MAX_TASKS_CHARS = 8000;
                const tasksJson = JSON.stringify(tasks).substring(0, MAX_TASKS_CHARS);
                const costPrompt = `Aşağıdaki planı "Maliyet ve Verimlilik" (Cost-Oriented) açısından eleştir. Nereden tasarruf edilebilir? Gereksiz adımlar var mı?\nPLAN: ${tasksJson}`;
                const perfPrompt = `Aşağıdaki planı "Yüksek Performans ve Ölçeklenebilirlik" (Performance-Oriented) açısından eleştir. Nerede darboğaz olabilir? Daha native/hızlı bir yol var mı?\nPLAN: ${tasksJson}`;

                const [costReview, perfReview] = await Promise.all([
                    ask('REVIEWER_COST', costPrompt, __dirname),
                    ask('REVIEWER_PERF', perfPrompt, __dirname)
                ]);

                // Phase 3: Synthesis (Performance-Weighted)
                log(`🧬 SYNTHESIS: [${project_id}] Görüşler birleştiriliyor...`);
                // Review metinlerini de kap: synthesis prompt'un toplam boyutunu kontrol altına al
                const MAX_REVIEW_CHARS = 3000;
                const synthesisPrompt = `Sen Baş Mimarsın. İki farklı görüşü (Maliyet ve Performans) değerlendirerek final planı oluştur.
                KRİTİK: PRD V4 uyarınca "Yüksek Performans" (<2s yüklenme) her zaman maliyetten önceliklidir.
                COST REVIEW: ${costReview.substring(0, MAX_REVIEW_CHARS)}
                PERF REVIEW: ${perfReview.substring(0, MAX_REVIEW_CHARS)}
                ORIGINAL PLAN: ${tasksJson}

                Final planı SADECE JSON array olarak döndür.`;

                const finalPlanRaw = await ask('ARCHITECT', synthesisPrompt, __dirname);
                const finalMatch = finalPlanRaw.match(/\[[\s\S]*\]/);
                if (finalMatch) tasks = parseJsonRobust(finalMatch[0]);

                // Phase 4: Stack Rules Extraction
                // Görev dağıtımından ÖNCE manifest'e yazılır — Tester ilk görevi aldığında kurallar hazır olur.
                log(`📋 STACK RULES: [${project_id}] PRD'den teknoloji kuralları çıkarılıyor...`);
                const stackPrompt = `Aşağıdaki teknik PRD içeriğini analiz et ve proje teknoloji kurallarını çıkar.

İÇERİK:
${combinedContent.substring(0, 10000)}

SADECE şu JSON formatında yanıt ver (başka hiçbir şey yazma):
{
  "forbidden_libs": ["yasaklı kütüphane/paket adlarının listesi — import veya require içinde görülmemeli"],
  "monorepo_roots": ["geçerli dizin köklerinin listesi, örn. apps/, packages/, supabase/"]
}`;
                try {
                    const stackRaw = await ask('ARCHITECT', stackPrompt, __dirname);
                    const stackMatch = stackRaw.match(/\{[\s\S]*\}/);
                    if (stackMatch) {
                        const stackRules = parseJsonRobust(stackMatch[0]);
                        const stackManifest = getManifest(project_id);
                        stackManifest.stack_rules = stackRules;
                        saveManifest(project_id, stackManifest);
                        log(`📋 [${project_id}] Stack kuralları mühürlendi. Yasak: [${(stackRules.forbidden_libs || []).join(', ')}]`);
                    }
                } catch (stackErr) {
                    log(`⚠️ [${project_id}] Stack rules çıkarılamadı, varsayılanlar kullanılacak: ${stackErr.message}`);
                }

                const manifest = getManifest(project_id);

                tasks.forEach(t => {
                    // Desteklenen uzantılar: Web, Backend, Mobile, DB, DevOps, Sistem dilleri
                    const isValidPath = /\.(js|ts|tsx|jsx|json|sql|md|yml|yaml|sh|py|rs|go|swift|kt|rb|php|cs|cpp|c|h|toml|env\.example)$/.test(t.file_path);
                    if (isValidPath && !manifest.tasks.find(mt => mt.task_id === t.task_id)) {
                        handleMessage({ type: 'TASK_READY', project_id, ...t });
                    }
                });

                // Dahili dizinlerde işlenen dosyaları mühürle (sadece bu turda işlenenler)
                if (!isExternal) {
                    batchFiles.forEach(file => fs.renameSync(path.join(projectPath, file), path.join(projectPath, `_${file}`)));
                }
                delete planFailCounts[project_id]; // başarıda sayacı sıfırla
                log(`✅ [${project_id}] Consensus Planlama tamamlandı. ${tasks.length} görev kuyruğa girdi.`);
            } catch (e) {
                log(`❌ [${project_id}] Planlama Hatası: ${e.message}`);
                planFailCounts[project_id] = (planFailCounts[project_id] || 0) + 1;
                // MAX_PLAN_FAILS sonrası dosyaları mühürle — sonsuz döngüyü kır
                if (!isExternal && planFailCounts[project_id] >= MAX_PLAN_FAILS) {
                    log(`⛔ [${project_id}] ${MAX_PLAN_FAILS} başarısız denemeden sonra dosyalar mühürleniyor.`);
                    batchFiles.forEach(file => {
                        try { fs.renameSync(path.join(projectPath, file), path.join(projectPath, `_FAILED_${file}`)); } catch (_) {}
                    });
                    delete planFailCounts[project_id];
                }
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