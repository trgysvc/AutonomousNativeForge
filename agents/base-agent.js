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
const HEARTBEATS = path.join(QUEUE, 'heartbeats');

const SYS_LOG = path.join(__dirname, '..', 'sys.log');
const LLM_COMM_LOG = path.join(__dirname, '..', 'llm_communication.log');

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
    // Format 5: Kapanmamış thinking tag — sadece METNİN BAŞINDA varsa temizle
    // Ortada geçen <think> benzeri ifadeler JSON'ı silmesin
    clean = clean.replace(/^<(think|thinking)[^>]*>[\s\S]*/i, '');
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
    // reasoning-parser aktifse content temiz gelir; content null ise reasoning veya reasoning_content'e düş
    return choice.message?.content || choice.message?.reasoning || choice.message?.reasoning_content || null;
}

/**
 * Path Authority: Ensures the file path is within the project directory
 */
function getAuthorizedPath(projectPath, targetRelativePath) {
    let cleanPath = targetRelativePath;
    
    // AI Hallucination Correction: Gereksiz mutlak yolları temizle
    const prefixesToRemove = [
        '/workspaces/AutonomousNativeForge/src/',
        '/workspaces/AutonomousNativeForge/',
        '/workspace/src/',
        '/workspace/',
        '/workspaces/'
    ];
    
    for (const prefix of prefixesToRemove) {
        if (cleanPath.startsWith(prefix)) {
            cleanPath = cleanPath.substring(prefix.length);
        }
    }

    // PROJECT ID REDUNDANCY FIX: İteratif temizle — LLM çift prefix üretebilir
    // Örn: aurapos/aurapos/apps → apps | src/aurapos/apps → apps
    const projectDirName = path.basename(projectPath); // Örn: 'aurapos'

    // src/{projectDirName}/ prefix temizle (LLM bazen 'src/aurapos/apps/...' üretir)
    const srcProjectPrefix = `src/${projectDirName}/`;
    if (cleanPath.startsWith(srcProjectPrefix)) {
        cleanPath = cleanPath.substring(srcProjectPrefix.length);
    }

    // İteratif project name prefix temizle — aurapos/aurapos/... gibi çift durumları da yakala
    while (cleanPath.startsWith(projectDirName + '/')) {
        cleanPath = cleanPath.substring(projectDirName.length + 1);
    }
    if (cleanPath === projectDirName) cleanPath = '.';

    const resolvedPath = path.resolve(projectPath, cleanPath);
    const resolvedProjectRoot = path.resolve(projectPath);
    
    if (!resolvedPath.startsWith(resolvedProjectRoot)) {
        throw new Error(`🛡️ GÜVENLİK İHLALİ: Geçersiz dosya yolu (Dizin dışına çıkma denemesi): ${targetRelativePath}`);
    }
    return resolvedPath;
}

/**
 * Action-Observation Loop: Verify file after writing with physical check
 */
