# Tool - Consumables (Label Maker)

The **Consumables / Label Maker** tool speeds up consumables receiving: log received parts, auto-derive production and expiry dates from the **9D code**, generate printable cut-out labels, and export a clean inventory record.

Route: `/consumables` (registered as "Label Maker" in the `tools` table, roles Admin/PMS/CSO/ENGR).

---

## 🏗️ Architecture

| Piece | Module | Notes |
|-------|--------|-------|
| Frontend | `frontend/src/pages/consumables/ConsumablesPage.tsx` | Single-page UI: receiving table, master-list management, label preview, inventory export |
| Backend API | `backend/src/consumables/routes.ts` | CRUD for `consumable_master` + XLSX generation (`exceljs`) |
| Storage | `consumable_master` table (Drizzle) | Part numbers unique across the master list |

---

## 🖨️ Workflow

1. **Import a receiving file** — drag & drop anywhere on the page (or Import button). Excel/CSV rows with `Part Number`, `9D Code`, and `Qty Arrived` are accepted; a downloadable template (`GET /template`) shows the expected columns, with Production Date and Expiry Date auto-filled by Excel formulas when opened.
2. **Add / edit parts** — unknown part numbers can be added to the master list (part number + description required; category, `expires` flag, and unit default to `Other`, `Y`, `pcs`).
3. **Labels** — the page builds one label per unit from the part description and derived dates; the **Export Labels** button generates a printable XLSX (`export-labels`) laid out three per row with cut lines, sized for A4 portrait.
4. **Inventory export** — `export-inventory` produces `consumable-inventory.xlsx` (or CSV client-side) with part number, 9D code, description, date received, qty, production date, expiry date, filters, and frozen header row.

**9D code**: a 9-digit date code; the production date is derived by decoding the first 4 digits into the ISO week (year-week + week day 3), and the expiry date defaults to `production + 18 months` when the master record marks the part as expiring (`expires = 'Y'`).

---

## 🔌 Backend API (`/api/consumables`, JWT auth)

- `GET /master` — full master list ordered by part number.
- `POST /master` — add one part; `409` if the part number already exists.
- `PUT /master/:id` — update a part.
- `DELETE /master/:id` — remove a part.
- `POST /master/import` — bulk upsert (`{ items: [...] }`); returns `{ added, updated, count }`.
- `GET /template` — downloads `consumables-template.xlsx` (receiving log with live formulas).
- `POST /export-labels` — `{ labels: [{ line1, line2 }] }` → printable label sheet.
- `POST /export-inventory` — `{ rows: [...] }` → `consumable-inventory.xlsx`.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
