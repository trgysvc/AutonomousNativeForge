'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ask, start, log, sendMessage } = require('./base-agent');

const SRC = path.join(__dirname, '..', 'src');

async function processTask(task) {
    const projectPath = path.join(SRC, task.project_id);
    const configPath = path.join(projectPath, 'config.json');
    
    // Proje bazlı anahtarları oku (Güvenlik için tokenları temizle)
    let configStr = '{}';
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.github) config.github.token = 'REDACTED';
        if (config.supabase) config.supabase.key = 'REDACTED'; // Varsa temizle
        configStr = JSON.stringify(config, null, 2);
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

    // Dökümantasyon Bağlamı (Architect'ten gelen linkler)
    const docContextSection = task.doc_context ? `
    REFERANS DÖKÜMANTASYON STANDARTLARI:
    ${task.doc_context}
    Lütfen yukarıdaki resmi dökümanlardaki en güncel pattern ve özellikleri kullanarak kod üret.` : "";

    let prompt = "";
    if (task.type === 'FIX_CODE') {
        log(`🔧 Hata Düzeltiliyor (${targetLang}): [${task.project_id}] ${task.task_id}`);
        const currentCode = fs.readFileSync(task.file_path, 'utf8');
        prompt = `
        PROJE: ${task.project_id}
        DİL: ${targetLang}
        KİMLİK VERİLERİ: ${configStr}
        DOSYA YOLU: ${task.file_path}
        ${docContextSection}
        
        MEVCUT HATALI KOD:
        ${currentCode}
        
        HATA RAPORU:
        ${task.description}
        
        Lütfen hatayı düzelt ve sadece güncel ${targetLang} kodunu döndür. Markdown bloğu kullanma.`;
    } else {
        log(`✍️ Kod Yazılıyor (${targetLang}): [${task.project_id}] ${task.title}`);
        prompt = `
        PROJE: ${task.project_id}
        DİL: ${targetLang}
        KİMLİK VERİLERİ (Supabase/GitHub): ${configStr}
        GÖREV: ${task.desc}
        BAŞLIK: ${task.title}
        ${docContextSection}
        
        Lütfen sadece ${targetLang} kodunu döndür. Markdown bloğu kullanma.`;
    }

    const code = await ask('CODER', prompt, __dirname);
    
    const filePath = task.file_path ? path.join(projectPath, task.file_path) : path.join(projectPath, `${task.task_id}${ext}`);
    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    
    fs.writeFileSync(filePath, code, 'utf-8');
    log(`💾 Kod Mühürlendi: ${filePath}`);
    
    sendMessage('ARCHITECT', 'CODE_FINISHED', { ...task, file_path: filePath });
}

start('CODER', processTask);