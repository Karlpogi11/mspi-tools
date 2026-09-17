import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { verifyAccessToken } from '../auth.js';

const rooms = new Map<number, Set<WebSocket>>();
const pulseClients = new Set<WebSocket>();

export function broadcastPulse(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const ws of pulseClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(text); } catch { /* ignore disconnected clients */ }
    }
  }
}

function roomOf(channelId: number): Set<WebSocket> {
  let room = rooms.get(channelId);
  if (!room) {
    room = new Set();
    rooms.set(channelId, room);
  }
  return room;
}

export function broadcastToChannel(channelId: number, payload: unknown): void {
  const room = rooms.get(channelId);
  if (!room || room.size === 0) return;
  const text = JSON.stringify(payload);
  for (const ws of room) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(text);
      } catch {
        /* ignore slow clients */
      }
    }
  }
}

export function upgradeToPulseWs(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!wss) {
    socket.destroy();
    return;
  }
  const server = wss;
  server.handleUpgrade(req, socket, head, (ws) => {
    server.emit('connection', ws, req);
  });
}

async function tokenFrom(request: { url?: string; headers: Record<string, string | string[] | undefined> }): Promise<string | null> {
  const url = request.url || '';
  const query = url.split('?')[1] || '';
  const token = new URLSearchParams(query).get('token');
  if (token) return token;
  const cookie = request.headers.cookie;
  if (typeof cookie === 'string') {
    const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('token='));
    if (match) return decodeURIComponent(match.slice('token='.length));
  }
  return null;
}

let wss: WebSocketServer | null = null;

/** Live rail for Pulse chat + bot alerts. Cookie-JWT auth, same as /ws (pcount). */
export function initMessengerWs(): void {
  // noServer: the single upgrade router in index.ts dispatches by pathname.
  wss = new WebSocketServer({ noServer: true });
  wss.on('connection', async (ws, request) => {
    const token = await tokenFrom(request as unknown as { url?: string; headers: Record<string, string | string[] | undefined> });
    const payload = token ? await verifyAccessToken(token).catch(() => null) : null;
    if (!payload) {
      ws.close(1008, 'Authentication required');
      return;
    }
    pulseClients.add(ws);
    const joined = new Set<number>();
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; channelId?: number };
        if (msg.type === 'join' && Number.isInteger(msg.channelId)) {
          const id = Number(msg.channelId);
          roomOf(id).add(ws);
          joined.add(id);
          ws.send(JSON.stringify({ type: 'joined', channelId: id }));
          return;
        }
        if (msg.type === 'leave' && Number.isInteger(msg.channelId)) {
          const id = Number(msg.channelId);
          rooms.get(id)?.delete(ws);
          joined.delete(id);
          return;
        }
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('close', () => {
      pulseClients.delete(ws);
      for (const id of joined) rooms.get(id)?.delete(ws);
    });
    ws.on('error', () => {});
  });
}
