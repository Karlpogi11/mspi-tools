import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { getDb } from '../db/index.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { writeAuditLog } from '../db/audit.js';
import { applecareGmailConnections, applecarePackingListItems, applecarePackingLists, applecareSites } from '../db/schema.js';
import { extractTextLayer } from '../pdf-extractor/pdf.js';
import { ensureApplecareTables } from './store.js';

const router = Router();
router.use(authenticateToken);

const SUBJECT_QUERY = 'newer_than:7d subject:"AppleCare Packing List"';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const activeSyncs = new Set<number>();

function dataDir(): string {
  const configured = process.env.APPLECARE_DATA_DIR || path.resolve(process.cwd(), 'data', 'applecare');
  return path.resolve(configured);
}

async function findAttachmentPath(storedPath: string | null | undefined, attachmentName: string | null | undefined): Promise<string | null> {
  const candidates = storedPath ? [storedPath, path.join(dataDir(), path.basename(storedPath))] : [];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch { /* Try the persistent data directory fallback below. */ }
  }

  if (!attachmentName) return null;
  try {
    const safeName = path.basename(attachmentName).replace(/[^A-Za-z0-9._-]/g, '_');
    const files = await fs.readdir(dataDir());
    const match = files.find((file) => file === safeName || file.endsWith(`-${safeName}`));
    if (!match) return null;
    const candidate = path.join(dataDir(), match);
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch { return null; }
}

function config() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'JWT_SECRET'] as const;
  for (const key of required) if (!process.env[key]) throw new Error(`${key} is not configured`);
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    key: crypto.createHash('sha256').update(process.env.JWT_SECRET!).digest(),
  };
}

function encodeState(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeState(value: string): number | null {
  try {
    const [payload, signature] = value.split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: number; exp?: number };
    return Number.isInteger(data.userId) && Number(data.exp) > Date.now() ? data.userId! : null;
  } catch { return null; }
}

function encrypt(value: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(value: string, key: Buffer): string {
  try {
    const [ivRaw, tagRaw, bodyRaw] = value.split('.');
    if (!ivRaw || !tagRaw || !bodyRaw) throw new Error('Malformed encrypted token');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(bodyRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('The Gmail connection needs to be reconnected. The server encryption key may have changed.');
  }
}

async function tokenFor(connection: typeof applecareGmailConnections.$inferSelect) {
  const c = config();
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: decrypt(connection.refresh_token_encrypted, c.key), grant_type: 'refresh_token' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Gmail authorization expired');
  return data.access_token;
}

async function gmail<T>(token: string, endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options?.headers || {}) } });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data?.error?.message || 'Gmail API request failed');
  return data;
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || '';
}

type GmailPart = { filename?: string; mimeType?: string; body?: { attachmentId?: string; data?: string; size?: number }; parts?: GmailPart[] };
type GmailMessage = { id: string; threadId?: string; internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }>; body?: { data?: string }; parts?: GmailPart[] } };

function partsOf(part?: GmailPart): GmailPart[] {
  if (!part) return [];
  return [part, ...(part.parts || []).flatMap(partsOf)];
}

