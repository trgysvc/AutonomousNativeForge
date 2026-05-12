import { readdir, stat } from 'fs/promises';
import { join, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGES_DIR = join(__dirname, '..', 'packages');

async function* walk(dir: string): AsyncIterable<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.mock.ts')) {
      yield full;
    }
  }
}

async function runMockFile(filePath: string): Promise<void> {
  try {
    const mod = await import(`file://${filePath}`);
    // Assume each mock file exports a default function named `run` or the module itself is a function
    if (typeof mod.default === 'function') {
      await mod.default();
    } else if (typeof mod === 'function') {
      await mod();
    } else {
      // Look for any exported async function
      const exportedFns = Object.values(mod).filter(
        (v) => typeof v === 'function' && v.constructor.name === 'AsyncFunction'
      );
      if (exportedFns.length > 0) {
        for (const fn of exportedFns) {
          await fn();
        }
      } else {
        console.warn(`[Mock] No runnable export found in ${filePath}`);
      }
    }
    console.log(`[Mock] ✅ ${filePath}`);
  } catch (err) {
    console.error(`[Mock] ❌ ${filePath}`);
    console.error(err);
  }
}

async function main() {
  console.log('🔎 Discovering mock test files...');
  const files: string[] = [];
  for await (const file of walk(PACKAGES_DIR)) {
    files.push(file);
  }
  if (files.length === 0) {
    console.log('⚠️ No mock test files found.');
    return;
  }
  console.log(`📦 Found ${files.length} mock file(s). Running...\n`);
  for (const file of files) {
    await runMockFile(file);
  }
  console.log('\n🏁 All mock tests completed.');
}

main().catch((e) => {
  console.error('💥 Fatal error:', e);
  process.exit(1);
});