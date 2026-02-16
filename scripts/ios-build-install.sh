#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/ios-build.sh"
"$ROOT_DIR/scripts/ios-install.sh" "$@"
