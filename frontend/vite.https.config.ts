import fs from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// TEMPORARY local-only config: second dev instance over HTTPS so phones on
// the same WiFi get a secure context (camera requires it). Plain LAN http
// never shows the camera prompt, and tunnel domains are filtered here.
// Usage: npx vite --config vite.https.config.ts --host 0.0.0.0
// Phone opens https://<this-machine-lan-ip>:5174 and taps through the
// self-signed cert warning once. Safe to delete after testing.
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5174,
      strictPort: true,
      https: {
        key: fs.readFileSync('/tmp/vite-https-key.pem'),
        cert: fs.readFileSync('/tmp/vite-https-cert.pem'),
      },
    },
  }),
);
