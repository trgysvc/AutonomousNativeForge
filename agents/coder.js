'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ask, start, log, sendMessage, getAuthorizedPath, safeWriteFile } = require('./base-agent');

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

async function processTask(task) {
    const projectPath = path.join(SRC, task.project_id);
    if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

    const configPath = path.join(projectPath, 'config.json');
    
    // Proje bazlı anahtarları oku (Güvenlik için tokenları temizle)
    let configStr = '{}';
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.github) config.github.token = 'REDACTED';
            if (config.supabase) config.supabase.key = 'REDACTED';
            configStr = JSON.stringify(config, null, 2);
        } catch (e) { log(`⚠️ Config okuma hatası: ${e.message}`); }
    }

    // Dil algılama
    const ext = path.extname(task.file_path || (task.task_id + '.js')).toLowerCase();
    const langMap = {
        '.js': 'Node.js',
        '.ts': 'TypeScript',
        '.tsx': 'React/Next.js (TypeScript)',
        '.swift': 'Swift (Apple Silicon Optimized)',
        '.py': 'Python',
        '.sql': 'PostgreSQL/Supabase SQL',
        '.html': 'HTML5',
        '.css': 'Tailwind CSS / CSS3'
    };
    const targetLang = langMap[ext] || 'Source Code';

    const projectTree = getProjectTree(projectPath);

    // Dökümantasyon Bağlamı
    const docContextSection = task.doc_context ? `
    REFERANS DÖKÜMANTASYON STANDARTLARI:
    ${task.doc_context}
    Lütfen yukarıdaki resmi dökümanlardaki en güncel pattern ve özellikleri kullanarak kod üret.` : "";

    const contextHeader = `
    CURRENT WORKING DIRECTORY: ${projectPath}
    PROJECT STRUCTURE:
    ${projectTree}
    `;

    let prompt = "";
    if (task.type === 'FIX_CODE') {
        log(`🔧 Hata Düzeltiliyor (${targetLang}): [${task.project_id}] ${task.task_id}`);
        const currentCode = fs.readFileSync(task.file_path, 'utf8');
        prompt = `
        ${contextHeader}
        PROJE: ${task.project_id}
        DİL: ${targetLang}
        KİMLİK VERİLERİ: ${configStr}
        DOSYA YOLU: ${task.file_path}
        ${docContextSection}
        
        MEVCUT HATALI KOD:
        ${currentCode}
        
        HATA RAPORU:
        ${task.description}
        
        KRİTİK KURAL (EISDIR Engelleme): Hedef yol bir dizin değil, her zaman yeni bir dosya ismi olmalıdır.
        Lütfen hatayı düzelt ve sadece güncel ${targetLang} kodunu döndür. Markdown bloğu kullanma.`;
    } else {
        log(`✍️ Kod Yazılıyor (${targetLang}): [${task.project_id}] ${task.title}`);
        prompt = `
        ${contextHeader}
        PROJE: ${task.project_id}
        DİL: ${targetLang}
        KİMLİK VERİLERİ (Supabase/GitHub): ${configStr}
        GÖREV: ${task.desc}
        BAŞLIK: ${task.title}
        ${docContextSection}
        
        KRİTİK KURAL (EISDIR Engelleme): Hedef yolun bir dizin (directory) değil, her zaman yeni bir dosya ismi (filename) olduğundan emin ol. Eğer bir dizin zaten mevcutsa (örn: src/), içine yeni bir dosya üret (örn: src/index.js).
        
        Lütfen sadece ${targetLang} kodunu döndür. Markdown bloğu kullanma.`;
    }

    try {
        const code = await ask('CODER', prompt, __dirname);
        
        // Path Authority & EISDIR Prevention
        const relativePath = task.file_path || `${task.task_id}${ext}`;
        const filePath = getAuthorizedPath(projectPath, relativePath);

        safeWriteFile(filePath, code);
        
        sendMessage('ARCHITECT', 'CODE_FINISHED', { ...task, file_path: filePath });
    } catch (err) {
        log(`❌ CODER HATASI: ${err.message}`);
        sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: `CODER HATASI: ${err.message}` });
    }
}

start('CODER', processTask);
