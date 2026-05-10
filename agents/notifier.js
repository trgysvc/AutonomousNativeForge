'use strict';
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const VAULT_PATH = path.join(__dirname, '..', 'config', 'vault.json');

/**
 * Supported events and their default on/off state.
 * TASK_DONE is off by default — too noisy for large projects.
 * Users opt-in by adding it to vault.json > global.webhooks.events.
 */
const DEFAULT_EVENTS = ['TASK_FAILED', 'SPRINT_COMPLETE', 'PR_OPENED'];

function getWebhookConfig() {
    try {
        const vault = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
        const wh = vault.global?.webhooks || {};
        return {
            urls: Array.isArray(wh.urls) ? wh.urls.filter(Boolean) : [],
            events: Array.isArray(wh.events) ? wh.events : DEFAULT_EVENTS
        };
    } catch (e) {
        return { urls: [], events: DEFAULT_EVENTS };
    }
}

/**
 * Sends a single POST to a webhook URL. Never throws — always resolves.
 */
function sendWebhook(url, payload) {
    return new Promise((resolve) => {
        let parsed;
        try { parsed = new URL(url); } catch (e) {
            return resolve({ error: `Geçersiz URL: ${url}`, url });
        }

        const body = JSON.stringify(payload);
        const mod = parsed.protocol === 'https:' ? https : http;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Autonomous-Native-Forge',
                'X-ANF-Event': payload.event
            }
        };

        const req = mod.request(options, (res) => {
            res.resume(); // drain the response body
            resolve({ status: res.statusCode, url });
        });
        req.on('error', (e) => resolve({ error: e.message, url }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout (10s)', url }); });
        req.write(body);
        req.end();
    });
}

/**
 * notify(event, data)
 *
 * Fires all configured webhook URLs for the given event in parallel.
 * Non-fatal: failures are logged to stderr but never interrupt the pipeline.
 *
 * Events:
 *   TASK_DONE       — a single task passed all checks and was marked DONE
 *   TASK_FAILED     — a task exceeded MAX_RETRIES and was marked FAILED
 *   SPRINT_COMPLETE — all tasks in a sprint reached DONE status
 *   PR_OPENED       — a GitHub PR was successfully created for a sprint branch
 */
async function notify(event, data) {
    const config = getWebhookConfig();
    if (config.urls.length === 0) return;
    if (!config.events.includes(event)) return;

    const payload = { event, timestamp: new Date().toISOString(), ...data };
    const results = await Promise.all(config.urls.map(url => sendWebhook(url, payload)));

    const failures = results.filter(r => r.error);
    if (failures.length > 0) {
        console.warn(`[NOTIFIER] ⚠️ Webhook hatası (${event}): ${failures.map(f => `${f.url} → ${f.error}`).join(' | ')}`);
    }
}

module.exports = { notify };
