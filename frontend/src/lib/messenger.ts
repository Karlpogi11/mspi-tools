const BASE = import.meta.env.VITE_API_URL || '/api';

export interface PulseChannel {
  id: number;
  name: string;
  topic: string;
  kind: string;
  unread: number;
}

export interface PulseAttachment {
  id: string;
  w: number;
  h: number;
  bytes: number;
}

export interface PulseAssignment {
  name: string;
  user_id: number | null;
  status: 'open' | 'acked' | 'done';
  by: string | null;
}

export interface PulseMessage {
  id: number;
  channel_id: number;
  user_id: number | null;
  author_name: string;
  body: string;
  kind: string;
  meta: { refs?: { ars: string[]; serials: string[]; parts: string[]; repairs?: string[] }; attachments?: PulseAttachment[]; endorsement_ids?: number[]; assignments?: PulseAssignment[] } | null;
  created_at: string;
}

async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data as T;
}

export const pulseApi = {
  channels: () => json<{ channels: PulseChannel[] }>('/messenger/channels'),
  createChannel: (name: string, topic: string) =>
    json<{ id: number; name: string }>('/messenger/channels', { method: 'POST', body: JSON.stringify({ name, topic }) }),
  messages: (channelId: number, cursor = 0) =>
    json<{ messages: PulseMessage[] }>(`/messenger/channels/${channelId}/messages?cursor=${cursor}&limit=50`),
  endorsementMessages: (endorsementId: number) =>
    json<{ messages: PulseMessage[] }>(`/messenger/endorsements/${endorsementId}/messages`),
  repairTimeline: (number: string) =>
    json<{ endorsement: Record<string, unknown> | null; endorsements: Array<Record<string, unknown>>; messages: PulseMessage[] }>(`/messenger/repairs/${number}/timeline`),
  assignmentAction: (channelId: number, msgId: number, index: number, action: 'ack' | 'done' | 'reopen') =>
    json<{ message: PulseMessage | null }>(`/messenger/channels/${channelId}/messages/${msgId}/assignment`, { method: 'POST', body: JSON.stringify({ index, action }) }),
  send: (channelId: number, body: string) =>
    json<{ message: PulseMessage }>(`/messenger/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  sendPhotos: async (channelId: number, files: File[], caption: string): Promise<{ message: PulseMessage }> => {
    const form = new FormData();
    for (const file of files) form.append('photos', file);
    form.append('caption', caption);
    const res = await fetch(`${BASE}/messenger/channels/${channelId}/photos`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const data = (await res.json().catch(() => null)) as ({ message: PulseMessage } & { error?: string }) | null;
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data as { message: PulseMessage };
  },
  photoUrl: (id: string, kind: 'thumb' | 'full' = 'thumb') => `${BASE}/messenger/photos/${id}?kind=${kind}`,
  markRead: (channelId: number, lastId: number) =>
    json<{ ok: boolean }>(`/messenger/channels/${channelId}/read`, { method: 'POST', body: JSON.stringify({ lastId }) }),
  exportUrl: (channelId: number) => `${BASE}/messenger/export.xlsx${channelId > 0 ? `?channelId=${channelId}` : ''}`,
  sheetStatus: () => json<{ connected: boolean }>('/messenger/sheets/status'),
  sheetConfig: () => json<{ config: { spreadsheet_id: string; spreadsheet_name: string; sheet_name: string } | null }>('/messenger/sheets/config'),
  saveSheetConfig: (spreadsheetId: string, spreadsheetName: string, sheetName: string) =>
    json<{ message: string }>('/messenger/sheets/config', { method: 'POST', body: JSON.stringify({ spreadsheetId, spreadsheetName, sheetName }) }),
  sheetTabs: (spreadsheetId: string) =>
    json<{ title: string; sheets: string[] }>(`/messenger/sheets/tabs?spreadsheetId=${encodeURIComponent(spreadsheetId)}`),
  backupToSheet: (channelId: number) =>
    json<{ pushed: number }>('/messenger/sheets/backup', { method: 'POST', body: JSON.stringify({ channelId }) }),
  appVersion: () =>
    json<{ name: string; version: string; notes: string; dmgUrl: string; exeUrl: string; vsixUrl: string; appcastUrl: string; minOs: string }>('/messenger/mac-app/version'),
};

/** Cookie-JWT live rail. Tauri/SwiftUI reuse the same /ws-pulse path. */
export function connectPulseWs(channelIds: number[], onMessage: (channelId: number, message: PulseMessage, kind: 'created' | 'updated') => void): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}/ws-pulse`);
  const joinAll = () => {
    for (const id of channelIds) ws.send(JSON.stringify({ type: 'join', channelId: id }));
  };
  ws.onopen = joinAll;
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { type?: string; channelId?: number; message?: PulseMessage };
      if (data.type === 'message.created' && data.message) onMessage(data.message.channel_id, data.message, 'created');
      if (data.type === 'message.updated' && data.message) onMessage(data.message.channel_id, data.message, 'updated');
    } catch {
      /* ignore */
    }
  };
  const timer = window.setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 25000);
  return () => {
    window.clearInterval(timer);
    ws.close();
  };
}
