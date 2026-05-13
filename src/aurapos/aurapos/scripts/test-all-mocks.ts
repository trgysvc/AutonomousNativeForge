import { execSync } from 'child_process';

try {
  execSync('pnpm run test:mock --recursive --if-present', { stdio: 'inherit' });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Mock tests failed:', message);
  process.exit(1);
}