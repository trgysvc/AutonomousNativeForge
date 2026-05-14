'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ask, start, log, sendMessage, getAuthorizedPath, safeWriteFile, NIM_CONFIG } = require('./base-agent');
const PROMPT_MODE = 'MINIMAL'; // Forge V3 Standard
const SRC = NIM_CONFIG.workspace_dir || path.join(__dirname, '..', 'src');

/**
 * Project Tree: Generates a simple directory map for the agent context
 */
function getProjectTree(projectPath) {
    try {
        if (!fs.existsSync(projectPath)) return "Dizin henüz oluşturulmadı.";
        const files = fs.readdirSync(projectPath, { recursive: true });
        return files.slice(0, 500).join('\n'); // 50'den 500'e çıkarıldı (Nemotron Kapasitesi)
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

const LANG_MAP = {
    '.js':    'Node.js',
    '.ts':    'TypeScript',
    '.tsx':   'React/Next.js (TypeScript)',
    '.jsx':   'React (JavaScript)',
    '.sql':   'SQL',
    '.py':    'Python',
    '.rs':    'Rust',
    '.go':    'Go',
    '.swift': 'Swift',
    '.kt':    'Kotlin',
    '.rb':    'Ruby',
    '.php':   'PHP',
    '.cs':    'C#',
    '.cpp':   'C++',
    '.sh':    'Bash',
    '.toml':  'TOML',
    '.yml':   'YAML',
    '.yaml':  'YAML',
};

// Context dosyası başına maksimum karakter (≈2500 token). Toplam cap: 10 dosya × 10000 = 100K char.
const MAX_CONTEXT_CHARS_PER_FILE = 10000;

/**
 * Context File Injection: Bağımlı ve paylaşılan dosyaları okuyup prompt'a ekler.
 * Coder bu sayede mevcut tipler, interface'ler ve fonksiyonları görerek yazar.
 */
function buildContextInjection(contextFiles, projectPath, logPrefix) {
    if (!contextFiles || contextFiles.length === 0) return '';

    const injections = [];
    contextFiles.forEach(cf => {
        if (!fs.existsSync(cf)) return;
        try {
            const content = fs.readFileSync(cf, 'utf8');
            const relativePath = path.relative(projectPath, cf);
            const snippet = content.length > MAX_CONTEXT_CHARS_PER_FILE
                ? content.substring(0, MAX_CONTEXT_CHARS_PER_FILE) + '\n... (dosya kırpıldı)'
                : content;
            injections.push(`\n--- BAĞLAM: ${relativePath} ---\n${snippet}`);
        } catch (e) { /* okunamayan dosyayı atla */ }
    });

    if (injections.length === 0) return '';
    log(`📎 ${logPrefix} ${injections.length} bağlam dosyası enjekte edildi.`);
    return '\n\nMEVCUT DOSYALAR (Bu dosyalarla uyumlu yaz — tipleri, import yollarını ve API sözleşmelerini koru):' + injections.join('\n');
}

async function handleMessage(msg) {
    const { type, project_id, task_id, file_path, title, desc, steer_instruction, context_files } = msg;
    const projectPath = path.join(SRC, project_id);
    if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

    // file_path zorunlu — undefined ise undefined.ts gibi bozuk dosya oluşmasını önle
    if (!file_path || typeof file_path !== 'string' || !path.extname(file_path)) {
        log(`❌ CODER: [${project_id}] ${task_id} için geçerli file_path yok (${file_path}) — görev atlandı.`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: `HATA: file_path geçersiz veya uzantısız: "${file_path}"` });
    }

    const ext = path.extname(file_path).toLowerCase();
    const targetLang = LANG_MAP[ext] || 'Code';

    const projectTree = getProjectTree(projectPath);

    let prompt = `Sen bir Kod Yazma Uzmanısın (Forge V3 - Mode: ${PROMPT_MODE}).
    GÖREV: ${title}
    HEDEF DOSYA: ${file_path}
    DİL: ${targetLang}

    KRİTİK TALİMAT: ${desc}

    BAĞLAM:
    - Çalışma Dizini: ${projectPath}
    - Proje Ağacı:\n${projectTree}
    - İzinli Kütüphaneler: Sadece PRD'de belirtilen en güncel sürümleri kullan.

    Kural 1: Architectural kararlar verme, sadece görev tanımındaki teknik spesifikasyonu uygula.
    Kural 2: SADECE ${targetLang} kodu döndür. Markdown bloğu, açıklama veya başlık yazma.`;

    // Active Recall Injection
    const lessons = getRelevantLessons(project_id, title, desc);
    if (lessons) prompt += lessons;

    // Failure Log Injection: Geçmiş başarısız denemeler — aynı hatayı tekrar yapma
    const failureLog = msg.failure_log || [];
    if (failureLog.length > 0) {
        prompt += `\n\n⚠️ BAŞARISIZ DENEME GEÇMİŞİ — BU HATALARI TEKRAR YAPMA:\n`;
        failureLog.forEach(f => {
            prompt += `- Deneme ${f.attempt} [${f.error_type}] (${f.timestamp.substring(0, 10)}): ${f.error.substring(0, 1000)}\n`;
        });
        prompt += `\nYukarıdaki hataları analiz et ve farklı bir strateji uygula.`;
    }

    // Context File Injection (bağımlılık çıktıları + planlanan shared dosyalar)
    prompt += buildContextInjection(context_files, projectPath, `CODER: [${project_id}] ${task_id} —`);

    if (type === 'STEER_CODE' || type === 'FIX_CODE') {
        log(`🧭 STEERING: [${project_id}] ${task_id} yönlendirme ile düzeltiliyor...`);
        const currentCode = fs.existsSync(file_path) ? fs.readFileSync(file_path, 'utf8') : '';
        prompt += `\n\nMEVCUT KOD:\n${currentCode}\n\nYÖNLENDİRME (STEER): ${steer_instruction || msg.description}`;
    } else {
        log(`✍️ CODER: [${project_id}] ${task_id} yazılıyor...`);
    }

    try {
        const code = await ask('CODER', prompt, __dirname);
        const filePath = getAuthorizedPath(projectPath, file_path || `${task_id}${ext}`);
        await safeWriteFile(filePath, code);
        const relativePath = path.relative(projectPath, filePath);
        sendMessage('ARCHITECT', 'CODE_FINISHED', { ...msg, file_path: relativePath });
    } catch (err) {
        log(`❌ CODER HATASI: ${err.message}`);
        sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: `CODER HATASI: ${err.message}` });
    }
}

start('CODER', handleMessage);
