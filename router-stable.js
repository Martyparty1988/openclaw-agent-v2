// router-stable.js — stable Martybot router for Railway
// Features: Telegram, WhatsApp pairing, Web API, Git status, lightweight AI via fetch.
// No heavy AI SDK imports. Build-safe.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
try { require('dotenv').config(); } catch {}

let sock = null;
let waConnected = false;
let waPairingCode = '';
let waPairingRaw = '';
let waPairingAt = '';
let waLastError = '';
let waMode = 'booting';
let waStarting = false;
let waReady = false;
let tgStarted = false;
let tgError = '';
let tgBot = null;

const startedAt = new Date().toISOString();
const envFlag = (name) => String(process.env[name] || '').toLowerCase() === 'true';
const digits = (value) => String(value || '').replace(/\D/g, '');
const phoneNumber = () => digits(process.env.WA_PHONE_NUMBER || process.env.WHATSAPP_PHONE_NUMBER || process.env.PHONE_NUMBER || '');
const authDir = () => process.env.WA_AUTH_DIR || './wa_auth';
const allowedTelegramIds = () => String(process.env.ALLOWED_TELEGRAM_CHAT_IDS || process.env.ALLOWED_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const chunkText = (text, size = 3800) => {
  const parts = [];
  let s = String(text || '');
  while (s.length > size) { parts.push(s.slice(0, size)); s = s.slice(size); }
  if (s) parts.push(s);
  return parts;
};

function log(...args) { console.log(...args); }
function warn(...args) { console.warn(...args); }
function errlog(...args) { console.error(...args); }

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Agent-Token'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function authOk(req) {
  const token = process.env.WEB_API_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return bearer === token || req.headers['x-agent-token'] === token;
}

function readJson(req, maxBytes = 50000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Request body too large'));
        if (!req.destroyed) req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function statusPayload() {
  return {
    ok: true,
    service: 'openclaw-agent-v2',
    router: 'router-stable',
    mode: 'stable',
    time: new Date().toISOString(),
    startedAt,
    node: process.version,
    provider: currentProvider().provider,
    model: currentProvider().model,
    telegram: Boolean(process.env.TELEGRAM_TOKEN && !envFlag('DISABLE_TELEGRAM')),
    telegramStarted: tgStarted,
    telegramError: tgError,
    whatsapp: Boolean(phoneNumber() && envFlag('ENABLE_WHATSAPP')),
    whatsappPhoneConfigured: Boolean(phoneNumber()),
    whatsappPhoneLast4: phoneNumber() ? phoneNumber().slice(-4) : '',
    whatsappConnected: waConnected,
    whatsappMode: waMode,
    whatsappSocketReady: Boolean(sock && waReady),
    whatsappPairingReady: Boolean(waPairingCode),
    whatsappPairingCode: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? waPairingCode : Boolean(waPairingCode),
    whatsappPairingRaw: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? waPairingRaw : Boolean(waPairingRaw),
    whatsappPairingAt: waPairingAt,
    whatsappLastError: waLastError,
    authDir: authDir(),
    aiAvailable: aiAvailable(),
    webApiToken: Boolean(process.env.WEB_API_TOKEN),
    gitWorkdir: process.env.AGENT_WORKDIR || process.cwd()
  };
}

function currentProvider() {
  if (process.env.OPENROUTER_API_KEY) return { provider: 'openrouter', model: process.env.OPENROUTER_MODEL || 'openrouter/auto' };
  if (process.env.DEEPSEEK_API_KEY) return { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest' };
  return { provider: 'none', model: 'none' };
}

function aiAvailable() {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

async function aiReply(text) {
  const p = currentProvider();
  const system = process.env.BOT_SYSTEM_PROMPT || 'Jsi Martybot, stručný český technický asistent. Odpovídej prakticky, jasně a bez zbytečné omáčky.';

  if (p.provider === 'none') {
    return 'Martybot stable běží ✅\nAI klíč ale není nastavený. Nastav OPENROUTER_API_KEY nebo DEEPSEEK_API_KEY a můžu odpovídat naplno.';
  }

  if (p.provider === 'openrouter') {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://railway.app',
        'X-Title': 'Martybot'
      },
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }]
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'OpenRouter HTTP ' + r.status);
    return data.choices?.[0]?.message?.content || 'Bez odpovědi.';
  }

  if (p.provider === 'deepseek') {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
      body: JSON.stringify({ model: p.model, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'DeepSeek HTTP ' + r.status);
    return data.choices?.[0]?.message?.content || 'Bez odpovědi.';
  }

  if (p.provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model: p.model, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'OpenAI HTTP ' + r.status);
    return data.choices?.[0]?.message?.content || 'Bez odpovědi.';
  }

  if (p.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: p.model, max_tokens: 1200, system, messages: [{ role: 'user', content: text }] })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'Anthropic HTTP ' + r.status);
    return data.content?.map(x => x.text || '').join('\n').trim() || 'Bez odpovědi.';
  }

  return 'Provider není podporovaný.';
}

