import { getDbPool } from '../db/index.js';

let frontlineTablesReady: Promise<void> | null = null;
const APPLE_DEVICE_MODELS = [
  'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone Air', 'iPhone 17', 'iPhone 17e', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16e',
  'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 15', 'iPhone 15 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 13 mini', 'iPhone 13', 'iPhone SE (3rd generation)', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 12 mini', 'iPhone 12', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone 11', 'iPhone SE (2nd generation)', 'iPhone XS', 'iPhone XS Max', 'iPhone XR', 'iPhone X', 'iPhone 8', 'iPhone 8 Plus', 'iPhone 7', 'iPhone 7 Plus',
  'iPad Pro 13-inch (M5)', 'iPad Pro 11-inch (M5)', 'iPad Air 13-inch (M4)', 'iPad Air 11-inch (M4)', 'iPad (A16)', 'iPad mini (A17 Pro)', 'iPad Pro 13-inch (M4)', 'iPad Pro 12.9-inch (6th generation)', 'iPad Pro 12.9-inch (5th generation)', 'iPad Pro 12.9-inch (4th generation)', 'iPad Pro 12.9-inch (3rd generation)', 'iPad Pro 12.9-inch (2nd generation)', 'iPad Pro 12.9-inch (1st generation)', 'iPad Pro 11-inch (4th generation)', 'iPad Pro 11-inch (3rd generation)', 'iPad Pro 11-inch (2nd generation)', 'iPad Pro 11-inch (1st generation)', 'iPad Air (5th generation)', 'iPad Air (4th generation)', 'iPad Air (3rd generation)', 'iPad Air 2', 'iPad (10th generation)', 'iPad (9th generation)', 'iPad (8th generation)', 'iPad (7th generation)',
  'MacBook Neo', 'MacBook Air 13-inch (M4)', 'MacBook Air 15-inch (M4)', 'MacBook Air 13-inch (M3)', 'MacBook Air 15-inch (M3)', 'MacBook Air 13-inch (M2)', 'MacBook Air 15-inch (M2)', 'MacBook Air (M1, 2020)', 'MacBook Pro 14-inch (M5)', 'MacBook Pro 16-inch (M4 Max)', 'MacBook Pro 16-inch (M4 Pro)', 'MacBook Pro 14-inch (M4 Pro)', 'MacBook Pro 14-inch (M4)', 'MacBook Pro 16-inch (M3 Max)', 'MacBook Pro 16-inch (M3 Pro)', 'MacBook Pro 14-inch (M3 Pro)', 'MacBook Pro 14-inch (M3)', 'MacBook Pro 16-inch (M2 Max)', 'MacBook Pro 16-inch (M2 Pro)', 'MacBook Pro 14-inch (M2 Pro)', 'MacBook Pro 14-inch (M2)', 'MacBook Pro 16-inch (M1 Max)', 'MacBook Pro 16-inch (M1 Pro)', 'MacBook Pro 14-inch (M1 Pro)', 'MacBook Pro 14-inch (M1)', 'MacBook Pro 13-inch (M2)', 'MacBook Pro 13-inch (M1)',
  'iMac 24-inch (M4)', 'iMac 24-inch (M3)', 'iMac 24-inch (M1, 2021)', 'iMac 27-inch (Intel, 2020)', 'iMac 27-inch (Intel, 2019)', 'iMac Pro (2017)',
  'Apple Watch Series 11', 'Apple Watch SE 3', 'Apple Watch Ultra 3', 'Apple Watch SE 2', 'Apple Watch Series 10', 'Apple Watch Ultra 2', 'Apple Watch Series 9', 'Apple Watch Ultra', 'Apple Watch Series 8', 'Apple Watch Series 7', 'Apple Watch Series 6', 'Apple Watch SE', 'Apple Watch Series 5', 'Apple Watch Series 4', 'Apple Watch Series 3', 'Apple Watch Series 2', 'Apple Watch Series 1',
];

export const FRONTLINE_OPTION_KEYS = ['product_division', 'transaction_type', 'cso'] as const;
export type FrontlineOptionKey = typeof FRONTLINE_OPTION_KEYS[number];

