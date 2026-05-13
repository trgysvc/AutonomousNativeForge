#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env if present
if [[ -f .env ]]; then
  export $(grep -v '^#' .env | xargs)
fi

# Ensure we are in the repository root (where docker-compose.yml lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "=== Running database migrations ==="
# Assuming Supabase CLI is installed and configured
if command -v supabase >/dev/null 2>&1; then
  supabase db push --project-id "${SUPABASE_PROJECT_ID:-}" --db-url "${SUPABASE_DB_URL:-}"
else
  echo "Supabase CLI not found. Skipping migrations."
fi

echo "=== Building Docker images ==="
docker compose build

echo "=== Pushing Docker images ==="
docker compose push

echo "=== Restarting services ==="
docker compose up -d --remove-orphans

echo "=== Deployment completed ==="