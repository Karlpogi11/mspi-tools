# Database Schema

The system uses **MySQL** as its single shared database database engine. Schema definitions and queries are managed using **Drizzle ORM** (defined in [backend/src/db/schema.ts](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/db/schema.ts)).

---

## 📊 Database Entity Relationship Diagram

```mermaid
erDiagram
    roles ||--o{ users : "role_id"
    roles ||--o{ role_tool_access : "role_id"
    tools ||--o{ role_tool_access : "tool_id"
    
    users ||--o{ pcount_sessions : "created_by / submitted_by"
    pcount_sessions ||--o{ pcount_session_members : "session_id"
    users ||--o{ pcount_session_members : "user_id"
    
    pcount_sessions ||--o{ pcount_display_columns : "session_id"
    pcount_sessions ||--o{ pcount_products : "session_id"
    pcount_products ||--o{ pcount_product_extra : "product_id"
    
    users ||--o{ reformat_templates : "created_by"
    reformat_templates ||--o{ reformat_template_shares : "template_id"
    users ||--o{ reformat_template_shares : "user_id"

    users ||--o{ consumable_master : "created_by"

    users ||--o{ awb_log : "created_by"

    users ||--o{ applecare_gmail_connections : "user_id"
    users ||--o{ applecare_sites : "created_by"
    applecare_sites ||--o{ applecare_packing_lists : "site_id"
    applecare_packing_lists ||--o{ applecare_packing_list_items : "packing_list_id"

    users ||--o{ storage_employees : "created_by"
    storage_employees ||--o{ storage_units : "current_employee_id"
    storage_units ||--o{ storage_movements : "unit_id"
    storage_employees ||--o{ storage_movements : "employee_id"

    parts_sites ||--o{ parts_units : "site_id"
    parts_sites ||--o{ parts_movements : "site_id"

    users ||--o{ audit_log : "actor_user_id"
```

---

## 🗄️ Tables Specifications

### 🛡️ Core Authorization & Tools Dashboard

#### `roles`
Stores the access levels (e.g. `'Admin'`, `'Operator'`, etc.).
- `id` (`int`, PK, Auto-increment)
- `name` (`varchar(50)`, Unique, Not Null)

#### `users`
Registered user accounts.
- `id` (`int`, PK, Auto-increment)
- `email` (`varchar(255)`, Unique, Not Null)
- `password_hash` (`varchar(255)`, Not Null)
- `full_name` (`varchar(255)`, Not Null)
- `role_id` (`int`, Foreign Key -> `roles.id`, Nullable, `ON DELETE SET NULL`)
- `is_super_admin` (`int`, Default `0`) — bypasses per-tool access checks
- `token_version` (`int`, Default `0`) — bumped on password change/reset to revoke JWTs
- `created_at` (`timestamp`, default current time)

#### `tools`
Available tools that can show up dynamically on the launcher page.
- `id` (`int`, PK, Auto-increment)
- `name` (`varchar(100)`, Not Null)
- `url` (`varchar(500)`, Not Null)
- `icon` (`varchar(50)`, Not Null) — FontAwesome icon name
- `description` (`varchar(500)`, Not Null)

#### `role_tool_access`
Many-to-many relationship mapping which roles can launch which tools.
- `role_id` (`int`, FK -> `roles.id`, Not Null, `ON DELETE CASCADE`)
- `tool_id` (`int`, FK -> `tools.id`, Not Null, `ON DELETE CASCADE`)
- **PK**: `(role_id, tool_id)`

---

### 📦 Physical Count (`pcount`)

#### `pcount_sessions`
Active or submitted inventory counting events.
- `id` (`int`, PK, Auto-increment)
- `name` (`varchar(255)`, Not Null)
- `status` (`varchar(20)`, Default `'active'`, Not Null)
- `sort_desc` (`int`, Default `1`) — Toggle sort order direction
- `created_by` (`int`, FK -> `users.id`, `ON DELETE SET NULL`)
- `join_code` (`varchar(4)`, Unique) — 4-digit code scanners use to join session
- `submitted_at` (`timestamp`, Nullable)
- `submitted_by` (`int`, FK -> `users.id`, `ON DELETE SET NULL`)
- `created_at` / `updated_at` (`timestamp`)

#### `pcount_session_members`
Active scan operators allowed to participate in a counting session.
- `session_id` (`int`, FK -> `pcount_sessions.id`, `ON DELETE CASCADE`)
- `user_id` (`int`, FK -> `users.id`, `ON DELETE CASCADE`)
- `joined_at` (`timestamp`)
- **PK**: `(session_id, user_id)`

