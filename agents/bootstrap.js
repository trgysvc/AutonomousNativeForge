/**
 * bootstrap.js — Otonom Yazılım Fabrikası (Cross-Platform Local Inference)
 * Proje Bazlı GitHub & Supabase Mühürleme Protokolü
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// ─── PROJE KİMLİK KASASI (VAULT) YÜKLEME ────────────────────────
const VAULT_PATH = path.join(__dirname, '..', 'config', 'vault.json');

function loadVault() {
    if (!fs.existsSync(VAULT_PATH)) {
        console.error(`❌ HATA: vault.json bulunamadı! [${VAULT_PATH}]`);
        process.exit(1);
    }
    try {
        return JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    } catch (err) {
        console.error("❌ HATA: vault.json okuma hatası!", err.message);
        process.exit(1);
    }
}

const PROJECTS_VAULT = loadVault();

const { exec, spawn } = require('node:child_process');

const BASE_DIR = path.join(__dirname, '..');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

const CONFIG = {
    vllmHost: 'http://localhost:8000',
    dirs: [
        'agents',
        'queue/inbox/architect',
        'queue/inbox/coder',
        'queue/inbox/tester',
        'queue/inbox/docs',
        'queue/processing',
        'queue/done',
        'queue/error',
        'docs/reference',
        'src',
        'logs'
    ]
};

const logFile = path.join(LOGS_DIR, 'system.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [BOOTSTRAP] ${msg}`;
    console.log(entry);
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(logFile, entry + '\n');
};

function initializeFolders() {
    log("📁 Klasör hiyerarşisi inşa ediliyor...");
    CONFIG.dirs.forEach(dir => {
        const fullPath = path.join(BASE_DIR, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });
}

function recoverStuckTasks() {
    log("🔄 Yetim görevler kurtarılıyor (Recovery)...");
    const PROCESSING = path.join(BASE_DIR, 'queue', 'processing');
    const INBOX = path.join(BASE_DIR, 'queue', 'inbox');

    if (!fs.existsSync(PROCESSING)) return;

    const files = fs.readdirSync(PROCESSING).filter(f => f.endsWith('.json'));
    files.forEach(f => {
        try {
            const source = path.join(PROCESSING, f);
            const content = JSON.parse(fs.readFileSync(source, 'utf8'));
            
            // Metadata güncelleme: recovery_count artır ve ismi işaretle
            content.recovery_count = (content.recovery_count || 0) + 1;
            const targetAgent = content.type ? content.type.split('_')[0].toLowerCase() : 'architect'; // Basit tahmin veya default
            
            // Eğer dosya adında zaten _recovered_ yoksa ekle
            const newFileName = f.includes('_recovered_') ? f : f.replace('.json', `_recovered_${Date.now()}.json`);
            const targetDir = path.join(INBOX, targetAgent);
            
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            
            fs.writeFileSync(path.join(targetDir, newFileName), JSON.stringify(content, null, 2));
            fs.unlinkSync(source);
            
            log(`   + [RECOVERED] ${f} -> ${targetAgent} (Count: ${content.recovery_count})`);
        } catch (err) {
            log(`   ❌ [RECOVERY HATASI] ${f}: ${err.message}`);
        }
    });
}

function deployProjectCredentials() {
    log("🔑 Supabase ve GitHub anahtarları mühürleniyor...");
    
    Object.entries(PROJECTS_VAULT).forEach(([id, data]) => {
        const projectSrcPath = path.join(BASE_DIR, 'src', id);
        const projectDocsPath = path.join(BASE_DIR, 'docs', 'reference', id);
        
        [projectSrcPath, projectDocsPath].forEach(p => {
            if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        });

        const envContent = `PROJECT_NAME="${data.name}"\nSUPABASE_URL="${data.supabase.url}"\nSUPABASE_KEY="${data.supabase.anon_key}"\nGITHUB_TOKEN="${data.github.token}"\nGITHUB_REPO="${data.github.repo}"\n`;
        fs.writeFileSync(path.join(projectSrcPath, '.env'), envContent);

        const configContent = JSON.stringify(data, null, 2);
        fs.writeFileSync(path.join(projectSrcPath, 'config.json'), configContent);

        log(`   + [${id.toUpperCase()}] Anahtarlar mühürlendi.`);
    });
}

function checkCoreAgents() {
    log("📝 Ajan dosyaları kontrol ediliyor...");
    const required = ['architect.js', 'base-agent.js', 'coder.js', 'tester.js', 'docs.js'];
    required.forEach(file => {
        const p = path.join(BASE_DIR, 'agents', file);
        if (!fs.existsSync(p)) {
            log(`   ⚠️ UYARI: ${file} eksik! Manuel olarak kopyalamayı unutma.`);
        }
    });
}

function spawnAgents() {
    log("🚀 Ajanlar otonom olarak başlatılıyor...");
    const agents = [
        { name: 'ARCHITECT', script: 'architect.js' },
        { name: 'CODER', script: 'coder.js' },
        { name: 'TESTER', script: 'tester.js' },
        { name: 'DOCS', script: 'docs.js' }
    ];

    const isMac = process.platform === 'darwin';
    
    agents.forEach(agent => {
        const scriptPath = path.join(BASE_DIR, 'agents', agent.script);
        const agentLog = path.join(LOGS_DIR, `${agent.name.toLowerCase()}.log`);
        
        if (isMac) {
            // macOS için AppleScript
            const cmd = `osascript -e 'tell app "Terminal" to do script "cd \\"${BASE_DIR}\\" && node agents/${agent.script} 2>&1 | tee \\"${agentLog}\\""'`;
            exec(cmd);
        } else {
            // Linux için terminal emülatörü kontrolü
            const linuxCmd = `gnome-terminal --title="${agent.name}" -- bash -c "node ${scriptPath} 2>&1 | tee ${agentLog}; exec bash" || \
                              x-terminal-emulator -e "node ${scriptPath} 2>&1 | tee ${agentLog}" || \
                              nohup node ${scriptPath} > ${agentLog} 2>&1 &`;
            exec(linuxCmd);
        }
        log(`   + [${agent.name}] Başlatıldı (Terminal/Background).`);
    });
}

async function waitForVllm() {
    log(`⏳ vLLM (${CONFIG.vllmHost}) bekleniyor...`);
    const url = new URL(CONFIG.vllmHost);
    
    while (true) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`${CONFIG.vllmHost}/v1/models`, (res) => {
                    if (res.statusCode === 200) resolve();
                    else reject();
                });
                req.on('error', reject);
                req.setTimeout(2000, () => { req.destroy(); reject(); });
            });
            log("✅ vLLM Hazır!");
            break;
        } catch (e) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function runBootstrap() {
    console.log("\n🚀 AUTONOMOUS NATIVE FORGE - KİMLİK DOĞRULAMALI KURULUM\n");
    
    initializeFolders();
    recoverStuckTasks();
    deployProjectCredentials();
    checkCoreAgents();
    
    log("\n✨ SİSTEM HAZIR.");
    await waitForVllm();
    spawnAgents();
    
    log("------------------------------------------");
    log("Tüm ajanlar başlatıldı. Loglar: 'logs/' klasöründe.");
    log("İretimi tetiklemek için dökümanları 'docs/reference/' altına koyun.");
}

runBootstrap().catch(console.error);