function decodeBase64(value = ''): Buffer { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

function parseSubject(subject: string) {
  const shipTo = subject.match(/ShipTo\s*:\s*([0-9]+)/i)?.[1] || '';
  const date = subject.match(/Date\s*:\s*(\d{8})/i)?.[1] || '';
  const time = subject.match(/Time\s*:\s*(\d{4})/i)?.[1] || '';
  return { shipTo, packingDate: date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : '', packingTime: time ? `${time.slice(0, 2)}:${time.slice(2)}` : '' };
}

function shipToVariants(shipTo: string): string[] {
  const unpadded = shipTo.replace(/^0+(?=\d)/, '');
  return [...new Set([shipTo, unpadded])];
}

async function attachmentBuffer(token: string, messageId: string, part: GmailPart): Promise<Buffer> {
  if (part.body?.data) return decodeBase64(part.body.data);
  if (!part.body?.attachmentId) return Buffer.alloc(0);
  const result = await gmail<{ data?: string }>(token, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`);
  return decodeBase64(result.data || '');
}

async function attachmentText(buffer: Buffer, filename: string): Promise<string> {
  if (/\.pdf$/i.test(filename)) return (await extractTextLayer(buffer))?.fullText || '';
  if (/\.(xlsx?|xls)$/i.test(filename)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const rows: string[] = [];
    workbook.worksheets.forEach((sheet) => sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values as Record<string, unknown>);
      rows.push(values.map((v: unknown) => String(v ?? '')).join(' | '));
    }));
    return rows.join('\n');
  }
  return '';
}

async function parseExcelItems(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const items: Array<{ part_number: string; description: string; po_no: string; serial_number: string; quantity: number; raw_text: string }> = [];
  const lines: string[] = [];
  workbook.worksheets.forEach((sheet) => {
    let headers: string[] = [];
    sheet.eachRow((row, rowNumber) => {
      const values = (Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values as Record<string, unknown>)).map((value: unknown) => String(value ?? '').trim());
      if (rowNumber === 1) {
        headers = values.map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
        lines.push(values.join(' | '));
        return;
      }
      if (!values.some(Boolean)) return;
      lines.push(values.join(' | '));
      const get = (...names: string[]) => {
        const index = headers.findIndex((header) => names.includes(header));
        return index >= 0 ? values[index] || '' : '';
      };
      const partNumber = get('partno', 'partnumber', 'part');
      if (!partNumber) return;
      const quantityRaw = get('qty', 'quantity');
      items.push({
        part_number: partNumber.slice(0, 150),
        description: get('description', 'itemdescription').slice(0, 500),
        po_no: get('pono', 'ponumber', 'purchaseno', 'purchasenumber').slice(0, 150),
        serial_number: get('serialno', 'serialnumber', 'serial').slice(0, 150),
        quantity: Number(quantityRaw) || 0,
        raw_text: values.join(' | ').slice(0, 1000),
      });
    });
  });
  return { text: lines.join('\n'), items };
}

function parseItems(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^([^|\s]+)\s*[|\s]+(.+?)[|\s]+(\d+)$/);
    if (!match) return null;
    return { part_number: match[1].slice(0, 150), description: match[2].slice(0, 500), po_no: '', serial_number: '', quantity: Number(match[3]), raw_text: line.slice(0, 1000) };
  }).filter((item): item is NonNullable<typeof item> => !!item);
}

function purchaseNumberFromStoredRow(rawText: string | null, filename: string | null): string | null {
  if (!rawText || !/\.xlsx?$/i.test(filename || '')) return null;
  const value = rawText.split('|')[8]?.trim();
  return value || null;
}

async function performSyncConnection(connection: typeof applecareGmailConnections.$inferSelect) {
  const token = await tokenFor(connection);
  const result = await gmail<{ messages?: Array<{ id: string; threadId?: string }> }>(token, `/messages?q=${encodeURIComponent(SUBJECT_QUERY)}&maxResults=100`);
  const db = getDb();
  let imported = 0;
  for (const summary of result.messages || []) {
    const [existing] = await db.select().from(applecarePackingLists).where(eq(applecarePackingLists.gmail_message_id, summary.id)).limit(1);
    const existingAttachmentPath = existing ? await findAttachmentPath(existing.attachment_path, existing.attachment_name) : null;
    const [existingSite] = existing ? await db.select({ id: applecareSites.id }).from(applecareSites).where(inArray(applecareSites.ship_to, shipToVariants(existing.ship_to))).limit(1) : [];
    if (existing && /\.(xlsx?|pdf)$/i.test(existing.attachment_name || '') && existing.raw_text) {
      const [existingItem] = await db.select({ id: applecarePackingListItems.id, po_no: applecarePackingListItems.po_no })
        .from(applecarePackingListItems)
        .where(eq(applecarePackingListItems.packing_list_id, existing.id))
        .limit(1);
      // Re-read old Excel records imported by the initial generic parser so
      // the structured PartNo/Description/SerialNo/Qty parser can populate them.
      if (existingItem && existingAttachmentPath) {
        if (!existing.received_by || (!existing.site_id && existingSite?.id)) {
          await db.update(applecarePackingLists)
            .set({
              received_by: existing.received_by || connection.gmail_email,
              ...(existing.site_id || !existingSite?.id ? {} : { site_id: existingSite.id }),
            })
            .where(eq(applecarePackingLists.id, existing.id));
        }
        continue;
      }
    }
    const message = await gmail<GmailMessage>(token, `/messages/${encodeURIComponent(summary.id)}?format=full`);
    const subject = header(message, 'Subject');
    const parsed = parseSubject(subject);
    if (!parsed.shipTo) continue;
    const site = await db.select({ id: applecareSites.id }).from(applecareSites).where(inArray(applecareSites.ship_to, shipToVariants(parsed.shipTo))).limit(1);
    // Inspect every MIME branch. Gmail may place the attachment after the
    // plain-text body or inside a nested multipart/alternative section.
    const attachmentParts = (message.payload?.parts || []).flatMap(partsOf)
      .filter((part) => part.filename && (part.body?.attachmentId || part.body?.data));
    // AppleCare emails can include inline PNG/JPG assets. Never treat those
    // as the packing list; prefer the actual Excel/PDF document attachment.
    const attachment = attachmentParts.find((part) => /\.(xlsx?|pdf)$/i.test(part.filename || ''));
    let attachmentName = '';
    let attachmentPath = '';
    let rawText = '';
    let items: ReturnType<typeof parseItems> = [];
    if (attachment?.filename) {
      const buffer = await attachmentBuffer(token, message.id, attachment);
      attachmentName = attachment.filename.slice(0, 255);
      const currentDataDir = dataDir();
      await fs.mkdir(currentDataDir, { recursive: true });
      const fileName = `${crypto.randomUUID()}-${path.basename(attachmentName).replace(/[^A-Za-z0-9._-]/g, '_')}`;
      attachmentPath = path.join(currentDataDir, fileName);
      await fs.writeFile(attachmentPath, buffer, { mode: 0o600 });
      if (/\.xlsx?$/i.test(attachmentName)) {
        const parsedExcel = await parseExcelItems(buffer);
        rawText = parsedExcel.text;
        items = parsedExcel.items;
      } else {
        rawText = await attachmentText(buffer, attachmentName);
        items = parseItems(rawText);
      }
    }
    const listValues = {
      gmail_message_id: message.id,
      gmail_thread_id: message.threadId || '',
      subject: subject.slice(0, 500),
      sender: header(message, 'From').slice(0, 500),
      received_by: existing?.received_by || connection.gmail_email,
      ship_to: parsed.shipTo,
      site_id: site[0]?.id || null,
      packing_date: parsed.packingDate,
      packing_time: parsed.packingTime,
      received_at: message.internalDate ? new Date(Number(message.internalDate)) : null,
      attachment_name: attachmentName,
      attachment_path: attachmentPath,
      raw_text: rawText.slice(0, 100000),
    };
    let listId: number;
    if (existing) {
      if (existing.attachment_path && existing.attachment_path !== attachmentPath) await fs.unlink(existing.attachment_path).catch(() => undefined);
      await db.update(applecarePackingLists).set(listValues).where(eq(applecarePackingLists.id, existing.id));
      await db.delete(applecarePackingListItems).where(eq(applecarePackingListItems.packing_list_id, existing.id));
      listId = existing.id;
    } else {
      const [inserted] = await db.insert(applecarePackingLists).values(listValues).$returningId();
      listId = inserted.id;
    }
    if (items.length) await db.insert(applecarePackingListItems).values(items.map((item) => ({ ...item, packing_list_id: listId })));
    imported++;
  }
  return imported;
}

async function syncConnection(connection: typeof applecareGmailConnections.$inferSelect) {
  if (activeSyncs.has(connection.id)) return null;
  activeSyncs.add(connection.id);
  try {
    const imported = await performSyncConnection(connection);
    await getDb().update(applecareGmailConnections).set({ last_synced_at: new Date() }).where(eq(applecareGmailConnections.id, connection.id));
    return imported;
  }
  finally { activeSyncs.delete(connection.id); }
}

router.get('/gmail/connect', (req: Request, res: Response) => {
  try {
    const c = config();
    const params = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: OAUTH_SCOPE, state: encodeState(req.user!.userId) });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  } catch (error) { res.status(503).json({ error: (error as Error).message }); }
});

router.get('/gmail/callback', async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const userId = typeof req.query.state === 'string' ? decodeState(req.query.state) : null;
  if (!userId || typeof req.query.code !== 'string') { res.redirect(`${frontendUrl}/applecare?error=gmail_authorization_failed`); return; }
  try {
    const c = config();
    const body = new URLSearchParams({ code: req.query.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: 'authorization_code' });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; error?: string };
    if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) throw new Error(tokens.error || 'Google did not return a refresh token');
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profileData = await profile.json() as { emailAddress?: string };
    const db = getDb();
    await db.insert(applecareGmailConnections).values({ user_id: userId, gmail_email: profileData.emailAddress || 'connected Gmail', refresh_token_encrypted: encrypt(tokens.refresh_token, c.key) }).onDuplicateKeyUpdate({ set: { gmail_email: profileData.emailAddress || 'connected Gmail', refresh_token_encrypted: encrypt(tokens.refresh_token, c.key) } });
    void writeAuditLog({ actorUserId: userId, action: 'applecare.gmail_connected', resourceType: 'gmail_connection' });
    res.redirect(`${frontendUrl}/applecare?connected=1`);
  } catch (error) { res.redirect(`${frontendUrl}/applecare?error=${encodeURIComponent((error as Error).message)}`); }
});

router.get('/status', async (req: Request, res: Response) => {
  const [connection] = await getDb().select({ id: applecareGmailConnections.id, email: applecareGmailConnections.gmail_email, lastSyncedAt: applecareGmailConnections.last_synced_at }).from(applecareGmailConnections).where(eq(applecareGmailConnections.user_id, req.user!.userId)).limit(1);
  res.json({ connected: !!connection, email: connection?.email || null, lastSyncedAt: connection?.lastSyncedAt || null });
});

router.delete('/gmail/disconnect', async (req: Request, res: Response) => {
  const db = getDb();
  const [connection] = await db.select().from(applecareGmailConnections).where(eq(applecareGmailConnections.user_id, req.user!.userId)).limit(1);
  if (connection) {
    try {
      const token = await tokenFor(connection);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch {
      // The local connection is still removed if Google already invalidated it.
    }
    await db.delete(applecareGmailConnections).where(eq(applecareGmailConnections.user_id, req.user!.userId));
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'applecare.gmail_disconnected', resourceType: 'gmail_connection' });
  }
  res.json({ message: 'Gmail disconnected' });
});

router.post('/sync', async (req: Request, res: Response) => {
  const [connection] = await getDb().select().from(applecareGmailConnections).where(eq(applecareGmailConnections.user_id, req.user!.userId)).limit(1);
  if (!connection) { res.status(400).json({ error: 'Connect Gmail first' }); return; }
  try { res.json({ imported: (await syncConnection(connection)) ?? 0 }); }
  catch (error) { res.status(502).json({ error: (error as Error).message }); }
});

router.get('/lists', async (req: Request, res: Response) => {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  let accountFilter: string | null = null;
  if (req.user!.roleName !== 'Admin') {
    const [connection] = await db.select({ email: applecareGmailConnections.gmail_email })
      .from(applecareGmailConnections)
      .where(eq(applecareGmailConnections.user_id, req.user!.userId))
      .limit(1);
    if (!connection) { res.json([]); return; }
    accountFilter = connection.email;
  }
  const visibility = accountFilter ? eq(applecarePackingLists.received_by, accountFilter) : undefined;
  const rows = await db.select({
    list: applecarePackingLists,
    siteName: applecareSites.site_name,
    totalQuantity: sql<number>`COALESCE((SELECT SUM(quantity) FROM applecare_packing_list_items WHERE packing_list_id = ${applecarePackingLists.id}), 0)`,
  }).from(applecarePackingLists).leftJoin(applecareSites, eq(applecarePackingLists.site_id, applecareSites.id)).where(visibility ? and(gte(applecarePackingLists.received_at, cutoff), visibility) : gte(applecarePackingLists.received_at, cutoff)).orderBy(desc(applecarePackingLists.received_at), desc(applecarePackingLists.id)).limit(500);
  res.json(rows.map(({ list, siteName, totalQuantity }) => ({ ...list, site_name: siteName || null, total_quantity: Number(totalQuantity) || 0, email_url: `https://mail.google.com/mail/u/0/#all/${list.gmail_message_id}` })));
});

router.get('/lists/:id', async (req: Request, res: Response) => {
  const [list] = await getDb().select().from(applecarePackingLists).where(eq(applecarePackingLists.id, Number(req.params.id))).limit(1);
  if (!list) { res.status(404).json({ error: 'Packing list not found' }); return; }
  if (req.user!.roleName !== 'Admin') {
    const [connection] = await getDb().select({ email: applecareGmailConnections.gmail_email })
      .from(applecareGmailConnections)
      .where(eq(applecareGmailConnections.user_id, req.user!.userId))
      .limit(1);
    if (!connection || list.received_by !== connection.email) { res.status(404).json({ error: 'Packing list not found' }); return; }
  }
  const items = await getDb().select().from(applecarePackingListItems).where(eq(applecarePackingListItems.packing_list_id, list.id));
  res.json({ ...list, items: items.map((item) => ({ ...item, po_no: item.po_no || purchaseNumberFromStoredRow(item.raw_text, list.attachment_name) })) });
});

router.get('/lists/:id/attachment', async (req: Request, res: Response) => {
  const [list] = await getDb().select().from(applecarePackingLists).where(eq(applecarePackingLists.id, Number(req.params.id))).limit(1);
  if (!list?.attachment_path) { res.status(404).json({ error: 'Attachment not found' }); return; }
  if (req.user!.roleName !== 'Admin') {
    const [connection] = await getDb().select({ email: applecareGmailConnections.gmail_email })
      .from(applecareGmailConnections)
      .where(eq(applecareGmailConnections.user_id, req.user!.userId))
      .limit(1);
    if (!connection || list.received_by !== connection.email) { res.status(404).json({ error: 'Attachment not found' }); return; }
  }
  const attachmentPath = await findAttachmentPath(list.attachment_path, list.attachment_name);
  if (!attachmentPath) { res.status(404).json({ error: 'Attachment is no longer available. Sync Gmail to download it again.' }); return; }
  res.download(attachmentPath, list.attachment_name || 'packing-list', (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Attachment is no longer available.' });
  });
});

router.get('/sites', async (_req, res) => res.json(await getDb().select().from(applecareSites).orderBy(applecareSites.site_name)));
router.post('/sites', requireAdmin, async (req: Request, res: Response) => {
  try {
    await ensureApplecareTables();
    const shipTo = String(req.body?.shipTo || '').trim();
    const siteName = String(req.body?.siteName || '').trim();
    if (!/^\d{4,30}$/.test(shipTo) || !siteName) { res.status(400).json({ error: 'Valid ShipTo number and site name are required' }); return; }
    const [id] = await getDb().insert(applecareSites).values({ ship_to: shipTo, site_name: siteName, created_by: req.user!.userId }).$returningId();
    const [created] = await getDb().select().from(applecareSites).where(eq(applecareSites.id, id.id)).limit(1);
    res.status(201).json(created);
  } catch (error) {
    console.error('[applecare] site mapping create failed:', error);
    const message = (error as { code?: string }).code === 'ER_DUP_ENTRY' ? 'That ShipTo number is already mapped.' : 'Could not save the site mapping.';
    res.status(500).json({ error: message });
  }
});
router.put('/sites/:id', requireAdmin, async (req: Request, res: Response) => {
  const siteName = String(req.body?.siteName || '').trim();
  if (!siteName) { res.status(400).json({ error: 'Site name is required' }); return; }
  const [site] = await getDb().select().from(applecareSites).where(eq(applecareSites.id, Number(req.params.id))).limit(1);
  if (!site) { res.status(404).json({ error: 'Site mapping not found' }); return; }
  await getDb().update(applecareSites).set({ site_name: siteName }).where(eq(applecareSites.id, site.id));
  const [updated] = await getDb().select().from(applecareSites).where(eq(applecareSites.id, site.id)).limit(1);
  res.json(updated);
});

export default router;