async function loadBaileys() {
  try {
    const mod = await import('baileys');
    return {
      makeWASocket: mod.default || mod.makeWASocket,
      useMultiFileAuthState: mod.useMultiFileAuthState,
      DisconnectReason: mod.DisconnectReason,
      fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion
    };
  } catch {
    const mod = await import('@whiskeysockets/baileys');
    return {
      makeWASocket: mod.default || mod.makeWASocket,
      useMultiFileAuthState: mod.useMultiFileAuthState,
      DisconnectReason: mod.DisconnectReason,
      fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion
    };
  }
}

function printPairing(pair) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('WHATSAPP_PAIRING_CODE=' + pair.code);
  console.log('WHATSAPP_PAIRING_RAW=' + pair.raw);
  console.log('WHATSAPP_PAIRING_PHONE=' + pair.phoneNumber);
  console.log('Use immediately: WhatsApp → Linked devices → Link with phone number');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function requestPairingCode() {
  const phone = phoneNumber();
  if (!phone) throw new Error('Missing WA_PHONE_NUMBER. Example: 31627355541');
  if (waConnected) return { alreadyRegistered: true, code: '', raw: '', phoneNumber: phone };

  if (!sock || typeof sock.requestPairingCode !== 'function') {
    if (!waStarting) startWhatsApp().catch(() => {});
    throw new Error('WhatsApp socket is not ready yet. Wait 10 seconds, then try /wa pair again. Current mode: ' + waMode);
  }

  const raw = await sock.requestPairingCode(phone);
  waPairingRaw = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  waPairingCode = waPairingRaw.match(/.{1,4}/g)?.join('-') || waPairingRaw;
  waPairingAt = new Date().toISOString();
  waLastError = '';
  const pair = { alreadyRegistered: false, code: waPairingCode, raw: waPairingRaw, phoneNumber: phone };
  printPairing(pair);
  return pair;
}

async function resetWhatsAppSession() {
  const dir = path.resolve(authDir());
  try { if (sock?.end) sock.end(); } catch {}
  sock = null;
  waConnected = false;
  waPairingCode = '';
  waPairingRaw = '';
  waPairingAt = '';
  waReady = false;
  waMode = 'resetting';
  fs.rmSync(dir, { recursive: true, force: true });
  waLastError = '';
  await startWhatsApp();
  return { reset: true, authDir: dir, status: statusPayload() };
}

function extractWaText(message) {
  return String(
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.buttonsResponseMessage?.selectedButtonId ||
    message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  ).trim();
}

