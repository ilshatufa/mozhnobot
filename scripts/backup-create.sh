#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

OUTPUT_DIR="${1:-$ROOT_DIR/backups}"
TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +"%Y%m%dT%H%M%SZ")}"
BUNDLE_NAME="mozhno-backup-${TIMESTAMP}"
ARCHIVE_PATH="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mozhno-backup-create.XXXXXX")"
BUNDLE_DIR="${TEMP_DIR}/${BUNDLE_NAME}"

cleanup() {
  rm -rf "$TEMP_DIR"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

copy_if_exists() {
  local path="$1"
  if [ -e "$ROOT_DIR/$path" ]; then
    cp -R "$ROOT_DIR/$path" "$BUNDLE_DIR/$path"
  fi
}

trap cleanup EXIT

require_command docker
require_command tar

mkdir -p "$OUTPUT_DIR"
mkdir -p "$BUNDLE_DIR/backup"

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "Missing .env in $ROOT_DIR" >&2
  exit 1
fi

echo "Creating PostgreSQL dump via docker compose..."
(
  cd "$ROOT_DIR"
  docker compose exec -T postgres sh -lc '
    export PGPASSWORD="$POSTGRES_PASSWORD"
    pg_dump \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --format=custom \
      --clean \
      --if-exists \
      --no-owner \
      --no-privileges
  '
) > "$BUNDLE_DIR/backup/postgres.dump"

copy_if_exists "docker-compose.yml"
copy_if_exists ".env"
copy_if_exists ".env.example"
copy_if_exists "README.md"
copy_if_exists "AGENTS.md"
copy_if_exists "bot"
copy_if_exists "postgres"
copy_if_exists "scripts"

cat > "$BUNDLE_DIR/backup/manifest.txt" <<EOF
bundle_name=${BUNDLE_NAME}
created_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
source_root=${ROOT_DIR}
archive_name=$(basename "$ARCHIVE_PATH")
EOF

tar -czf "$ARCHIVE_PATH" -C "$TEMP_DIR" "$BUNDLE_NAME"

echo "Backup archive created:"
echo "$ARCHIVE_PATH"
