import { getDbPool } from '../db/index.js';

export async function ensureStorageTables() {
  const pool = getDbPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS storage_employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_number VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    active INT NOT NULL DEFAULT 1,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT storage_employees_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  try { await pool.query('ALTER TABLE storage_employees ADD COLUMN removed_at TIMESTAMP NULL AFTER active'); } catch (error) { if (!String((error as Error).message).includes('Duplicate column')) throw error; }
  await pool.query(`CREATE TABLE IF NOT EXISTS storage_units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ar_number VARCHAR(100) NOT NULL UNIQUE,
    family VARCHAR(20) NOT NULL,
    status VARCHAR(40) NOT NULL,
    cabinet_number INT NULL,
    state VARCHAR(10) NOT NULL DEFAULT 'out',
    current_employee_id INT NULL,
    checked_in_at TIMESTAMP NULL,
    checked_out_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX storage_units_state_cabinet_idx (state, family, cabinet_number),
    CONSTRAINT storage_units_employee_fk FOREIGN KEY (current_employee_id) REFERENCES storage_employees(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS storage_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT NOT NULL,
    employee_id INT NOT NULL,
    action VARCHAR(10) NOT NULL,
    family VARCHAR(20) NOT NULL,
    status VARCHAR(40) NOT NULL,
    cabinet_number INT NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX storage_movements_unit_occurred_idx (unit_id, occurred_at),
    CONSTRAINT storage_movements_unit_fk FOREIGN KEY (unit_id) REFERENCES storage_units(id) ON DELETE CASCADE,
    CONSTRAINT storage_movements_employee_fk FOREIGN KEY (employee_id) REFERENCES storage_employees(id) ON DELETE RESTRICT
  )`);
}
