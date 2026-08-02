# Tool - Reformat

The **Reformat** utility enables operators to define column mapping rules (templates) and apply them to raw spreadsheets (CSV/Excel files) to standardise data formats for ingestion by other downstream systems.

---

## 🏗️ Core Concept: Column Mappings

A reformatting template dictates how columns in a destination spreadsheet should be populated from an input file.

Each destination column is represented as a `ColumnDef` structure:
```typescript
interface ColumnDef {
  name: string;      // The output column header name
  source: string;    // The source column header name (if mapped)
  constant: string;  // A fixed value to fill in (if source is empty)
}
```

### Mapping Mechanisms
1. **Dynamic Mapping**: If `source` is specified, the processor maps the value of the corresponding header in each input row to the destination column.
2. **Static Mapping**: If `constant` is specified, every row in the output spreadsheet gets the exact fixed value (e.g. mapping a store code or default status).

---

## 👥 Template Ownership & Sharing

Templates are private to their creators by default, but can be shared across operators for consistency.

- **Owned Templates**: Stored in `reformat_templates`, where `created_by` equals the logged-in user.
- **Shared Templates**: Accessible via a join query on the `reformat_template_shares` table. The backend fetches both owned and shared lists so users can load any template they have permissions to view.

---

## 📡 REST API Endpoints

All endpoints are mounted on `/api/reformat` (after `authenticateToken` verification):

- **`GET /templates`**: Retrieves lists of templates owned by the user and templates shared with the user.
- **`POST /templates`**: Creates a new template. Expects `{ name, header_row, columns, removed_columns }` in body.
- **`PUT /templates/:id`**: Updates an existing template (only allowed for template owner).
- **`DELETE /templates/:id`**: Deletes a template. Cascades deletion of all share mappings.
- **`POST /templates/:id/share`**: Shares template with another user by email. Checks if user exists, and inserts record in `reformat_template_shares`.
- **`DELETE /templates/:id/share/:userId`**: Revokes sharing permissions for a specific user.

---

## 💾 Copying & Downloading

The output results (after arrange mapping) can be copied to the clipboard or downloaded as Excel (.xlsx) or CSV (.csv) files via the action buttons on the top-right of the result panel:
- **Copy Raw Data**: Copies the results to the clipboard as tab-separated values.
- **Export**: Generates spreadsheet file downloads.

### Active View Filtering & State Logic
The copying and downloading mechanisms always match the active view rendered in the result UI:
- **Standard View**: If the standard grid view is showing, the copy/download output contains the filtered and sorted rows (`sortedRows.map((f) => f.row)`) and mapped headers (`outputNames`), excluding any removed/hidden columns.
- **Pivot Table View**: If the Pivot configuration is active and holds aggregate values (`pivotActive` is true), the copy/download output contains the aggregated pivot data columns and rows (`pivotResult.headers` and `pivotResult.rows`), including calculated sub-totals and Grand Total.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]
