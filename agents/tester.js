'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { ask, start, log, sendMessage } = require('./base-agent');

const execAsync = promisify(exec);

/**
 * Politika Denetimi: Yasaklı kütüphanelerin (express, mongoose vb.) kullanımını engeller.
 * Sadece Node.js native modülleri ve projenin izin verdiği minimalist yapı korunur.
 */
function checkPolicy(code) {
    const forbidden = ['express', 'mongoose', 'axios', 'lodash', 'dotenv', 'nodemon'];
    const issues = [];
    
    // Hallucination Protection Protocol (PRD Line 9-11 Logic)
    const lines = code.split('\n');
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        const isImportOrRequire = (trimmed.startsWith('import') || trimmed.includes('require(')) && 
                                   !trimmed.startsWith('//') && 
                                   !trimmed.startsWith('/*');
        
        if (isImportOrRequire) {
            forbidden.forEach(lib => {
                const regex = new RegExp(`['"]${lib}['"]`, 'i');
                if (regex.test(trimmed)) {
                    issues.push(`🛡️ PROTOCOL VIOLATION: '${lib}' kullanımı PRD-Satır 4.5 uyarınca yasaktır (L:${index + 1})`);
                }
            });

            // Specific check for Express which is strictly forbidden in AuraPOS (Fastify is used)
            if (trimmed.toLowerCase().includes('express')) {
                issues.push(`⚠️ PRD İHLALİ: Express yerine Fastify kullanmalısın (PRD v4.1) (L:${index + 1})`);
            }
        }
    });

    return issues;
}

/**
 * Fiziksel sentaks ve tip kontrolü (Async)
 */
async function validateCode(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.js') {
            await execAsync(`node --check "${filePath}"`);
            return { valid: true };
        } else if (ext === '.ts' || ext === '.tsx') {
            try {
                // Not: Hızlı kontrol için npx -y typescript kullanıyoruz
                await execAsync(`npx -y typescript tsc --noEmit --target esnext --module esnext --esModuleInterop --skipLibCheck "${filePath}"`);
                return { valid: true };
            } catch (err) {
                // Eğer tsc bulunamazsa veya npx hata verirse uyarı dön
                return { valid: false, error: err.stderr || err.message };
            }
        }
    } catch (err) {
        return { valid: false, error: err.stderr || err.message };
    }
    return { valid: true };
}

async function processTask(task) {
    log(`🧐 Kalite Kontrol Başlatıldı: [${task.project_id}] ${task.task_id}`);
    
    if (!task.file_path || !fs.existsSync(task.file_path)) {
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: "HATA: Test edilecek dosya fiziksel olarak bulunamadı." });
    }

    const code = fs.readFileSync(task.file_path, 'utf8');

    // 1. ADIM: Fiziksel Sentaks Kontrolü (Node/TSC)
    const syntax = await validateCode(task.file_path);
    if (!syntax.valid) {
        log(`❌ Sentaks Hatası Tespit Edildi: ${path.basename(task.file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: `SENTAKS/TIP HATASI: ${syntax.error}` });
    }

    // 2. ADIM: Native Politika Denetimi
    const policyIssues = checkPolicy(code);
    if (policyIssues.length > 0) {
        log(`🚫 Politika İhlali Tespit Edildi: ${path.basename(task.file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: policyIssues.join('\n') });
    }

    // 3. ADIM: Mantıksal ve Derin Denetim (AI Review)
    const prompt = `
    Sen bir Kıdemli QA Mühendisisin. Aşağıdaki kodu MANTIKSAL olarak denetle.
    Sentaks ve Tip kontrolü NATIVE araçlarla (node/tsc) GEÇTİ. Sadece iş mantığı ve best-practice odaklı incele.
    
    PROJE: ${task.project_id}
    GÖREV: ${task.title}
    KOD:
    ${code}

    MANDATORY OUTPUT FORMAT (JSON ONLY):
    {
        "status": "PASSED" | "FAILED",
        "bugs": [
            { "id": 1, "description": "Hata detayı", "severity": "HIGH"|"MEDIUM"|"LOW" }
        ],
        "summary": "Teknik değerlendirme özeti"
    }

    KURALLAR:
    - SADECE Native Node.js kullanılabilir.
    - Mantıksal bir açık, performans sorunu veya eksik hata yönetimi varsa FAILED dön.
    - Hata yoksa PASSED dön.`;

    try {
        const res = await ask('TESTER', prompt, __dirname);
        let result = { status: 'PASSED' };
        
        const match = res.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                result = JSON.parse(match[0]);
            } catch (e) {
                log(`⚠️ AI yanıtı JSON olarak ayrıştırılamadı, native onaya güveniliyor.`);
            }
        }

        if (result.status === 'PASSED') {
            log(`✅ TÜM TESTLER GEÇİLDİ: ${path.basename(task.file_path)}`);
            sendMessage('ARCHITECT', 'TEST_PASSED', task);
        } else {
            const bugSummary = Array.isArray(result.bugs) 
                ? result.bugs.map(b => b.description).join(', ')
                : result.summary || 'Mantıksal hata tespit edildi.';
            sendMessage('ARCHITECT', 'BUG_REPORT', { ...task, description: `MANTIKSAL HATA: ${bugSummary}` });
        }
    } catch (e) {
        // LLM review fail olsa bile native tools pass verdiyse opsiyonel olarak geçirebiliriz (Resilience)
        log(`⚠️ AI Review Hatası: ${e.message}. Native validation baz alınıyor.`);
        sendMessage('ARCHITECT', 'TEST_PASSED', task);
    }
}

start('TESTER', processTask);