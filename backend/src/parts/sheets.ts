import crypto from 'crypto';
import { getDbPool } from '../db/index.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly openid email';

export interface PartsSheetConnection {
  id: number;
  user_id: number;
  google_email: string;
  refresh_token_encrypted: string;
}

function config() {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'JWT_SECRET'] as const) {
    if (!process.env[key]) throw new Error(`${key} is not configured`);
  }
  const defaultRedirectUri =
    process.env.NODE_ENV === 'production'
      ? 'https://tools.mspi.io/api/parts/sheets/callback'
      : 'http://localhost:3001/api/parts/sheets/callback';
  // NOTE: must NOT fall back to GOOGLE_SHEETS_REDIRECT_URI — that var belongs
  // to Frontline Monitor and sharing it sent Parts OAuth codes to Frontline's
  // callback (connecting the wrong tool and landing on the wrong page).
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.PARTS_GOOGLE_SHEETS_REDIRECT_URI || defaultRedirectUri,
    key: crypto.createHash('sha256').update(process.env.JWT_SECRET!).digest(),
  };
}

export function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

export function encodeState(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeState(value: string): number | null {
  try {
    const [payload, signature] = value.split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: number; exp?: number };
    return Number.isInteger(data.userId) && Number(data.exp) > Date.now() ? data.userId! : null;
  } catch {
    return null;
  }
}

export function encrypt(value: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

function decrypt(value: string, key: Buffer): string {
  const [iv, tag, body] = value.split('.');
  if (!iv || !tag || !body) throw new Error('Malformed Google connection');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

async function google<T>(token: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options?.headers || {}) } });
  const data = (await response.json()) as T & { error?: { message?: string } | string; error_description?: string };
  if (!response.ok) {
    const error = typeof data.error === 'string' ? data.error : data.error?.message || data.error_description;
    throw new Error(`Google API request failed (${response.status}): ${error || 'unknown Google API error'}`);
  }
  return data;
}

