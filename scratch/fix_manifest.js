const fs = require('fs');
const path = require('path');

const manifestPath = '/workspaces/AutonomousNativeForge/src/aurapos/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

manifest.tasks = manifest.tasks.filter(t => t && t.task_id); // Remove malformed tasks

manifest.tasks.forEach(task => {
    if (task.status === 'FAILED') {
        console.log(`Fixing task ${task.task_id}...`);
        task.status = 'PENDING';
        task.retry_count = 0;
        task.failure_log = [];
        
        if (task.file_path && task.file_path.startsWith('src/')) {
             console.log(`  Updating path: ${task.file_path} -> apps/branch-server/${task.file_path}`);
             task.file_path = 'apps/branch-server/' + task.file_path;
        }
    }
});

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('Manifest fixed successfully.');
