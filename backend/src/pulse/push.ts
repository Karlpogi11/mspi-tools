import webpush from 'web-push';
import { getDbPool } from '../db/index.js';
import type { PulseMessage, EndorsePayload, PartsRequestPayload, ReleasePayload, ShiftHandoverPayload, AlertPayload } from './types.js';

let configured = false;
function configure(): boolean {
  if (configured) return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  configured = true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@mspi.io';
  if (!publicKey || !privateKey) {
    console.warn('Pulse push disabled: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are missing.');
    return false;
  }
  webpush.setVapidDetails(email, publicKey, privateKey);
  return true;
}

function notificationFor(message: PulseMessage): { title: string; body: string; actions: Array<{ action: string; title: string }> } {
  switch (message.type) {
    case 'ENDORSE': { const p = message.payload as EndorsePayload; return { title: 'Endorsement Assigned', body: `AR#${p.arNumber} — ${p.deviceModel}\n${p.faultDescription}`, actions: [{ action: 'accept', title: 'Accept' }, { action: 'pass', title: 'Pass' }] }; }
    case 'PARTS_REQUEST': { const p = message.payload as PartsRequestPayload; return { title: 'Parts Request', body: `AR#${p.arNumber} needs ${p.partNumber}`, actions: [{ action: 'fulfill', title: 'Fulfill' }] }; }
    case 'RELEASE': { const p = message.payload as ReleasePayload; return { title: 'Ready for Release', body: `AR#${p.arNumber} — ${p.customerName}`, actions: [] }; }
    case 'SHIFT_HANDOVER': { const p = message.payload as ShiftHandoverPayload; return { title: 'Shift Handover', body: `${p.totalOpen} open items`, actions: [] }; }
    case 'ALERT': { const p = message.payload as AlertPayload; return { title: 'Alert', body: p.message, actions: [] }; }
    default: return { title: `Pulse: ${message.type.replace('_', ' ')}`, body: message.ar_number ? `AR#${message.ar_number}` : 'New operational update', actions: [] };
  }
}

export async function sendPushToTargetUsers(message: PulseMessage): Promise<void> {
  try {
    if (!configure()) return;
    const pool = getDbPool();
    const roleFilter = message.target_role === 'ALL' ? '' : ' AND (u.role_id IN (SELECT id FROM roles WHERE name = ?) OR u.is_super_admin = 1)';
    const params: Array<number | string> = message.target_user_id ? [message.target_user_id] : [message.target_role];
    const [rows] = await pool.query(`SELECT s.id, s.endpoint, s.p256dh, s.auth FROM pulse_subscriptions s JOIN users u ON u.id = s.user_id WHERE ${message.target_user_id ? 's.user_id = ?' : '1=1'}${message.target_user_id ? '' : roleFilter}`, params);
    const notification = notificationFor(message);
    const body = JSON.stringify({ ...notification, type: message.type, arNumber: message.ar_number, messageId: message.id, count: 1 });
    await Promise.all((rows as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>).map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, body);
        await pool.execute('UPDATE pulse_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [subscription.id]);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 410) await pool.execute('DELETE FROM pulse_subscriptions WHERE id = ?', [subscription.id]).catch(() => undefined);
        console.warn('Pulse push delivery failed:', error instanceof Error ? error.message : error);
      }
    }));
  } catch (error) {
    console.warn('Pulse push unavailable:', error instanceof Error ? error.message : error);
  }
}
