#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MSPIStorageLocator"
MAC_APP_DIR="$ROOT_DIR/mac-app"
OUTPUT_DIR="$ROOT_DIR/backend/public/mac-app"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/storage-locator-zip.XXXXXX")"
APP_DIR="$STAGING_DIR/$APP_NAME.app"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

swift build --package-path "$MAC_APP_DIR" --configuration release --product "$APP_NAME"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$MAC_APP_DIR/.build/arm64-apple-macosx/release/$APP_NAME" "$APP_DIR/Contents/MacOS/$APP_NAME"
cp "$MAC_APP_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
actool \
  --compile "$APP_DIR/Contents/Resources" \
  --platform macosx \
  --minimum-deployment-target 14.0 \
  --app-icon AppIcon \
  --output-partial-info-plist "$STAGING_DIR/Assets-partial.plist" \
  "$MAC_APP_DIR/Resources/Assets.xcassets"
chmod 755 "$APP_DIR/Contents/MacOS/$APP_NAME"

if [[ -n "${SIGNING_IDENTITY:-}" ]]; then
  codesign --deep --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$APP_DIR"
else
  codesign --deep --force --sign - "$APP_DIR"
  echo "Warning: created an ad-hoc signed ZIP. Use SIGNING_IDENTITY for production distribution." >&2
fi

mkdir -p "$OUTPUT_DIR"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$OUTPUT_DIR/$APP_NAME.zip"

echo "Created $OUTPUT_DIR/$APP_NAME.zip"
