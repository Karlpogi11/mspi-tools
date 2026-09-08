# Tool - Endorsements (Engineer)

Round-robin **Engineer endorsement queue** over Frontline records: daily rotation for iOS/ACCS, monthly counts for MacBook/iMac, Manila-day guard, optimistic-concurrency queue token, skip/pass/reorder, calendar counts, and ENGR availability.

Routes: `/endorsements` (queue dashboard), `/admin/engineers` (roster CRUD). Registered as "Engineer Endorsements" in the `tools` table, roles Admin/ENGR (`requireToolAccess('/endorsements')`; finer checks: endorse = super-admin/Admin/CSO, availability join/leave = ENGR, roster manage = super-admin/Admin/PMG/CSO).

---

## 🏗️ Architecture

| Piece | Module | Notes |
|-------|--------|-------|
| Frontend | `frontend/src/pages/EngineerEndorsementsPage.tsx` | Queue panel (10s poll), history (60s poll), calendar month view + manual edit, reassignment, drag reorder |
| Frontend admin | `frontend/src/pages/admin/AdminEngineersPage.tsx` | Roster name CRUD (availability managed separately) |
| Backend API | `backend/src/endorsements/routes.ts` + `queue.ts` + `assignments.ts` | Queue engine over `frontline_records` |
| Storage | `engineer_*` tables (via `frontline/store.ts` + `queue.ts`) | Roster, daily availability, endorsements (`ar_number` Unique), queue days/events, calendar entries/orders |

---

## 🔌 Backend API (`/api/endorsements`)

- Availability/queue: `POST /availability/join|leave|skip`, `POST /availability/pass-next`, `GET|PUT /availability/schedule`, `PUT /availability/order`, `POST /availability/add|remove`, `GET /available`, roster `GET|POST /roster`, `PATCH|DELETE /roster/:id`
- Endorse: `POST /preview`, `POST /` (assign next), `POST /:id/pass`, `PATCH /:id/engineer`, `PATCH /:id` (device model), `POST /:id/cancel` (5s window), `DELETE /:id`
- Views: `GET /notifications`, `GET /calendar`, `PUT /calendar-order`, `PUT|DELETE /calendar-entry`, `GET /dashboard`

Timezone: `Asia/Manila`. No new env vars.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
- [[Tool - Frontline Monitor]]
