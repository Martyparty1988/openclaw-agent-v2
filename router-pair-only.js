// router-pair-only.js — minimal Railway server for WhatsApp pairing.
// Focus: reliable pairing. No AI agent, no Telegram, no heavy optional imports.

const http = require('http');
const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch {}

let sock = null;
let connected = false;
let pairingCode = '';
let pairingRaw = '';
let pairingAt = '';
let lastError = '';
let mode = 'booting';
let starting = false;
let baileysReady = false;

const envFlag = (name) => String(process.env[name] || '').toLowerCase() === 'true';
const digits = (value) => String(value || '').replace(/\D/g, '');
const phoneNumber = () => digits(process.env.WA_PHONE_NUMBER || process.env.WHATSAPP_PHONE_NUMBER || process.env.PHONE_NUMBER || '');
const authDir = () => process.env.WA_AUTH_DIR || './wa_auth';

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

function statusPayload() {
  return {
    ok: true,
    service: 'openclaw-agent-v2',
    router: 'router-pair-only',
    time: new Date().toISOString(),
    provider: 'pair-only',
    model: 'none',
    whatsapp: Boolean(phoneNumber() && envFlag('ENABLE_WHATSAPP')),
    whatsappPhoneConfigured: Boolean(phoneNumber()),
    whatsappPhoneLast4: phoneNumber() ? phoneNumber().slice(-4) : '',
    whatsappConnected: connected,
    whatsappMode: mode,
    whatsappSocketReady: Boolean(sock && baileysReady),
    whatsappPairingReady: Boolean(pairingCode),
    whatsappPairingCode: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? pairingCode : Boolean(pairingCode),
    whatsappPairingRaw: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? pairingRaw : Boolean(pairingRaw),
    whatsappPairingAt: pairingAt,
    whatsappLastError: lastError,
    authDir: authDir(),
    webApiToken: Boolean(process.env.WEB_API_TOKEN)
  };
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
  } catch (firstErr) {
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
  console.log('Code is fresh. Use it immediately. It can expire quickly.');
  console.log('WhatsApp → Linked devices → Link with phone number');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function requestPairingCode() {
  const phone = phoneNumber();
  if (!phone) throw new Error('Missing WA_PHONE_NUMBER. Example: 31627355541');
  if (connected) return { alreadyRegistered: true, code: '', raw: '', phoneNumber: phone };

  if (!sock || typeof sock.requestPairingCode !== 'function') {
    if (!starting) startWhatsApp().catch(() => {});
    throw new Error('WhatsApp socket is not ready yet. Wait 10 seconds after deploy, then call /api/whatsapp/pair again. Current mode: ' + mode);
  }

  const raw = await sock.requestPairingCode(phone);
  pairingRaw = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  pairingCode = pairingRaw.match(/.{1,4}/g)?.join('-') || pairingRaw;
  pairingAt = new Date().toISOString();
  lastError = '';

  const pair = { alreadyRegistered: false, code: pairingCode, raw: pairingRaw, phoneNumber: phone };
  printPairing(pair);
  return pair;
}

async function resetSession() {
  const dir = path.resolve(authDir());
  try {
    if (sock?.end) sock.end();
  } catch {}
  sock = null;
  connected = false;
  pairingCode = '';
  pairingRaw = '';
  pairingAt = '';
  baileysReady = false;
  mode = 'resetting';
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    lastError = 'Reset failed: ' + (err.message || String(err));
    throw err;
  }
  lastError = '';
  await startWhatsApp();
  return { reset: true, authDir: dir, status: statusPayload() };
}

async function startWhatsApp() {
  if (starting) return;
  if (!envFlag('ENABLE_WHATSAPP')) {
    mode = 'disabled';
    console.log('WhatsApp disabled. Set ENABLE_WHATSAPP=true.');
    return;
  }

  const phone = phoneNumber();
  if (!phone) {
    mode = 'missing-phone';
    lastError = 'Missing WA_PHONE_NUMBER';
    console.log(lastError);
    return;
  }

  starting = true;
  try {
    mode = 'loading-baileys';
    const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();

    let logger;
    try { logger = require('pino')({ level: process.env.WA_LOG_LEVEL || 'silent' }); }
    catch { logger = { child() { return this; }, trace(){}, debug(){}, info(){}, warn(){}, error(){} }; }

    const { state, saveCreds } = await useMultiFileAuthState(authDir());
    const version = fetchLatestBaileysVersion ? (await fetchLatestBaileysVersion()).version : undefined;

    mode = 'baileys-starting';
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
      if (update.connection === 'connecting') {
        mode = 'connecting';
      }
      if (update.connection === 'open') {
        connected = true;
        mode = 'connected';
        lastError = '';
        console.log('✅ WhatsApp connected.');
      }
      if (update.connection === 'close') {
        connected = false;
        mode = 'closed';
        lastError = update.lastDisconnect?.error?.message || 'connection closed';
        console.log('WhatsApp closed:', lastError);
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason?.loggedOut) setTimeout(() => startWhatsApp(), 5000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages || []) {
        if (!msg?.message || msg.key?.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid || jid.endsWith('@g.us')) continue;
        await sock.sendMessage(jid, { text: 'Martybot WhatsApp je připojený ✅' }).catch(() => {});
      }
    });

    baileysReady = true;
    mode = 'socket-ready';
    console.log('📱 WhatsApp socket ready for ' + phone);
    console.log('Generate fresh code manually: GET or POST /api/whatsapp/pair');

    // Optional auto-pair only when explicitly enabled. Manual pair is safer because codes expire.
    if (envFlag('WA_AUTO_PAIR')) {
      setTimeout(() => requestPairingCode().catch((err) => {
        lastError = err.message || String(err);
        console.error('Pairing failed:', lastError);
      }), 2500);
    }
  } catch (err) {
    mode = 'startup-error';
    lastError = err.message || String(err);
    console.error('WhatsApp startup failed:', lastError);
  } finally {
    starting = false;
  }
}

function startHttp() {
  const port = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Agent-Token'
      });
      return res.end();
    }

    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    try {
      if (['/', '/health', '/api/status', '/api/whatsapp/status'].includes(url.pathname)) {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        return json(res, 200, statusPayload());
      }

      if (url.pathname === '/api/whatsapp/pair' && (req.method === 'GET' || req.method === 'POST')) {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        const pair = await requestPairingCode();
        return json(res, 200, { ok: true, ...pair, hint: 'Use code immediately. If it fails, call /api/whatsapp/reset and then /api/whatsapp/pair again.' });
      }

      if (url.pathname === '/api/whatsapp/reset' && (req.method === 'GET' || req.method === 'POST')) {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        return json(res, 200, { ok: true, ...(await resetSession()) });
      }

      if (url.pathname === '/api/chat' && req.method === 'POST') {
        if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
        return json(res, 200, { ok: true, replies: ['Martybot pair-only běží ✅\nPro nový kód otevři /api/whatsapp/pair. Když kód selže, otevři /api/whatsapp/reset a pak znovu /api/whatsapp/pair.'] });
      }

      return json(res, 404, { ok: false, error: 'Not found', path: url.pathname });
    } catch (err) {
      lastError = err.message || String(err);
      return json(res, 500, { ok: false, error: lastError, status: statusPayload() });
    }
  }).listen(port, '0.0.0.0', () => console.log('🌐 HTTP API listening on 0.0.0.0:' + port + ' router-pair-only'));
}

console.log('🚀 router-pair-only starting');
startHttp();
startWhatsApp();
