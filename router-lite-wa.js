// router-lite-wa.js — stable Railway router focused on Web API + WhatsApp pairing.
// No meta-agent imports, no Anthropic/OpenAI build blockers. Once WhatsApp is paired, advanced agent logic can be reconnected later.

const http = require('http');
require('dotenv').config();

let waSock = null;
let waConnected = false;
let waStarting = false;
let waPairingCode = '';
let waPairingAt = '';
let waLastError = '';
let waMode = 'disabled';

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneNumber() {
  return digitsOnly(
    process.env.WA_PHONE_NUMBER ||
    process.env.WHATSAPP_PHONE_NUMBER ||
    process.env.PHONE_NUMBER ||
    process.env.WHATSAPP_PAIRING_PHONE ||
    ''
  );
}

function chunkText(text, maxLen = 3800) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > maxLen) {
    out.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  if (rest) out.push(rest);
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Agent-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function apiAuthorized(req) {
  const token = process.env.WEB_API_TOKEN;
  if (!token) return true;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const alt = req.headers['x-agent-token'] || '';
  return bearer === token || alt === token;
}

function readJson(req, maxBytes = 30000) {
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
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function loadBaileys() {
  const mod = await import('@whiskeysockets/baileys');
  return {
    makeWASocket: mod.default || mod.makeWASocket,
    useMultiFileAuthState: mod.useMultiFileAuthState,
    DisconnectReason: mod.DisconnectReason,
    fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion,
  };
}

function extractMessageText(message) {
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

async function createPairingCode() {
  const phone = phoneNumber();
  if (!phone) throw new Error('Missing WA_PHONE_NUMBER. Use digits only, e.g. 31627355541.');
  if (!waSock || typeof waSock.requestPairingCode !== 'function') {
    throw new Error('WhatsApp socket not ready yet. Wait 5–10 seconds after deploy, then try again.');
  }

  if (waSock.authState?.creds?.registered) {
    waConnected = true;
    return { alreadyRegistered: true, code: '', phoneNumber: phone };
  }

  const raw = await waSock.requestPairingCode(phone);
  const clean = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  waPairingCode = clean.match(/.{1,4}/g)?.join('-') || clean;
  waPairingAt = new Date().toISOString();
  waLastError = '';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('WHATSAPP_PAIRING_CODE=' + waPairingCode);
  console.log('WHATSAPP_PAIRING_PHONE=' + phone);
  console.log('WhatsApp → Linked devices → Link with phone number');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { alreadyRegistered: false, code: waPairingCode, phoneNumber: phone };
}

async function startWhatsApp() {
  if (!envFlag('ENABLE_WHATSAPP') || envFlag('DISABLE_WHATSAPP')) {
    waMode = 'disabled';
    console.log('⚪ WhatsApp disabled. Set ENABLE_WHATSAPP=true to enable.');
    return false;
  }

  const phone = phoneNumber();
  if (!phone) {
    waMode = 'missing-phone';
    waLastError = 'Missing WA_PHONE_NUMBER';
    console.log('⚪ WhatsApp missing WA_PHONE_NUMBER.');
    return false;
  }

  if (waStarting) return false;
  waStarting = true;

  try {
    const {
      makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await loadBaileys();

    let logger;
    try {
      logger = require('pino')({ level: process.env.WA_LOG_LEVEL || 'silent' });
    } catch {
      logger = { child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {} };
    }

    const authDir = process.env.WA_AUTH_DIR || process.env.WHATSAPP_AUTH_DIR || './wa_auth';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const version = fetchLatestBaileysVersion ? (await fetchLatestBaileysVersion()).version : undefined;

    waMode = 'baileys-direct';
    waSock = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false,
      browser: ['Martybot', 'Chrome', '2.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    waSock.ev.on('creds.update', saveCreds);
    waSock.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        waConnected = true;
        waLastError = '';
        console.log('✅ WhatsApp connected.');
      }

      if (update.connection === 'close') {
        waConnected = false;
        waLastError = update.lastDisconnect?.error?.message || 'connection closed';
        console.warn('⚠️ WhatsApp connection closed:', waLastError);
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason?.loggedOut) {
          setTimeout(() => startWhatsApp().catch((err) => console.error(err)), 5000);
        }
      }
    });

    waSock.ev.on('messages.upsert', async ({ messages }) => {
      for (const item of messages || []) {
        if (!item?.message || item.key?.fromMe) continue;
        const jid = item.key.remoteJid || '';
        if (!envFlag('ALLOW_WHATSAPP_GROUPS') && jid.endsWith('@g.us')) continue;
        const text = extractMessageText(item.message);
        if (!text) continue;
        const reply = async (messageText) => {
          for (const part of chunkText(messageText)) {
            await waSock.sendMessage(jid, { text: part });
          }
        };
        await reply('Martybot je připojený ✅\nZatím běží v lite režimu kvůli stabilnímu buildu. Napiš /status pro stav.');
      }
    });

    console.log('📱 WhatsApp direct mode started for ' + phone);
    setTimeout(() => {
      createPairingCode().catch((err) => {
        waLastError = err.message || String(err);
        console.error('❌ Pairing failed:', waLastError);
      });
    }, 2500);

    return true;
  } catch (err) {
    waMode = 'startup-error';
    waLastError = err.message || String(err);
    console.error('❌ WhatsApp startup failed:', waLastError);
    return false;
  } finally {
    waStarting = false;
  }
}

async function startTelegram() {
  if (envFlag('DISABLE_TELEGRAM') || !process.env.TELEGRAM_TOKEN) {
    console.log('⚪ Telegram disabled or TELEGRAM_TOKEN missing.');
    return false;
  }

  try {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
    bot.on('message', async (msg) => {
      const text = String(msg.text || '').trim();
      if (!text) return;
      if (text === '/status') {
        await bot.sendMessage(msg.chat.id, 'Martybot lite běží ✅\nWhatsApp: ' + (waConnected ? 'connected' : waMode));
      } else {
        await bot.sendMessage(msg.chat.id, 'Martybot lite běží ✅\nPokročilý agent je dočasně vypnutý kvůli stabilnímu buildu.');
      }
    });
    bot.on('polling_error', (err) => console.error('Telegram error', err.message));
    console.log('✅ Telegram started.');
    return true;
  } catch (err) {
    console.error('❌ Telegram startup failed:', err.message || err);
    return false;
  }
}

function statusPayload() {
  return {
    ok: true,
    service: 'openclaw-agent-v2',
    router: 'router-lite-wa',
    time: new Date().toISOString(),
    provider: 'lite',
    model: 'lite-stable-router',
    telegram: Boolean(process.env.TELEGRAM_TOKEN && !envFlag('DISABLE_TELEGRAM')),
    whatsapp: Boolean(phoneNumber() && envFlag('ENABLE_WHATSAPP')),
    whatsappConnected: waConnected,
    whatsappMode: waMode,
    whatsappPairingReady: Boolean(waPairingCode),
    whatsappPairingCode: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? waPairingCode : Boolean(waPairingCode),
    whatsappPairingAt: waPairingAt,
    whatsappLastError: waLastError,
    auto: false,
    gitWorkdir: process.cwd(),
    bashTools: false,
    writeTools: false,
    webApiToken: Boolean(process.env.WEB_API_TOKEN),
  };
}

function startHttp() {
  const port = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
  const server = http.createServer(async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

    try {
      if (req.method === 'GET' && ['/', '/health', '/api/status'].includes(url.pathname)) {
        if (url.pathname === '/api/status' && !apiAuthorized(req)) {
          return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        }
        return sendJson(res, 200, statusPayload());
      }

      if (req.method === 'GET' && url.pathname === '/api/whatsapp/status') {
        if (!apiAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return sendJson(res, 200, statusPayload());
      }

      if (req.method === 'POST' && url.pathname === '/api/whatsapp/pair') {
        if (!apiAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return sendJson(res, 200, { ok: true, ...(await createPairingCode()) });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (!apiAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        const payload = await readJson(req);
        const text = String(payload.text || payload.message || '').trim();
        const replies = [];
        if (!text) return sendJson(res, 400, { ok: false, error: 'Missing text' });
        if (text === '/status') {
          replies.push('Martybot lite běží ✅\nWhatsApp: ' + (waConnected ? 'connected' : waMode) + '\nPairing ready: ' + Boolean(waPairingCode));
        } else if (text === '/whatsapp pair' || text === '/wa pair') {
          const pair = await createPairingCode();
          replies.push(pair.alreadyRegistered ? 'WhatsApp už je spárovaný ✅' : 'WhatsApp pairing code: ' + pair.code);
        } else {
          replies.push('Martybot lite režim ✅\nPoužij /status nebo /wa pair. Pokročilý agent je dočasně vypnutý kvůli stabilnímu buildu.');
        }
        return sendJson(res, 200, { ok: true, replies });
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      console.error('[http]', err);
      return sendJson(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
  });

  server.listen(port, () => console.log('🌐 HTTP API listening on :' + port + ' router-lite-wa'));
  return true;
}

async function main() {
  console.log('🚀 OpenClaw router-lite-wa starting.');
  startHttp();
  await startTelegram();
  await startWhatsApp();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
