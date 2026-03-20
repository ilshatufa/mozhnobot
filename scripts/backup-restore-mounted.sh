#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/postgres/backups"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <dump-path-relative-to-postgres/backups>" >&2
  exit 1
fi

DUMP_REL_PATH="$1"
DUMP_HOST_PATH="$BACKUP_DIR/$DUMP_REL_PATH"

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

case "$DUMP_REL_PATH" in
  /*|../*|*/../*|*"/.."|*"../")
    echo "Use a path relative to postgres/backups without parent traversal" >&2
    exit 1
    ;;
esac

if [ ! -f "$DUMP_HOST_PATH" ]; then
  echo "Dump not found: $DUMP_HOST_PATH" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Stopping bot before restore..."
docker compose stop bot >/dev/null 2>&1 || true

echo "Starting postgres..."
docker compose up -d postgres
wait_for_postgres
ensure_database_exists

echo "Restoring PostgreSQL dump from /backups/$DUMP_REL_PATH..."
docker compose exec -T postgres sh -lc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  pg_restore \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --single-transaction \
    "/backups/'"$DUMP_REL_PATH"'"
'

echo "Starting application services..."
docker compose up -d

echo "Restore completed from: $DUMP_HOST_PATH"
