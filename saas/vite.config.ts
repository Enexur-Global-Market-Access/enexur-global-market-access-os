import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], optimizeDeps: { noDiscovery: true, include: [] }, server: { port: 5173, proxy: { '/api': 'http://localhost:4100' } }, build: { outDir: 'dist/web' } });
