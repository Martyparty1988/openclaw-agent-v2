const fs = require('fs');
const path = require('path');
const http = require('http');

const originalCreateServer = http.createServer;
const webDir = path.join(__dirname, 'web');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function fileFor(url) {
  const pathname = new URL(url || '/', 'http://localhost').pathname;
  if (pathname === '/' || pathname === '/web' || pathname === '/web/') return path.join(webDir, 'index.html');
  if (pathname === '/manifest.webmanifest') return path.join(webDir, 'manifest.webmanifest');
  if (pathname === '/icon.svg' || pathname === '/favicon.ico') return path.join(webDir, 'icon.svg');
  if (!pathname.startsWith('/web/')) return '';
  const clean = pathname.replace('/web/', '').replace(/\.\./g, '');
  return path.join(webDir, clean);
}

function sendFile(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let file = '';
  try { file = fileFor(req.url); } catch { return false; }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

http.createServer = function createServerWithWeb(options, listener) {
  if (typeof options === 'function') {
    listener = options;
    options = undefined;
  }
  const wrapped = (req, res) => sendFile(req, res) || listener(req, res);
  return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
};

console.log('Static Martybot web UI enabled on /');
