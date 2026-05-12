const fs = require('fs');

const path = 'README.md';
let content = fs.readFileSync(path, 'utf8');

// Add to English section
content = content.replace(
  '- [x] Web Dashboard — `http://localhost:3000`, 5s refresh, dark theme',
  '- [x] Web Dashboard — `http://localhost:3000`, 5s refresh, dark theme\n- [x] Telemetry Daemon — Autonomous 24/7 background system health & speed tracker'
);

// Add to Turkish section
content = content.replace(
  '- [x] Web Dashboard — `http://localhost:3000`, 5s refresh, dark theme',
  '- [x] Web Dashboard — `http://localhost:3000`, 5s refresh, dark theme\n- [x] Otonom Telemetri — 7/24 Arka planda çalışan performans ve sağlık gözlemcisi'
);

fs.writeFileSync(path, content);
console.log("Updated README.md");
