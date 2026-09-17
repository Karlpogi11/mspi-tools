const API = import.meta.env.VITE_API_URL || '/api';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export async function subscribeToPush(): Promise<boolean> {
  try {
    const permission = await requestNotificationPermission();
    if (permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await fetch(`${API}/pulse/vapid-public-key`, { credentials: 'include' });
    const { publicKey } = await keyResponse.json() as { publicKey: string | null };
    if (!publicKey) return false;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) as unknown as ArrayBuffer });
    const json = subscription.toJSON();
    await fetch(`${API}/pulse/subscribe`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, deviceLabel: navigator.userAgent.slice(0, 100) }) });
    return true;
  } catch { return false; }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try { const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription(); if (!subscription) return true; await fetch(`${API}/pulse/subscribe`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }); return subscription.unsubscribe(); } catch { return false; }
}

function urlBase64ToBytes(value: string): Uint8Array { const padding = '='.repeat((4 - value.length % 4) % 4); const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')); const output = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i); return output; }

export async function updateAppBadge(count: number): Promise<void> { if ('setAppBadge' in navigator) { count > 0 ? await navigator.setAppBadge(count) : await navigator.clearAppBadge(); } }