async function startWhatsApp() {
  if (waStarting) return;
  if (!envFlag('ENABLE_WHATSAPP')) {
    waMode = 'disabled';
    log('WhatsApp disabled. Set ENABLE_WHATSAPP=true.');
    return;
  }

  const phone = phoneNumber();
  if (!phone) {
    waMode = 'missing-phone';
    waLastError = 'Missing WA_PHONE_NUMBER';
    log(waLastError);
    return;
  }

  waStarting = true;
  try {
    waMode = 'loading-baileys';
    const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();

    let logger;
    try { logger = require('pino')({ level: process.env.WA_LOG_LEVEL || 'silent' }); }
    catch { logger = { child() { return this; }, trace(){}, debug(){}, info(){}, warn(){}, error(){} }; }

    const { state, saveCreds } = await useMultiFileAuthState(authDir());
    const version = fetchLatestBaileysVersion ? (await fetchLatestBaileysVersion()).version : undefined;

    waMode = 'baileys-starting';
    sock = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false,
      browser: ['Martybot', 'Chrome', '2.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'connecting') waMode = 'connecting';
      if (update.connection === 'open') {
        waConnected = true;
        waMode = 'connected';
        waLastError = '';
        log('✅ WhatsApp connected.');
      }
      if (update.connection === 'close') {
        waConnected = false;
        waMode = 'closed';
        waLastError = update.lastDisconnect?.error?.message || 'connection closed';
        warn('WhatsApp closed:', waLastError);
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason?.loggedOut) setTimeout(() => startWhatsApp(), 5000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages || []) {
        if (!msg?.message || msg.key?.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid) continue;
        if (!envFlag('ALLOW_WHATSAPP_GROUPS') && jid.endsWith('@g.us')) continue;
        const text = extractWaText(msg.message);
        if (!text) continue;
        const reply = async (messageText) => {
          for (const part of chunkText(messageText)) await sock.sendMessage(jid, { text: part }).catch(() => {});
        };
        const out = await handleCommandOrAI(text, 'whatsapp');
        await reply(out);
      }
    });

    waReady = true;
    waMode = 'socket-ready';
    log('📱 WhatsApp socket ready for ' + phone);
    log('Generate fresh code manually: /wa pair in Telegram or GET /api/whatsapp/pair');
  } catch (e) {
    waMode = 'startup-error';
    waLastError = e.message || String(e);
    errlog('WhatsApp startup failed:', waLastError);
  } finally {
    waStarting = false;
  }
}

function execGit(args, timeout = 10000) {
  const cwd = process.env.AGENT_WORKDIR || process.cwd();
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), error: error ? error.message : '' });
    });
  });
}