export function connectUrl(userId: number): string {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: SHEETS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: encodeState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const c = config();
  const body = new URLSearchParams({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!tokenRes.ok || !tokenData.refresh_token || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Google did not return a refresh token');
  }
  const info = await google<{ email?: string }>(tokenData.access_token, 'https://www.googleapis.com/oauth2/v3/userinfo');
  return { refreshToken: tokenData.refresh_token, email: info.email || '' };
}

export async function saveConnection(userId: number, refreshToken: string, email: string) {
  const c = config();
  await getDbPool().query(
    `INSERT INTO parts_sheet_connections (user_id, google_email, refresh_token_encrypted) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), refresh_token_encrypted = VALUES(refresh_token_encrypted)`,
    [userId, email, encrypt(refreshToken, c.key)]
  );
}

export async function connectionFor(userId: number): Promise<PartsSheetConnection | null> {
  const [rows] = await getDbPool().query('SELECT id, user_id, google_email, refresh_token_encrypted FROM parts_sheet_connections WHERE user_id = ? LIMIT 1', [userId]);
  return (rows as PartsSheetConnection[])[0] ?? null;
}

async function accessTokenFor(connection: PartsSheetConnection): Promise<string> {
  const c = config();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: decrypt(connection.refresh_token_encrypted, c.key),
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Google authorization expired');
  return data.access_token;
}

export async function sheetConfig() {
  const [rows] = await getDbPool().query(
    'SELECT spreadsheet_id, spreadsheet_name, stock_in_sheet_name, stock_out_sheet_name, updated_by, updated_at, last_sheet_sync_at FROM parts_sheet_config WHERE id = 1 LIMIT 1'
  );
  return (rows as Array<{
    spreadsheet_id: string;
    spreadsheet_name: string;
    stock_in_sheet_name: string;
    stock_out_sheet_name: string;
    updated_by: number | null;
    updated_at: string;
    last_sheet_sync_at: string | null;
  }>)[0] ?? null;
}

/** One cheap Drive metadata read: when the spreadsheet last changed. Throws
 *  with (403) when the stored grant predates the Drive metadata scope. */
export async function driveSheetModifiedTime(userId: number, spreadsheetId: string, ownerUserId?: number | null): Promise<string | null> {
  let connection = ownerUserId ? await connectionFor(ownerUserId).catch(() => null) : null;
  if (!connection) connection = await connectionFor(userId).catch(() => null);
  if (!connection) return null;
  const token = await accessTokenFor(connection);
  const data = await google<{ modifiedTime?: string }>(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime`);
  return data.modifiedTime || null;
}

export async function listSheets(spreadsheetId: string, userId: number): Promise<{ title: string; sheets: string[] }> {  const connection = await connectionFor(userId);
  if (!connection) throw new Error('Google is not connected');
  const token = await accessTokenFor(connection);
  const data = await google<{ properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`
  );
  return {
    title: data.properties?.title || '',
    sheets: (data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean),
  };
}

export interface SheetLogRow {
  siteCode: string;
  siteName: string;
  type: 'IN' | 'OUT';
  date: string;
  partNumber: string;
  description: string;
  serial: string;
  reference: string;
  quantity: number;
  actor: string;
  location: string;
}

/** Last append failure reason — surfaced in admin status so a silent
 * sheet-sync failure is visible instead of only in server logs. */
let lastAppendError: string | null = null;

export function lastSheetError(): string | null {
  return lastAppendError;
}

/** Movement dates are stored as YYYY-MM-DD; the sheet displays MM/DD/YYYY.
 * parseSheetDate reads M/D/YYYY back on sync, so this round-trips. */
function toSheetDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/**
 * Append one raw log row to the correct tab. Never throws — callers treat
 * failure as unsynced.
 *
 * Stock-In tab columns: DATE | PART NUMBER | SERIAL NUMBER | DESCRIPTION | QTY | REMARKS | STATUS/REFERENCE | LOCATION
 *   Appends [Date, PartNumber, Serial] — trailing cells are omitted (Google
 *   rejects JSON nulls, and omitting leaves D-G for the sheet's formulas),
 *   then writes LOCATION to H of the newly appended row in a second call.
 *
 * Stock-out tab columns: DATE | SERIAL NUMBER | REFERENCE NUMBER | PART NUMBER | DESCRIPTION | QTY | REMARKS
 *   Appends [Date, Serial, Reference] — leaves D-G for formulas.
 *
 * No header is written: both tabs ship with their own headers/formulas.
 */
export async function appendSheetRow(userId: number, row: SheetLogRow): Promise<boolean> {
  try {
    const cfg = await sheetConfig();
    if (!cfg?.spreadsheet_id) {
      lastAppendError = 'No spreadsheet configured — set the Spreadsheet ID in Admin → Parts → Sheet log.';
      console.warn('parts sheet append skipped:', lastAppendError);
      return false;
    }
    const tabLabel = row.type === 'IN' ? 'Stock-In' : 'Stock-out';
    const sheetName = row.type === 'IN' ? cfg.stock_in_sheet_name : cfg.stock_out_sheet_name;
    if (!sheetName) {
      lastAppendError = `No ${tabLabel} tab selected — load tabs and pick the ${tabLabel} tab in Admin → Parts → Sheet log.`;
      console.warn('parts sheet append skipped:', lastAppendError);
      return false;
    }
    // Prefer the config owner's Google connection; fall back to the acting
    // user (config may have been saved by a different admin).
    let connection = cfg.updated_by ? await connectionFor(cfg.updated_by) : null;
    if (!connection) connection = await connectionFor(userId);
    if (!connection) {
      lastAppendError = 'Google is not connected — connect Google in Admin → Parts → Sheet log.';
      console.warn('parts sheet append skipped:', lastAppendError);
      return false;
    }
    const token = await accessTokenFor(connection);
    const isIn = row.type === 'IN';
    const primary = isIn
      ? [toSheetDate(row.date), row.partNumber, row.serial]
      : [toSheetDate(row.date), row.serial, row.reference];
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheet_id)}/values/${encodeURIComponent(sheetName)}`;
    const res = await google<{ updates?: { updatedRange?: string } }>(
      token,
      `${base}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [primary] }),
      }
    );
    // LOCATION lives in column H on the Stock-In tab. The row is already in
    // the sheet at this point, so a failed H write must NOT return false —
    // a retry would append a duplicate row.
    lastAppendError = null;
    if (isIn && row.location) {
      const m = res?.updates?.updatedRange?.match(/!([A-Z]+)(\d+)/);
      if (m) {
        try {
          await google(token, `${base}!H${m[2]}?valueInputOption=RAW`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[row.location]] }),
          });
        } catch (err) {
          lastAppendError = `Row appended, but LOCATION (H${m[2]}) write failed: ${(err as Error).message}`;
          console.error('parts sheet location write failed:', err);
        }
      }
    }
    return true;
  } catch (error) {
    lastAppendError = `Sheet ${row.type} append to Google failed: ${(error as Error).message}`;
    console.error('parts sheet append failed:', error);
    return false;
  }
}

// ---------- Two-way sync (Sheet → Web) ----------

function parseSheetDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // M/D/YYYY or D/M/YYYY (Google Sheets locale dependent — prefer the first
  // number as month when ≤ 12, otherwise day/month).
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    const pad = (n: string) => n.padStart(2, '0');
    const first = Number(a); const second = Number(b);
    if (first > 12 && second <= 12) return `${y}-${pad(b)}-${pad(a)}`;
    return `${y}-${pad(a)}-${pad(b)}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

async function readSheetRows(token: string, spreadsheetId: string, sheetName: string, lastCol: string): Promise<string[][]> {
  const data = await google<{ values?: string[][] }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}!A2:${lastCol}`
  );
  return data.values || [];
}

/** Rows per multi-row INSERT — well under MySQL's 65 535-placeholder limit. */
const SYNC_BATCH = 500;

/**
 * Rebuild one site's stock from the Google Sheet tabs.
 *
 * Stock-In tab  (A=DATE, B=PART NUMBER, C=SERIAL, E=QTY, H=LOCATION)
 * Stock-out tab (A=DATE, B=SERIAL, C=REFERENCE, D=PART NUMBER, F=QTY)
 *
 * Reads both tabs in parallel, applies every row in memory, then clears the
 * target site's parts_units + parts_movements and writes the final state in
 * bulk batches inside one transaction. The in-memory replay keeps sync at a
 * handful of queries regardless of sheet size — the old per-row replay cost
 * ~3 queries per row and made large sheets crawl.
 *
 * Duplicate guard: an IN row for a serial already in stock (no OUT between),
 * or an OUT row for a serial already out (no IN between), is skipped and
 * reported in `duplicateSerials` instead of being replayed as a double entry.
 */
