#!/bin/bash
set -euo pipefail
APP_NAME="MSPIStorageLocator"
DOWNLOAD_URL="https://tools.mspi.io/mac-app/MSPIStorageLocator.zip"
INSTALL_DIR="$HOME/Applications"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/storage-locator-install.XXXXXX")"
ZIP_PATH="$TEMP_DIR/$APP_NAME.zip"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

mkdir -p "$INSTALL_DIR"
curl --fail --silent --show-error --location "$DOWNLOAD_URL" -o "$ZIP_PATH"
ditto -xk "$ZIP_PATH" "$TEMP_DIR/extracted"
if [[ ! -d "$TEMP_DIR/extracted/$APP_NAME.app" ]]; then
  echo "Downloaded archive does not contain $APP_NAME.app" >&2
  exit 1
fi

rm -rf "$INSTALL_DIR/$APP_NAME.app"
ditto "$TEMP_DIR/extracted/$APP_NAME.app" "$INSTALL_DIR/$APP_NAME.app"
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME.app" >/dev/null 2>&1 || true
open "$INSTALL_DIR/$APP_NAME.app"
