'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VAULT_PATH = path.join(ROOT, 'config', 'vault.json');
const LOG_FILE = path.join(ROOT, 'sys.log');

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8')).global || {}; }
    catch (e) { return {}; }
}

const config = loadConfig();
const SRC_DIR = config.workspace_dir || path.join(ROOT, 'src');
const PORT = config.dashboard_port || 3000;

// ─── Data ────────────────────────────────────────────────────────────────────

function getProjects() {
    if (!fs.existsSync(SRC_DIR)) return [];
    return fs.readdirSync(SRC_DIR)
        .filter(name => fs.existsSync(path.join(SRC_DIR, name, 'manifest.json')))
        .map(name => {
            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, name, 'manifest.json'), 'utf8'));
                return {
                    project_id: name,
                    tasks: (manifest.tasks || []).map(t => ({
                        task_id:   t.task_id,
                        title:     t.title,
                        status:    t.status || 'PENDING',
                        file_path: t.file_path || ''
                    }))
                };
            } catch (e) { return null; }
        })
        .filter(Boolean);
}

// Efficient tail: reads at most 64 KB from the end of the log file.
function getLogLines(n = 60) {
    if (!fs.existsSync(LOG_FILE)) return [];
    const stat = fs.statSync(LOG_FILE);
    const readSize = Math.min(stat.size, 65536);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(LOG_FILE, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean).slice(-n);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ANF Dashboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0d1117;color:#c9d1d9;font-family:'Courier New',monospace;font-size:13px;padding:20px 24px}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #30363d}
    h1{color:#58a6ff;font-size:16px;letter-spacing:2px;font-weight:normal}
    #refresh{color:#484f58;font-size:11px}
    .project{margin-bottom:20px;border:1px solid #30363d;border-radius:6px;overflow:hidden}
    .phead{background:#161b22;padding:10px 16px;display:flex;align-items:center;gap:14px}
    .pid{color:#79c0ff;font-size:14px;font-weight:bold}
    .pstat{color:#6e7681;font-size:11px;white-space:nowrap}
    .bar{background:#21262d;border-radius:2px;height:4px;flex:1;min-width:60px}
    .bar-fill{background:#3fb950;height:4px;border-radius:2px;transition:width .5s}
    table{width:100%;border-collapse:collapse}
    th{color:#6e7681;text-align:left;padding:5px 16px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;background:#0d1117;border-bottom:1px solid #21262d}
    td{padding:5px 16px;font-size:12px;border-top:1px solid #21262d;vertical-align:middle}
    .DONE{color:#3fb950}
    .IN_PROGRESS{color:#58a6ff}
    .TESTING{color:#e3b341}
    .FIXING{color:#d29922}
    .FAILED,.ERROR{color:#f85149}
    .PENDING{color:#484f58}
    .fp{color:#6e7681;font-size:11px}
    .sect{color:#6e7681;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin:20px 0 6px}
    .logs{background:#010409;border:1px solid #30363d;border-radius:6px;padding:10px 12px;height:260px;overflow-y:auto}
    .ll{font-size:10.5px;line-height:1.7;white-space:pre-wrap;word-break:break-all;color:#484f58}
    .ll:last-child{color:#8b949e}
    .empty{padding:20px;color:#484f58;font-style:italic}
    .badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;background:#21262d;margin-left:6px}
  </style>
</head>
<body>
  <header>
    <h1>⚙ AUTONOMOUS NATIVE FORGE</h1>
    <span id="refresh">connecting...</span>
  </header>
  <div id="projects"></div>
  <div class="sect">System Log <span class="badge">last 60 lines</span></div>
  <div class="logs" id="logs"></div>
  <script>
    const e = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    async function update() {
      try {
        const [sr, lr] = await Promise.all([fetch('/api/status'), fetch('/api/logs')]);
        const { projects } = await sr.json();
        const { lines } = await lr.json();
        document.getElementById('refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();

        const pel = document.getElementById('projects');
        if (!projects.length) {
          pel.innerHTML = '<div class="empty">No projects yet. Drop a PRD into docs/reference/ to begin.</div>';
        } else {
          pel.innerHTML = projects.map(p => {
            const done  = p.tasks.filter(t => t.status === 'DONE').length;
            const total = p.tasks.length;
            const pct   = total ? Math.round(done / total * 100) : 0;
            const inprog = p.tasks.filter(t => t.status === 'IN_PROGRESS').length;
            const failed = p.tasks.filter(t => t.status === 'FAILED' || t.status === 'ERROR').length;
            const rows = p.tasks.map(t =>
              '<tr><td>' + e(t.task_id) + '</td>' +
              '<td>' + e(t.title) + '</td>' +
              '<td class="' + e(t.status) + '">' + e(t.status) + '</td>' +
              '<td class="fp">' + e(t.file_path) + '</td></tr>'
            ).join('');
            return '<div class="project">' +
              '<div class="phead">' +
              '<span class="pid">' + e(p.project_id) + '</span>' +
              '<span class="pstat">' + done + '/' + total +
                (inprog ? ' · <span class="IN_PROGRESS">' + inprog + ' running</span>' : '') +
                (failed ? ' · <span class="FAILED">' + failed + ' failed</span>' : '') +
              '</span>' +
              '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
              '<span class="pstat">' + pct + '%</span>' +
              '</div>' +
              '<table><tr><th>ID</th><th>Title</th><th>Status</th><th>File</th></tr>' + rows + '</table>' +
              '</div>';
          }).join('');
        }

        const lel = document.getElementById('logs');
        lel.innerHTML = lines.map(l => '<div class="ll">' + e(l) + '</div>').join('');
        lel.scrollTop = lel.scrollHeight;
      } catch (err) {
        document.getElementById('refresh').textContent = '⚠ ' + err.message;
      }
    }
    update();
    setInterval(update, 5000);
  </script>
</body>
</html>`;

// ─── Router ───────────────────────────────────────────────────────────────────

function handler(req, res) {
    const url = (req.url || '/').split('?')[0];

    // CORS for local dev tools
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:' + PORT);

    if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML);
    }

    if (url === '/api/status') {
        try {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ projects: getProjects() }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    if (url === '/api/logs') {
        try {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ lines: getLogLines() }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    res.writeHead(404);
    res.end('Not found');
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = http.createServer(handler);
server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🖥  ANF Dashboard  →  http://localhost:${PORT}\n`);
    console.log(`   Projects: ${SRC_DIR}`);
    console.log(`   Log:      ${LOG_FILE}\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} kullanımda. vault.json > dashboard_port değiştirin.`);
    } else {
        console.error('❌ Dashboard hatası:', err.message);
    }
    process.exit(1);
});
