/**
 * base-agent.js — Core Logic for Autonomous Agents
 * Optimized for: NVIDIA Blackwell (GB10), Apple Silicon (Unified Memory), and NPU-accelerated HW
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const QUEUE = path.join(__dirname, '..', 'queue');
const INBOX = path.join(QUEUE, 'inbox');
const PROCESSING = path.join(QUEUE, 'processing');
const DONE = path.join(QUEUE, 'done');
const ERROR = path.join(QUEUE, 'error');

const SYS_LOG = path.join(__dirname, '..', 'sys.log');

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

async function ask(agentName, prompt, agentDir = __dirname) {
    const skillPath = path.join(agentDir, `${agentName.toLowerCase()}.md`);
    let skillContent = '';
    
    if (fs.existsSync(skillPath)) {
        skillContent = fs.readFileSync(skillPath, 'utf8');
        log(`📖 [${agentName}] Skill mühürü okundu.`);
    }
    
    const finalPrompt = `SYSTEM RULES (MANDATORY):\n${skillContent}\n\nUSER TASK:\n${prompt}`;

    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            model: 'deepseek-r1-32b',
            messages: [{ role: 'user', content: finalPrompt }],
            temperature: 0.1
        });

        const options = {
            hostname: 'localhost',
            port: 8000,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 2700000 // 45 Dakika
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    const content = parsed.choices[0].message.content;
                    const clean = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    resolve(clean);
                } catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error("vLLM Timeout")); });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function pushToGithub(projectId, filePath, content, commitMessage) {
    const configPath = path.join(__dirname, '..', 'src', projectId, 'config.json');
    if (!fs.existsSync(configPath)) throw new Error(`Config eksik: ${projectId}`);
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const token = config.github.token;
    const repoPath = new URL(config.github.repo).pathname;
    const ownerRepo = repoPath.replace('.git', '').substring(1);
    const relativeFilePath = path.relative(path.join(__dirname, '..', 'src', projectId), filePath).replace(/\\/g, '/');
    const fileName = relativeFilePath;

    // 1. Mevcut SHA'yı al (Eğer dosya varsa)
    let currentSha = null;
    try {
        currentSha = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${ownerRepo}/contents/${fileName}`,
                method: 'GET',
                headers: {
                    'Authorization': `token ${token}`,
                    'User-Agent': 'Autonomous-Native-Forge',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const parsed = JSON.parse(body);
                            resolve(parsed.sha);
                        } catch (e) { resolve(null); }
                    } else resolve(null);
                });
            });
            req.on('error', () => resolve(null));
            req.end();
        });
    } catch (e) {
        log(`⚠️ SHA alınamadı (Yeni dosya olabilir): ${e.message}`);
    }

    const payload = {
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        branch: "main"
    };
    if (currentSha) payload.sha = currentSha;

    const data = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${ownerRepo}/contents/${fileName}`,
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Autonomous-Native-Forge',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 201 || res.statusCode === 200) resolve(true);
                else reject(new Error(`GitHub Hatası [${res.statusCode}]: ${body}`));
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
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

    while (true) {
        const files = fs.readdirSync(agentInbox).filter(f => f.endsWith('.json'));
        for (const f of files) {
            const source = path.join(agentInbox, f);
            const target = path.join(PROCESSING, f);
            fs.renameSync(source, target);
            try {
                const task = JSON.parse(fs.readFileSync(target, 'utf-8'));
                await processTask(task);
                fs.renameSync(target, path.join(DONE, f));
            } catch (err) {
                log(`❌ Hata: ${err.message}`);
                fs.renameSync(target, path.join(ERROR, f));
            }
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

module.exports = { ask, start, log, sendMessage, pushToGithub };