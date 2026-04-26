#!/usr/bin/env node
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const VAULT_PATH = path.join(__dirname, '..', 'config', 'vault.json');

function loadNimConfig() {
    const vault = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    return vault.global || {};
}

async function testNimConnection() {
    const cfg = loadNimConfig();
    const protocol = cfg.nim_protocol === 'https' ? require('node:https') : require('node:http');

    console.log('🔍 NIM Bağlantı Testi');
    console.log(`   Host     : ${cfg.nim_protocol}://${cfg.nim_host}:${cfg.nim_port}`);
    console.log(`   Model ID : ${cfg.model_id}`);
    console.log(`   Auth     : ${cfg.nim_api_key ? '✅ API Key mevcut' : '⚠️  API Key yok (local mod)'}`);
    console.log('');

    // Test 1: /v1/models endpoint
    await new Promise((resolve) => {
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.nim_api_key) headers['Authorization'] = `Bearer ${cfg.nim_api_key}`;

        const req = protocol.request({
            hostname : cfg.nim_host,
            port     : cfg.nim_port,
            path     : '/v1/models',
            method   : 'GET',
            headers,
            timeout  : 10000
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const data = JSON.parse(body);
                    const modelIds = (data.data || []).map(m => m.id);
                    console.log('✅ Test 1 — /v1/models PASSED');
                    console.log('   Mevcut modeller:', modelIds.join(', '));
                    if (!modelIds.includes(cfg.model_id)) {
                        console.warn(`   ⚠️  UYARI: vault model_id '${cfg.model_id}' listede yok!`);
                        console.warn(`   Doğru model ID'yi vault.json'a yaz.`);
                    } else {
                        console.log(`   ✅ '${cfg.model_id}' doğrulandı.`);
                    }
                } else {
                    console.error(`❌ Test 1 — /v1/models FAILED [HTTP ${res.statusCode}]`);
                    console.error('   Yanıt:', body.substring(0, 300));
                }
                resolve();
            });
        });
        req.on('timeout', () => { req.destroy(); console.error('❌ Test 1 — TIMEOUT'); resolve(); });
        req.on('error', (e) => { console.error('❌ Test 1 — BAĞLANTI HATASI:', e.message); resolve(); });
        req.end();
    });

    // Test 2: Minimal inference (tek token)
    await new Promise((resolve) => {
        const body = JSON.stringify({
            model    : cfg.model_id,
            messages : [{ role: 'user', content: 'Reply with the single word: READY' }],
            max_tokens: 10
        });
        const headers = {
            'Content-Type'  : 'application/json',
            'Content-Length': Buffer.byteLength(body)
        };
        if (cfg.nim_api_key) headers['Authorization'] = `Bearer ${cfg.nim_api_key}`;

        const req = protocol.request({
            hostname : cfg.nim_host,
            port     : cfg.nim_port,
            path     : '/v1/chat/completions',
            method   : 'POST',
            headers,
            timeout  : 60000
        }, (res) => {
            let resp = '';
            res.on('data', c => resp += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const parsed = JSON.parse(resp);
                    const reply  = parsed?.choices?.[0]?.message?.content || '';
                    console.log('✅ Test 2 — Inference PASSED');
                    console.log('   Model yanıtı:', reply.trim());
                } else {
                    console.error(`❌ Test 2 — Inference FAILED [HTTP ${res.statusCode}]`);
                    console.error('   Yanıt:', resp.substring(0, 300));
                }
                resolve();
            });
        });
        req.on('timeout', () => { req.destroy(); console.error('❌ Test 2 — TIMEOUT (60sn)'); resolve(); });
        req.on('error', (e) => { console.error('❌ Test 2 — BAĞLANTI HATASI:', e.message); resolve(); });
        req.write(body);
        req.end();
    });

    console.log('\n🏁 Test tamamlandı. Sorun yoksa: node agents/bootstrap.js');
}

testNimConnection().catch(console.error);
