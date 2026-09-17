import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({ registerType: 'autoUpdate', strategies: 'injectManifest', srcDir: 'src', filename: 'service-worker.ts', manifest: { name: 'MSPI Pulse', short_name: 'Pulse', theme_color: '#0f172a', background_color: '#0f172a', display: 'standalone', start_url: '/pulse', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }], share_target: { action: '/pulse/compose', method: 'GET', params: { text: 'prefill' } } }, devOptions: { enabled: true } })],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx-js-style')) return 'xlsx-style';
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'vendor';
          if (id.endsWith('/src/components/pcount/ImportSystem.tsx')) return 'pcount-import-system';
          if (id.endsWith('/src/components/pcount/ImportCount.tsx')) return 'pcount-import-count';
          if (id.endsWith('/src/components/pcount/ProductTable.tsx')) return 'pcount-product-table';
          if (id.endsWith('/src/components/pcount/ScanPanel.tsx')) return 'pcount-scan-panel';
          if (id.endsWith('/src/components/pcount/ScanBar.tsx')) return 'pcount-scan-bar';
          if (id.endsWith('/src/components/pcount/PcountReportPreview.tsx')) return 'pcount-report';
          if (id.includes('/src/components/pcount/')) return 'pcount-components';
        },
      },
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/ws-pulse': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
