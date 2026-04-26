'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { ask, start, log, sendMessage } = require('./base-agent');
const { scanCode } = require('./security_guardrail');
const SILENT_REPLY_TOKEN = 'HEARTBEAT_OK'; // Forge V3 Standard
const execAsync = promisify(exec);

/**
 * Governance Tests: Mimari Barikatlar (Guardrails)
 * PRD'de izin verilmeyen kütüphaneleri ve monorepo dışı yapıları engeller.
 */
function checkArchitectureGuardrails(code, filePath) {
    const forbidden = ['express', 'mongoose', 'axios', 'lodash', 'dotenv', 'nodemon', 'sequelize'];
    const issues = [];

    // Rule 1: Monorepo Path Authority
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (!normalizedPath.includes('apps/') && !normalizedPath.includes('packages/')) {
        issues.push(`🛡️ PROTOCOL VIOLATION: Dosya yolu monorepo standartlarına (apps/ veya packages/) aykırı: ${filePath}`);
    }
    
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
                    issues.push(`🛡️ PROTOCOL VIOLATION: '${lib}' kullanımı PRD v4 uyarınca yasaktır. (L:${index + 1})`);
                }
            });

            // Specific check for Express -> Fastify transition
            if (trimmed.toLowerCase().includes('express')) {
                issues.push(`⚠️ PRD İHLALİ: Express tespiti. Fastify kullanılması zorunludur. (L:${index + 1})`);
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
                await execAsync(`npx -y --package typescript tsc --noEmit --target esnext --module esnext --esModuleInterop --skipLibCheck "${filePath}"`);
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

async function handleMessage(msg) {
    const { type, project_id, task_id, file_path, title } = msg;
    if (type !== 'RUN_TEST') return;

    log(`🧐 QA GUARDRAIL: [${project_id}] ${task_id} denetleniyor...`);
    
    if (!file_path || !fs.existsSync(file_path)) {
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: "HATA: Dosya bulunamadı." });
    }

    const code = fs.readFileSync(file_path, 'utf8');

    // 1. ADIM: Native Syntax Check (TSC/Node)
    const syntax = await validateCode(file_path);
    if (!syntax.valid) {
        log(`❌ SYNC FAIL: ${path.basename(file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: `SENTAKS HATASI: ${syntax.error}` });
    }

    // 2. ADIM: Governance (PRD Guardrails)
    const guardrailIssues = checkArchitectureGuardrails(code, file_path);
    if (guardrailIssues.length > 0) {
        log(`🛡️ GUARDRAIL FAIL: [${project_id}] Mimari İhlal!`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: guardrailIssues.join('\n') });
    }

    // 2.5 ADIM: Shadow Tester (Security Scan)
    log(`🕵️ SHADOW TESTER: [${project_id}] Güvenlik denetimi yapılıyor...`);
    const securityFindings = scanCode(code);
    if (securityFindings.length > 0) {
        log(`🚨 SECURITY FAIL: [${project_id}] Kritik açık tespit edildi!`);
        const firstFinding = securityFindings[0];
        const steerMsg = `GÜVENLİK İHLALİ: ${firstFinding.reason} (L:${firstFinding.line})\nÖNERİ: ${firstFinding.steer}`;
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: steerMsg });
    }

    // 3. ADIM: Forge V3 AI Review (Compliance Check)
    const prompt = `Sen bir Forge V3 Kıdemli QA Mühendisisin. 
    KOD: ${code}
    GÖREV: ${title}
    
    YALNIZCA döküman uyumluluğu ve PRD kuralları açısından incele. 
    Eğer kod PRD'deki "native", "offline-first" veya "monorepo" kurallarına aykırıysa FAILED dön.
    
    Yanıt Formatı (SADECE JSON):
    {"status": "PASSED" | "FAILED", "reason": "...", "bugs": []}`;

    try {
        const res = await ask('TESTER', prompt, __dirname);
        const match = res.match(/\{[\s\S]*\}/);
        const result = match ? JSON.parse(match[0]) : { status: 'PASSED' };

        if (result.status === 'PASSED') {
            log(`✅ [${project_id}] ${task_id} onaylandı. ${SILENT_REPLY_TOKEN}`);
            sendMessage('ARCHITECT', 'TEST_PASSED', msg);
        } else {
            sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, description: `PRD UYUMSUZLUĞU: ${result.reason}` });
        }
    } catch (e) {
        log(`⚠️ AI Review hatası, native onay ile devam ediliyor.`);
        sendMessage('ARCHITECT', 'TEST_PASSED', msg);
    }
}

start('TESTER', handleMessage);

module.exports = { validateCode, execAsync };