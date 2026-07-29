import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: fileURLToPath(new URL('../dist-collector', import.meta.url)), emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/api/collector': { target: process.env.COLLECTOR_API_PROXY || 'http://127.0.0.1:8790', changeOrigin: true } },
  },
});
