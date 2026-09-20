#!/bin/bash
set -e
APP_NAME="MSPIStorageLocator"
DOWNLOAD_URL="https://tools.mspi.io/mac-app/MSPIStorageLocator.dmg"
INSTALL_DIR="$HOME/Applications"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "/tmp/$APP_NAME.dmg"
MOUNT_PATH=$(hdiutil attach "/tmp/$APP_NAME.dmg" | tail -1 | awk '{print $3}')
rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$MOUNT_PATH/$APP_NAME.app" "$INSTALL_DIR/"
hdiutil detach "$MOUNT_PATH"
rm "/tmp/$APP_NAME.dmg"
open "$INSTALL_DIR/$APP_NAME.app"
