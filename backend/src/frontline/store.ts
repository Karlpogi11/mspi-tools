import { getDbPool } from '../db/index.js';

export async function ensureFrontlineTables(): Promise<void> {
  const pool = getDbPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_google_connections (
    id int AUTO_INCREMENT NOT NULL,
    user_id int NOT NULL,
    google_email varchar(255) NOT NULL,
    refresh_token_encrypted text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_google_user_unique (user_id),
    CONSTRAINT frontline_google_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_sources (
    id int AUTO_INCREMENT NOT NULL,
    spreadsheet_id varchar(255) NOT NULL,
    spreadsheet_name varchar(255) NOT NULL,
    selected_sheets text NOT NULL,
    updated_by int NULL,
    last_synced_at timestamp NULL,
    last_sync_status varchar(20) NOT NULL DEFAULT 'never',
    last_sync_error varchar(500) NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_source_spreadsheet_unique (spreadsheet_id),
    CONSTRAINT frontline_source_user_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_records (
    id bigint AUTO_INCREMENT NOT NULL,
    source_id int NOT NULL,
    source_sheet varchar(255) NOT NULL,
    source_row int NOT NULL,
    occurred_date date NULL,
    start_time varchar(40) NULL,
    end_time varchar(40) NULL,
    aht_minutes decimal(10,2) NULL,
    transaction_type varchar(150) NOT NULL DEFAULT '',
    channel varchar(80) NOT NULL DEFAULT '',
    product_division varchar(100) NOT NULL DEFAULT '',
    ar_number varchar(100) NOT NULL DEFAULT '',
    serial_number varchar(150) NOT NULL DEFAULT '',
    cso varchar(150) NOT NULL DEFAULT '',
    issue varchar(1000) NOT NULL DEFAULT '',
    outcome varchar(150) NOT NULL DEFAULT '',
    raw_json text NULL,
    imported_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_record_source_row_unique (source_id, source_sheet, source_row),
    KEY frontline_record_date_idx (occurred_date), KEY frontline_record_cso_idx (cso),
    CONSTRAINT frontline_record_source_fk FOREIGN KEY (source_id) REFERENCES frontline_sources(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_access_requests (
    id int AUTO_INCREMENT NOT NULL,
    user_id int NOT NULL,
    reason varchar(1000) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by int NULL,
    reviewed_at timestamp NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_access_user_unique (user_id),
    CONSTRAINT frontline_access_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT frontline_access_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_user_access (
    user_id int NOT NULL,
    access_scope varchar(20) NOT NULL DEFAULT 'cso',
    cso_name varchar(150) NULL,
    granted_by int NULL,
    granted_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT frontline_user_access_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT frontline_user_access_grantor_fk FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
}
