import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // В dev фронт ходит на бэкенд через proxy и подставляет токен из корневого .env.
  const env = loadEnv(mode, '..', '');
  const target = `http://127.0.0.1:${env.PORT || 3000}`;
  const headers: Record<string, string> = env.DASHBOARD_TOKEN ? { 'X-Dashboard-Token': env.DASHBOARD_TOKEN } : {};
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: { '/api': { target, headers } } },
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  };
});
