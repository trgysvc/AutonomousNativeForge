import { execSync } from 'child_process';

try {
  execSync('pnpm run test:mock --recursive --if-present', { stdio: 'inherit' });
} catch (error) {
  console.error('Mock tests failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}