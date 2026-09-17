import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { verifyAccessToken } from '../auth.js';
import { isMember } from './store.js';

const clients = new Map<WebSocket, { sessionId: number; scannerId: string; scanning: boolean; ip: string }>();
const sessions = new Map<number, Set<WebSocket>>();
const heartbeats = new Map<WebSocket, number>();

let wss: WebSocketServer;

export function initWs() {
  // noServer: a single upgrade router in index.ts dispatches by pathname.
  // (A second { server, path } instance would 400 every foreign upgrade.)
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws, request) => {
    const auth = await getSessionAuth(request);
    if (!auth) {
      ws.close(1008, 'Authentication required');
      return;
    }

    let joined = false;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { type, sessionId, scannerId, scanning } = msg;

        if (type === 'join' && sessionId && scannerId) {
          const isAllowed = await isMember(sessionId, auth.userId);
          if (!isAllowed) {
            ws.send(JSON.stringify({ type: 'join_error', error: 'You do not have access to this session' }));
            return;
          }
          clients.set(ws, { sessionId, scannerId, scanning: scanning === true, ip: getClientIp(request) });
          if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
          sessions.get(sessionId)!.add(ws);
          joined = true;
          heartbeats.set(ws, Date.now());
          broadcastScannerCount(sessionId);
          ws.send(JSON.stringify({ type: 'joined', sessionId }));
          return;
        }

        if (type === 'set_scanning' && joined) {
          const info = clients.get(ws);
          if (info) {
            clients.set(ws, { ...info, scanning: scanning === true });
            broadcastScannerCount(info.sessionId);
          }
          return;
        }

        if (type === 'heartbeat' && joined) {
          const info = clients.get(ws);
          if (info) {
            heartbeats.set(ws, Date.now());
          }
          return;
        }
      } catch {}
    });

    ws.on('close', () => {
      const info = clients.get(ws);
      if (info) {
        heartbeats.delete(ws);
        sessions.get(info.sessionId)?.delete(ws);
        if (sessions.get(info.sessionId)?.size === 0) sessions.delete(info.sessionId);
        clients.delete(ws);
        broadcastScannerCount(info.sessionId);
      }
    });

    ws.on('error', () => {});
  });

  setInterval(() => {
    const now = Date.now();
    for (const [ws, time] of heartbeats) {
      if (now - time > 30_000) {
        const sessionId = clients.get(ws)?.sessionId;
        heartbeats.delete(ws);
        if (sessionId !== undefined) broadcastScannerCount(sessionId);
      }
    }
  }, 15_000);
}

export function upgradeToPcountWs(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!wss) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
}

async function getSessionAuth(request: IncomingMessage): Promise<{ userId: number } | null> {
  const token = request.headers.cookie
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('token='))
    ?.slice('token='.length);
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(decodeURIComponent(token));
    return payload ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}

function getClientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const realIp = request.headers['x-real-ip'];
  const rawIp = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : typeof realIp === 'string' ? realIp : request.socket.remoteAddress || 'unknown';
  const normalized = rawIp.replace(/^::ffff:/, '');
  return normalized === '::1' ? '127.0.0.1' : normalized;
}

export function getScannerCountWs(sessionId: number): number {
  const ips = new Set<string>();
  const now = Date.now();
  for (const [ws, info] of clients) {
    const heartbeat = heartbeats.get(ws);
    if (info.sessionId === sessionId && info.scanning && ws.readyState === WebSocket.OPEN && heartbeat && now - heartbeat <= 30_000) {
      ips.add(info.ip);
    }
  }
  return ips.size;
}

export function getOnlineCountWs(sessionId: number): number {
  const ips = new Set<string>();
  const now = Date.now();
  for (const [ws, info] of clients) {
    const heartbeat = heartbeats.get(ws);
    if (info.sessionId === sessionId && ws.readyState === WebSocket.OPEN && heartbeat && now - heartbeat <= 30_000) {
      ips.add(info.ip);
    }
  }
  return ips.size;
}

function broadcastScannerCount(sessionId: number) {
  if (!sessions.has(sessionId)) return;
  const count = getScannerCountWs(sessionId);
  const msg = JSON.stringify({ type: 'scanner_count', count, online: getOnlineCountWs(sessionId) });
  for (const ws of sessions.get(sessionId)!) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function broadcast(sessionId: number, data: object) {
  if (!sessions.has(sessionId)) return;
  const msg = JSON.stringify(data);
  for (const ws of sessions.get(sessionId)!) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
