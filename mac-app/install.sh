#!/bin/bash
set -euo pipefail
APP_NAME="MSPIStorageLocator"
DOWNLOAD_URL="https://tools.mspi.io/mac-app/MSPIStorageLocator.dmg"
INSTALL_DIR="$HOME/Applications"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/storage-locator-install.XXXXXX")"
DMG_PATH="$TEMP_DIR/$APP_NAME.dmg"
MOUNT_PATH=""

cleanup() {
  if [[ -n "$MOUNT_PATH" ]]; then
    hdiutil detach "$MOUNT_PATH" -quiet || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

mkdir -p "$INSTALL_DIR"
curl --fail --silent --show-error --location "$DOWNLOAD_URL" -o "$DMG_PATH"
MOUNT_PATH=$(hdiutil attach -nobrowse -readonly "$DMG_PATH" | awk '/\/Volumes\// {print $NF; exit}')
if [[ -z "$MOUNT_PATH" || ! -d "$MOUNT_PATH/$APP_NAME.app" ]]; then
  echo "Downloaded disk image does not contain $APP_NAME.app" >&2
  exit 1
fi

rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$MOUNT_PATH/$APP_NAME.app" "$INSTALL_DIR/"
open "$INSTALL_DIR/$APP_NAME.app"
