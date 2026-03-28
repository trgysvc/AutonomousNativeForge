'use strict';
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const path = require('node:path');
const { ask, start, log, sendMessage } = require('./base-agent');

/**
 * Fiziksel sentaks kontrolü (node --check ve tsc --noEmit)
 */
function validateCode(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.js') {
            execSync(`node --check "${filePath}"`, { stdio: 'ignore' });
            return { valid: true };
        } else if (ext === '.ts' || ext === '.tsx') {
            try {
                // Not: Globals veya local node_modules'da tsc yüklü olmalıdır
                execSync(`tsc --noEmit "${filePath}"`, { stdio: 'ignore' });
                return { valid: true };
            } catch (err) {
                if (err.code === 'ENOENT' || err.message.includes('not found')) {
                    log("⚠️ UYARI: 'tsc' (TypeScript Compiler) bulunamadı, tip kontrolü atlanıyor.");
                    return { valid: true, warning: 'tsc not found' };
                }
                throw err;
            }
        }
    } catch (err) {
        return { valid: false, error: err.message };
    }
    return { valid: true };
}

/**
 * Politika Denetimi: Yasaklı kütüphanelerin (express, mongoose vb.) kullanımını engeller.
 * Sadece require veya import satırlarını kontrol eder, yorumları es geçer.
 */
function checkPolicy(code) {
    const forbidden = ['express', 'mongoose', 'axios', 'lodash', 'dotenv'];
    const issues = [];
    
    const lines = code.split('\n');
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        // Sadece aktif kod satırlarını kontrol et
        const isImportOrRequire = (trimmed.startsWith('import') || trimmed.includes('require(')) && 
                                  !trimmed.startsWith('//') && 
                                  !trimmed.startsWith('/*');
        
        if (isImportOrRequire) {
            forbidden.forEach(lib => {
                // Regex: kütüphane adını tırnak içinde ara
                const regex = new RegExp(`['"]${lib}['"]`, 'i');
                if (regex.test(trimmed)) {
                    issues.push(`🛡️ Policy İhlali: '${lib}' kullanımı projenin native felsefesine aykırıdır (Line: ${index + 1})`);
                }
            });
        }
    });

    return issues;
}

async function processTask(task) {
    log(`🧐 Kalite Kontrol Başlatıldı: [${task.project_id}] ${task.task_id}`);
    
    if (!task.file_path || !fs.existsSync(task.file_path)) {
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: "HATA: Test edilecek dosya fiziksel olarak bulunamadı." });
    }

    const code = fs.readFileSync(task.file_path, 'utf8');

    // 1. ADIM: Fiziksel Sentaks Kontrolü (Node/TSC)
    const syntax = validateCode(task.file_path);
    if (!syntax.valid) {
        log(`❌ Sentaks Hatası Tespit Edildi: ${path.basename(task.file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: `SENTAKS HATASI: ${syntax.error}` });
    }

    // 2. ADIM: Native Politika Denetimi
    const policyIssues = checkPolicy(code);
    if (policyIssues.length > 0) {
        log(`🚫 Politika İhlali Tespit Edildi: ${path.basename(task.file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: policyIssues.join('\n') });
    }

    // 3. ADIM: Mantıksal ve Derin Denetim (DeepSeek-R1)
    const prompt = `
    Sen bir Kıdemli QA Mühendisisin. Aşağıdaki kodu mantıksal hatalar, güvenlik açıkları ve performans için denetle:
    PROJE: ${task.project_id}
    GÖREV: ${task.title}
    KOD:
    ${code}

    MANDATORY OUTPUT FORMAT (JSON ONLY):
    {
        "status": "PASSED" | "FAILED",
        "bugs": [
            { "id": 1, "description": "Hata detayı", "severity": "HIGH"|"MEDIUM"|"LOW", "line": 0 }
        ],
        "tests": [
            { "test_name": "Test Adı", "result": "PASS"|"FAIL", "reason": "Açıklama" }
        ],
        "summary": "Teknik değerlendirme özeti"
    }

    KURALLAR:
    - SADECE Native Node.js kullanılabilir.
    - Mantıksal bir açık, performans sorunu veya eksik hata yönetimi varsa FAILED dön.`;

    try {
        const res = await ask('TESTER', prompt, __dirname);
        let result = { status: 'FAILED', bugs: [{ description: 'Yapay zeka yanıtı ayrıştırılamadı.' }] };
        
        const match = res.match(/\{[\s\S]*\}/);
        if (match) result = JSON.parse(match[0]);

        if (result.status === 'PASSED') {
            log(`✅ TÜM TESTLER GEÇİLDİ: ${path.basename(task.file_path)}`);
            sendMessage('ARCHITECT', 'TEST_PASSED', task);
        } else {
            const bugSummary = Array.isArray(result.bugs) 
                ? result.bugs.map(b => `[L:${b.line}] ${b.description}`).join(', ')
                : result.bugs;
            sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: bugSummary });
        }
    } catch (e) {
        log(`❌ Tester Kritik Hata: ${e.message}`);
        sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: `TESTER KRİTİK HATA: ${e.message}` });
    }
}

start('TESTER', processTask);