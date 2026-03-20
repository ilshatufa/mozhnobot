#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <archive-path> <remote-host> [remote-path]" >&2
  exit 1
fi

ARCHIVE_PATH="$1"
REMOTE_HOST="$2"
REMOTE_PATH="${3:-~/$(basename "$ARCHIVE_PATH")}"

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi

echo "Uploading archive to ${REMOTE_HOST}:${REMOTE_PATH}..."
scp ${SSH_OPTS:-} "$ARCHIVE_PATH" "${REMOTE_HOST}:${REMOTE_PATH}"

echo "Archive uploaded:"
echo "${REMOTE_HOST}:${REMOTE_PATH}"
