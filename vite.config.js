import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend on 5173; proxy /api -> Express backend on 3001 so the browser
// talks to one origin and there's no CORS dance in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
