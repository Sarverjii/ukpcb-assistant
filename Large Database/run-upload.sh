#!/usr/bin/env bash
# Linux entry point — run directly, or point cron at this file (see
# README.md for the exact crontab line for a 12:00 PM daily run).
#
# set -e: stop this wrapper on its own errors (e.g. node missing); the
# actual per-file upload logic never uses this wrapper's exit-on-error —
# upload-documents.mjs already catches and logs every per-file failure
# itself and keeps going, only setting a non-zero exit code at the end to
# signal "something needs attention" to cron/systemd's own failure alerts.
set -e

# Resolve this script's own directory so it works no matter what directory
# cron (or you) invoke it from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found on PATH. Install Node.js (https://nodejs.org), or if cron can't see" >&2
  echo "your normal PATH, hardcode the full path to node in this file (e.g. /usr/bin/node)." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "node_modules is missing — run 'npm install' once in this folder before first use." >&2
  exit 1
fi

node upload-documents.mjs
