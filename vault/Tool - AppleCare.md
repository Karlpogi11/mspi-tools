# Tool - AppleCare (Packing Lists)

Gmail-synced **AppleCare Packing List** inbox: connect Gmail, auto-collect packing-list emails with attachments, parse ShipTo/date/time, map ShipTo → site, and store lists + line items.

Route: `/applecare` (registered as "AppleCare Packing Lists" in the `tools` table, roles Admin/PMG).

---

## 🏗️ Architecture

| Piece | Module | Notes |
|-------|--------|-------|
| Frontend | `frontend/src/pages/ApplecarePage.tsx` | Inbox UI: Gmail connect/sync, filter lists, list detail, attachment download; admin-only site mapping |
| Backend API | `backend/src/applecare/routes.ts` | Gmail OAuth + sync + lists + sites (all behind `authenticateToken`) |
| Storage | `applecare_*` tables via `ensureApplecareTables()` | `gmail_connections`, `sites`, `packing_lists`, `packing_list_items` |
| Attachments | `APPLECARE_DATA_DIR` (default `<cwd>/data/applecare`) | Downloaded PDF/XLS payloads |

---

## 🔌 Backend API (`/api/applecare`, per-tool `requireToolAccess`)

- `GET /gmail/connect`, `GET /gmail/callback` — per-user Gmail OAuth (refresh token AES-256-GCM encrypted with `JWT_SECRET` hash)
- `GET /status`, `DELETE /gmail/disconnect`
- `POST /sync` — pull new messages, parse subject, upsert list + items
- `GET /lists`, `GET /lists/:id`, `GET /lists/:id/attachment`
- `GET /sites`, `POST /sites` (`requireAdmin`), `PUT /sites/:id` (`requireAdmin`)

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
