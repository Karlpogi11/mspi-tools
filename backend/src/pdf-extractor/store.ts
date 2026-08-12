import { desc, eq } from 'drizzle-orm';
import { getDb, getDbPool } from '../db/index.js';
import { awbLog } from '../db/schema.js';

export interface AwbRowInput {
  hawb: string;
  invoice_reference: string;
  invoice_total_amount: string;
  delivery_date: string;
  total_qty: string;
  received_date: string;
  original_filename: string;
  month_folder: string;
  status?: string;
}

export interface AwbLogRow {
  id: number;
  hawb: string;
  invoice_reference: string;
  invoice_total_amount: string;
  delivery_date: string;
  total_qty: string;
  received_date: string;
  original_filename: string;
  month_folder: string;
  status: string;
  date_logged: string | null;
}

function serialize(row: any): AwbLogRow {
  return {
    id: row.id,
    hawb: row.hawb ?? '',
    invoice_reference: row.invoice_reference,
    invoice_total_amount: row.invoice_total_amount ?? '',
    delivery_date: row.delivery_date ?? '',
    total_qty: row.total_qty ?? '',
    received_date: row.received_date ?? '',
    original_filename: row.original_filename ?? '',
    month_folder: row.month_folder ?? '',
    status: row.status ?? 'ok',
    date_logged:
      row.date_logged instanceof Date
        ? row.date_logged.toISOString()
        : row.date_logged != null
          ? String(row.date_logged)
          : null,
  };
}

export async function insertAwbLog(row: AwbRowInput, userId: number | null): Promise<{ inserted: boolean }> {
  try {
    const db = getDb();
    const result = await db
      .insert(awbLog)
      .values({
        hawb: row.hawb,
        invoice_reference: row.invoice_reference,
        invoice_total_amount: row.invoice_total_amount,
        delivery_date: row.delivery_date,
        total_qty: row.total_qty,
        received_date: row.received_date,
        original_filename: row.original_filename,
        month_folder: row.month_folder,
        status: row.status ?? 'ok',
        created_by: userId,
      })
      .onDuplicateKeyUpdate({
        set: {
          hawb: row.hawb,
          invoice_total_amount: row.invoice_total_amount,
          delivery_date: row.delivery_date,
          total_qty: row.total_qty,
          received_date: row.received_date,
          original_filename: row.original_filename,
          month_folder: row.month_folder,
          status: row.status ?? 'ok',
          created_by: userId,
        },
      });
    return { inserted: (result?.[0]?.affectedRows ?? 0) === 1 };
  } catch (err) {
    console.error('[pdf-extractor] log insert failed:', (err as Error)?.message);
    throw err;
  }
}

export async function listAwbLog(userId: number, limit = 500): Promise<AwbLogRow[]> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(awbLog)
      .where(eq(awbLog.created_by, userId))
      .orderBy(desc(awbLog.date_logged), desc(awbLog.id))
      .limit(limit);
    return rows.map((r) => serialize(r));
  } catch (err) {
    console.error('[pdf-extractor] log list failed:', (err as Error)?.message);
    throw err;
  }
}

export async function ensureAwbLogTable(): Promise<void> {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS awb_log (
      id int AUTO_INCREMENT NOT NULL,
      hawb varchar(50) DEFAULT '',
      invoice_reference varchar(20) NOT NULL,
      invoice_total_amount varchar(20) DEFAULT '',
      delivery_date varchar(40) DEFAULT '',
      total_qty varchar(20) DEFAULT '',
      received_date varchar(40) DEFAULT '',
      original_filename varchar(255) DEFAULT '',
      month_folder varchar(60) DEFAULT '',
      status varchar(20) NOT NULL DEFAULT 'ok',
      created_by int NULL,
      date_logged timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY awb_log_invoice_ref_unique (invoice_reference),
      CONSTRAINT awb_log_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}
