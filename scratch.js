const fs = require('fs');

const log = fs.readFileSync('sys.log', 'utf8');
const lines = log.split('\n').filter(l => l.trim() !== '');

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

    // Document Reading (Synthesis)
    if (line.includes('Multi-Doc Synthesis başlatılıyor')) {
        lastDocStart = time;
    }
    if (line.includes('CONSENSUS: [aurapos] Peer Review başlatılıyor') && lastDocStart) {
        readTimes.push((time - lastDocStart) / 1000); // seconds
        lastDocStart = null;
    }

    // Coding
    if (line.includes('CODER: [aurapos]') && line.includes('yazılıyor')) {
        lastCoderStart = time;
    }
    if (line.includes('Kod yazımı bitti') && lastCoderStart) {
        codingTimes.push((time - lastCoderStart) / 1000);
        lastCoderStart = null;
    }

    // QA/Testing
    if (line.includes('QA GUARDRAIL: [aurapos]')) {
        lastQaStart = time;
    }
    if ((line.includes('SYNC FAIL') || line.includes('TEST GEÇİLDİ')) && lastQaStart) {
        qaTimes.push((time - lastQaStart) / 1000);
        lastQaStart = null;
    }
});

const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length).toFixed(1) : 0;
const min = arr => arr.length ? Math.min(...arr).toFixed(1) : 0;
const max = arr => arr.length ? Math.max(...arr).toFixed(1) : 0;

console.log(`Document Reading (RAG + Planning): Avg ${avg(readTimes)}s (Samples: ${readTimes.length})`);
console.log(`Code Writing: Avg ${avg(codingTimes)}s, Min ${min(codingTimes)}s, Max ${max(codingTimes)}s (Samples: ${codingTimes.length})`);
console.log(`QA/Testing: Avg ${avg(qaTimes)}s (Samples: ${qaTimes.length})`);
