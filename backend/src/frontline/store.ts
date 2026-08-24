import { getDbPool } from '../db/index.js';

let frontlineTablesReady: Promise<void> | null = null;

async function initializeFrontlineTables(): Promise<void> {
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
  try { await pool.query("ALTER TABLE frontline_records ADD COLUMN device_model varchar(150) NOT NULL DEFAULT '' AFTER serial_number"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
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
  await pool.query(`CREATE TABLE IF NOT EXISTS engineer_daily_availability (
    id bigint AUTO_INCREMENT NOT NULL,
    user_id int NULL,
    engineer_name varchar(150) NOT NULL,
    availability_date date NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    joined_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at timestamp NULL,
    assignment_count int NOT NULL DEFAULT 0,
    last_assigned_at timestamp NULL,
    PRIMARY KEY (id), UNIQUE KEY engineer_availability_day_name_unique (engineer_name, availability_date),
    KEY engineer_availability_active_idx (availability_date, status, assignment_count, last_assigned_at),
    CONSTRAINT engineer_availability_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS engineer_endorsements (
    id bigint AUTO_INCREMENT NOT NULL,
    ar_number varchar(100) NOT NULL,
    frontline_record_id bigint NULL,
    cso_user_id int NOT NULL,
    engineer_user_id int NULL,
    engineer_name varchar(150) NOT NULL,
    device_model varchar(150) NOT NULL DEFAULT '',
    issue varchar(1000) NOT NULL DEFAULT '',
    product_division varchar(100) NOT NULL DEFAULT '',
    status varchar(30) NOT NULL DEFAULT 'endorsed',
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY engineer_endorsement_ar_unique (ar_number),
    KEY engineer_endorsement_engineer_idx (engineer_user_id, status, created_at),
    KEY engineer_endorsement_cso_idx (cso_user_id, created_at),
    CONSTRAINT engineer_endorsement_record_fk FOREIGN KEY (frontline_record_id) REFERENCES frontline_records(id) ON DELETE SET NULL,
    CONSTRAINT engineer_endorsement_cso_fk FOREIGN KEY (cso_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT engineer_endorsement_engineer_fk FOREIGN KEY (engineer_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  try { await pool.query("ALTER TABLE engineer_daily_availability MODIFY COLUMN user_id int NULL"); } catch (error) { if (!String((error as Error).message).includes('Duplicate')) throw error; }
  try { await pool.query("ALTER TABLE engineer_daily_availability ADD COLUMN engineer_name varchar(150) NULL AFTER user_id"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  await pool.query("UPDATE engineer_daily_availability a LEFT JOIN users u ON u.id = a.user_id SET a.engineer_name = COALESCE(NULLIF(a.engineer_name, ''), u.full_name, CONCAT('Engineer ', a.id)) WHERE a.engineer_name IS NULL OR a.engineer_name = ''");
  await pool.query("ALTER TABLE engineer_daily_availability MODIFY COLUMN engineer_name varchar(150) NOT NULL");
  try { await pool.query("ALTER TABLE engineer_daily_availability ADD KEY engineer_availability_user_idx (user_id)"); } catch (error) { if (!String((error as Error).message).includes('Duplicate key name')) throw error; }
  try { await pool.query("ALTER TABLE engineer_daily_availability DROP INDEX engineer_availability_day_unique"); } catch (error) { const message = String((error as Error).message); if (!message.includes('check that column/key exists') && !message.includes('check that it exists')) throw error; }
  try { await pool.query("ALTER TABLE engineer_daily_availability ADD UNIQUE KEY engineer_availability_day_name_unique (engineer_name, availability_date)"); } catch (error) { if (!String((error as Error).message).includes('Duplicate key name')) throw error; }
  try { await pool.query("ALTER TABLE engineer_endorsements MODIFY COLUMN engineer_user_id int NULL"); } catch (error) { if (!String((error as Error).message).includes('Duplicate')) throw error; }
  try { await pool.query("ALTER TABLE engineer_endorsements ADD COLUMN engineer_name varchar(150) NULL AFTER engineer_user_id"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  await pool.query("UPDATE engineer_endorsements e LEFT JOIN engineer_daily_availability a ON a.user_id = e.engineer_user_id SET e.engineer_name = COALESCE(NULLIF(e.engineer_name, ''), a.engineer_name, CONCAT('Engineer ', e.engineer_user_id)) WHERE e.engineer_name IS NULL OR e.engineer_name = ''");
  await pool.query("ALTER TABLE engineer_endorsements MODIFY COLUMN engineer_name varchar(150) NOT NULL");
}

export function ensureFrontlineTables(): Promise<void> {
  if (!frontlineTablesReady) {
    frontlineTablesReady = initializeFrontlineTables().catch((error) => {
      frontlineTablesReady = null;
      throw error;
    });
  }
  return frontlineTablesReady;
}