async function safeWriteFile(filePath, content) {
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
    // Skills are located directly in the agent's directory as {agent}.md
    const skillPath = path.join(agentDir, `${agentName.toLowerCase()}.md`);
    let skillContent = '';
    if (fs.existsSync(skillPath)) {
        skillContent = fs.readFileSync(skillPath, 'utf8');
        log(`📖 [${agentName}] Skill mühürü okundu: ${path.basename(skillPath)}`);
    } else {
        log(`⚠️ [${agentName}] Skill dökümanı bulunamadı: ${skillPath}`);
    }
    const finalPrompt = `SYSTEM RULES (MANDATORY):\n${skillContent}\n\nUSER TASK:\n${prompt}`;

    return new Promise((resolve, reject) => {
        // Temel istek gövdesi
        // max_tokens: thinking(6144) + content için yeterli alan bırakılmalı.
        // Nemotron: max_tokens TOPLAM output (thinking + content) sayar.
        // 6144 thinking + 6144 content = 12288 → context 32768'de güvenli sınır.
        // RESMİ DÖKÜMANTASYON (OpenAPI) UYUMLU AYARLAR
        const budgets = NIM_CONFIG.nim_reasoning_budgets || {};
        const agentBudgetRaw = budgets[agentName.toUpperCase()];
        const reasoningBudget = agentBudgetRaw ? parseInt(agentBudgetRaw) : 2048;

        // OFFICIAL RULE: max_tokens MUST be greater than reasoning_budget
        // 4096 output buffer: SQL migrations and large TS modules need 3000-5000 tokens.
        // 2048 caused finish=length (content_len=0) on large code generation tasks.
        const maxTokens = reasoningBudget + 4096;

        // VLLM CRASH PREVENTION: Max Context is 24576. 
        // We must ensure Input Tokens + maxTokens < 24576.
        // Assuming ~4 chars per token, max input chars = (24000 - maxTokens) * 4
        const maxSafeInputChars = (24000 - maxTokens) * 4;
        let safePrompt = finalPrompt;
        
        if (safePrompt.length > maxSafeInputChars) {
            safePrompt = safePrompt.substring(0, maxSafeInputChars);
            log(`⚠️ [${agentName}] Kırpıldı: İçerik model kapasitesini (24576) aşmaması için ${maxSafeInputChars} karaktere düşürüldü.`);
        }

        const requestBody = {
            model: NIM_CONFIG.model_id || 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
            messages: [{ role: 'user', content: safePrompt }],
            temperature: 0.1,
            max_tokens: maxTokens,
            max_completion_tokens: maxTokens // Included for future OpenAI API compatibility
        };

        if (NIM_CONFIG.nim_enable_thinking === false) {
            requestBody.chat_template_kwargs = { enable_thinking: false };
            log(`⚡ [${agentName}] Thinking explicitly disabled.`);
        } else {
            requestBody.chat_template_kwargs = {
                enable_thinking: true,
                reasoning_budget: reasoningBudget
            };
            log(`🧠 [${agentName}] Reasoning budget: ${reasoningBudget} tokens | Max Output: ${maxTokens}`);
        }


        const data = JSON.stringify({ ...requestBody, stream: true });
        
        // --- LLM REQUEST LOGGING ---
        const timestamp = new Date().toISOString();
        fs.appendFileSync(LLM_COMM_LOG, `\n\n[${timestamp}] >>> REQUEST [${agentName}] >>>\n` + data, 'utf8');

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
        };

        // Inactivity timeout: if no chunk arrives in this many ms, abort.
        // Much safer than a wall-clock timeout — detects truly stalled streams.
        const INACTIVITY_MS = NIM_CONFIG.nim_stream_inactivity_ms || 120000; // 2 min default
        let inactivityTimer = null;
        let tokenCount = 0;
        let lastProgressLog = Date.now();
        const PROGRESS_INTERVAL_MS = 30000; // log progress every 30 sec

        const resetInactivity = () => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                req.destroy(new Error(`Stream inactivity timeout (${INACTIVITY_MS / 1000}s, ${tokenCount} tokens received)`));
            }, INACTIVITY_MS);
        };

        // SSE accumulator
        let contentBuffer = '';
        let reasoningBuffer = '';
        let sseBuffer = '';
        let finishReason = null;
        let resolved = false;

        const req = httpModule.request(options, (res) => {
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', c => errBody += c);
                res.on('end', () => {
                    reject(new Error(`LLM API Hatası [${res.statusCode}]: ${errBody}`));
                });
                return;
            }
            resetInactivity();

            res.on('data', (chunk) => {
                resetInactivity();
                sseBuffer += chunk.toString('utf8');

                // SSE lines arrive as: "data: {...}\n\n"
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop(); // keep incomplete last line

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') { finishReason = finishReason || 'stop'; continue; }
                    try {
                        const event = JSON.parse(jsonStr);
                        const delta = event.choices?.[0]?.delta;
                        if (!delta) continue;
                        if (delta.reasoning_content) reasoningBuffer += delta.reasoning_content;
                        if (delta.content)           contentBuffer   += delta.content;
                        finishReason = event.choices?.[0]?.finish_reason || finishReason;
                        tokenCount++;

                        // Periodic progress log so sys.log shows the model is alive
                        const now = Date.now();
                        if (now - lastProgressLog > PROGRESS_INTERVAL_MS) {
                            log(`⏳ [${agentName}] Streaming... ${tokenCount} tokens so far (finish=${finishReason || 'generating'})`);
                            lastProgressLog = now;
                        }
                    } catch (_) { /* partial JSON chunk — wait for next data event */ }
                }
            });

            res.on('end', () => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                if (resolved) return;
                resolved = true;

                // --- LLM RESPONSE LOGGING ---
                const respTimestamp = new Date().toISOString();
                const llmRawResponse = contentBuffer || reasoningBuffer;
                const clean = cleanResponse(llmRawResponse);
                const summary = `[stream] tokens=${tokenCount}, finish=${finishReason}, content_len=${contentBuffer.length}`;
                fs.appendFileSync(LLM_COMM_LOG, `\n\n[${respTimestamp}] <<< RESPONSE [${agentName}] <<<\n${summary}\n\nCONTENT:\n${clean}`, 'utf8');

                if (!llmRawResponse || llmRawResponse.trim().length < 5) {
                    reject(new Error(`Stream ended but response is empty (tokens=${tokenCount}, finish=${finishReason})`));
                    return;
                }
                resolve(cleanResponse(llmRawResponse));
            });

            res.on('error', (err) => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                if (!resolved) { resolved = true; reject(err); }
            });
        });

        req.on('error', (err) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            if (!resolved) { resolved = true; reject(err); }
        });

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

    // Security Check: Blacklist filter — path segment bazında kontrol (false positive önler)
    const pathSegments = filePath.replace(/\\/g, '/').split('/');
    if (SECRET_BLACKLIST.some(blocked => pathSegments.some(seg => seg === blocked) || fileName === blocked)) {
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
    const timestamp = Date.now();
    const fileName = `${type}-${timestamp}.json`;
    const tmpName = `${type}-${timestamp}.tmp`;
    const targetDir = path.join(INBOX, target.toLowerCase());
    const targetPath = path.join(targetDir, fileName);
    const tmpPath = path.join(targetDir, tmpName);

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    
    // Atomik yazma: Önce geçici dosyaya yaz, sonra ismini değiştir
    fs.writeFileSync(tmpPath, JSON.stringify({ ...data, type }, null, 2));
    fs.renameSync(tmpPath, targetPath);
}

