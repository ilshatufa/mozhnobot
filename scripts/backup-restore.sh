#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <archive-path> [target-dir]" >&2
  exit 1
fi

ARCHIVE_PATH="$1"
TARGET_DIR="${2:-/opt/mozhnobot}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mozhno-backup-restore.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_DIR"
}

wait_for_postgres() {
  local container_id
  local status
  local attempts=60

  container_id="$(docker compose ps -q postgres)"
  if [ -z "$container_id" ]; then
    echo "Postgres container was not created" >&2
    exit 1
  fi

  while [ "$attempts" -gt 0 ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy|running)
        return 0
        ;;
      exited|dead|unhealthy)
        echo "Postgres container is not healthy: $status" >&2
        exit 1
        ;;
    esac

    sleep 2
    attempts=$((attempts - 1))
  done

  echo "Timed out waiting for postgres healthcheck" >&2
  exit 1
}

ensure_database_exists() {
  docker compose exec -T postgres sh -lc '
    export PGPASSWORD="$POSTGRES_PASSWORD"
    if ! psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '\''$POSTGRES_DB'\''" | grep -q 1; then
      createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
    fi
  '
}

trap cleanup EXIT

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi

mkdir -p "$TEMP_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$TEMP_DIR"

EXTRACTED_ROOT="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$EXTRACTED_ROOT" ]; then
  echo "Could not detect extracted backup directory" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp -R "$EXTRACTED_ROOT"/. "$TARGET_DIR"/

cd "$TARGET_DIR"

if [ ! -f "$TARGET_DIR/docker-compose.yml" ]; then
  echo "docker-compose.yml not found in restored target dir: $TARGET_DIR" >&2
  exit 1
fi

if [ ! -f "$TARGET_DIR/.env" ]; then
  echo ".env not found in restored target dir: $TARGET_DIR" >&2
  exit 1
fi

if [ ! -f "$TARGET_DIR/backup/postgres.dump" ]; then
  echo "Database dump not found: $TARGET_DIR/backup/postgres.dump" >&2
  exit 1
fi

echo "Stopping bot before restore..."
docker compose stop bot >/dev/null 2>&1 || true

echo "Starting postgres..."
docker compose up -d --build postgres
wait_for_postgres
ensure_database_exists

echo "Restoring PostgreSQL dump..."
docker compose exec -T postgres sh -lc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  pg_restore \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --single-transaction
' < "$TARGET_DIR/backup/postgres.dump"

echo "Starting application services..."
docker compose up -d --build

echo "Restore completed in: $TARGET_DIR"
