declare module 'web-push' {
  interface Subscription { endpoint: string; keys: { p256dh: string; auth: string } }
  interface WebPush { setVapidDetails(subject: string, publicKey: string, privateKey: string): void; sendNotification(subscription: Subscription, payload: string): Promise<unknown> }
  const webpush: WebPush;
  export default webpush;
}
