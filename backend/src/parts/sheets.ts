import crypto from 'crypto';
import { getDbPool } from '../db/index.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets openid email';

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
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_SHEETS_REDIRECT_URI || defaultRedirectUri,
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
  const [rows] = await getDbPool().query('SELECT spreadsheet_id, spreadsheet_name, sheet_name, updated_by, updated_at FROM parts_sheet_config WHERE id = 1 LIMIT 1');
  return (rows as Array<{ spreadsheet_id: string; spreadsheet_name: string; sheet_name: string; updated_by: number | null; updated_at: string }>)[0] ?? null;
}

export async function listSheets(spreadsheetId: string, userId: number): Promise<{ title: string; sheets: string[] }> {
  const connection = await connectionFor(userId);
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
}

/** Append one raw log row. Never throws — callers treat failure as unsynced. */
export async function appendSheetRow(userId: number, row: SheetLogRow): Promise<boolean> {
  try {
    const cfg = await sheetConfig();
    if (!cfg?.spreadsheet_id || !cfg?.sheet_name) return false;
    const connection = await connectionFor(cfg.updated_by || userId);
    if (!connection) return false;
    const token = await accessTokenFor(connection);
    await google(
      token,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheet_id)}/values/${encodeURIComponent(cfg.sheet_name)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[
            new Date().toISOString(),
            row.siteCode,
            row.siteName,
            row.type,
            row.date,
            row.partNumber,
            row.description,
            row.serial,
            row.reference,
            row.quantity,
            row.actor,
          ]],
        }),
      }
    );
    return true;
  } catch (error) {
    console.error('parts sheet append failed:', error);
    return false;
  }
}
