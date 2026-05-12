#!/usr/bin/env bash
set -euo pipefail

# dev-services.sh - Start PostgreSQL or Redis with healthcheck for local development
# Usage: ./scripts/dev-services.sh db   # start PostgreSQL
#        ./scripts/dev-services.sh redis # start Redis

SERVICE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${PROJECT_ROOT}/tmp"
PG_DATA_DIR="${DATA_DIR}/pgsql"
REDIS_DATA_DIR="${DATA_DIR}/redis"
PG_PORT=5432
REDIS_PORT=6379

mkdir -p "${PG_DATA_DIR}" "${REDIS_DATA_DIR}"

start_postgres() {
  if command -v pg_ctl >/dev/null 2>&1; then
    PG_CTL=pg_ctl
  elif command -v "/usr/lib/postgresql/*/bin/pg_ctl" >/dev/null 2>&1; then
    PG_CTL=$(ls /usr/lib/postgresql/*/bin/pg_ctl | head -n1)
  else
    echo "Error: pg_ctl not found. Install PostgreSQL client tools." >&2
    exit 1
  fi

  # Initialize data directory if needed
  if [ ! -f "${PG_DATA_DIR}/PG_VERSION" ]; then
    initdb -D "${PG_DATA_DIR}" --auth-local=trust --auth-host=trust
  fi

  echo "Starting PostgreSQL on port ${PG_PORT}..."
  "${PG_CTL}" -D "${PG_DATA_DIR}" -o "-c listen_addresses='localhost' -c port=${PG_PORT}" -w start

  # Wait for readiness
  echo "Waiting for PostgreSQL to accept connections..."
  until pg_isready -h localhost -p "${PG_PORT}" >/dev/null 2>&1; do
    sleep 0.5
  done
  echo "PostgreSQL is ready."

  # Keep the script running until interrupted
  wait
}

start_redis() {
  if ! command -v redis-server >/dev/null 2>&1; then
    echo "Error: redis-server not found. Install Redis." >&2
    exit 1
  fi

  echo "Starting Redis on port ${REDIS_PORT}..."
  redis-server --port "${REDIS_PORT}" --dir "${REDIS_DATA_DIR}" --save "" --appendonly no --loglevel warning &
  REDIS_PID=$!

  # Wait for readiness
  echo "Waiting for Redis to accept connections..."
  until redis-cli -p "${REDIS_PORT}" ping | grep -q PONG; do
    sleep 0.5
  done
  echo "Redis is ready."

  # Wait for the Redis process
  wait "${REDIS_PID}"
}

stop_services() {
  echo "Stopping services..."
  if command -v pg_ctl >/dev/null 2>&1; then
    pg_ctl -D "${PG_DATA_DIR}" stop -s || true
  fi
  pkill -f "redis-server.*--port ${REDIS_PORT}" || true
}

case "${SERVICE}" in
  db)
    trap stop_services SIGINT SIGTERM
    start_postgres
    ;;
  redis)
    trap stop_services SIGINT SIGTERM
    start_redis
    ;;
  *)
    echo "Usage: $0 {db|redis}" >&2
    exit 1
    ;;
esac