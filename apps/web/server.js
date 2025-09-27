#!/usr/bin/env node
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Railway provides dynamic PORT - must use exactly what Railway gives us
const RAILWAY_PORT = process.env.PORT;
const PORT = RAILWAY_PORT || 5173; // Fallback for local development only
const DIST_DIR = join(__dirname, 'dist');

console.log('🔍 Railway Environment check:');
console.log('  Railway PORT env var:', RAILWAY_PORT);
console.log('  Final port used:', PORT);
console.log('  Is Railway deployment:', !!RAILWAY_PORT);
console.log('  Node version:', process.version);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Simple health check endpoint
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, timestamp: new Date().toISOString() }));
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Remove query parameters and fragments
  filePath = filePath.split('?')[0].split('#')[0];
  
  let fullPath = join(DIST_DIR, filePath);

  // Security check - ensure we're serving from dist directory
  if (!fullPath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // If file doesn't exist and it's not a file with extension, serve index.html (SPA support)
  if (!existsSync(fullPath)) {
    if (!extname(filePath)) {
      // This is likely a client-side route, serve index.html
      fullPath = join(DIST_DIR, 'index.html');
    } else {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
  }

  try {
    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    const content = readFileSync(fullPath);
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    console.error('Error serving file:', error);
    console.error('Attempted path:', fullPath);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ Server successfully bound to 0.0.0.0:${PORT}`);
  console.log(`📁 Serving files from: ${DIST_DIR}`);
  console.log(`🏥 Health check available at: /health`);
  console.log(`🌐 Railway will route traffic to this port automatically`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`💥 Port ${PORT} is already in use`);
  }
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});