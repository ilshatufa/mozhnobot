#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <remote-host> [remote-dir] [local-output-dir]" >&2
  exit 1
fi

REMOTE_HOST="$1"
REMOTE_DIR="${2:-/opt/mozhnobot}"
LOCAL_OUTPUT_DIR="${3:-$ROOT_DIR/backups}"

ARCHIVE_PATH="$("$SCRIPT_DIR/backup-create.sh" "$LOCAL_OUTPUT_DIR" | tail -n 1)"
REMOTE_ARCHIVE_PATH="${REMOTE_DIR}/$(basename "$ARCHIVE_PATH")"

echo "Preparing remote directory..."
ssh ${SSH_OPTS:-} "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"

"$SCRIPT_DIR/backup-transfer.sh" "$ARCHIVE_PATH" "$REMOTE_HOST" "$REMOTE_ARCHIVE_PATH"

echo "Restoring archive on remote host..."
ssh ${SSH_OPTS:-} "$REMOTE_HOST" "bash -s -- '$REMOTE_ARCHIVE_PATH' '$REMOTE_DIR'" < "$SCRIPT_DIR/backup-restore.sh"

echo "Remote deployment finished:"
echo "$REMOTE_HOST:$REMOTE_DIR"
