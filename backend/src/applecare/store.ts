import { getDbPool } from '../db/index.js';

export async function ensureApplecareTables(): Promise<void> {
  const pool = getDbPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS applecare_gmail_connections (
    id int AUTO_INCREMENT NOT NULL, user_id int NOT NULL, gmail_email varchar(255) NOT NULL,
    refresh_token_encrypted text NOT NULL, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY applecare_gmail_user_unique (user_id),
    CONSTRAINT applecare_gmail_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS applecare_sites (
    id int AUTO_INCREMENT NOT NULL, ship_to varchar(30) NOT NULL, site_name varchar(255) NOT NULL,
    active int NOT NULL DEFAULT 1, created_by int NULL, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY applecare_ship_to_unique (ship_to),
    CONSTRAINT applecare_site_user_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS applecare_packing_lists (
    id int AUTO_INCREMENT NOT NULL, gmail_message_id varchar(255) NOT NULL, gmail_thread_id varchar(255) DEFAULT '',
    subject varchar(500) NOT NULL, sender varchar(500) DEFAULT '', ship_to varchar(30) NOT NULL,
    site_id int NULL, packing_date varchar(20) DEFAULT '', packing_time varchar(10) DEFAULT '', received_at timestamp NULL,
    attachment_name varchar(255) DEFAULT '', attachment_path varchar(500) DEFAULT '', status varchar(30) NOT NULL DEFAULT 'incoming',
    raw_text text, imported_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
    UNIQUE KEY applecare_message_unique (gmail_message_id), KEY applecare_ship_to_idx (ship_to), KEY applecare_received_idx (received_at),
    CONSTRAINT applecare_list_site_fk FOREIGN KEY (site_id) REFERENCES applecare_sites(id) ON DELETE SET NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS applecare_packing_list_items (
    id int AUTO_INCREMENT NOT NULL, packing_list_id int NOT NULL, part_number varchar(150) DEFAULT '',
    description varchar(500) DEFAULT '', serial_number varchar(150) DEFAULT '', quantity int NOT NULL DEFAULT 0,
    raw_text text, PRIMARY KEY (id), CONSTRAINT applecare_item_list_fk FOREIGN KEY (packing_list_id) REFERENCES applecare_packing_lists(id) ON DELETE CASCADE
  )`);
}
