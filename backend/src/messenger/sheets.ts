import crypto from 'crypto';
import { getDbPool } from '../db/index.js';

function key(): Buffer {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
}

function decrypt(value: string): string {
  const [iv, tag, body] = value.split('.');
  if (!iv || !tag || !body) throw new Error('Malformed Google connection');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

async function google<T>(token: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options?.headers || {}) } });
  const data = (await response.json()) as T & { error?: { message?: string } | string };
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Google API request failed');
  return data;
}

/** Reuse the Parts Google OAuth connection (same user, same JWT_SECRET
 *  encryption) so Messenger backup needs no new Google console wiring.
 *  If unconnected, the UI directs the user to Parts → Connect Google. */
async function accessTokenFor(userId: number): Promise<string> {
  const [rows] = await getDbPool().query(
    'SELECT refresh_token_encrypted FROM parts_sheet_connections WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const row = (rows as Array<{ refresh_token_encrypted: string }>)[0];
  if (!row) throw new Error('Google is not connected. Connect it on the Parts Inventory page first.');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_ID is not configured');
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: decrypt(row.refresh_token_encrypted),
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

export async function messengerSheetStatus(userId: number): Promise<{ connected: boolean }> {
  try {
    await accessTokenFor(userId);
    return { connected: true };
  } catch {
    return { connected: false };
  }
}

/** Paste-a-sheet-ID flow (same as Parts): list tabs to choose from. */
export async function listSheetsFor(spreadsheetId: string, userId: number): Promise<{ title: string; sheets: string[] }> {
  const token = await accessTokenFor(userId);
  const data = await google<{ properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`
  );
  return {
    title: data.properties?.title || '',
    sheets: (data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean),
  };
}

const BACKUP_HEADERS = ['Timestamp', 'Channel', 'Author', 'Kind', 'Body', 'Message ID'];

export async function pushBackupToSheet(
  userId: number,
  spreadsheetId: string,
  sheetName: string,
  rows: Array<{ channel: string; author: string; kind: string; body: string; id: number; created_at: string }>
): Promise<number> {
  const token = await accessTokenFor(userId);
  const headerRange = `${encodeURIComponent(sheetName)}!A1:F1`;
  const current = await google<{ values?: string[][] }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${headerRange}`
  );
  if (!current.values?.[0]?.some((c) => String(c ?? '').trim() !== '')) {
    await google(token, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${headerRange}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [BACKUP_HEADERS] }),
    });
  }
  const values = rows.map((r) => [r.created_at, r.channel, r.author, r.kind, r.body, r.id]);
  if (values.length === 0) return 0;
  await google(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
  );
  return values.length;
}