export const FRONTLINE_DEFAULT_OPTIONS: Record<FrontlineOptionKey, string[]> = {
  product_division: [
    'DESKTOP', 'PORTABLE', 'MAC ACCS', 'SHUFFLE', 'IPHONE', 'IPAD', 'IPOD', 'IPHONE ACCS', 'IPAD ACCS', 'IPOD ACCS',
    'BEATS', 'WATCH', 'WATCH ACCS', 'APPLE ID', 'ITUNES', 'ICLOUD', 'BACKUP', 'IMESSAGE',
  ],
  transaction_type: [
    'RECEIVED (APPOINTMENT)', 'RECEIVED (WALK-IN)', 'RELEASED: SAF L1 (APPOINTMENT)', 'RELEASED: SAF L1 (WALK-IN)',
    'RELEASED: REPLACED', 'RELEASED: REPAIRED', 'RELEASED: NRS', 'RELEASED: NTF', 'RELEASED: PULL OUT', 'RELEASED: IFS',
    'PAYMENT CONCERNS', 'STATUS UPDATE', 'SERVICE INQUIRY (APPOINTMENT)', 'SERVICE INQUIRY (WALK-IN)',
    'TECHNICAL ASSISTANCE (APPOINTMENT)', 'TECHNICAL ASSISTANCE (WALK-IN)', 'JOB ORDER (APPOINTMENT)',
    'JOB ORDER (WALK-IN)', 'COMPLAINT', 'RE-DIAGNOSIS',
  ],
  cso: ['Albert Santos', 'Bernard Dugay', 'John Ray Ablaza', 'Learn Amper', 'Pat San Andres', 'Pia Silvano'],
};

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
  await pool.query(`CREATE TABLE IF NOT EXISTS engineer_calendar_entries (
    id bigint AUTO_INCREMENT NOT NULL,
    entry_date date NOT NULL,
    product_division varchar(100) NOT NULL,
    engineer_name varchar(150) NOT NULL,
    entry_count int NOT NULL,
    details varchar(1000) NOT NULL DEFAULT '',
    created_by int NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY engineer_calendar_entry_unique (entry_date, product_division, engineer_name),
    KEY engineer_calendar_entry_date_idx (entry_date),
    CONSTRAINT engineer_calendar_entry_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS engineer_calendar_orders (
    id bigint AUTO_INCREMENT NOT NULL,
    order_month char(7) NOT NULL,
    product_division varchar(30) NOT NULL,
    engineer_name varchar(150) NOT NULL,
    sort_order int NOT NULL,
    created_by int NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY engineer_calendar_order_unique (order_month, product_division, engineer_name),
    KEY engineer_calendar_order_month_idx (order_month, product_division, sort_order),
    CONSTRAINT engineer_calendar_order_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  )`);
  try { await pool.query("ALTER TABLE engineer_calendar_orders ADD COLUMN product_division varchar(30) NOT NULL DEFAULT 'iOS/ACCS' AFTER order_month"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  try { await pool.query('ALTER TABLE engineer_calendar_orders DROP INDEX engineer_calendar_order_unique'); } catch (error) { if (!String((error as Error).message).includes('check that column/key exists') && !String((error as Error).message).includes('check that it exists')) throw error; }
  try { await pool.query('ALTER TABLE engineer_calendar_orders ADD UNIQUE KEY engineer_calendar_order_unique (order_month, product_division, engineer_name)'); } catch (error) { if (!String((error as Error).message).includes('Duplicate key name')) throw error; }
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_sources (
    id int AUTO_INCREMENT NOT NULL,
    spreadsheet_id varchar(255) NOT NULL,
    spreadsheet_name varchar(255) NOT NULL,
    selected_sheets text NOT NULL,
    write_sheet_name varchar(255) NULL,
    updated_by int NULL,
    last_synced_at timestamp NULL,
    last_sync_status varchar(20) NOT NULL DEFAULT 'never',
    last_sync_error varchar(500) NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_source_spreadsheet_unique (spreadsheet_id),
    CONSTRAINT frontline_source_user_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  try { await pool.query("ALTER TABLE frontline_sources ADD COLUMN write_sheet_name varchar(255) NULL AFTER selected_sheets"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_printer_settings (
    id tinyint NOT NULL,
    printer_ip varchar(45) NOT NULL,
    printer_port int NOT NULL DEFAULT 8008,
    print_enabled tinyint(1) NOT NULL DEFAULT 1,
    updated_by int NULL,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT frontline_printer_settings_user_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  try { await pool.query("ALTER TABLE frontline_printer_settings ADD COLUMN printer_port int NOT NULL DEFAULT 8008 AFTER printer_ip"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  try { await pool.query("ALTER TABLE frontline_printer_settings ADD COLUMN print_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER printer_port"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_sheet_writes (
    id bigint AUTO_INCREMENT NOT NULL,
    source_id int NOT NULL,
    sheet_name varchar(255) NOT NULL,
    headers_json text NOT NULL,
    values_json text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    error_message varchar(500) NULL,
    created_by int NOT NULL,
    written_at timestamp NULL,
    dedupe_fingerprint varchar(64) NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY frontline_sheet_writes_status_idx (status),
    UNIQUE KEY frontline_sheet_writes_dedupe_unique (dedupe_fingerprint),
    CONSTRAINT frontline_sheet_writes_source_fk FOREIGN KEY (source_id) REFERENCES frontline_sources(id) ON DELETE RESTRICT,
    CONSTRAINT frontline_sheet_writes_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
  )`);
  try { await pool.query("ALTER TABLE frontline_sheet_writes ADD COLUMN dedupe_fingerprint varchar(64) NULL AFTER written_at"); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  try { await pool.query("ALTER TABLE frontline_sheet_writes ADD UNIQUE KEY frontline_sheet_writes_dedupe_unique (dedupe_fingerprint)"); } catch (error) { if (!String((error as Error).message).includes('Duplicate key name')) throw error; }
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
  await pool.query(`CREATE TABLE IF NOT EXISTS engineer_roster (
    id bigint AUTO_INCREMENT NOT NULL,
    user_id int NULL,
    engineer_name varchar(150) NOT NULL,
    active int NOT NULL DEFAULT 1,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY engineer_roster_name_unique (engineer_name),
    KEY engineer_roster_user_idx (user_id),
    CONSTRAINT engineer_roster_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_device_models (
    id int AUTO_INCREMENT NOT NULL,
    model_name varchar(150) NOT NULL,
    active int NOT NULL DEFAULT 1,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_device_model_name_unique (model_name)
  )`);
  await pool.query(`INSERT IGNORE INTO frontline_device_models (model_name) VALUES ${APPLE_DEVICE_MODELS.map(() => '(?)').join(',')}`, APPLE_DEVICE_MODELS);
  await pool.query(`CREATE TABLE IF NOT EXISTS frontline_option_lists (
    id int AUTO_INCREMENT NOT NULL,
    list_key varchar(40) NOT NULL,
    label varchar(255) NOT NULL,
    sort_order int NOT NULL DEFAULT 0,
    active tinyint NOT NULL DEFAULT 1,
    created_by int NULL,
    updated_by int NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY frontline_option_list_unique (list_key, label),
    KEY frontline_option_list_lookup_idx (list_key, active, sort_order),
    CONSTRAINT frontline_option_list_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT frontline_option_list_updater_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  for (const key of FRONTLINE_OPTION_KEYS) {
    const values = FRONTLINE_DEFAULT_OPTIONS[key];
    if (values.length) {
      await pool.query(`INSERT IGNORE INTO frontline_option_lists (list_key, label, sort_order) VALUES ${values.map(() => '(?, ?, ?)').join(',')}`, values.flatMap((label, index) => [key, label, index]));
    }
  }
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
  await pool.query("INSERT IGNORE INTO engineer_roster (user_id, engineer_name, active) SELECT MAX(user_id), engineer_name, 1 FROM engineer_daily_availability GROUP BY engineer_name");
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
