import { getDbPool } from '../db/index.js';

// Tables are created once per process — awaiting 6 sequential
// CREATE TABLE IF NOT EXISTS roundtrips on every request was the dominant
// cost of the Stock Out serial search (~9 roundtrips per keystroke-pause).
let ensured: Promise<void> | null = null;

export function ensurePartsTables(): Promise<void> {
  if (!ensured) ensured = createPartsTables().catch((error) => { ensured = null; throw error; });
  return ensured;
}

async function createPartsTables() {
  const pool = getDbPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS parts_sites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    active INT NOT NULL DEFAULT 1,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT parts_sites_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS parts_master (
    id INT AUTO_INCREMENT PRIMARY KEY,
    part_number VARCHAR(150) NOT NULL UNIQUE,
    description VARCHAR(500) NOT NULL DEFAULT '',
    eee_code VARCHAR(100) NULL,
    substitute_part VARCHAR(150) NULL,
    serialized CHAR(1) NOT NULL DEFAULT 'Y',
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX parts_master_eee_idx (eee_code),
    CONSTRAINT parts_master_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS parts_units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    part_number VARCHAR(150) NOT NULL,
    serial VARCHAR(150) NULL UNIQUE,
    quantity INT NOT NULL DEFAULT 1,
    status VARCHAR(10) NOT NULL DEFAULT 'in',
    location VARCHAR(100) NULL,
    reference VARCHAR(150) NULL,
    occurred_date DATE NULL,
    stocked_in_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    stocked_out_at TIMESTAMP NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX parts_units_site_status_part_idx (site_id, status, part_number),
    INDEX parts_units_serial_idx (serial),
    CONSTRAINT parts_units_site_fk FOREIGN KEY (site_id) REFERENCES parts_sites(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS parts_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    part_number VARCHAR(150) NOT NULL,
    serial VARCHAR(150) NULL,
    type VARCHAR(10) NOT NULL,
    occurred_date DATE NOT NULL,
    location VARCHAR(100) NULL,
    reference VARCHAR(150) NULL,
    quantity INT NOT NULL DEFAULT 1,
    actor_user_id INT NULL,
    sheet_synced INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX parts_movements_site_created_idx (site_id, created_at),
    INDEX parts_movements_serial_idx (serial),
    CONSTRAINT parts_movements_site_fk FOREIGN KEY (site_id) REFERENCES parts_sites(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS parts_sheet_config (
    id INT PRIMARY KEY DEFAULT 1,
    spreadsheet_id VARCHAR(255) NOT NULL DEFAULT '',
    spreadsheet_name VARCHAR(255) NOT NULL DEFAULT '',
    stock_in_sheet_name VARCHAR(255) NOT NULL DEFAULT '',
    stock_out_sheet_name VARCHAR(255) NOT NULL DEFAULT '',
    updated_by INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS parts_sheet_connections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    google_email VARCHAR(255) NOT NULL DEFAULT '',
    refresh_token_encrypted TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT parts_sheet_connections_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  
  // Migrations for existing databases
  try { await pool.query('ALTER TABLE parts_units ADD COLUMN location VARCHAR(100) NULL'); } catch (e: any) { if (!e.message.includes('Duplicate column name')) console.error(e); }
  try { await pool.query('ALTER TABLE parts_movements ADD COLUMN location VARCHAR(100) NULL'); } catch (e: any) { if (!e.message.includes('Duplicate column name')) console.error(e); }
  try { await pool.query('ALTER TABLE parts_sheet_config ADD COLUMN stock_in_sheet_name VARCHAR(255) NOT NULL DEFAULT ""'); } catch (e: any) { if (!e.message.includes('Duplicate column name')) console.error(e); }
  try { await pool.query('ALTER TABLE parts_sheet_config ADD COLUMN stock_out_sheet_name VARCHAR(255) NOT NULL DEFAULT ""'); } catch (e: any) { if (!e.message.includes('Duplicate column name')) console.error(e); }
  // Carry the legacy single sheet_name over to both tabs when the new columns
  // are still empty, so an already-connected log keeps writing after upgrade.
  try {
    await pool.query(
      `UPDATE parts_sheet_config SET stock_in_sheet_name = sheet_name, stock_out_sheet_name = sheet_name
       WHERE sheet_name IS NOT NULL AND sheet_name != '' AND stock_in_sheet_name = ''`
    );
  } catch (e: any) { if (!e.message.includes("Unknown column 'sheet_name'")) console.error(e); }
  // Units that are OUT are no longer in any box — drop stale locations so the
  // serials workbench never shows a box for a serial that already left.
  try { await pool.query(`UPDATE parts_units SET location = NULL WHERE status <> 'in' AND location IS NOT NULL`); } catch (e: any) { console.error(e); }
}