#### `pcount_display_columns`
Custom configuration columns imported for a session.
- `id` (`int`, PK, Auto-increment)
- `session_id` (`int`, FK -> `pcount_sessions.id`, `ON DELETE CASCADE`)
- `column_name` (`varchar(255)`, Not Null)

#### `pcount_products`
The products list imported from standard sheet files to be counted.
- `id` (`int`, PK, Auto-increment)
- `session_id` (`int`, FK -> `pcount_sessions.id`, `ON DELETE CASCADE`)
- `product_code` (`varchar(255)`, Not Null)
- `description` (`varchar(500)`)
- `category` (`varchar(20)`)
- `system_qty` (`int`, Default `0`)
- `counted_qty` (`int`, Default `0`)
- `adjusted_qty` (`int`, Nullable) — Admin correction
- `status` (`varchar(20)`, Default `'pending'`) — e.g. `'pending'`, `'counted'`, `'flagged'`
- `notes` (`text`)
- **Index**: `pcount_products_session_code_idx` on `(session_id, product_code)` for rapid scanning queries.

#### `pcount_product_extra`
Stores arbitrary spreadsheet columns (in key-value mapping) that are not natively supported in the main schema.
- `id` (`int`, PK, Auto-increment)
- `product_id` (`int`, FK -> `pcount_products.id`, `ON DELETE CASCADE`)
- `column_name` (`varchar(255)`, Not Null)
- `column_value` (`text`)

---

### 📋 Reformat Tool (`reformat`)

#### `reformat_templates`
Custom reformatting templates defined by users.
- `id` (`int`, PK, Auto-increment)
- `name` (`varchar(255)`, Not Null)
- `header_row` (`int`, Default `1`)
- `columns` (`text`) — JSON string defining layout mappings
- `removed_columns` (`text`) — JSON list of strings
- `created_by` (`int`, FK -> `users.id`, `ON DELETE CASCADE`)
- `created_at` / `updated_at` (`timestamp`)

#### `reformat_template_shares`
Mappings for template sharing among team members.
- `template_id` (`int`, FK -> `reformat_templates.id`, `ON DELETE CASCADE`)
- `user_id` (`int`, FK -> `users.id`, `ON DELETE CASCADE`)
- `shared_at` (`timestamp`)
- **PK**: `(template_id, user_id)`

---

### 🏷️ Consumables / Label Maker (`consumables`)

#### `consumable_master`
Master list of consumable parts used by the Label Maker.
- `id` (`int`, PK, Auto-increment)
- `part_number` (`varchar(100)`, Not Null, **Unique**) — upsert key for bulk imports
- `description` (`varchar(255)`, Not Null)
- `category` (`varchar(100)`, Default `'Other'`)
- `expires` (`varchar(1)`, Default `'Y'`) — whether the part has an expiry (drives 9D-code expiry derivation)
- `unit` (`varchar(20)`, Default `'pcs'`)
- `created_by` (`int`, FK -> `users.id`, `ON DELETE SET NULL`)
- `created_at` / `updated_at` (`timestamp`)

---

### 📄 PDF Extractor (`awb_log`)

#### `awb_log`
One row per extracted invoice; unique on the invoice reference so re-processing updates instead of duplicating.
- `id` (`int`, PK, Auto-increment)
- `invoice_reference` (`varchar(20)`, Not Null, **Unique**)
- `hawb`, `invoice_total_amount`, `delivery_date`, `total_qty`, `received_date` (`varchar`, default empty — received date left blank by design)
- `original_filename`, `month_folder` — provenance + filed-to folder
- `status` (`varchar(20)`, Default `'ok'`) — `ok` / `duplicate` / `error` / `permit`
- `created_by` (`int`, FK -> `users.id`, `ON DELETE SET NULL`)
- `date_logged` (`timestamp`)

---

### 🧾 AppleCare packing lists (`applecare`)

#### `applecare_gmail_connections`
Per-user Gmail OAuth link (refresh token AES-256-GCM encrypted with `JWT_SECRET` hash).
- `user_id` (`int`, Unique, FK -> `users.id`, `ON DELETE CASCADE`)
- `gmail_email`, `refresh_token_encrypted` (`text`), `last_synced_at`

