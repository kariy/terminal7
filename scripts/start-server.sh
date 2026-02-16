#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export CC_MANAGER_HOST="${CC_MANAGER_HOST:-0.0.0.0}"
export CC_MANAGER_PORT="${CC_MANAGER_PORT:-8787}"

cd "$ROOT_DIR"
echo "Starting manager on ${CC_MANAGER_HOST}:${CC_MANAGER_PORT}"
exec bun run services/cc-manager/src/main.ts
