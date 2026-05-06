const http = require('http');

const BUFFER_LIMIT = Number(process.env.RUNTIME_LOG_BUFFER_LIMIT || 220);
const logs = [];

function maskSecrets(text) {
  return String(text || '')
    .replace(/https:\/\/[^\s/@]+@github\.com/gi, 'https://***@github.com')
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***')
    .replace(/[0-9]{8,12}:[A-Za-z0-9_-]{25,}/g, 'telegram_token_***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/x-agent-token\s*[:=]\s*[^\s,}]+/gi, 'x-agent-token=***');
}

function serializeArg(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function pushLog(level, args) {
  const line = maskSecrets(args.map(serializeArg).join(' ')).slice(0, 3000);
  logs.push({ ts: new Date().toISOString(), level, line });
  while (logs.length > BUFFER_LIMIT) logs.shift();
}

function installConsoleTap() {
  if (console.__martybotRuntimeLogsInstalled) return;
  console.__martybotRuntimeLogsInstalled = true;
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args) => { pushLog('log', args); original.log(...args); };
  console.info = (...args) => { pushLog('info', args); original.info(...args); };
  console.warn = (...args) => { pushLog('warn', args); original.warn(...args); };
  console.error = (...args) => { pushLog('error', args); original.error(...args); };

  pushLog('info', ['[runtime-logs] console tap installed']);
}

function authOk(req) {
  const token = process.env.WEB_API_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return bearer === token || req.headers['x-agent-token'] === token;
}

function levelIcon(level) {
  if (level === 'error') return '❌';
  if (level === 'warn') return '⚠️';
  if (level === 'info') return 'ℹ️';
  return '•';
}

function formatLogs(limit = 80) {
  const selected = logs.slice(-limit);
  const lines = [];
  lines.push('📜 Martybot Runtime Logs');
  lines.push('Záznamů: ' + selected.length + '/' + logs.length);
  lines.push('Čas: ' + new Date().toISOString());
  lines.push('');
  if (!selected.length) {
    lines.push('Zatím nejsou žádné logy v bufferu.');
  } else {
    for (const item of selected) {
      lines.push(levelIcon(item.level) + ' ' + item.ts + ' [' + item.level + '] ' + item.line);
    }
  }
  lines.push('');
  lines.push('Poznámka: tokeny a citlivé hodnoty jsou maskované.');
  return lines.join('\n');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Agent-Token',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function installEndpoint() {
  if (http.__martybotRuntimeLogsEndpointInstalled) return;
  http.__martybotRuntimeLogsEndpointInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithRuntimeLogs(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = async (req, res) => {
      let url;
      try { url = new URL(req.url || '/', 'http://localhost'); } catch { url = { pathname: '' }; }
      if (req.method === 'OPTIONS' && url.pathname === '/api/logs') return sendJson(res, 204, {});
      if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/logs') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        const limit = Math.max(1, Math.min(200, Number(url.searchParams?.get('limit') || 80)));
        const text = formatLogs(limit);
        return sendJson(res, 200, { ok: true, count: logs.length, limit, logs: logs.slice(-limit), reply: text, replies: [text] });
      }
      if (typeof listener === 'function') return listener(req, res);
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    };

    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };

  console.log('[runtime-logs-endpoint] installed at /api/logs');
}

installConsoleTap();
installEndpoint();

module.exports = { logs, formatLogs };
