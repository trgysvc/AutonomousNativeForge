/**
 * base-agent.js — Core Logic for Autonomous Agents
 * Optimized for: NVIDIA Blackwell (GB10), Apple Silicon (Unified Memory), and NPU-accelerated HW
 */
const fs = require('node:fs');
const path = require('node:path');

// Vault'tan NIM config'i yükle
const VAULT_PATH = path.join(__dirname, '..', 'config', 'vault.json');
function loadNimConfig() {
    try {
        const vault = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
        return vault.global || {};
    } catch (e) {
        console.error('❌ vault.json okunamadı:', e.message);
        return {};
    }
}
const NIM_CONFIG = loadNimConfig();

// http veya https — nim_protocol vault'tan
const httpModule = (NIM_CONFIG.nim_protocol === 'https')
    ? require('node:https')
    : require('node:http');

// GitHub API her zaman HTTPS kullanır
const https = require('node:https');

const QUEUE = path.join(__dirname, '..', 'queue');
const INBOX = path.join(QUEUE, 'inbox');
const PROCESSING = path.join(QUEUE, 'processing');
const DONE = path.join(QUEUE, 'done');
const ERROR = path.join(QUEUE, 'error');

const SYS_LOG = path.join(__dirname, '..', 'sys.log');

// Security Blacklist for GitHub Pushes
const SECRET_BLACKLIST = [
    '.env',
    'config.json',
    'vault.json',
    'node_modules',
    '.git',
    '.DS_Store'
];

