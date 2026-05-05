// router-pair-only.js — absolute minimal Railway server for WhatsApp pairing.
// Purpose: make build/start reliable first. No AI agent, no Telegram, no heavy optional imports.

const http = require('http');
try { require('dotenv').config(); } catch {}

let sock = null;
let connected = false;
let pairingCode = '';
let pairingAt = '';
let lastError = '';
let mode = 'booting';
let starting = false;

const envFlag = (name) => String(process.env[name] || '').toLowerCase() === 'true';
const digits = (value) => String(value || '').replace(/\D/g, '');
const phoneNumber = () => digits(process.env.WA_PHONE_NUMBER || process.env.WHATSAPP_PHONE_NUMBER || process.env.PHONE_NUMBER || '');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Agent-Token');
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
    whatsappConnected: connected,
    whatsappMode: mode,
    whatsappPairingReady: Boolean(pairingCode),
    whatsappPairingCode: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? pairingCode : Boolean(pairingCode),
    whatsappPairingAt: pairingAt,
    whatsappLastError: lastError,
    webApiToken: Boolean(process.env.WEB_API_TOKEN),
  };
}

async function loadBaileys() {
  // New official package name is "baileys". Keep fallback for older package name.
  try {
    const mod = await import('baileys');
    return {
      makeWASocket: mod.default || mod.makeWASocket,
      useMultiFileAuthState: mod.useMultiFileAuthState,
      DisconnectReason: mod.DisconnectReason,
      fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion,
    };
  } catch (firstErr) {
    const mod = await import('@whiskeysockets/baileys');
    return {
      makeWASocket: mod.default || mod.makeWASocket,
      useMultiFileAuthState: mod.useMultiFileAuthState,
      DisconnectReason: mod.DisconnectReason,
      fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion,
    };
  }
}

async function requestPairingCode() {
  const phone = phoneNumber();
  if (!phone) throw new Error('Missing WA_PHONE_NUMBER. Example: 31627355541');
  if (!sock || typeof sock.requestPairingCode !== 'function') {
    throw new Error('WhatsApp socket is not ready yet. Wait 10 seconds after deploy, then call /api/whatsapp/pair again.');
  }

  if (sock.authState?.creds?.registered) {
    connected = true;
    return { alreadyRegistered: true, code: '', phoneNumber: phone };
  }

  const raw = await sock.requestPairingCode(phone);
  const clean = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  pairingCode = clean.match(/.{1,4}/g)?.join('-') || clean;
  pairingAt = new Date().toISOString();
  lastError = '';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('WHATSAPP_PAIRING_CODE=' + pairingCode);
  console.log('WHATSAPP_PAIRING_PHONE=' + phone);
  console.log('WhatsApp → Linked devices → Link with phone number');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { alreadyRegistered: false, code: pairingCode, phoneNumber: phone };
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

    const authDir = process.env.WA_AUTH_DIR || './wa_auth';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
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
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
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

    mode = 'socket-ready';
    console.log('📱 WhatsApp socket ready for ' + phone);
    setTimeout(() => requestPairingCode().catch((err) => {
      lastError = err.message || String(err);
      console.error('Pairing failed:', lastError);
    }), 2500);
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
    setCors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

    try {
      if (req.method === 'GET' && ['/', '/health', '/api/status', '/api/whatsapp/status'].includes(url.pathname)) {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return sendJson(res, 200, statusPayload());
      }

      if (req.method === 'POST' && url.pathname === '/api/whatsapp/pair') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return sendJson(res, 200, { ok: true, ...(await requestPairingCode()) });
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return sendJson(res, 200, { ok: true, replies: ['Martybot pair-only běží ✅\nPoužij /api/whatsapp/pair nebo sleduj Railway logs pro WHATSAPP_PAIRING_CODE.'] });
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      lastError = err.message || String(err);
      return sendJson(res, 500, { ok: false, error: lastError, status: statusPayload() });
    }
  }).listen(port, () => console.log('🌐 HTTP API listening on :' + port + ' router-pair-only'));
}

console.log('🚀 router-pair-only starting');
startHttp();
startWhatsApp();