async function gitStatus() {
  const branch = await execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const short = await execGit(['status', '--short']);
  const ahead = await execGit(['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  const changed = short.stdout ? short.stdout.split('\n').length : 0;
  return [
    '🧩 Git status',
    'Branch: ' + (branch.stdout || 'unknown'),
    'Změny: ' + changed,
    ahead.ok ? 'Sync: ' + ahead.stdout.replace(/\s+/, ' behind / ') + ' ahead' : 'Sync: upstream nenastavený',
    short.stdout ? '\n' + short.stdout.slice(0, 1200) : 'Working tree čistý ✅'
  ].join('\n');
}

async function gitPull() {
  if (!envFlag('ALLOW_GIT_PULL') && !envFlag('ALLOW_AGENT_WRITE')) {
    return 'Git pull je vypnutý kvůli bezpečnosti. Nastav ALLOW_GIT_PULL=true, pokud ho chceš povolit.';
  }
  const res = await execGit(['pull', '--ff-only'], 30000);
  return '⬇️ Git pull\n' + (res.stdout || res.stderr || res.error || 'Hotovo.');
}

function formatStatus() {
  const s = statusPayload();
  return [
    '✅ Martybot stable běží',
    'Provider: ' + s.provider,
    'Model: ' + s.model,
    'AI: ' + (s.aiAvailable ? 'ON' : 'OFF'),
    'Telegram: ' + (s.telegramStarted ? 'ON' : 'OFF'),
    'WhatsApp: ' + s.whatsappMode,
    'Socket ready: ' + s.whatsappSocketReady,
    'Connected: ' + s.whatsappConnected,
    'Pairing ready: ' + s.whatsappPairingReady,
    s.whatsappLastError ? 'WA error: ' + s.whatsappLastError : '',
    s.telegramError ? 'TG error: ' + s.telegramError : ''
  ].filter(Boolean).join('\n');
}

async function handleCommandOrAI(text, platform = 'web') {
  const raw = String(text || '').trim();
  const cmd = raw.toLowerCase();

  if (!raw) return 'Prázdná zpráva.';
  if (cmd === '/start' || cmd === '/help') {
    return [
      'Martybot stable ✅',
      '',
      'Příkazy:',
      '/status',
      '/git',
      '/git pull',
      '/wa status',
      '/wa pair',
      '/wa reset',
      '',
      'Normální text pošlu na AI provider, pokud je nastavený API klíč.'
    ].join('\n');
  }
  if (cmd === '/status' || cmd === '/wa status') return formatStatus();
  if (cmd === '/git') return await gitStatus();
  if (cmd === '/git pull' || cmd === '/pull') return await gitPull();
  if (cmd === '/wa pair' || cmd === '/whatsapp pair') {
    const pair = await requestPairingCode();
    if (pair.alreadyRegistered) return 'WhatsApp už je spárovaný ✅';
    return 'Čerstvý WhatsApp kód:\n\n' + pair.code + '\n\nZadej ho hned ve WhatsApp → Propojená zařízení → Propojit pomocí telefonního čísla.';
  }
  if (cmd === '/wa reset' || cmd === '/whatsapp reset') {
    await resetWhatsAppSession();
    return 'WhatsApp session reset ✅\nPočkej cca 10 sekund a napiš /wa pair.';
  }

  try {
    return await aiReply(raw);
  } catch (e) {
    return 'AI chyba: ' + (e.message || String(e));
  }
}

async function startTelegram() {
  if (envFlag('DISABLE_TELEGRAM') || !process.env.TELEGRAM_TOKEN) {
    tgStarted = false;
    tgError = envFlag('DISABLE_TELEGRAM') ? 'disabled' : 'missing token';
    log('Telegram disabled or TELEGRAM_TOKEN missing.');
    return;
  }

  try {
    const TelegramBot = require('node-telegram-bot-api');
    tgBot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    try { await tgBot.deleteWebHook({ drop_pending_updates: false }); } catch {}
    tgStarted = true;
    tgError = '';

    tgBot.on('message', async (msg) => {
      const chatId = String(msg.chat.id);
      const text = String(msg.text || '').trim();
      const allow = allowedTelegramIds();
      if (allow.length && !allow.includes(chatId) && !allow.includes('tg_' + chatId)) {
        await tgBot.sendMessage(chatId, '🚫 Tenhle Telegram chat není v ALLOWED_TELEGRAM_CHAT_IDS. Tvoje ID: ' + chatId);
        return;
      }
      try {
        const out = await handleCommandOrAI(text, 'telegram');
        for (const part of chunkText(out, 3900)) await tgBot.sendMessage(chatId, part, { disable_web_page_preview: true });
      } catch (e) {
        await tgBot.sendMessage(chatId, 'Chyba: ' + (e.message || String(e)));
      }
    });

    tgBot.on('polling_error', (e) => {
      tgError = e.message || String(e);
      errlog('Telegram polling error:', tgError);
    });

    log('✅ Telegram stable started.');
  } catch (e) {
    tgStarted = false;
    tgError = e.message || String(e);
    errlog('Telegram startup failed:', tgError);
  }
}

function startHttp() {
  const port = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    try {
      if (['/', '/health', '/api/status', '/api/whatsapp/status'].includes(url.pathname)) {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        return json(res, 200, statusPayload());
      }
      if (url.pathname === '/api/whatsapp/pair' && (req.method === 'GET' || req.method === 'POST')) {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        return json(res, 200, { ok: true, ...(await requestPairingCode()) });
      }
      if (url.pathname === '/api/whatsapp/reset' && (req.method === 'GET' || req.method === 'POST')) {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        return json(res, 200, { ok: true, ...(await resetWhatsAppSession()) });
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        const body = await readJson(req);
        const text = String(body.text || body.message || '').trim();
        const reply = await handleCommandOrAI(text, 'web');
        return json(res, 200, { ok: true, replies: chunkText(reply) });
      }
      return json(res, 404, { ok: false, error: 'Not found', path: url.pathname });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message || String(e), status: statusPayload() });
    }
  }).listen(port, '0.0.0.0', () => log('🌐 HTTP API listening on 0.0.0.0:' + port + ' router-stable'));
}

log('🚀 router-stable starting');
startHttp();
startTelegram();
startWhatsApp();
