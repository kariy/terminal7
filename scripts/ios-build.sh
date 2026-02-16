#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${IOS_DIR:-$ROOT_DIR/ios/ClaudeChat}"
PROJECT_PATH="${PROJECT_PATH:-$IOS_DIR/ClaudeChat.xcodeproj}"
SCHEME="${SCHEME:-ClaudeChat}"
CONFIGURATION="${CONFIGURATION:-Debug}"
APP_NAME="${APP_NAME:-ClaudeChat}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$IOS_DIR/.build/DerivedData}"
LAST_APP_FILE="$IOS_DIR/.build/latest-ios-app-path.txt"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphoneos/${APP_NAME}.app"

mkdir -p "$IOS_DIR/.build"

echo "Building $SCHEME ($CONFIGURATION) for iOS devices..."
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -allowProvisioningUpdates \
  build

if [[ ! -d "$APP_PATH" ]]; then
  APP_PATH="$(find "$DERIVED_DATA_PATH/Build/Products" -type d -name "${APP_NAME}.app" -path "*iphoneos*" | head -n 1 || true)"
fi

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Build completed but could not locate ${APP_NAME}.app in $DERIVED_DATA_PATH." >&2
  exit 1
fi

printf '%s\n' "$APP_PATH" > "$LAST_APP_FILE"

echo "Build complete."
echo "App path: $APP_PATH"
