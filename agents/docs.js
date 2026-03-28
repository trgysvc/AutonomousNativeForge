'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ask, start, log, sendMessage } = require('./base-agent');

const DOCS_BASE = path.join(__dirname, '..', 'docs');

async function processTask(task) {
    log(`📄 Dokümantasyon: [${task.project_id}] ${task.title}`);
    const code = fs.readFileSync(task.file_path, 'utf8');

    const prompt = `
    Aşağıdaki başarılı modül için Türkçe teknik döküman ve DEVLOG girdisi hazırla.
    PROJE: ${task.project_id}
    GÖREV: ${task.title}
    KOD:
    ${code}
    
    MANDATORY RULES:
    1. Dökümanın EN BAŞINA şu damgayı ekle: PROJECT_ID: ${task.project_id}
    2. Format: Markdown. Teknik kararları ve 'Neden Native' olduğunu vurgula.
    3. Dil: Teknik Türkçe.`;

    const response = await ask('DOCS', prompt, __dirname);
    
    const projectDocDir = path.join(DOCS_BASE, task.project_id);
    if (!fs.existsSync(projectDocDir)) fs.mkdirSync(projectDocDir, { recursive: true });
    
    fs.writeFileSync(path.join(projectDocDir, `${task.task_id}.md`), response);
    
    // Ana DEVLOG'a ekle
    const devlogPath = path.join(__dirname, '..', 'DEVLOG.md');
    const entry = `\n---\n### [${new Date().toISOString()}] - ${task.project_id} - ${task.title}\n${response}\n`;
    fs.appendFileSync(devlogPath, entry, 'utf-8');
    
    log(`✅ Süreç Tamamlandı.`);
    sendMessage('ARCHITECT', 'DOCS_COMPLETE', task);
}

async function updateSystemState(msg) {
    const { project_id, project_manifest } = msg;
    log(`📊 Sistem Durumu Güncelleniyor: [${project_id}]`);

    const manifest = project_manifest || { tasks: [] };
    const doneTasks = manifest.tasks.filter(t => t.status === 'DONE');
    const technicalDebt = manifest.tasks.filter(t => t.status === 'DONE' && (t.desc.toLowerCase().includes('geçici') || t.desc.toLowerCase().includes('temp') || t.desc.toLowerCase().includes('workaround')));

    const prompt = `
    Sen bir Baş Mimarsın. Projenin şu anki fiziksel ve mantıksal durumunu özetleyen bir SYSTEM_STATE.md içeriği hazırla.
    PROJE: ${project_id}
    TAMAMLANAN GÖREVLER: ${JSON.stringify(doneTasks.map(t => t.title))}
    TEKNİK BORÇLAR: ${JSON.stringify(technicalDebt.map(t => t.title))}
    
    Format:
    # SYSTEM STATE: ${project_id}
    ## 🏗️ Mimari Özet
    ## ✅ Tamamlanan Özellikler
    ## ⚠️ Teknik Borç ve Riskler (Technical Debt)
    ## 🗺️ Sonraki Adımlar
    
    Dil: Teknik Türkçe.`;

    const response = await ask('DOCS', prompt, __dirname);
    
    const statePath = path.join(__dirname, '..', 'src', project_id, 'SYSTEM_STATE.md');
    fs.writeFileSync(statePath, response);
    log(`✅ SYSTEM_STATE.md güncellendi.`);
}

async function handleMessage(msg) {
    const { type } = msg;
    if (type === 'WRITE_DOCS') {
        await processTask(msg);
    } else if (type === 'UPDATE_STATE') {
        await updateSystemState(msg);
    }
}

start('DOCS', handleMessage);