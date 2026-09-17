import { getDbPool } from '../db/index.js';

/** Raw-SQL tables (same pattern as storage-locator/parts stores) so no
 *  drizzle migration round-trip is needed for v1. All free, no new vendors. */
export async function ensureMessengerTables(): Promise<void> {
  const pool = getDbPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messenger_channels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      topic VARCHAR(255) NOT NULL DEFAULT '',
      kind VARCHAR(20) NOT NULL DEFAULT 'group',
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY messenger_channels_name_unique (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messenger_members (
      channel_id INT NOT NULL,
      user_id INT NOT NULL,
      last_read_id INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id),
      KEY messenger_members_user_idx (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messenger_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_id INT NOT NULL,
      user_id INT NULL,
      author_name VARCHAR(255) NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'chat',
      meta JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY messenger_messages_channel_idx (channel_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messenger_sheet_config (
      id INT NOT NULL DEFAULT 1 PRIMARY KEY,
      spreadsheet_id VARCHAR(255) NOT NULL DEFAULT '',
      spreadsheet_name VARCHAR(255) NOT NULL DEFAULT '',
      sheet_name VARCHAR(255) NOT NULL DEFAULT '',
      updated_by INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messenger_device_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      platform VARCHAR(20) NOT NULL DEFAULT 'mac',
      app_version VARCHAR(50) NOT NULL DEFAULT '',
      token_hash VARCHAR(128) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY messenger_device_user_idx (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Seed two default channels so a fresh install has somewhere to talk.
  await pool.execute(
    `INSERT IGNORE INTO messenger_channels (name, topic, kind) VALUES
      ('general', 'Team-wide ops chat and bot alerts', 'group'),
      ('podium-frontline', 'Frontline sync + CSO alerts', 'group')`
  );
}

export interface MessengerChannel {
  id: number;
  name: string;
  topic: string;
  kind: string;
  unread: number;
}

export interface MessengerMessage {
  id: number;
  channel_id: number;
  user_id: number | null;
  author_name: string;
  body: string;
  kind: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}
