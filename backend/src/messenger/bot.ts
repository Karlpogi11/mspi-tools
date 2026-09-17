import { getDbPool } from '../db/index.js';
import { broadcastToChannel } from './ws.js';
import type { MessengerMessage } from './store.js';

/** Server-side bot poster. Other tool modules call postBotMessage() after
 *  domain events (endorsed, pcount submitted, stock moved) so chat stays in
 *  sync without polling. Free: no external push vendor at v1. */
export async function postBotMessage(
  channelName: string,
  body: string,
  meta: Record<string, unknown> = {}
): Promise<MessengerMessage | null> {
  const pool = getDbPool();
  const [chanRows] = await pool.query('SELECT id FROM messenger_channels WHERE name = ? LIMIT 1', [channelName]);
  const channel = (chanRows as Array<{ id: number }>)[0];
  if (!channel) return null;
  const [result] = await pool.query(
    `INSERT INTO messenger_messages (channel_id, user_id, author_name, body, kind, meta)
     VALUES (?, NULL, 'Pulse Bot', ?, 'bot', ?)`,
    [channel.id, body.slice(0, 4000), JSON.stringify(meta)]
  );
  const id = Number((result as { insertId?: number }).insertId || 0);
  const [rows] = await pool.query('SELECT * FROM messenger_messages WHERE id = ? LIMIT 1', [id]);
  const message = (rows as MessengerMessage[])[0] ?? null;
  if (message) broadcastToChannel(channel.id, { type: 'message.created', message });
  return message;
}

/** AR / serial / part / repair-number linkifier shared by web + desktop clients. */
export function linkifyRefs(body: string): { ars: string[]; serials: string[]; parts: string[]; repairs: string[] } {
  const ars = Array.from(new Set((body.match(/AR-\d{2,10}/gi) || []).map((s) => s.toUpperCase()))).slice(0, 10);
  const serials = Array.from(new Set((body.match(/\bSN-[A-Z0-9-]{3,30}\b/gi) || []).map((s) => s.toUpperCase()))).slice(0, 10);
  const parts = Array.from(new Set((body.match(/\b661-\d{4,6}\b/g) || []))).slice(0, 10);
  const repairs = Array.from(new Set((body.match(/\b200\d{5}\b/g) || []))).slice(0, 10);
  return { ars, serials, parts, repairs };
}