function log(msg) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${msg}`;
    console.log(formatted);
    try {
        fs.appendFileSync(SYS_LOG, formatted + '\n', 'utf8');
    } catch (e) {
        // Fallback if log file fails
    }
}

/**
 * Extraction Pipe: Cleans LLM response from thinking tokens and markdown wrappers.
 *
 * Desteklenen modeller ve thinking formatları:
 *   DeepSeek-R1        → <think>...</think>
 *   Nemotron-3-Super   → <think>...</think>  (--reasoning-parser olmadan)
 *   GLM-4 / GLM-Z1     → <|thinking|>...</|thinking|>
 *   GLM-4.7            → <|thinking|>...</|thinking|>
 *   DeepSeek V4 distill→ <|begin_of_thought|>...<|end_of_thought|>
 *
 * NOT: vLLM --reasoning-parser kullanılırsa thinking zaten ayrı alanda gelir,
 *      content doğrudan temiz yanıt içerir → bu fonksiyon yine de zarar vermez.
 */
function cleanResponse(content) {
    if (!content) return "";

    let clean = content;
    // Format 1: <think>...</think> — DeepSeek R1 & Nemotron-3-Super
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Format 2: <|thinking|>...</|thinking|> — GLM-4 / GLM-Z1 / GLM-4.7
    clean = clean.replace(/<\|thinking\|>[\s\S]*?<\/\|thinking\|>/gi, '');
    // Format 3: <|begin_of_thought|>...<|end_of_thought|> — DeepSeek V4 distill
    clean = clean.replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, '');
    // Format 4: <|thought|>...</|thought|> — alternatif format
    clean = clean.replace(/<\|thought\|>[\s\S]*?<\/\|thought\|>/gi, '');
    // Format 5: Kapanmamış thinking tag — geri kalan her şeyi temizle
    clean = clean.replace(/<(think|thinking)[^>]*>[\s\S]*/gi, '');
    clean = clean.trim();

    // Kod bloğu extraction (Coder çıktısı için)
    const codeBlockRegex = /```(?:[a-z]*)\n([\s\S]*?)```/gi;
    const matches = [...clean.matchAll(codeBlockRegex)];
    if (matches.length > 0) {
        return matches.map(m => m[1]).join('\n\n').trim();
    }

    return clean.replace(/^```|```$/g, '').trim();
}

/**
 * API yanıtından content'i çıkarır.
 * vLLM --reasoning-parser kullanılırsa: content temiz, reasoning_content thinking'i içerir.
 * --reasoning-parser olmadan: content thinking taglarıyla birlikte gelir → cleanResponse halleder.
 */
function extractContent(parsed) {
    const choice = parsed.choices?.[0];
    if (!choice) return null;
    // reasoning-parser aktifse content zaten temiz gelir
    return choice.message?.content || null;
}

/**
 * Path Authority: Ensures the file path is within the project directory
 */
function getAuthorizedPath(projectPath, targetRelativePath) {
    const resolvedPath = path.resolve(projectPath, targetRelativePath);
    const resolvedProjectRoot = path.resolve(projectPath);
    
    if (!resolvedPath.startsWith(resolvedProjectRoot)) {
        throw new Error(`🛡️ GÜVENLİK İHLALİ: Geçersiz dosya yolu (Dizin dışına çıkma denemesi): ${targetRelativePath}`);
    }
    return resolvedPath;
}

/**
 * Action-Observation Loop: Verify file after writing with physical check
 */
function safeWriteFile(filePath, content) {
    // 1. EISDIR Check
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        throw new Error(`❌ EISDIR: '${filePath}' bir dizindir, dosya değil! Lütfen geçerli bir dosya adı ekleyin.`);
    }

    // 2. Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 3. Write
    fs.writeFileSync(filePath, content, 'utf8');

    // 4. Physical Verification
    if (!fs.existsSync(filePath)) {
        throw new Error(`❌ YAZMA HATASI: Dosya fiziksel olarak oluşturulamadı: ${filePath}`);
    }
    const stats = fs.statSync(filePath);
    if (stats.size === 0 && content.length > 0) {
        throw new Error(`❌ YAZMA HATASI: Dosya boyutu 0 byte (Yazma başarısız): ${filePath}`);
    }

    log(`💾 Dosya mühürlendi (${stats.size} bytes): ${path.basename(filePath)}`);
    return true;
}

async function ask(agentName, prompt, agentDir = __dirname) {
    const skillPath = path.join(agentDir, `${agentName.toLowerCase()}.md`);
    let skillContent = '';
    if (fs.existsSync(skillPath)) {
        skillContent = fs.readFileSync(skillPath, 'utf8');
        log(`📖 [${agentName}] Skill mühürü okundu.`);
    }
    const finalPrompt = `SYSTEM RULES (MANDATORY):\n${skillContent}\n\nUSER TASK:\n${prompt}`;

    return new Promise((resolve, reject) => {
        // Temel istek gövdesi
        const requestBody = {
            model: NIM_CONFIG.model_id || 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
            messages: [{ role: 'user', content: finalPrompt }],
            temperature: 0.1
        };

        // Thinking & reasoning_budget kontrolü
        // - nim_enable_thinking: false → düşünme kapalı (Tester gibi hızlı JSON görevleri için)
        // - nim_reasoning_budgets: { ARCHITECT: 16384, CODER: 4096, ... } → per-agent derinlik
        // Nemotron: chat_template_kwargs yöntemi | GLM: aynı yöntem
        const budgets = NIM_CONFIG.nim_reasoning_budgets || {};
        const agentBudget = budgets[agentName.toUpperCase()];

        if (NIM_CONFIG.nim_enable_thinking === false) {
            requestBody.chat_template_kwargs = { enable_thinking: false };
        } else if (agentBudget !== undefined) {
            requestBody.chat_template_kwargs = {
                enable_thinking: true,
                ...(agentBudget === 'low_effort'
                    ? { low_effort: true }
                    : { reasoning_budget: agentBudget })
            };
            log(`🧠 [${agentName}] Reasoning budget: ${agentBudget} token`);
        }

        const data = JSON.stringify(requestBody);

        // Authorization header — boşsa ekleme
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        };
        if (NIM_CONFIG.nim_api_key) {
            headers['Authorization'] = `Bearer ${NIM_CONFIG.nim_api_key}`;
        }

        const options = {
            hostname: NIM_CONFIG.nim_host || 'localhost',
            port: NIM_CONFIG.nim_port || 8000,
            path: '/v1/chat/completions',
            method: 'POST',
            headers,
            timeout: NIM_CONFIG.nim_timeout_ms || 2700000 // vault'tan veya default 45dk (CoT modeller)
        };

        const req = httpModule.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    const content = extractContent(parsed);
                    if (!content) {
                        reject(new Error(`NIM yanıt formatı hatalı: ${body.substring(0, 200)}`));
                        return;
                    }
                    const clean = cleanResponse(content);
                    if (!clean || clean.length < 5) {
                        reject(new Error("Yanıt boş veya çok kısa."));
                        return;
                    }
                    resolve(clean);
                } catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error(`NIM Timeout (${Math.round((NIM_CONFIG.nim_timeout_ms || 2700000)/60000)}dk)`)); });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

/**
 * Proje GitHub konfigürasyonunu yükler.
 * Config yoksa veya github alanı eksikse null döner — çağıranlar graceful skip uygular.
 */
function loadProjectGitConfig(projectId) {
    try {
        const configPath = path.join(__dirname, '..', 'src', projectId, 'config.json');
        if (!fs.existsSync(configPath)) return null;
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!config.github?.token || !config.github?.repo) return null;
        const repoPath = new URL(config.github.repo).pathname;
        const ownerRepo = repoPath.replace('.git', '').substring(1);
        return { token: config.github.token, ownerRepo };
    } catch (e) { return null; }
}

/** GitHub API için basit HTTPS yardımcısı */
function githubRequest(method, apiPath, token, body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'api.github.com',
            path: apiPath,
            method,
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Autonomous-Native-Forge',
                'Accept': 'application/vnd.github.v3+json',
                ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
            }
        };
        const req = https.request(options, (res) => {
            let buf = '';
            res.on('data', chunk => buf += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: buf }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

/**
 * Sprint branch'ını oluşturur (yoksa). Varsa sessizce geçer.
 * Branch adı: feature/sprint-s0, feature/sprint-s1, ...
 */
async function ensureBranch(projectId, branchName) {
    const git = loadProjectGitConfig(projectId);
    if (!git) { log(`⚠️ ensureBranch: GitHub config eksik, atlanıyor.`); return; }

    // Branch var mı?
    const check = await githubRequest('GET', `/repos/${git.ownerRepo}/git/ref/heads/${branchName}`, git.token);
    if (check.status === 200) return; // Zaten var

    // main'in SHA'sını al
    const mainRef = await githubRequest('GET', `/repos/${git.ownerRepo}/git/ref/heads/main`, git.token);
    if (mainRef.status !== 200) throw new Error(`main branch SHA alınamadı [${mainRef.status}]`);
    const sha = JSON.parse(mainRef.body).object?.sha;
    if (!sha) throw new Error('main SHA boş');

    // Branch oluştur
    const create = await githubRequest('POST', `/repos/${git.ownerRepo}/git/refs`, git.token,
        { ref: `refs/heads/${branchName}`, sha });
    if (create.status !== 201) throw new Error(`Branch oluşturulamadı [${create.status}]: ${create.body}`);
    log(`🌿 Branch oluşturuldu: ${branchName}`);
}

/**
 * Sprint tamamlandığında feature branch'tan main'e PR açar.
 * PR zaten açıksa (422 Unprocessable) sessizce geçer.
 */
async function createPullRequest(projectId, branchName, title, body) {
    const git = loadProjectGitConfig(projectId);
    if (!git) { log(`⚠️ createPullRequest: GitHub config eksik, atlanıyor.`); return null; }

    const res = await githubRequest('POST', `/repos/${git.ownerRepo}/pulls`, git.token,
        { title, body, head: branchName, base: 'main' });

    if (res.status === 201) {
        const pr = JSON.parse(res.body);
        return pr.html_url;
    }
    if (res.status === 422) {
        log(`ℹ️ PR zaten açık veya merge edilmiş: ${branchName}`);
        return null;
    }
    throw new Error(`PR oluşturulamadı [${res.status}]: ${res.body}`);
}

/**
 * Dosyayı belirtilen branch'a push eder. Branch belirtilmezse 'main' kullanılır.
 * GitHub config yoksa false döner (non-fatal).
 */
async function pushToGithub(projectId, filePath, content, commitMessage, branch = 'main') {
    const fileName = path.basename(filePath);

    // Security Check: Blacklist filter
    if (SECRET_BLACKLIST.some(blocked => fileName.includes(blocked) || filePath.includes(blocked))) {
        log(`🛡️ GÜVENLİK: ${fileName} hassas veri — GitHub'a gönderilmedi.`);
        return false;
    }

    const git = loadProjectGitConfig(projectId);
    if (!git) throw new Error(`GitHub config eksik: ${projectId}`);

    const projectRoot = path.join(__dirname, '..', 'src', projectId);
    const relativeFilePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

    // Mevcut SHA (dosya varsa güncelleme, yoksa yeni dosya)
    let currentSha = null;
    const shaRes = await githubRequest('GET',
        `/repos/${git.ownerRepo}/contents/${relativeFilePath}?ref=${branch}`, git.token);
    if (shaRes.status === 200) {
        try { currentSha = JSON.parse(shaRes.body).sha; } catch (e) { /* yeni dosya */ }
    }

    const payload = {
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        branch
    };
    if (currentSha) payload.sha = currentSha;

    const pushRes = await githubRequest('PUT',
        `/repos/${git.ownerRepo}/contents/${relativeFilePath}`, git.token, payload);

    if (pushRes.status === 201 || pushRes.status === 200) return true;
    throw new Error(`GitHub Push Hatası [${pushRes.status}]: ${pushRes.body}`);
}

