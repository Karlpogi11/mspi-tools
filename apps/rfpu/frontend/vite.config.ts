import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/rfpu/',
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
