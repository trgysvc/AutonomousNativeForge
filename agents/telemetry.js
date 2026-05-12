'use strict';

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const SYS_LOG = path.join(LOGS_DIR, 'system.log'); // Bootstrap uses system.log for global, base-agent uses sys.log for app
const APP_LOG = path.join(BASE_DIR, 'sys.log'); // Let's check sys.log
const SRC_DIR = path.join(BASE_DIR, 'src');
const REPORT_PATH = path.join(BASE_DIR, 'anf_system_report.md');

const PROJECT_ID = 'aurapos'; // Can be made dynamic later
const MANIFEST_PATH = path.join(SRC_DIR, PROJECT_ID, 'manifest.json');

const STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function parseLogSpeeds() {
    if (!fs.existsSync(APP_LOG)) return { readAvg: 0, codeAvg: 0, qaAvg: 0 };
    
    const log = fs.readFileSync(APP_LOG, 'utf8');
    const lines = log.split('\n');

    let codingTimes = [];
    let readTimes = [];
    let qaTimes = [];

    let lastCoderStart = null;
    let lastQaStart = null;
    let lastDocStart = null;

    lines.forEach(line => {
        const timeMatch = line.match(/\[(.*?)\]/);
        if (!timeMatch) return;
        const time = new Date(timeMatch[1]).getTime();

        if (line.includes('Multi-Doc Synthesis başlatılıyor')) lastDocStart = time;
        if (line.includes('CONSENSUS: [aurapos] Peer Review başlatılıyor') && lastDocStart) {
            readTimes.push((time - lastDocStart) / 1000);
            lastDocStart = null;
        }

        if (line.includes('CODER: [aurapos]') && line.includes('yazılıyor')) lastCoderStart = time;
        if (line.includes('Kod yazımı bitti') && lastCoderStart) {
            codingTimes.push((time - lastCoderStart) / 1000);
            lastCoderStart = null;
        }

        if (line.includes('QA GUARDRAIL: [aurapos]')) lastQaStart = time;
        if ((line.includes('SYNC FAIL') || line.includes('TEST GEÇİLDİ')) && lastQaStart) {
            qaTimes.push((time - lastQaStart) / 1000);
            lastQaStart = null;
        }
    });

    const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length).toFixed(1) : 0;
    return {
        readAvg: avg(readTimes),
        codeAvg: avg(codingTimes),
        qaAvg: avg(qaTimes),
        codeSamples: codingTimes.length
    };
}

function checkSystemState() {
    let state = "🟢 ONLINE (Aktif İşlem Yapılıyor)";
    if (fs.existsSync(APP_LOG)) {
        const stats = fs.statSync(APP_LOG);
        const diff = Date.now() - stats.mtimeMs;
        if (diff > STALL_THRESHOLD_MS) {
            state = `🔴 STALLED (Sistem Dondu - ${Math.floor(diff/60000)} dakikadır işlem yok!)`;
        }
    }
    return state;
}

function generateReport() {
    if (!fs.existsSync(MANIFEST_PATH)) return;

    try {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        const tasks = manifest.tasks || [];
        
        let done = 0, pending = 0, in_progress = 0, testing = 0, failed = 0;
        tasks.forEach(t => {
            if (t.status === 'DONE') done++;
            else if (t.status === 'PENDING') pending++;
            else if (t.status === 'IN_PROGRESS' || t.status === 'FIXING') in_progress++;
            else if (t.status === 'TESTING') testing++;
            else if (t.status === 'FAILED') failed++;
        });

        const speeds = parseLogSpeeds();
        const systemState = checkSystemState();

        // Calculate ETA
        const averageTaskMinutes = (speeds.codeAvg > 0 ? parseFloat(speeds.codeAvg) : 240) / 60; 
        const etaMinutes = (pending + in_progress + testing) * (averageTaskMinutes + 2); // adding 2 mins for steer buffer
        const etaHours = (etaMinutes / 60).toFixed(1);

        const reportContent = `# ANF Otonom Sistem Canlı Telemetri
**Son Güncelleme:** ${new Date().toISOString()}
**Sistem Durumu:** ${systemState}

## 📊 1. Görev Dağılımı (Manifesto Analizi)
*   **Toplam Görev:** ${tasks.length}
*   ✅ **DONE:** ${done}
*   ⏳ **PENDING:** ${pending}
*   🛠️ **IN_PROGRESS:** ${in_progress}
*   🔄 **TESTING:** ${testing}
*   ❌ **FAILED:** ${failed}

## ⚡ 2. Üretim Hızı İstatistikleri
Sistem logları taranarak ajanların net süreleri (saniye cinsinden) analiz edilmiştir:
*   **Döküman Okuma / Planlama (RAG):** ${speeds.readAvg} saniye
*   **Kod Yazma Hızı:** ${speeds.codeAvg} saniye (Örneklem: ${speeds.codeSamples} görev)
*   **Test ve Kalite Kontrol (QA):** ${speeds.qaAvg} saniye

## ⏱️ 3. Tahmini Tamamlanma (ETA)
Kalan ${pending + in_progress + testing} görev için mevcut hızlar baz alındığında, **tahmini tamamlanma süresi: ${etaHours} Saat**.
`;

        fs.writeFileSync(REPORT_PATH, reportContent);
        console.log(`[TELEMETRY] Rapor güncellendi. State: ${systemState} | DONE: ${done}`);
    } catch (err) {
        console.error("[TELEMETRY] Hata oluştu:", err.message);
    }
}

// Start loop
console.log("🚀 TELEMETRY başlatıldı.");
generateReport();
setInterval(generateReport, 15000); // 15 saniyede bir güncelle
