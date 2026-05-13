'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { ask, start, log, sendMessage, NIM_CONFIG, withLock } = require('./base-agent');
const { scanCode } = require('./security_guardrail');
const { runInSandbox } = require('./docker_sandbox');
const SILENT_REPLY_TOKEN = 'HEARTBEAT_OK'; // Forge V3 Standard
const execAsync = promisify(exec);
const SRC = NIM_CONFIG.workspace_dir || path.join(__dirname, '..', 'src');

/**
 * Stack kuralları yükleme hiyerarşisi:
 *   1. manifest.stack_rules       — en yüksek öncelik (PRD'den çıkarılan proje kuralları)
 *   2. vault.json > global        — ikinci seviye (tüm projeler için global default)
 *   3. Boş liste                  — kural yok, kısıtlama yok (yanlış pozitif üretme)
 *
 * Neden boş fallback?
 *   Her proje farklı bir stack kullanır. ANF bir proje tipi varsaymaz.
 *   Kısıtlamalar PRD'den gelir; PRD yoksa kısıtlama da yoktur.
 */
async function loadStackRules(projectId) {
    return await withLock(`manifest-${projectId}`, async () => {
        try {
            const manifestPath = path.join(__dirname, '..', 'src', projectId, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (manifest.stack_rules) return manifest.stack_rules;
            }
        } catch (e) { /* manifest okunamazsa vault'a bak */ }

        // Vault global default (opsiyonel — vault.json'da tanımlıysa kullan)
        return {
            forbidden_libs: NIM_CONFIG.forbidden_libs || [],
            monorepo_roots: NIM_CONFIG.monorepo_roots || []
        };
    });
}

/**
 * Governance Tests: PRD-tabanlı Mimari Guardrail
 *
 * Denetim kuralları manifest.stack_rules'dan gelir.
 * - forbidden_libs boşsa: kütüphane kısıtlaması uygulanmaz
 * - monorepo_roots boşsa: dosya yolu kısıtlaması uygulanmaz
 *
 * Bu sayede Node.js, Python, Rust, Swift, .NET — her proje tipi
 * kendi PRD kurallarıyla denetlenir, AuraPOS varsayımları taşınmaz.
 */
