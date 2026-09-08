# Tool - Storage Locator

Physical cabinet **IN/OUT tracker** for customer units by AR number: fixed IOS/Mac cabinet map, verified-employee gate, occupancy grid, and append-only movement history.

Routes: `/storage-locator` (operator UI), `/admin/storage-locator` (employee management). Registered as "Storage Locator" in the `tools` table, roles Admin/PMG/CSO/ENGR (`requireToolAccess('/storage-locator')`; employee CRUD is `requireAdmin`).

---

## 🏗️ Architecture

| Piece | Module | Notes |
|-------|--------|-------|
| Frontend | `frontend/src/pages/StorageLocatorPage.tsx` | Employee verify → AR lookup → IN (family/status/cabinet picker from `RULES`) or OUT; occupancy grid, per-unit history |
| Frontend admin | `frontend/src/pages/admin/AdminStorageLocatorPage.tsx` | Bulk paste-add employees (`EmployeeID<TAB>Full Name`), edit/activate/deactivate (soft delete) |
| Backend API | `backend/src/storage-locator/routes.ts` + `store.ts` | Transactional IN/OUT (`FOR UPDATE`; 409 on double-IN / occupied cabinet / already-OUT) |
| Storage | `ensureStorageTables()` | `storage_employees`, `storage_units` (`ar_number` Unique), `storage_movements` |

Cabinet `RULES`: IOS/RFP → 1–4, 9–12; IOS/Awaiting Parts → 5, 6, 13, 14; IOS/Awaiting Repair → 7, 8, 15, 16; Mac/Abandoned → 1–24; Mac/Awaiting Repair → 37–48; Mac/Awaiting Parts → 49–60; Mac/RFP → 73–96.

---

## 🔌 Backend API (`/api/storage-locator`)

- `GET /rules`, `GET /overview`, `GET /recent-history`, `GET /units/:arNumber`
- `POST /units/in`, `POST /units/out` (require verified active employee)
- `GET /employees/verify`
- `GET|POST /employees`, `PATCH|DELETE /employees/:id` (admin; delete = soft `active=0`)

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
