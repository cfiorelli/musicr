import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_VERSION__: JSON.stringify(
      process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'dev'
    ),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
  preview: {
    host: true,
    port: 8080,
    // Allow Railway domain for production preview
    allowedHosts: ['musicrweb-production.up.railway.app', 'localhost']
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Ensure assets use relative paths for Railway deployment
    assetsDir: 'assets',
  },
});