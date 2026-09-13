import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
});