async function checkArchitectureGuardrails(code, filePath, projectId) {
    const stackRules = await loadStackRules(projectId);
    const forbidden = stackRules.forbidden_libs || [];
    const monorepoRoots = stackRules.monorepo_roots || [];

    const issues = [];
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Rule 1: Dosya Yolu Kısıtlaması — yalnızca monorepo_roots tanımlıysa ve kaynak kod ise uygulanır
    // Dokümantasyon (.md), CI/CD (.yml/.yaml), config (.json, .toml, .env) ve migration (.sql)
    // dosyaları monorepo kök kontrolünden muaftır.
    const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.swift', '.kt', '.cs', '.cpp', '.c'];
    const ext = path.extname(filePath).toLowerCase();
    const isSourceFile = SOURCE_EXTS.includes(ext);
    if (monorepoRoots.length > 0 && isSourceFile) {
        const inValidRoot = monorepoRoots.some(root => normalizedPath.includes(root));
        if (!inValidRoot) {
            issues.push(`🛡️ PATH VIOLATION: Dosya geçerli bir proje kökünde değil [${monorepoRoots.join(', ')}]: ${filePath}`);
        }
    }

    // Rule 2: Yasak Kütüphane Kontrolü — yalnızca forbidden_libs tanımlıysa uygulanır
    if (forbidden.length > 0) {
        const lines = code.split('\n');
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            const isImportOrRequire = (trimmed.startsWith('import') || trimmed.includes('require(')) &&
                                       !trimmed.startsWith('//') &&
                                       !trimmed.startsWith('/*');
            if (isImportOrRequire) {
                forbidden.forEach(lib => {
                    const regex = new RegExp(`['"]${lib}(/[^'"]*)?['"]`, 'i');
                    if (regex.test(trimmed)) {
                        issues.push(`🛡️ LIB VIOLATION: '${lib}' bu projenin PRD'sinde yasaklıdır. (L:${index + 1})`);
                    }
                });
            }
        });
    }

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

    // 1. ADIM: Native Syntax Check (TSC/Node) — hızlı ön filtre
    const syntax = await validateCode(file_path);
    if (!syntax.valid) {
        log(`❌ SYNC FAIL: ${path.basename(file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'SYNTAX', description: `SENTAKS HATASI: ${syntax.error}` });
    }

    // 1.5 ADIM: Docker Sandbox — izole ortamda çalıştırma kontrolü
    const projectPath = path.join(SRC, project_id);
    log(`🐳 SANDBOX: [${project_id}] ${task_id} izole test ortamında denetleniyor...`);
    const sandbox = await runInSandbox(projectPath, file_path);
    if (sandbox.skipped) {
        log(`⏭️ SANDBOX ATLANDI: ${sandbox.reason}`);
    } else if (!sandbox.passed) {
        log(`❌ SANDBOX FAIL: ${path.basename(file_path)}`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'SANDBOX', description: `SANDBOX HATASI (İzole Ortam):\n${sandbox.output}` });
    } else {
        log(`🐳 SANDBOX GEÇTİ: ${path.basename(file_path)}`);
    }

    // 2. ADIM: Governance (PRD Guardrails — manifest.stack_rules tabanlı)
    const guardrailIssues = await checkArchitectureGuardrails(code, file_path, project_id);
    if (guardrailIssues.length > 0) {
        log(`🛡️ GUARDRAIL FAIL: [${project_id}] Mimari İhlal!`);
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'GUARDRAIL', description: guardrailIssues.join('\n') });
    }

    // 2.5 ADIM: Shadow Tester (Security Scan)
    log(`🕵️ SHADOW TESTER: [${project_id}] Güvenlik denetimi yapılıyor...`);
    const securityFindings = scanCode(code);
    if (securityFindings.length > 0) {
        log(`🚨 SECURITY FAIL: [${project_id}] Kritik açık tespit edildi!`);
        const firstFinding = securityFindings[0];
        const steerMsg = `GÜVENLİK İHLALİ: ${firstFinding.reason} (L:${firstFinding.line})\nÖNERİ: ${firstFinding.steer}`;
        return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'SECURITY', description: steerMsg });
    }

    // 3. ADIM: AI Review (PRD Uyumluluk Denetimi)
    const stackRules = await loadStackRules(project_id);
    const rulesContext = stackRules.forbidden_libs?.length > 0
        ? `Yasak kütüphaneler: ${stackRules.forbidden_libs.join(', ')}.`
        : 'Proje stack kuralları manifest\'te henüz tanımlı değil.';

    const prompt = `Sen bir kıdemli QA Mühendisisin.
    PROJE: ${project_id}
    GÖREV: ${title}
    PRD KURALLARI: ${rulesContext}
    KOD:
    ${code}

    Bu kodu yalnızca şu açılardan değerlendir:
    1. Görev tanımına (GÖREV) uygun mu? Beklenen işlevi yerine getiriyor mu?
    2. Proje PRD kurallarına aykırı bir kütüphane veya yaklaşım kullanıyor mu?
    3. Belirgin mantık hatası veya güvenlik açığı var mı?

    Genel kod kalitesi, stil veya "daha iyi yazılabilir" yorumları yapma — yalnızca PRD ihlali ve doğruluk denetle.

    Yanıt Formatı (SADECE JSON):
    {"status": "PASSED" | "FAILED", "reason": "...", "bugs": []}`;

    try {
        const res = await ask('TESTER', prompt, __dirname);
        const match = res.match(/\{[\s\S]*\}/);

        if (!match) {
            log(`❌ AI Review: JSON parse edilemedi. Yanıt: ${res.substring(0, 100)}`);
            return sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'AI_REVIEW_PARSE', description: `AI Review yanıtı geçersiz JSON: ${res.substring(0, 200)}` });
        }

        const result = JSON.parse(match[0]);

        if (result.status === 'PASSED') {
            log(`✅ [${project_id}] ${task_id} onaylandı. ${SILENT_REPLY_TOKEN}`);
            sendMessage('ARCHITECT', 'TEST_PASSED', msg);
        } else {
            sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'PRD_COMPLIANCE', description: `PRD UYUMSUZLUĞU: ${result.reason}` });
        }
    } catch (e) {
        log(`❌ AI Review başarısız: ${e.message}`);
        sendMessage('ARCHITECT', 'BUG_REPORT', { ...msg, error_type: 'AI_REVIEW_ERROR', description: `AI Review hatası (inceleme yapılamadı): ${e.message}` });
    }
}

start('TESTER', handleMessage);

module.exports = { validateCode, execAsync };