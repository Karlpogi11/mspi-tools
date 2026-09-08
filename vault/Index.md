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
- [[Tool - PDF Extractor]]: **AWB/Invoice PDF Extractor** — text-layer + OCR pipeline that files PDFs by month and logs every invoice.
- [[Tool - Consumables]]: **Label Maker** — log received consumables, derive production/expiry from the 9D code, and print labels.
- [[Tool - AppleCare]]: **AppleCare Packing Lists** — Gmail-synced packing-list inbox with parsed line items and site mapping.
- [[Tool - Frontline Monitor]]: **Frontline Monitor** — Google-Sheets-backed CSO activity reporting, data entry write-back, and label printing.
- [[Tool - Endorsements]]: **Engineer Endorsements** — round-robin endorsement queue over Frontline records with calendar management.
- [[Tool - Storage Locator]]: **Storage Locator** — cabinet IN/OUT tracking for customer units with verified employee history.
- [[Tool - Parts Inventory]]: **Parts Inventory** — per-site Apple parts stock IN/OUT with serial tracking and a shared Google Sheet log.

### 🧩 Browser Extensions
- [[Tool - Work Permit Extension]]: Standalone Chrome extension for approved personal-email users.

---

### 📂 Quick Directory Links
- [Backend Source](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src)
- [Frontend Source](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/frontend/src)
- [Root package.json](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/package.json)
