const fs = require('fs');

const devlogPath = 'DEVLOG.md';
const content = fs.readFileSync(devlogPath, 'utf8');

const newEntry = `
---
### [${new Date().toISOString()}] - system - Automated Telemetry Daemon & Event-Loop Patch
- **Event-Loop Fix:** Patched \`agents/architect.js\` to dispatch tasks when status is \`FAILED\` (not just \`DONE\`). This prevents the system from stalling if a task reaches MAX_RETRIES.
- **Telemetry Daemon:** Created \`agents/telemetry.js\` to run independently as a systemd service (\`anf-telemetry.service\`).
- **Real-Time Analytics:** The daemon monitors \`manifest.json\` and \`sys.log\` to calculate RAG read times, code writing speeds, and QA test times.
- **Auto-Reporting:** It automatically updates \`anf_system_report.md\` every 15 seconds with system state (ONLINE/STALLED) and ETA for project completion.
- **Bootstrap Integration:** Added telemetry to \`agents/bootstrap.js\` so it is deployed automatically on fresh Linux installations alongside core agents.
`;

// Prepend right after the first line (or at the top)
const updatedContent = newEntry + '\n' + content.trim();
fs.writeFileSync(devlogPath, updatedContent);

// Remove the obsolete devlog.md
if (fs.existsSync('devlog.md')) {
    fs.unlinkSync('devlog.md');
    console.log("Deleted obsolete devlog.md");
}

console.log("Updated DEVLOG.md successfully.");
