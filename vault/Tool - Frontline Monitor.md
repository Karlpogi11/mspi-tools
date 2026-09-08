# Tool - Frontline Monitor

Google-Sheets-backed **CSO frontline activity** monitor: synced transaction report (AHT/trends/exceptions), write-back data entry, Epson AR-label printing, and per-user access gating.

Routes: `/frontline` (report viewer), `/frontline/data-entry` (write-back form), `/admin/frontline` (source/printer/options/access). Registered as "Frontline Monitor" in the `tools` table, role Admin (record-level access via `frontline_user_access`: `all` or `cso=<name>`).

---

## 🏗️ Architecture

| Piece | Module | Notes |
|-------|--------|-------|
| Frontend report | `frontend/src/pages/FrontlinePage.tsx` | Filters (date/AR/CSO/type/division), cached report, sync-now, ePOS print preview |
| Frontend entry | `frontend/src/pages/FrontlineDataEntryPage.tsx` | Dynamic form from `GET /write-schema`, auto-AHT, AR/serial lookup, serial history |
| Frontend admin | `frontend/src/pages/admin/AdminFrontlinePage.tsx` | Spreadsheet source, Google connect, printer IP/port, option lists, access approvals |
| Backend API | `backend/src/frontline/routes.ts` | Mounted directly at `/api/frontline` in `backend/src/index.ts` |
| Storage | `ensureFrontlineTables()` | `frontline_*` sources/records/writes/options/printer/access tables |

---

## 🔌 Backend API (`/api/frontline`)

- Google OAuth (admin): `GET /google/connect`, `GET /google/callback`, `GET /google/status`, `DELETE /google/disconnect`
- Access/report: `GET /access`, `POST /access-request`, `GET /source`, `GET /status`, `GET /report`, `POST /sync` (strict rate limit: 20 req / 15 min), `POST /source`, `GET /spreadsheets/:id/sheets`
- Options: `GET /options`, `POST /options`, `PATCH /options/:id` (admin)
- Write-back: `GET /write-schema`, `POST /write-entry`, `GET /lookup`, `GET /entry-check`, `GET /serial-history`, `GET /device-models`
- Printer: `GET /printer`, `PUT /printer` (admin), `POST /printer/test`, `POST /printer/print`

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHEETS_REDIRECT_URI`, `FRONTEND_URL`.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
- [[Tool - Endorsements]]
