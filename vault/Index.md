# MSPI Internal Tools — Obsidian Vault

Welcome to the Obsidian Vault for the MSPI Internal Tools project. This workspace has been restructured from a Turborepo monorepo into a flat unified backend/frontend layout.

## 🗺️ Map of Contents (MOC)

### 🏗️ Core System & Architecture
- [[Architecture Overview]]: General project structure, Vite/Express routing, and dynamic tools loading.
- [[Authentication & SSO]]: Centralized cookie-based SSO mechanism using wildcard domain `.mspi.io` cookie with JWT.
- [[Database Schema]]: MySQL table structures managed with Drizzle ORM.
- [[Deployment & Rules]]: Instructions for running locally, builds, and **CRITICAL** domain restrictions.

### 🛠️ Internal Tools
- [[Tool - PCount]]: **Physical Count Utility** featuring a real-time WebSocket sync and high-performance caching layer.
- [[Tool - Reformat]]: **Excel/CSV Reformat Utility** allowing users to create mapping templates, import, parse, rearrange columns, and download reformatted spreadsheets.
- [[Tool - RFPU]]: **Request For Price Utility** standalone route integration.

---

### 📂 Quick Directory Links
- [Backend Source](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src)
- [Frontend Source](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/frontend/src)
- [Root package.json](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/package.json)
