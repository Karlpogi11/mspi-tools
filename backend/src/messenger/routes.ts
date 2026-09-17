import { Router, Request, Response } from 'express';
import Excel from 'exceljs';
import { getDbPool } from '../db/index.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureMessengerTables, type MessengerChannel, type MessengerMessage } from './store.js';
import { broadcastToChannel } from './ws.js';
import { linkifyRefs } from './bot.js';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_FILES_PER_MESSAGE,
  photoUpload,
  resolvePhoto,
  storePhoto,
  type StoredPhoto,
} from './photos.js';
import { listSheetsFor, messengerSheetStatus, pushBackupToSheet } from './sheets.js';

const router = Router();
let ready = false;

async function readyDb(_req: Request, res: Response, next: () => void) {
  try {
    if (!ready) {
      await ensureMessengerTables();
      ready = true;
    }
    next();
  } catch {
    res.status(503).json({ error: 'Messenger database is unavailable' });
  }
}

router.use(readyDb);

function bad(res: Response, message: string, code = 400) {
  res.status(code).json({ error: message });
}
function text(value: unknown, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

/** GET /api/messenger/channels — membership auto-joins general channels. */
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const [channels] = await getDbPool().query(
      `SELECT c.id, c.name, c.topic, c.kind,
        (SELECT COUNT(*) FROM messenger_messages m
          LEFT JOIN messenger_members mm ON mm.channel_id = m.channel_id AND mm.user_id = ?
          WHERE m.channel_id = c.id AND m.id > COALESCE(mm.last_read_id, 0)) AS unread
      FROM messenger_channels c ORDER BY c.name`,
      [userId]
    );
    // Lazy-join every channel so v1 has no invite flow.
    const rows = channels as MessengerChannel[];
    for (const c of rows) {
      await getDbPool().query('INSERT IGNORE INTO messenger_members (channel_id, user_id) VALUES (?, ?)', [c.id, userId]);
    }
    res.json({ channels: rows });
  } catch (error) {
    console.error('Messenger channels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/channels', async (req: Request, res: Response) => {
  const name = text(req.body?.name, 100).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  if (!name) return bad(res, 'Channel name is required.');
  try {
    const [result] = await getDbPool().query(
      'INSERT INTO messenger_channels (name, topic, created_by) VALUES (?, ?, ?)',
      [name, text(req.body?.topic, 255), req.user!.userId]
    );
    const id = Number((result as { insertId?: number }).insertId || 0);
    await writeAuditLog({ actorUserId: req.user!.userId, action: 'messenger.channel.create', resourceType: 'messenger_channel', resourceId: String(id), metadata: { name } });
    res.json({ id, name });
  } catch {
    return bad(res, 'Channel already exists.');
  }
});

/** GET /api/messenger/channels/:id/messages?cursor=&limit= */
router.get('/channels/:id/messages', async (req: Request, res: Response) => {
  try {
    const channelId = Number(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const cursor = Number(req.query.cursor) || 0;
    if (!Number.isInteger(channelId)) return bad(res, 'Invalid channel.');
    const extra = cursor > 0 ? 'AND m.id < ?' : '';
    const params = cursor > 0 ? [channelId, cursor, limit] : [channelId, limit];
    const [rows] = await getDbPool().query(
      `SELECT m.*, u.full_name AS member_name FROM messenger_messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel_id = ? ${extra} ORDER BY m.id DESC LIMIT ?`,
      params
    );
    const messages = (rows as Array<MessengerMessage & { member_name?: string }>).reverse().map((m) => ({
      ...m,
      author_name: m.author_name || m.member_name || 'Unknown',
      meta: typeof m.meta === 'string' ? safeJson(m.meta) : m.meta,
    }));
    res.json({ messages });
  } catch (error) {
    console.error('Messenger messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function safeJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Resolve AR numbers and bare repair numbers to endorsement ids. */
async function resolveEndorsementIds(refs: { ars: string[]; repairs: string[] }): Promise<number[]> {
  const candidates = [
    ...refs.ars.map((a) => a.replace(/^AR-/i, '')),
    ...refs.repairs,
  ].filter(Boolean);
  if (candidates.length === 0) return [];
  const [rows] = await getDbPool().query(
    'SELECT id FROM engineer_endorsements WHERE UPPER(ar_number) IN (?)',
    [candidates]
  );
  return (rows as Array<{ id: number }>).map((r) => Number(r.id)).filter((id) => Number.isInteger(id));
}

function toClientMessage(m: MessengerMessage & { member_name?: string }): MessengerMessage {
  return {
    ...m,
    author_name: m.author_name || m.member_name || 'Unknown',
    meta: typeof m.meta === 'string' ? (safeJson(m.meta) as MessengerMessage['meta']) : m.meta,
  };
}

export interface PulseAssignment {
  name: string;
  user_id: number | null;
  status: 'open' | 'acked' | 'done';
  by: string | null;
}

function extractMentionNames(body: string): string[] {
  const names: string[] = [];
  const re = /(^|\s)@([A-Za-z][A-Za-z.'\-]*(?: +[A-Za-z][A-Za-z.'\-]*){0,3})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const name = match[2].replace(/[.\s]+$/g, '').trim();
    const first = name.split(/\s+/)[0]?.toLowerCase();
    if (!name || first === 'all' || first === 'everyone') continue;
    if (names.length < 5 && !names.includes(name)) names.push(name);
  }
  return names;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Map @mentions to users: try the full capture, then progressively shorter
 *  prefixes ("Ray pullout na" → "Ray"). Exact full-name wins, else a unique
 *  first-name match. Unmatched names stay visible but unassigned. */
async function resolveAssignments(body: string): Promise<PulseAssignment[]> {
  const names = extractMentionNames(body);
  if (names.length === 0) return [];
  const [rows] = await getDbPool().query('SELECT id, full_name FROM users');
  const users = rows as Array<{ id: number; full_name: string }>;
  const seen = new Set<number>();
  const assignments: PulseAssignment[] = [];
  for (const raw of names) {
    const normWords = normalizeName(raw).split(' ').filter(Boolean);
    const rawWords = raw.split(/\s+/);
    let match: { id: number; full_name: string } | null = null;
    let display = raw;
    for (let len = Math.min(normWords.length, 4); len >= 1 && !match; len--) {
      const candidate = normWords.slice(0, len).join(' ');
      const exact = users.filter((u) => normalizeName(u.full_name) === candidate);
      if (exact.length === 1) {
        match = exact[0];
        display = rawWords.slice(0, len).join(' ');
        break;
      }
      if (len === 1) {
        const firsts = users.filter((u) => normalizeName(u.full_name).split(' ')[0] === candidate);
        if (firsts.length === 1) {
          match = firsts[0];
          display = rawWords[0];
        }
      }
    }
    if (match && seen.has(match.id)) continue;
    if (match) seen.add(match.id);
    assignments.push({ name: display, user_id: match ? match.id : null, status: 'open', by: null });
  }
  return assignments;
}

router.post('/channels/:id/messages', async (req: Request, res: Response) => {
  try {
    const channelId = Number(req.params.id);
    const body = text(req.body?.body);
    if (!Number.isInteger(channelId)) return bad(res, 'Invalid channel.');
    if (!body) return bad(res, 'Message is empty.');
    const pool = getDbPool();
    const [userRows] = await pool.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user!.userId]);
    const author = String((userRows as Array<{ full_name: string }>)[0]?.full_name || req.user!.email);
    const refs = linkifyRefs(body);
    const meta = { refs, endorsement_ids: await resolveEndorsementIds(refs), assignments: await resolveAssignments(body) };
    const [result] = await pool.query(
      `INSERT INTO messenger_messages (channel_id, user_id, author_name, body, kind, meta)
      VALUES (?, ?, ?, ?, 'chat', ?)`,
      [channelId, req.user!.userId, author, body, JSON.stringify(meta)]
    );
    const id = Number((result as { insertId?: number }).insertId || 0);
    const [rows] = await pool.query('SELECT * FROM messenger_messages WHERE id = ? LIMIT 1', [id]);
    const message = (rows as MessengerMessage[])[0];
    if (message) broadcastToChannel(channelId, { type: 'message.created', message: { ...message, meta } });
    res.json({ message: message ? { ...message, meta } : null });
  } catch (error) {
    console.error('Messenger send error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/channels/:id/read', async (req: Request, res: Response) => {
  try {
    const channelId = Number(req.params.id);
    const lastId = Number(req.body?.lastId) || 0;
    if (!Number.isInteger(channelId)) return bad(res, 'Invalid channel.');
    await getDbPool().query(
      'INSERT INTO messenger_members (channel_id, user_id, last_read_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id))',
      [channelId, req.user!.userId, lastId]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Messenger mark-read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/messenger/channels/:id/members — for @mention display (no global directory). */
router.get('/channels/:id/members', async (req: Request, res: Response) => {
  try {
    const channelId = Number(req.params.id);
    if (!Number.isInteger(channelId)) return bad(res, 'Invalid channel.');
    const [rows] = await getDbPool().query(
      `SELECT u.id AS user_id, u.full_name FROM messenger_members mm
       JOIN users u ON u.id = mm.user_id WHERE mm.channel_id = ? ORDER BY u.full_name`,
      [channelId]
    );
    res.json({ members: rows });
  } catch (error) {
    console.error('Messenger members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/messenger/channels/:id/messages/:msgId/assignment — ack / done / reopen. */
router.post('/channels/:id/messages/:msgId/assignment', async (req: Request, res: Response) => {
  try {
    const channelId = Number(req.params.id);
    const msgId = Number(req.params.msgId);
    const index = Number(req.body?.index);
    const action = String(req.body?.action || '');
    if (!Number.isInteger(channelId) || !Number.isInteger(msgId) || !Number.isInteger(index)) {
      return bad(res, 'Invalid request.');
    }
    if (!['ack', 'done', 'reopen'].includes(action)) return bad(res, 'Invalid action.');
    const pool = getDbPool();
    const [rows] = await pool.query(
      'SELECT * FROM messenger_messages WHERE id = ? AND channel_id = ? LIMIT 1',
      [msgId, channelId]
    );
    const row = (rows as MessengerMessage[])[0];
    if (!row) return bad(res, 'Message not found.', 404);
    const meta = (typeof row.meta === 'string' ? safeJson(row.meta) : row.meta) as
      (Record<string, unknown> & { assignments?: PulseAssignment[] }) | null;
    const assignments = Array.isArray(meta?.assignments) ? meta!.assignments! : [];
    const target = assignments[index];
    if (!target) return bad(res, 'Assignment not found.', 404);
    const [userRows] = await pool.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user!.userId]);
    const by = String((userRows as Array<{ full_name: string }>)[0]?.full_name || req.user!.email);
    target.status = (action === 'reopen' ? 'open' : action) as PulseAssignment['status'];
    target.by = action === 'reopen' ? null : by;
    await pool.query('UPDATE messenger_messages SET meta = ? WHERE id = ? LIMIT 1', [JSON.stringify({ ...meta, assignments }), msgId]);
    const [fresh] = await pool.query('SELECT * FROM messenger_messages WHERE id = ? LIMIT 1', [msgId]);
    const message = (fresh as MessengerMessage[])[0];
    if (message) broadcastToChannel(channelId, { type: 'message.updated', message: toClientMessage(message) });
    res.json({ message: message ? toClientMessage(message) : null });
  } catch (error) {
    console.error('Messenger assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/messenger/endorsements/:id/messages — Pulse threads linked to an endorsement. */
router.get('/endorsements/:id/messages', async (req: Request, res: Response) => {
  try {
    const endorsementId = Number(req.params.id);
    if (!Number.isInteger(endorsementId) || endorsementId <= 0) return bad(res, 'Invalid endorsement.');
    const [rows] = await getDbPool().query(
      `SELECT m.*, u.full_name AS member_name FROM messenger_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE JSON_CONTAINS(m.meta, ?, '$.endorsement_ids')
       ORDER BY m.id ASC LIMIT 200`,
      [JSON.stringify(endorsementId)]
    );
    const messages = (rows as Array<MessengerMessage & { member_name?: string }>).map(toClientMessage);
    res.json({ messages });
  } catch (error) {
    console.error('Messenger endorsement messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/messenger/repairs/:number/timeline — endorsement record + every mentioning message. */
router.get('/repairs/:number/timeline', async (req: Request, res: Response) => {
  try {
    const number = String(req.params.number);
    if (!/^200\d{5}$/.test(number)) return bad(res, 'Invalid repair number.');
    const pool = getDbPool();
    const [endorsementRows] = await pool.query(
      `SELECT e.id, e.ar_number, e.device_model, e.issue, e.product_division, e.status,
              e.engineer_name, e.created_at, cso.full_name AS cso_name
       FROM engineer_endorsements e LEFT JOIN users cso ON cso.id = e.cso_user_id
       WHERE e.ar_number = ? ORDER BY e.id DESC LIMIT 5`,
      [number]
    );
    const [msgRows] = await pool.query(
      `SELECT m.*, u.full_name AS member_name FROM messenger_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.body LIKE ? ORDER BY m.id DESC LIMIT 100`,
      [`%${number}%`]
    );
    const messages = (msgRows as Array<MessengerMessage & { member_name?: string }>).reverse().map(toClientMessage);
    res.json({ endorsement: (endorsementRows as Array<Record<string, unknown>>)[0] ?? null, endorsements: endorsementRows, messages });
  } catch (error) {
    console.error('Messenger repair timeline error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/messenger/photos/:id?kind=thumb|full — cookie-JWT auth inherited from mount. */
router.get('/photos/:id', async (req: Request, res: Response) => {
  try {
    const kind = req.query.kind === 'full' ? 'full' : 'thumb';
    const filePath = resolvePhoto(kind, String(req.params.id));
    if (!filePath) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  } catch (error) {
    console.error('Messenger photo serve error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    else res.end();
  }
});

/** POST /api/messenger/channels/:id/photos — multipart (photos[] + optional caption). */
router.post('/channels/:id/photos', (req: Request, res: Response) => {
  photoUpload.array('photos', MAX_PHOTO_FILES_PER_MESSAGE)(req, res, (err: unknown) => {
    void handlePhotoUpload(req, res, err);
  });
});

async function handlePhotoUpload(req: Request, res: Response, err: unknown): Promise<void> {
  try {
    if (err) {
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') return bad(res, `Each photo must be ${MAX_PHOTO_BYTES / 1024 / 1024}MB or fewer.`);
      if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
        return bad(res, `Up to ${MAX_PHOTO_FILES_PER_MESSAGE} photos per message.`);
      }
      return bad(res, 'Photo upload failed.');
    }
    const channelId = Number(req.params.id);
    if (!Number.isInteger(channelId)) return bad(res, 'Invalid channel.');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return bad(res, 'No photos attached.');
    const caption = text(req.body?.caption);
    const stored: StoredPhoto[] = [];
    try {
      for (const file of files) {
        stored.push(await storePhoto(file.path));
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Only ')) return bad(res, error.message);
      throw error;
    }
    const pool = getDbPool();
    const [userRows] = await pool.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [req.user!.userId]);
    const author = String((userRows as Array<{ full_name: string }>)[0]?.full_name || req.user!.email);
    const refs = linkifyRefs(caption);
    const attachments = stored.map((s) => ({ id: s.id, w: s.width, h: s.height, bytes: s.bytes }));
    const meta = { refs, attachments, endorsement_ids: await resolveEndorsementIds(refs), assignments: await resolveAssignments(caption) };
    const [result] = await pool.query(
      `INSERT INTO messenger_messages (channel_id, user_id, author_name, body, kind, meta)
       VALUES (?, ?, ?, ?, 'chat', ?)`,
      [channelId, req.user!.userId, author, caption, JSON.stringify(meta)]
    );
    const id = Number((result as { insertId?: number }).insertId || 0);
    const [rows] = await pool.query('SELECT * FROM messenger_messages WHERE id = ? LIMIT 1', [id]);
    const message = (rows as MessengerMessage[])[0];
    if (message) {
      broadcastToChannel(channelId, { type: 'message.created', message: { ...message, meta } });
    }
    res.json({ message: message ? { ...message, meta } : null });
  } catch (error) {
    console.error('Messenger photo upload error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    else res.end();
  }
}

/** GET /api/messenger/export.xlsx?channelId= — raw backup to Excel. */
router.get('/export.xlsx', async (req: Request, res: Response) => {
  try {
    const channelId = Number(req.query.channelId) || 0;
    const where = channelId > 0 ? 'WHERE m.channel_id = ?' : '';
    const params = channelId > 0 ? [channelId] : [];
    const [rows] = await getDbPool().query(
      `SELECT m.id, c.name AS channel, m.author_name, m.kind, m.body, m.created_at
      FROM messenger_messages m JOIN messenger_channels c ON c.id = m.channel_id
      ${where} ORDER BY m.id DESC LIMIT 5000`,
      params
    );
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet('pulse-backup');
    ws.columns = [
      { header: 'Message ID', key: 'id', width: 12 },
      { header: 'Timestamp', key: 'created_at', width: 22 },
      { header: 'Channel', key: 'channel', width: 20 },
      { header: 'Author', key: 'author_name', width: 24 },
      { header: 'Kind', key: 'kind', width: 10 },
      { header: 'Body', key: 'body', width: 80 },
    ];
    for (const r of rows as Array<Record<string, unknown>>) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="pulse-backup.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Messenger export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    else res.end();
  }
});

// ---- Google Sheet backup: paste sheet ID + choose tab (Parts-style) ----
router.get('/sheets/status', async (req: Request, res: Response) => {
  try {
    res.json(await messengerSheetStatus(req.user!.userId));
  } catch (error) {
    console.error('Messenger sheet status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sheets/config', async (_req: Request, res: Response) => {
  try {
    const [rows] = await getDbPool().query('SELECT spreadsheet_id, spreadsheet_name, sheet_name FROM messenger_sheet_config WHERE id = 1 LIMIT 1');
    res.json({ config: (rows as Array<Record<string, string>>)[0] ?? null });
  } catch (error) {
    console.error('Messenger sheet config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sheets/config', async (req: Request, res: Response) => {
  try {
    const spreadsheetId = text(req.body?.spreadsheetId, 255);
    const spreadsheetName = text(req.body?.spreadsheetName, 255);
    const sheetName = text(req.body?.sheetName, 255);
    if (!spreadsheetId || !sheetName) return bad(res, 'Spreadsheet ID and tab name are required.');
    await getDbPool().query(
      `INSERT INTO messenger_sheet_config (id, spreadsheet_id, spreadsheet_name, sheet_name, updated_by)
      VALUES (1, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE spreadsheet_id = VALUES(spreadsheet_id),
      spreadsheet_name = VALUES(spreadsheet_name), sheet_name = VALUES(sheet_name), updated_by = VALUES(updated_by)`,
      [spreadsheetId, spreadsheetName, sheetName, req.user!.userId]
    );
    res.json({ message: 'Backup sheet saved.' });
  } catch (error) {
    console.error('Messenger sheet save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sheets/tabs', async (req: Request, res: Response) => {
  const spreadsheetId = text(req.query.spreadsheetId, 255);
  if (!spreadsheetId) return bad(res, 'Spreadsheet ID is required.');
  try {
    res.json(await listSheetsFor(spreadsheetId, req.user!.userId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not list tabs.' });
  }
});

router.post('/sheets/backup', async (req: Request, res: Response) => {
  const channelId = Number(req.body?.channelId) || 0;
  const [cfgRows] = await getDbPool().query('SELECT spreadsheet_id, sheet_name FROM messenger_sheet_config WHERE id = 1 LIMIT 1');
  const cfg = (cfgRows as Array<{ spreadsheet_id: string; sheet_name: string }>)[0];
  if (!cfg?.spreadsheet_id || !cfg?.sheet_name) return bad(res, 'Save a spreadsheet ID and tab first.');
  const where = channelId > 0 ? 'AND m.channel_id = ?' : '';
  const params = channelId > 0 ? [channelId] : [];
  const [rows] = await getDbPool().query(
    `SELECT m.id, c.name AS channel, m.author_name AS author, m.kind, m.body, m.created_at
     FROM messenger_messages m JOIN messenger_channels c ON c.id = m.channel_id
     WHERE 1=1 ${where} ORDER BY m.id DESC LIMIT 2000`,
    params
  );
  try {
    const pushed = await pushBackupToSheet(
      req.user!.userId,
      cfg.spreadsheet_id,
      cfg.sheet_name,
      (rows as Array<{ channel: string; author: string; kind: string; body: string; id: number; created_at: string }>).map((r) => ({
        ...r,
        created_at: String(r.created_at),
      }))
    );
    await writeAuditLog({ actorUserId: req.user!.userId, action: 'messenger.sheets.backup', resourceType: 'messenger_backup', resourceId: cfg.spreadsheet_id, metadata: { pushed } });
    res.json({ pushed });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Backup failed.' });
  }
});

/** GET /api/messenger/mac-app/version — Sparkle/Tauri updater + download page. Free: GitHub Releases. */
router.get('/mac-app/version', (_req: Request, res: Response) => {
  res.json({
    name: 'MSPI Pulse',
    version: '0.1.0',
    notes: 'Initial Pulse desktop trial.',
    dmgUrl: '',
    exeUrl: '',
    vsixUrl: '',
    appcastUrl: 'https://tools.mspi.io/api/messenger/mac-app/appcast.xml',
    sha256: '',
    minOs: 'macOS 13 Ventura and later / Windows 10 and later',
  });
});

router.get('/mac-app/appcast.xml', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/rss+xml');
  res.send(`<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>MSPI Pulse</title><item><title>0.1.0</title><sparkle:version>1</sparkle:version><description>Initial trial.</description></item></channel></rss>`);
});

export default router;
