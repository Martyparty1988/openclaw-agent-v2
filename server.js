const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const MetaAgent = require('./meta-agent');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const WEB_ROOT = path.join(__dirname, 'web');

const meta = new MetaAgent();

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

async function serveStatic(res, filePath) {
  const fullPath = path.join(WEB_ROOT, filePath === '/' ? 'index.html' : filePath);
  try {
    const safePath = path.normalize(fullPath);
    if (!safePath.startsWith(WEB_ROOT)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const content = await fs.readFile(safePath);
    const ext = path.extname(safePath);
    const contentType = ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  if (req.url === '/api/message' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const text = String(payload.text || '').trim();
      const userId = String(payload.userId || 'web_user');

      if (!text) {
        sendJson(res, 400, { error: 'Missing message text.' });
        return;
      }

      const replies = [];
      await meta.handle({
        userId,
        platform: 'web',
        text,
        reply: async (message) => replies.push(message),
      });

      sendJson(res, 200, { ok: true, replies });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, service: 'openclaw-web-control' });
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(res, req.url || '/');
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  console.log(`🌐 OpenClaw web control running on http://${HOST}:${PORT}`);
});