async function start(agentName, processTask) {
    log(`🚀 ${agentName} başlatıldı.`);
    const agentInbox = path.join(INBOX, agentName.toLowerCase());
    if (!fs.existsSync(agentInbox)) fs.mkdirSync(agentInbox, { recursive: true });

    // Per-agent concurrency limit from vault. ARCHITECT stays at 1 (shared manifest state).
    const concurrencyMap = NIM_CONFIG.concurrency || {};
    const MAX_CONCURRENT = Math.max(1, concurrencyMap[agentName.toUpperCase()] || 1);
    if (MAX_CONCURRENT > 1) log(`⚡ [${agentName}] Paralel mod: ${MAX_CONCURRENT} eş zamanlı görev.`);

    let activeCount = 0;

    // runTask: claim → execute → archive. Not awaited in the main loop — runs concurrently.
    const runTask = async (processingPath) => {
        activeCount++;
        const dest = path.basename(processingPath);
        const taskId = dest.replace('.json', '');
        const heartbeatFile = path.join(HEARTBEATS, `${taskId}.heartbeat`);
        
        if (!fs.existsSync(HEARTBEATS)) fs.mkdirSync(HEARTBEATS, { recursive: true });

        // Heartbeat updater
        const heartbeatInterval = setInterval(() => {
            try {
                fs.writeFileSync(heartbeatFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
            } catch (e) { /* ignore */ }
        }, 30000); // Update every 30s

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
            clearInterval(heartbeatInterval);
            try { if (fs.existsSync(heartbeatFile)) fs.unlinkSync(heartbeatFile); } catch (_) {}
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

/**
 * Global File Lock: Prevents inter-process race conditions on shared files (like manifest.json)
 * Uses atomic directory creation as a mutex.
 */
async function withLock(lockName, fn) {
    const lockDir = path.join(__dirname, '..', 'queue', `${lockName}.lock`);
    const STALE_MS = 30000; // 30s timeout for stale locks
    
    const acquire = async () => {
        while (true) {
            try {
                fs.mkdirSync(lockDir);
                // Lock acquired! Record timestamp for stale check
                fs.writeFileSync(path.join(lockDir, 'timestamp'), Date.now().toString());
                return;
            } catch (e) {
                if (fs.existsSync(lockDir)) {
                    const tsFile = path.join(lockDir, 'timestamp');
                    const ts = fs.existsSync(tsFile) ? parseInt(fs.readFileSync(tsFile, 'utf8') || '0') : Date.now();
                    if (Date.now() - ts > STALE_MS) {
                        log(`⚠️ Stale lock detected (${lockName}), breaking it...`);
                        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
                        continue;
                    }
                }
                await new Promise(r => setTimeout(r, 100)); // wait and retry
            }
        }
    };

    await acquire();
    try {
        return await fn();
    } finally {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch (_) {}
    }
}

module.exports = { ask, start, log, sendMessage, pushToGithub, safeWriteFile, getAuthorizedPath, cleanResponse, NIM_CONFIG, ensureBranch, createPullRequest, withLock };