function sendMessage(target, type, data) {
    const fileName = `${type}-${Date.now()}.json`;
    const targetPath = path.join(INBOX, target.toLowerCase(), fileName);
    if (!fs.existsSync(path.dirname(targetPath))) fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify({ ...data, type }, null, 2));
}

async function start(agentName, processTask) {
    log(`🚀 ${agentName} başlatıldı.`);
    const agentInbox = path.join(INBOX, agentName.toLowerCase());
    if (!fs.existsSync(agentInbox)) fs.mkdirSync(agentInbox, { recursive: true });

    // Per-agent concurrency limit from vault. ARCHITECT stays at 1 (shared manifest state).
    const concurrencyMap = NIM_CONFIG.concurrency || {};
    const MAX_CONCURRENT = Math.max(1, concurrencyMap[agentName.toUpperCase()] || 1);
    if (MAX_CONCURRENT > 1) log(`⚡ [${agentName}] Paralel mod: ${MAX_CONCURRENT} eş zamanlı görev.`);

    // Orphan Recovery: PROCESSING dosyaları "{agentName}-{originalFile}" formatında.
    // Prefix olmadan filter yazılmış eski kod hiçbir zaman eşleşmiyordu — düzeltildi.
    if (fs.existsSync(PROCESSING)) {
        const prefix = `${agentName.toLowerCase()}-`;
        const orphans = fs.readdirSync(PROCESSING)
            .filter(f => f.startsWith(prefix) && f.endsWith('.json'));
        for (const f of orphans) {
            log(`♻️ Orphan task kurtarıldı: ${f}`);
            const source = path.join(PROCESSING, f);
            try {
                const task = JSON.parse(fs.readFileSync(source, 'utf-8'));
                await processTask(task);
                if (!fs.existsSync(DONE)) fs.mkdirSync(DONE, { recursive: true });
                fs.renameSync(source, path.join(DONE, f));
            } catch (err) {
                log(`❌ Orphan Hata: ${err.message}`);
                if (!fs.existsSync(ERROR)) fs.mkdirSync(ERROR, { recursive: true });
                try { fs.renameSync(source, path.join(ERROR, f)); } catch (_) {}
            }
        }
    }

    let activeCount = 0;

    // runTask: claim → execute → archive. Not awaited in the main loop — runs concurrently.
    const runTask = async (processingPath) => {
        activeCount++;
        const dest = path.basename(processingPath);
        try {
            const task = JSON.parse(fs.readFileSync(processingPath, 'utf-8'));
            await processTask(task);
            if (!fs.existsSync(DONE)) fs.mkdirSync(DONE, { recursive: true });
            fs.renameSync(processingPath, path.join(DONE, dest));
        } catch (err) {
            log(`❌ Hata: ${err.message}`);
            if (!fs.existsSync(ERROR)) fs.mkdirSync(ERROR, { recursive: true });
            try { fs.renameSync(processingPath, path.join(ERROR, dest)); } catch (_) {}
        } finally {
            activeCount--;
        }
    };

    while (true) {
        const available = MAX_CONCURRENT - activeCount;
        if (available > 0 && fs.existsSync(agentInbox)) {
            const files = fs.readdirSync(agentInbox)
                .filter(f => f.endsWith('.json'))
                .slice(0, available);

            for (const f of files) {
                const source = path.join(agentInbox, f);
                const processingName = `${agentName.toLowerCase()}-${f}`;
                const target = path.join(PROCESSING, processingName);
                if (!fs.existsSync(PROCESSING)) fs.mkdirSync(PROCESSING, { recursive: true });
                try {
                    fs.renameSync(source, target); // atomic claim — safe across processes
                    runTask(target);               // intentionally no await
                } catch (_) { /* another process claimed this file first */ }
            }
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

module.exports = { ask, start, log, sendMessage, pushToGithub, safeWriteFile, getAuthorizedPath, cleanResponse, NIM_CONFIG, ensureBranch, createPullRequest };