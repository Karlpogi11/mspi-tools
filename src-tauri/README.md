# MSPI Pulse — Tauri wrapper (free, cross-platform trial)

Wraps the existing Vite build (`frontend/dist`) so one codebase ships:

- `npm run tauri:build:mac` → `.dmg` (macOS 13+)
- `npm run tauri:build:win` → `.exe` / NSIS installer (Windows 10+)

The app opens straight into `/messenger` and reuses cookie-JWT auth plus
the `/ws-pulse` live rail. No new backend, no license cost.

## Native SwiftUI later

`backend/src/messenger/*` (REST + WS event shapes) is the frozen contract.
A future `mspi-pulse-macos/` Xcode project (like LabelMerger: Swift,
GitHub Releases, `~/Applications`) implements the same contract with
`URLSessionWebSocket` + Keychain + Sparkle — only the UI layer is rewritten.
