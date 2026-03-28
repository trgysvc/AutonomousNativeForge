'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ask, start, log, sendMessage, getAuthorizedPath, safeWriteFile } = require('./base-agent');
const PROMPT_MODE = 'MINIMAL'; // Forge V3 Standard
const SRC = path.join(__dirname, '..', 'src');

/**
 * Project Tree: Generates a simple directory map for the agent context
 */
function getProjectTree(projectPath) {
    try {
        if (!fs.existsSync(projectPath)) return "Dizin henüz oluşturulmadı.";
        const files = fs.readdirSync(projectPath, { recursive: true });
        return files.slice(0, 50).join('\n'); // İlk 50 dosyayı döndür
    } catch (e) { return "Dizin okunamadı."; }
}

/**
 * Active Recall: Context-Aware Lesson Filtering
 */
function getRelevantLessons(projectId, title, desc) {
    const globalPath = path.join(__dirname, '..', 'common_lessons.json');
    const projectPath = path.join(__dirname, '..', 'src', projectId, 'knowledge.json');
    let allLessons = [];

    [globalPath, projectPath].forEach(p => {
        if (fs.existsSync(p)) {
            try {
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                allLessons = allLessons.concat(data.lessons || []);
            } catch (e) {}
        }
    });

    const contextKeywords = (title + " " + desc).toLowerCase();
    const relevant = allLessons.filter(lesson => 
        lesson.context.some(kw => contextKeywords.includes(kw.toLowerCase()))
    );

    if (relevant.length === 0) return "";

    let lessonStr = "\n\n🧠 GEÇMİŞ DENEYİM / KRİTİK DERSLER:\n";
    relevant.forEach(l => {
        lessonStr += `- [${l.id}] ${l.rule}\n`;
    });
    return lessonStr;
}

async function handleMessage(msg) {
    const { type, project_id, task_id, file_path, title, desc, steer_instruction, project_manifest } = msg;
    const projectPath = path.join(SRC, project_id);
    if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

    // Dil algılama
    const ext = path.extname(file_path || (task_id + '.ts')).toLowerCase();
    const langMap = { '.js': 'Node.js', '.ts': 'TypeScript', '.tsx': 'React/Next.js (TypeScript)', '.sql': 'PostgreSQL' };
    const targetLang = langMap[ext] || 'Code';

    const projectTree = getProjectTree(projectPath);
    const configPath = path.join(projectPath, 'config.json');
    let configStr = '{}';
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.github) config.github.token = 'REDACTED';
            configStr = JSON.stringify(config, null, 2);
        } catch (e) {}
    }

    let prompt = `Sen bir Kod Yazma Uzmanısın (Forge V3 - Mode: ${PROMPT_MODE}). 
    GÖREV: ${title}
    HEDEF DOSYA: ${file_path}
    DİL: ${targetLang}
    
    KRİTİK TALİMAT: ${desc}
    
    BAĞLAM:
    - Çalışma Dizini: ${projectPath}
    - Proje Ağacı: ${projectTree}
    - İzinli Kütüphaneler: Sadece PRD'de belirtilen en güncel sürümleri kullan.
    
    Kural 1: Architectural kararlar verme, sadece dökümandaki teknik spesifikasyonu uygula.
    Kural 2: Markdown bloğu kullanmadan SADECE ${targetLang} kodu döndür.`;

    // Active Recall Injection
    const lessons = getRelevantLessons(project_id, title, desc);
    if (lessons) prompt += lessons;

    if (type === 'STEER_CODE' || msg.type === 'FIX_CODE') {
        log(`🧭 STEERING: [${project_id}] ${task_id} yönlendirme ile düzeltiliyor...`);
        const currentCode = fs.existsSync(file_path) ? fs.readFileSync(file_path, 'utf8') : "";
        prompt += `\n\nMEVCUT KOD:\n${currentCode}\n\nYÖNLENDİRME (STEER): ${steer_instruction || msg.description}`;
    } else {
        log(`✍️ CODER: [${project_id}] ${task_id} yazılıyor...`);
    }

    try {
        const code = await ask('CODER', prompt, __dirname);
        const filePath = getAuthorizedPath(projectPath, file_path || `${task_id}${ext}`);
        
        safeWriteFile(filePath, code);
        sendMessage('ARCHITECT', 'CODE_FINISHED', { ...msg, file_path: filePath });
    } catch (err) {
        log(`❌ CODER HATASI: ${err.message}`);
        sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: `CODER HATASI: ${err.message}` });
    }
}

start('CODER', handleMessage);
