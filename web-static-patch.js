const fs = require('fs');
const path = require('path');
const http = require('http');

const originalCreateServer = http.createServer;

function dirExists(dir) {
  try { return fs.existsSync(dir) && fs.statSync(dir).isDirectory(); } catch { return false; }
}

function pickWebDir() {
  const workdirWeb = process.env.AGENT_WORKDIR ? path.join(process.env.AGENT_WORKDIR, 'web') : '';
  if (workdirWeb && dirExists(workdirWeb)) return workdirWeb;
  return path.join(__dirname, 'web');
}

const webDir = pickWebDir();
const types = {
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function firstExisting(files) {
  return files.find((file) => file && fs.existsSync(file) && fs.statSync(file).isFile()) || '';
}

function cleanPath(value) {
  return String(value || '').replace('/web/', '').replace(/\.\./g, '').replace(/^\/+/, '');
}

function fileFor(url) {
  const pathname = new URL(url || '/', 'http://localhost').pathname;
  if (pathname === '/' || pathname === '/web' || pathname === '/web/' || pathname === '/web/index.html') {
    return firstExisting([
      path.join(webDir, 'index.clean.html'),
      path.join(webDir, 'index.html'),
      path.join(webDir, 'premium.html')
    ]);
  }
  if (pathname === '/manifest.webmanifest') return path.join(webDir, 'manifest.webmanifest');
  if (pathname === '/icon.svg' || pathname === '/favicon.ico') return path.join(webDir, 'icon.svg');
  const rootFiles = [
    '/styles.css', '/app.js', '/service-actions.js', '/martybot-pro.js', '/window-manager.js', '/same-origin-only.js',
    '/service-worker.js', '/manifest.webmanifest', '/icon.svg'
  ];
  if (rootFiles.includes(pathname)) return path.join(webDir, pathname.slice(1));
  if (!pathname.startsWith('/web/')) return '';
  return path.join(webDir, cleanPath(pathname));
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

try {
  require('./web-safe-improve-endpoint.js');
} catch (err) {
  console.error('[web-static-patch] safe improve endpoint failed:', err && err.message || err);
}

try {
  require('./diagnostics-endpoint.js');
} catch (err) {
  console.error('[web-static-patch] diagnostics endpoint failed:', err && err.message || err);
}

try {
  require('./git-push-test-endpoint.js');
} catch (err) {
  console.error('[web-static-patch] git push test endpoint failed:', err && err.message || err);
}

try {
  require('./git-pull-endpoint.js');
} catch (err) {
  console.error('[web-static-patch] git pull endpoint failed:', err && err.message || err);
}

console.log('Static Martybot clean web UI enabled on / from ' + webDir);
