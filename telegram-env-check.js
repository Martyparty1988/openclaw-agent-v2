// telegram-env-check.js — safe Telegram env diagnostics without printing secrets.
// Helps detect when an older env variable shadows the fresh BotFather token.

const http = require('http');

function maskToken(token) {
  const value = String(token || '').trim();
  if (!value) return 'empty';
  const parts = value.split(':');
  const tail = value.slice(-6);
  return `len=${value.length}, id=${parts[0] || '?'}, tail=***${tail}`;
}

function tokenFormatLooksValid(token) {
  return /^\d{6,}:[A-Za-z0-9_-]{25,}$/.test(String(token || '').trim());
}

function telegramDiagnostics() {
  const candidates = [
    ['TELEGRAM_TOKEN', process.env.TELEGRAM_TOKEN],
    ['TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN],
    ['BOT_TOKEN', process.env.BOT_TOKEN],
  ].map(([name, value]) => ({
    name,
    configured: Boolean(String(value || '').trim()),
    masked: maskToken(value),
    format: tokenFormatLooksValid(value) ? 'ok' : 'invalid',
  }));

  const configured = candidates.filter((item) => item.configured);
  const selected = configured[0] || { name: 'none', configured: false, masked: 'empty', format: 'invalid' };

  return {
    ok: true,
    selected,
    candidates,
    multipleConfigured: configured.length > 1,
    priority: ['TELEGRAM_TOKEN', 'TELEGRAM_BOT_TOKEN', 'BOT_TOKEN'],
    disableTelegram: String(process.env.DISABLE_TELEGRAM || '').trim() || '(empty)',
    note: 'This endpoint masks secrets. Telegram 404 almost always means the selected token is invalid/revoked/wrongly copied.'
  };
}

function logTelegramDiagnostics() {
  const d = telegramDiagnostics();
  if (!d.selected.configured) {
    console.log('[telegram-env] no Telegram token configured');
    return;
  }

  console.log(`[telegram-env] selected=${d.selected.name} ${d.selected.masked} format=${d.selected.format}`);

  if (d.multipleConfigured) {
    console.warn('[telegram-env] multiple token variables configured. Priority is TELEGRAM_TOKEN > TELEGRAM_BOT_TOKEN > BOT_TOKEN. Remove old duplicates in Railway Variables.');
    for (const item of d.candidates.filter(x => x.configured)) {
      console.warn(`[telegram-env] candidate=${item.name} ${item.masked} format=${item.format}`);
    }
  }

  if (d.selected.format !== 'ok') {
    console.warn(`[telegram-env] selected token from ${d.selected.name} does not look like a BotFather token. Check Railway Variables.`);
  }
}

function installTelegramEnvEndpoint() {
  if (http.__telegramEnvCheckInstalled) return;
  http.__telegramEnvCheckInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithTelegramEnv(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}

      if (pathname === '/api/telegram/env' || pathname === '/telegram-env') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(telegramDiagnostics(), null, 2));
        return;
      }

      if (typeof listener === 'function') return listener(req, res);
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    };

    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };
}

logTelegramDiagnostics();
installTelegramEnvEndpoint();

module.exports = { telegramDiagnostics, maskToken, tokenFormatLooksValid };
