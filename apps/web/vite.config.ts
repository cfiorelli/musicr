import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/shared': path.resolve(__dirname, '../../shared/src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Remove specific allowedHosts restriction for Railway deployment flexibility
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Ensure assets use relative paths for Railway deployment
    assetsDir: 'assets',
  },
});