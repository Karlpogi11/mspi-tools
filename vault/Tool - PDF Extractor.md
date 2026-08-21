# Tool - PDF Extractor

The **PDF Extractor** ingests AWB / SG-invoice PDFs (any filename), scans them, extracts the invoice details, files each PDF by its delivery-date month, and logs every invoice into the `awb_log` MySQL table. Received date is intentionally left blank and can be filled in later by the user.

---

## 🏗️ Architecture

Fully Node/TS — no Python, no system OCR dependencies:

| Stage | Module | Tooling |
|-------|--------|---------|
| Text layer (fast path) | `backend/src/pdf-extractor/pdf.ts` | `pdfjs-dist` word bboxes + line grouping |
| Page rasterization | `backend/src/pdf-extractor/raster.ts` | `pdfjs-dist` render → `@napi-rs/canvas` PNG |
| OCR (scans) | `backend/src/pdf-extractor/ocr.ts` | `tesseract.js` WASM worker pool (word boxes + confidence) |
| Field parsing | `backend/src/pdf-extractor/parser.ts` | regex port of HAWB / SG ref / amount / date / qty extraction, month labels |
| Stepped pipeline | `backend/src/pdf-extractor/pipeline.ts` | text layer → OCR 220 → enhanced OCR 350 dpi, stops when complete |
| Filing + uploads | `backend/src/pdf-extractor/runner.ts` | multer → `backend/data/pdf-extractor/{inbox,processed,errors,permits}` |
| Log storage | `backend/src/pdf-extractor/store.ts` | drizzle inserts into `awb_log` (unique on invoice ref) |

Runtime data lives in `backend/data/pdf-extractor/` (gitignored):

- `inbox/` — dropped/uploaded files land here
- `processed/<Month YYYY>/` — successful files, renamed to the invoice reference (e.g. `SG02736563.pdf`)
- `errors/` — files with missing fields (`<ref>_MISSING_<field>.pdf`, nothing is deleted)
- `permits/` — PDFs containing the word "permit" are filed here and not logged

---

## 🚀 Two modes

### 1. Web (launcher)

Route: `/pdf-extractor` (registered in the `tools` table, roles PMS/CSO/ENGR/Admin).

- Drag & drop **or** Import button — any filename works, files are renamed automatically
- Uploads run through a **streaming batch pipeline**: files are processed in chunks and completed batches are combined into one ordered Excel download; failed files are automatically retried in smaller groups, and leftovers can be re-queued via per-row **Retry**
- Per-file result rows: Invoice Ref, HAWB, Amount, Delivery Date, Qty, Received Date (blank), filed-to folder
- **Copy** button → tab-separated text (pastes straight into Google Sheets/Excel)
- **Export Excel** button → `awb-log.xlsx` from the table on screen (Received Date column remains blank)
- AWB Log table below shows the last 500 logged rows, with its own Copy / Export buttons
- **Temporary error log** panel (admin) showing per-file extraction diagnostics, clearable

Backend endpoints (auth: shared `authenticateToken` JWT cookie):

- `POST /api/pdf-extractor/extract` — legacy multipart `files[]` (max 50 × 60 MB), returns `{ results: [{ file, status: ok|duplicate|error|permit, fields, dest }] }`
- `POST /api/pdf-extractor/extract-stream` — streaming batch processing used by the UI (returns per-batch results + a run token)
- `POST /api/pdf-extractor/finalize-run` — combines a completed run into one ordered `awb-log.xlsx` download
- `POST /api/pdf-extractor/retry/:token` — re-processes a single failed file
- `GET /api/pdf-extractor/download/:token` / `file/:token` — download / preview of generated artifacts
- `GET /api/pdf-extractor/log` — last 500 logged rows
- `GET /api/pdf-extractor/health` — service health
- `GET|DELETE /api/pdf-extractor/diagnostics` — admin temporary diagnostics list / clear

### 2. Watcher (local drop folder)

```bash
cd backend
npm run watch:pdf-extractor
```

Watches `backend/data/pdf-extractor/inbox/` with chokidar — any PDF dropped there is extracted and filed automatically (drains files already in the folder at startup). No web UI needed.

---

## 🗄️ Database

Table: `awb_log` (see `backend/src/db/schema.ts`)

| Column | Notes |
|--------|-------|
| `invoice_reference` | unique → reprocessing the same invoice updates the row instead of duplicating |
| `hawb`, `invoice_total_amount`, `delivery_date`, `total_qty` | extracted from the PDF |
| `received_date` | always blank by design |
| `original_filename`, `month_folder` | provenance + where the PDF was filed |
| `status` | `ok` |
| `created_by` | nullable FK to `users` (null for watcher mode) |
| `date_logged` | timestamp |

```bash
# after pulling (or after adding the table):
cd backend && npm run db:push
```

If the DB is unavailable the extractor still works — files are filed, inserts are skipped, and the API warns.

---

## ⚙️ Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PDF_EXTRACTOR_DATA` | `backend/data/pdf-extractor` | runtime data root |
| `PDF_PROCESS_CONCURRENCY` | `1` | PDFs processed concurrently per request; configurable from 1 to 8 |
| `OCR_WORKER_COUNT` | `1` | Tesseract WASM workers shared across OCR jobs; configurable from 1 to 4 |
| `TESSERACT_LANG` | `eng` | OCR language |
| `TESSERACT_LANG_PATH` | tesseract.js CDN | override to vendor `*.traineddata.gz` offline |

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