#### `applecare_sites`
ShipTo → site name mapping (admin-managed).
- `ship_to` (`varchar(30)`, Unique), `site_name`, `active`, `created_by` (FK -> `users.id`, `SET NULL`)

#### `applecare_packing_lists`
One row per Gmail message; unique on `gmail_message_id`.
- `gmail_message_id` (Unique), `gmail_thread_id`, `subject`, `sender`, `received_by`
- `ship_to`, `site_id` (FK -> `applecare_sites.id`, `SET NULL`), `packing_date`, `packing_time`, `received_at`
- `attachment_name`, `attachment_path`, `status` (Default `'incoming'`), `raw_text`

#### `applecare_packing_list_items`
Line items per packing list.
- `packing_list_id` (FK -> `applecare_packing_lists.id`, `CASCADE`), `part_number`, `description`, `po_no`, `serial_number`, `quantity`

---

### 🗄️ Storage Locator (`storage_*`)

#### `storage_employees`
Verified employees allowed to perform IN/OUT.
- `employee_number` (Unique), `full_name`, `active`, `created_by` (FK -> `users.id`, `SET NULL`)

#### `storage_units`
One row per AR number; unique on `ar_number`.
- `ar_number` (Unique), `family` (`IOS`/`Mac`), `status`, `cabinet_number`, `state` (`in`/`out`), `current_employee_id` (FK -> `storage_employees.id`, `SET NULL`), `checked_in_at` / `checked_out_at`

#### `storage_movements`
Append-only IN/OUT history.
- `unit_id` (FK -> `storage_units.id`, `CASCADE`), `employee_id` (FK -> `storage_employees.id`, `RESTRICT`), `action` (`IN`/`OUT`), `family`, `status`, `cabinet_number`, `occurred_at`

---

### 📊 Frontline / Endorsements (owned by `backend/src/frontline/store.ts`)

Created at startup via `ensureFrontlineTables()` (not in `schema.ts`):
- `frontline_google_connections`, `frontline_sources` (`spreadsheet_id` Unique), `frontline_sheet_writes` (`dedupe_fingerprint` Unique), `frontline_records` (Unique on source/sheet/row)
- `frontline_option_lists`, `frontline_device_models`, `frontline_printer_settings`
- `frontline_access_requests`, `frontline_user_access` (`user_id` PK, `access_scope` = `all`/`cso`)
- `engineer_roster`, `engineer_daily_availability`, `engineer_endorsements` (`ar_number` Unique), `engineer_queue_days`, `engineer_queue_events`, `engineer_calendar_entries`, `engineer_calendar_orders`, roster/availability schedules

---

### 🧩 Parts Inventory (`parts_*`)

Created at startup via `ensurePartsTables()` (`backend/src/parts/store.ts`):

#### `parts_sites`
Service centers. Podiums lock to one via `code`.
- `code` (Unique), `name`, `active`, `created_by` (FK -> `users.id`, `SET NULL`)

#### `parts_master`
Part catalog imported from the master file.
- `part_number` (Unique), `description`, `eee_code` (indexed), `substitute_part`, `serialized` (`Y`/`N`, Default `'Y'`)

#### `parts_units`
Current stock state. One row per serial (globally unique, nullable for qty balances).
- `site_id` (FK -> `parts_sites.id`, `CASCADE`), `part_number`, `serial` (Unique, nullable), `quantity`, `status` (`in`/`out`), `reference`, `occurred_date`, `stocked_in/out_at`

#### `parts_movements`
Append-only IN/OUT ledger; every row is mirrored to the Google Sheet.
- `site_id` (FK -> `parts_sites.id`, `CASCADE`), `part_number`, `serial` (nullable), `type` (`IN`/`OUT`), `occurred_date`, `reference`, `quantity`, `actor_user_id`, `sheet_synced`

#### `parts_sheet_config` / `parts_sheet_connections`
Single-row sheet destination (`spreadsheet_id`, `sheet_name`) + per-user Google OAuth refresh tokens (AES-256-GCM).

---

### 📝 Audit

#### `audit_log`
Append-only admin/audit trail.
- `actor_user_id` (FK -> `users.id`, `SET NULL`), `action`, `resource_type`, `resource_id`, `metadata` (`text`), `created_at`

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Authentication & SSO]]
- [[Tool - Consumables]]
- [[Tool - PDF Extractor]]
- [[Tool - AppleCare]]
- [[Tool - Frontline Monitor]]
- [[Tool - Endorsements]]
- [[Tool - Storage Locator]]
- [[Tool - Parts Inventory]]
