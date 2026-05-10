'use strict';
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');

const execAsync = promisify(exec);
const SANDBOX_TIMEOUT_MS = 120000; // 2 dakika

async function isDockerAvailable() {
    try {
        await execAsync('docker info', { timeout: 5000 });
        return true;
    } catch (e) { return false; }
}

/**
 * Dosyayı izole Docker container'ında denetler.
 * Dönüş: { skipped, passed, output } — asla fırlatmaz.
 *
 * İzolasyon: --network none, --memory 512m, --cpus 2, salt-okunur mount.
 * TS projeleri: yalnızca yerel node_modules/.bin/tsc varsa çalışır.
 * Yoksa native check (validateCode) zaten yaptığı için atlanır.
 *
 * Neden önce Docker unavailable kontrolü değil?
 *   Önce dil desteğini kontrol et — desteklenmiyorsa Docker'a bile sorma.
 *   Bu, Docker olmayan ortamlarda gereksiz 5 saniyelik timeout'u önler.
 */
async function runInSandbox(projectPath, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');

    let image, command;

    if (ext === '.js') {
        image = 'node:20-alpine';
        command = `node --check /app/${relativePath}`;
    } else if (ext === '.ts' || ext === '.tsx') {
        // Network none ile npx typescript indiremez — yerel tsc şart.
        const localTsc = path.join(projectPath, 'node_modules', '.bin', 'tsc');
        if (!fs.existsSync(localTsc)) {
            return { skipped: true, reason: 'TS sandbox: yerel tsc yok, native check yeterli' };
        }
        image = 'node:20-alpine';
        command = `sh -c "cd /app && ./node_modules/.bin/tsc --noEmit 2>&1 | head -100"`;
    } else if (ext === '.py') {
        image = 'python:3.12-alpine';
        command = `python -m py_compile /app/${relativePath}`;
    } else {
        return { skipped: true, reason: `${ext} dosyaları için sandbox tanımsız` };
    }

    if (!await isDockerAvailable()) {
        return { skipped: true, reason: 'Docker daemon çalışmıyor' };
    }

    const dockerCmd = [
        'docker run --rm',
        '--network none',
        '--memory 512m',
        '--cpus 2',
        `--volume "${projectPath}:/app:ro"`,
        image,
        command
    ].join(' ');

    try {
        const { stdout, stderr } = await execAsync(dockerCmd, { timeout: SANDBOX_TIMEOUT_MS });
        return { passed: true, output: (stdout + stderr).trim() };
    } catch (err) {
        const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
        return { passed: false, output: output.substring(0, 2000) };
    }
}

module.exports = { runInSandbox };
