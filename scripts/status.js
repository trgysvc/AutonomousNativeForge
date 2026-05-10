#!/usr/bin/env node
'use strict';
/**
 * status.js — ANF Pipeline Durum Monitörü
 * Kullanım: node scripts/status.js [--watch]
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE = path.join(__dirname, '..');
const QUEUE = path.join(BASE, 'queue');
const SRC   = path.join(BASE, 'src');
const LOGS  = path.join(BASE, 'logs');

const WATCH = process.argv.includes('--watch');

const STATUS_ICONS = {
    PENDING:     '⏳',
    IN_PROGRESS: '🔄',
    TESTING:     '🧐',
    FIXING:      '🧭',
    DONE:        '✅',
    FAILED:      '❌',
    ERROR:       '🔴',
};

function countFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length; }
    catch { return 0; }
}

function readManifests() {
    const results = [];
    if (!fs.existsSync(SRC)) return results;
    for (const project of fs.readdirSync(SRC)) {
        const mPath = path.join(SRC, project, 'manifest.json');
        if (!fs.existsSync(mPath)) continue;
        try {
            const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
            results.push(m);
        } catch {}
    }
    return results;
}

function getLastLines(file, n = 5) {
    if (!fs.existsSync(file)) return [];
    try {
        const content = fs.readFileSync(file, 'utf8');
        return content.trim().split('\n').slice(-n);
    } catch { return []; }
}

function render() {
    const now = new Date().toLocaleString('tr-TR');
    console.clear();
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║       🏭  ANF Pipeline Durumu  |  ${now}  ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    // Queue durumu
    const inbox = {
        architect: countFiles(path.join(QUEUE, 'inbox', 'architect')),
        coder:     countFiles(path.join(QUEUE, 'inbox', 'coder')),
        tester:    countFiles(path.join(QUEUE, 'inbox', 'tester')),
        docs:      countFiles(path.join(QUEUE, 'inbox', 'docs')),
    };
    const processing = countFiles(path.join(QUEUE, 'processing'));
    const done       = countFiles(path.join(QUEUE, 'done'));
    const error      = countFiles(path.join(QUEUE, 'error'));

    console.log('📬 KUYRUK DURUMU:');
    console.log(`   Architect inbox : ${inbox.architect} mesaj`);
    console.log(`   Coder inbox     : ${inbox.coder} mesaj`);
    console.log(`   Tester inbox    : ${inbox.tester} mesaj`);
    console.log(`   Docs inbox      : ${inbox.docs} mesaj`);
    console.log(`   İşlemde (processing) : ${processing}`);
    console.log(`   Tamamlanan (done)    : ${done}`);
    console.log(`   Hata (error)         : ${error}`);

    // Bekleyen PRD'ler (henüz işlenmemiş)
    const refDir = path.join(BASE, 'docs', 'reference');
    if (fs.existsSync(refDir)) {
        const pending = fs.readdirSync(refDir).filter(d => {
            const full = path.join(refDir, d);
            if (!fs.lstatSync(full).isDirectory()) return false;
            const files = fs.readdirSync(full).filter(f => f.endsWith('.md') && !f.startsWith('_'));
            return files.length > 0;
        });
        if (pending.length > 0) {
            console.log('\n📥 İŞLENMEYİ BEKLEYEN PRD\'LER:');
            for (const p of pending) {
                const files = fs.readdirSync(path.join(refDir, p)).filter(f => f.endsWith('.md') && !f.startsWith('_'));
                console.log(`   🗂  [${p}] — ${files.join(', ')}`);
            }
            console.log('   → Architect başlatmak için: node agents/architect.js\n');
        }
    }

    // Proje manifest'leri
    const manifests = readManifests();
    if (manifests.length === 0) {
        console.log('\n📂 Aktif proje yok. docs/reference/{proje_id}/ altına PRD ekleyin.\n');
    } else {
        for (const m of manifests) {
            const tasks = m.tasks || [];
            const counts = {};
            for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;

            console.log(`\n📦 PROJE: ${m.project_id}`);
            console.log(`   Toplam görev: ${tasks.length}`);
            for (const [status, count] of Object.entries(counts)) {
                console.log(`   ${STATUS_ICONS[status] || '•'} ${status}: ${count}`);
            }

            // Son 3 görevi listele
            const recent = tasks.slice(-3);
            if (recent.length) {
                console.log('   Son görevler:');
                for (const t of recent) {
                    console.log(`     ${STATUS_ICONS[t.status] || '•'} [${t.task_id}] ${t.title}`);
                }
            }
        }
    }

    // Son sistem log satırları
    const syslog = path.join(LOGS, 'system.log');
    const lines = getLastLines(syslog, 6);
    if (lines.length) {
        console.log('\n📋 SON SİSTEM LOGU:');
        for (const l of lines) {
            console.log(`   ${l}`);
        }
    }

    if (WATCH) {
        console.log('\n   [--watch modunda: her 3 saniyede güncellenir. Ctrl+C ile çık]\n');
    }
}

render();
if (WATCH) {
    setInterval(render, 3000);
}