export async function syncFromSheet(
  userId: number,
  siteId: number,
  siteCode: string,
  siteName: string
): Promise<{ imported: number; ins: number; outs: number; duplicates: number; duplicateSerials: string[] }> {
  const cfg = await sheetConfig();
  if (!cfg?.spreadsheet_id) throw new Error('No spreadsheet configured.');
  if (!cfg.stock_in_sheet_name || !cfg.stock_out_sheet_name) throw new Error('Stock-In and Stock-out tabs are not configured.');
  const connection = await connectionFor(cfg.updated_by || userId);
  if (!connection) throw new Error('Google is not connected.');
  const token = await accessTokenFor(connection);

  const [inRows, outRows] = await Promise.all([
    readSheetRows(token, cfg.spreadsheet_id, cfg.stock_in_sheet_name, 'H'),
    readSheetRows(token, cfg.spreadsheet_id, cfg.stock_out_sheet_name, 'G'),
  ]);

  interface ReplayRow { date: string; type: 'IN' | 'OUT'; partNumber: string; serial: string; reference: string; location: string; quantity: number; order: number }
  const replay: ReplayRow[] = [];

  inRows.forEach((r, i) => {
    const date = parseSheetDate(r[0]);
    const partNumber = String(r[1] ?? '').trim();
    const serial = String(r[2] ?? '').trim().toUpperCase();
    if (!date || !partNumber) return;
    const qtyRaw = Number(String(r[4] ?? '').replace(/[^\d.-]/g, ''));
    replay.push({ date, type: 'IN', partNumber, serial, reference: '', location: String(r[7] ?? '').trim(), quantity: Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1, order: i });
  });

  outRows.forEach((r, i) => {
    const date = parseSheetDate(r[0]);
    const serial = String(r[1] ?? '').trim().toUpperCase();
    const reference = String(r[2] ?? '').trim();
    const partNumber = String(r[3] ?? '').trim();
    if (!date || (!serial && !partNumber)) return;
    const qtyRaw = Number(String(r[5] ?? '').replace(/[^\d.-]/g, ''));
    replay.push({ date, type: 'OUT', partNumber, serial, reference, location: '', quantity: Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1, order: 100000 + i });
  });

  replay.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  // ---- Apply every row in memory (zero DB roundtrips) ----
  interface FinalUnit {
    partNumber: string;
    serial: string | null;
    quantity: number;
    status: 'in' | 'out';
    location: string | null;
    reference: string | null;
    occurredDate: string;
    stockedOutDate: string | null;
  }
  interface FinalMovement {
    partNumber: string;
    serial: string | null;
    type: 'IN' | 'OUT';
    date: string;
    location: string | null;
    reference: string | null;
    quantity: number;
  }

  const units = new Map<string, FinalUnit>();
  const bucketsByPart = new Map<string, FinalUnit[]>();
  const movements: FinalMovement[] = [];
  let ins = 0;
  let outs = 0;
  // Duplicate guard: a serial already in stock cannot be stocked in again
  // without an OUT between (and vice versa) — those sheet rows are skipped
  // and reported instead of silently replayed as double entries.
  let duplicates = 0;
  const duplicateSerials = new Set<string>();

  for (const row of replay) {
    if (row.type === 'IN') {
      if (row.serial) {
        const existing = units.get(row.serial);
        if (existing && existing.status === 'in') {
          duplicates++;
          duplicateSerials.add(row.serial);
          continue;
        }
        // One unit per serial — the latest IN wins, as in SQL.
        units.set(row.serial, {
          partNumber: row.partNumber, serial: row.serial, quantity: 1, status: 'in',
          location: row.location || null, reference: null, occurredDate: row.date, stockedOutDate: null,
        });
      } else {
        // Non-serialized: one bucket per (part, location) — overflow lives in
        // its own bucket, so Box 1 and Box 2 stay separate.
        const key = `${row.partNumber}\u0000${row.location}`;
        const ex = units.get(key);
        if (ex) {
          ex.quantity += row.quantity;
          ex.status = 'in';
          ex.occurredDate = row.date;
          ex.stockedOutDate = null;
        } else {
          const bucket: FinalUnit = {
            partNumber: row.partNumber, serial: null, quantity: row.quantity, status: 'in',
            location: row.location || null, reference: null, occurredDate: row.date, stockedOutDate: null,
          };
          units.set(key, bucket);
          const list = bucketsByPart.get(row.partNumber) || [];
          list.push(bucket);
          bucketsByPart.set(row.partNumber, list);
        }
      }
      movements.push({ partNumber: row.partNumber, serial: row.serial || null, type: 'IN', date: row.date, location: row.location || null, reference: null, quantity: row.quantity });
      ins++;
    } else {
      if (row.serial) {
        const u = units.get(row.serial);
        if (u && u.status !== 'in') {
          // Duplicate guard (OUT side): the serial is already out — a second
          // OUT with no IN between is an invalid sheet row.
          duplicates++;
          duplicateSerials.add(row.serial);
          continue;
        }
        if (u) {
          u.status = 'out';
          u.location = null;
          u.reference = row.reference || null;
          u.stockedOutDate = row.date;
        }
      } else if (row.partNumber) {
        // Deduct from the in-stock bucket holding the most of this part
        // (same rule the per-row SQL replay used).
        const buckets = bucketsByPart.get(row.partNumber) || [];
        let best: FinalUnit | null = null;
        for (const u of buckets) {
          if (u.status !== 'in' || u.quantity <= 0) continue;
          if (!best || u.quantity > best.quantity) best = u;
        }
        if (best) {
          best.quantity = Math.max(0, best.quantity - row.quantity);
          best.reference = row.reference || null;
          if (best.quantity === 0) {
            best.status = 'out';
            best.location = null;
            best.stockedOutDate = row.date;
          }
        }
      }
      movements.push({ partNumber: row.partNumber, serial: row.serial || null, type: 'OUT', date: row.date, location: null, reference: row.reference || null, quantity: row.quantity });
      outs++;
    }
  }

  // ---- Bulk write: delete + batched multi-row inserts ----
  const pool = getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Clear only this site's rows — other sites stay untouched.
    await conn.execute('DELETE FROM parts_movements WHERE site_id = ?', [siteId]);
    await conn.execute('DELETE FROM parts_units WHERE site_id = ?', [siteId]);

    const unitList = [...units.values()];
    for (let i = 0; i < unitList.length; i += SYNC_BATCH) {
      const chunk = unitList.slice(i, i + SYNC_BATCH);
      const sql = `INSERT INTO parts_units (site_id, part_number, serial, quantity, status, location, reference, occurred_date, stocked_in_at, stocked_out_at) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)').join(',')}`;
      const params: unknown[] = [];
      for (const u of chunk) params.push(siteId, u.partNumber, u.serial, u.quantity, u.status, u.location, u.reference, u.occurredDate, u.stockedOutDate);
      await conn.query(sql, params);
    }

    for (let i = 0; i < movements.length; i += SYNC_BATCH) {
      const chunk = movements.slice(i, i + SYNC_BATCH);
      const sql = `INSERT INTO parts_movements (site_id, part_number, serial, type, occurred_date, location, reference, quantity, sheet_synced) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, 1)').join(',')}`;
      const params: unknown[] = [];
      for (const m of chunk) params.push(siteId, m.partNumber, m.serial, m.type, m.date, m.location, m.reference, m.quantity);
      await conn.query(sql, params);
    }

    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
  return { imported: movements.length, ins, outs, duplicates, duplicateSerials: [...duplicateSerials] };
}
