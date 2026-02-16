#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${IOS_DIR:-$ROOT_DIR/ios/ClaudeChat}"
APP_NAME="${APP_NAME:-ClaudeChat}"
DEFAULT_APP_CACHE_FILE="$IOS_DIR/.build/latest-ios-app-path.txt"

DEVICE_ID="${1:-${IOS_DEVICE_ID:-}}"
APP_PATH="${2:-${IOS_APP_PATH:-}}"

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(xcrun devicectl list devices | awk 'NR > 2 { if (match($0, /[A-F0-9-]{36}/)) { print substr($0, RSTART, RLENGTH); exit } }')"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "No paired iOS device found. Connect and trust your phone, then try again." >&2
  exit 1
fi

if [[ -z "$APP_PATH" && -f "$DEFAULT_APP_CACHE_FILE" ]]; then
  APP_PATH="$(cat "$DEFAULT_APP_CACHE_FILE")"
fi

if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(find "$IOS_DIR/.build/DerivedData/Build/Products" -type d -name "${APP_NAME}.app" -path "*iphoneos*" | head -n 1 || true)"
fi

if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(find "$HOME/Library/Developer/Xcode/DerivedData" -type d -path "*/Build/Products/*iphoneos*/${APP_NAME}.app" | head -n 1 || true)"
fi

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Could not find a built iOS app. Run scripts/ios-build.sh first or pass an app path." >&2
  exit 1
fi

echo "Installing app on device: $DEVICE_ID"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

echo "Install complete."
echo "Installed app: $APP_PATH"
