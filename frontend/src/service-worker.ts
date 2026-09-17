/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };
precacheAndRoute(self.__WB_MANIFEST);
interface PulseServiceWorkerRegistration extends ServiceWorkerRegistration { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void>; }
const worker = self as unknown as ServiceWorkerGlobalScope;
worker.addEventListener('push', (event) => { const data = event.data?.json() as { title?: string; body?: string; arNumber?: string; actions?: Array<{ action: string; title: string }>; count?: number } | undefined; if (!data) return; const options = { body: data.body, actions: data.actions || [], data: { arNumber: data.arNumber }, badge: '/favicon.svg' } as NotificationOptions; event.waitUntil(worker.registration.showNotification(data.title || 'MSPI Pulse', options)); });
worker.addEventListener('notificationclick', (event) => { event.notification.close(); const ar = (event.notification.data as { arNumber?: string } | undefined)?.arNumber; event.waitUntil(worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => { const target = ar ? `/pulse?ar=${encodeURIComponent(ar)}` : '/pulse'; const existing = clients.find((client): client is WindowClient => 'focus' in client); return existing ? existing.navigate(target).then(() => existing.focus()) : worker.clients.openWindow(target); })); });
worker.addEventListener('message', (event) => { const data = event.data as { type?: string; count?: number }; const registration = worker.registration as PulseServiceWorkerRegistration; if (data.type === 'UPDATE_BADGE' && registration.setAppBadge && registration.clearAppBadge) event.waitUntil((data.count || 0) > 0 ? registration.setAppBadge(data.count || 0) : registration.clearAppBadge()); });
