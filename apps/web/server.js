// Minimal static file server for Railway deployment.
// Uses only Node.js built-ins: no external dependencies.
// - Binds to 0.0.0.0:PORT (Railway injects PORT at runtime)
// - SPA fallback: unknown paths return index.html with 200 (passes /health check)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function handler(req, res) {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback — return index.html for all unmatched routes
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
  }
}

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log(`[musicr/web] serving dist/ on 0.0.0.0:${PORT}`);
});
