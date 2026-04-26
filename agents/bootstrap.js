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

const VAULT = loadVault();
const PROJECTS_VAULT = Object.fromEntries(
    Object.entries(VAULT).filter(([k]) => k !== 'global')
);
const NIM_CONFIG = VAULT.global || {};

// NIM config validation
if (!NIM_CONFIG.nim_host) {
    console.error('❌ HATA: vault.json içinde global.nim_host eksik!');
    process.exit(1);
}

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
    log("🚀 Ajanlar başlatılıyor...");
    const agents = [
        { name: 'ARCHITECT', script: 'architect.js' },
        { name: 'CODER',     script: 'coder.js'     },
        { name: 'TESTER',    script: 'tester.js'    },
        { name: 'DOCS',      script: 'docs.js'      }
    ];

    const isMac = process.platform === 'darwin';

    if (isMac) {
        agents.forEach(agent => {
            const agentLog = path.join(LOGS_DIR, `${agent.name.toLowerCase()}.log`);
            const cmd = `osascript -e 'tell app "Terminal" to do script "cd \\"${BASE_DIR}\\" && node agents/${agent.script} 2>&1 | tee \\"${agentLog}\\""'`;
            exec(cmd);
            log(`   + [${agent.name}] macOS Terminal başlatıldı.`);
        });
        return;
    }

    // Linux: systemd user-mode (sudo gerektirmez)
    const systemdUserDir = path.join(process.env.HOME || '/home/nvidia', '.config', 'systemd', 'user');
    if (!fs.existsSync(systemdUserDir)) fs.mkdirSync(systemdUserDir, { recursive: true });

    const nodeBin = process.execPath; // Çalışan Node.js binary'sinin tam yolu

    agents.forEach(agent => {
        const agentLog  = path.join(LOGS_DIR, `${agent.name.toLowerCase()}.log`);
        const unitName  = `anf-${agent.name.toLowerCase()}.service`;
        const unitPath  = path.join(systemdUserDir, unitName);
        const unitContent = `[Unit]
Description=ANF Agent — ${agent.name}
After=network.target

[Service]
Type=simple
WorkingDirectory=${BASE_DIR}
ExecStart=${nodeBin} ${path.join(BASE_DIR, 'agents', agent.script)}
StandardOutput=append:${agentLog}
StandardError=append:${agentLog}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
        fs.writeFileSync(unitPath, unitContent);
        log(`   + [${agent.name}] systemd unit yazıldı: ${unitPath}`);

        // daemon-reload + start (--user flag ile sudo gerekmez)
        exec(`systemctl --user daemon-reload && systemctl --user enable ${unitName} && systemctl --user start ${unitName}`, (err) => {
            if (err) {
                log(`   ⚠️ [${agent.name}] systemd başlatılamadı, nohup fallback devreye giriyor...`);
                const out = fs.openSync(agentLog, 'a');
                spawn(nodeBin, [path.join(BASE_DIR, 'agents', agent.script)], {
                    detached: true,
                    stdio: ['ignore', out, out],
                    cwd: BASE_DIR
                }).unref();
                log(`   + [${agent.name}] nohup fallback başlatıldı.`);
            } else {
                log(`   ✅ [${agent.name}] systemd --user servisi aktif.`);
            }
        });
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