# Tool - Parts Inventory

Per-site **Apple service-parts stock IN/OUT** with serial tracking: podiums lock to their site via site code, scan serial/part/EEE to auto-fill, and every movement is mirrored as an append-only raw row to one global Google Sheet. Admins manage sites, the parts master, all-site stock, and the sheet destination.

Routes: `/parts` (podium), `/admin/parts` (admin). Registered as "Parts Inventory" in the `tools` table, roles Admin/PMG/CSO/ENGR (`requireToolAccess('/parts')`).

**Site isolation:** verify returns a signed 24h site token (HMAC of user+site); every site-scoped endpoint pins non-admin callers to that site — passing another site's code (or `ALL`) cannot escape it. Admins bypass and may use `ALL`.

---

## 🏗️ Architecture

| Piece | Module | Notes |
|-------|--------|-------|
| Frontend podium | `frontend/src/pages/PartsPage.tsx` | Full-width layout. Find tab: smart suggestions (part/description/EEE), Serials view (one row per unique serial) vs Parts view (Excel-style rows, tap a row for its serials, full-list option). Stock In/Out tabs: serial-first with realtime resolve, inline field errors |
| Dashboard gate | `frontend/src/pages/DashboardPage.tsx` | Same flow as Storage Locator: clicking the tool opens a site-code modal on the dashboard; the tool only opens after verification (`navigate('/parts', { state: { site } })`) |
| Frontend admin | `frontend/src/pages/admin/AdminPartsPage.tsx` | All-site stock (site filter + search), site CRUD, master search/CRUD + file import, sheet connect/ID/sheet-picker/retry |
| Parsers | `frontend/src/lib/parts.ts` | `parseStockInWorkbook` (Date, Part Number, Serial), `parseStockOutWorkbook` (Date, Serial, Reference, Part Number), `parsePartsMasterWorkbook` (Part Number, Description, EEE, Substitute, Serialized) |
| Backend API | `backend/src/parts/routes.ts` | Sites, master, resolve/lookup/stock, single + bulk IN/OUT (transactional), templates, sheet OAuth/config/append |
| EEE decode | `backend/src/parts/eee.ts` | `eee_code` holds `;`-separated codes; Apple serials CONTAIN the EEE (e.g. `…20J9BP` → `20J9`). `resolveBySerial()` longest-match with cached index; stock-in derives the part from a bare serial |
| Sheet log | `backend/src/parts/sheets.ts` | Per-module Google OAuth (AES-256-GCM refresh tokens) + `values:append`; failures never block IN/OUT (`sheet_synced` flag + retry) |
| Storage | `ensurePartsTables()` | `parts_sites`, `parts_master`, `parts_units`, `parts_movements`, `parts_sheet_config`, `parts_sheet_connections` |

---

## 🔌 Backend API (`/api/parts`)

- Sites: `GET /sites/verify?code=`, `GET /sites`, `POST /sites` (admin), `PATCH|DELETE /sites/:id` (admin)
- Master: `GET /master?q=`, `POST /master` (admin), `PUT|DELETE /master/:id` (admin), `POST /master/import` (admin, upsert ≤500/chunk)
- Flow: `GET /resolve?serial=&partNumber=&eee=&siteCode=`, `GET /lookup?serial=&siteCode=`, `GET /stock?siteCode=&q=`, `GET /recent?siteCode=`
- `POST /stock/in` {siteCode, partNumber (or eee), serial?, quantity?, occurredDate?} — unknown serial needs a known part; non-serialized parts take quantity, no serial
- `POST /stock/out` {siteCode, serial?, partNumber?, quantity?, reference **required**, occurredDate?} — unknown/already-out/cross-site serials rejected with 404/409/403
- `POST /import/in` rows {date, partNumber, serial} · `POST /import/out` rows {date, serial, reference, partNumber} — ≤1000 rows, partial success with per-row errors
- Templates: `GET /template/in`, `GET /template/out` (exceljs)
- Sheet: `GET /sheets/status`, `GET /sheets/connect` (admin), `GET /sheets/callback`, `DELETE /sheets/disconnect` (admin), `GET /sheets/config`, `POST /sheets/config` (admin), `GET /sheets/list` (admin), `POST /sheets/retry` (admin, ≤200 rows)

Sheet row columns: Timestamp, Site Code, Site Name, Type, Date, Part Number, Description, Serial, Reference, Quantity, Actor.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
- [[Tool - Storage Locator]]
- [[Tool - Frontline Monitor]]
