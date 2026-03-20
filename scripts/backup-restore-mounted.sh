#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/postgres/backups"
TEMP_DIR=""

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <dump-or-archive-path>" >&2
  exit 1
fi

INPUT_PATH="$1"

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

resolve_host_path() {
  local raw_path="$1"

  case "$raw_path" in
    ../*|*/../*|*"/.."|*"../")
      echo "Use a path inside postgres/backups without parent traversal" >&2
      exit 1
      ;;
    "$BACKUP_DIR"/*)
      printf '%s\n' "$raw_path"
      ;;
    ./postgres/backups/*)
      printf '%s\n' "$ROOT_DIR/${raw_path#./}"
      ;;
    postgres/backups/*)
      printf '%s\n' "$ROOT_DIR/$raw_path"
      ;;
    /*)
      printf '%s\n' "$raw_path"
      ;;
    *)
      printf '%s\n' "$BACKUP_DIR/$raw_path"
      ;;
  esac
}

restore_from_stdin() {
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
  '
}

restore_from_mounted_dump() {
  local dump_rel_path="$1"

  echo "Restoring PostgreSQL dump from /backups/$dump_rel_path..."
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
      "/backups/'"$dump_rel_path"'"
  '
}

restore_from_archive() {
  local archive_path="$1"
  local dump_entry

  require_command tar

  dump_entry="$(tar -tzf "$archive_path" | awk '/\/backup\/postgres\.dump$/ { print; exit }')"
  if [ -z "$dump_entry" ]; then
    echo "Database dump not found in archive: $archive_path" >&2
    exit 1
  fi

  echo "Restoring PostgreSQL dump from archive: $archive_path"
  tar -xOzf "$archive_path" "$dump_entry" | restore_from_stdin
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

BACKUP_HOST_PATH="$(resolve_host_path "$INPUT_PATH")"

if [ ! -f "$BACKUP_HOST_PATH" ]; then
  echo "Backup file not found: $BACKUP_HOST_PATH" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Stopping bot before restore..."
docker compose stop bot >/dev/null 2>&1 || true

echo "Starting postgres..."
docker compose up -d postgres
wait_for_postgres
ensure_database_exists

case "$BACKUP_HOST_PATH" in
  *.tar.gz|*.tgz)
    restore_from_archive "$BACKUP_HOST_PATH"
    ;;
  "$BACKUP_DIR"/*)
    restore_from_mounted_dump "${BACKUP_HOST_PATH#$BACKUP_DIR/}"
    ;;
  *)
    echo "Restoring PostgreSQL dump from host file: $BACKUP_HOST_PATH"
    restore_from_stdin < "$BACKUP_HOST_PATH"
    ;;
esac

echo "Starting application services..."
docker compose up -d

echo "Restore completed from: $BACKUP_HOST_PATH"
