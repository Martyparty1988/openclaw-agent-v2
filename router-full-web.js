// router-full-web.js — Martybot FULL router + standalone Web Self‑Improve
// Full MetaAgent/sub-agents + Telegram + WhatsApp pairing + Web API + Git + AI fallback.
// Adds dedicated commands: /web improve, /web improve write, /self improve web.

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
let tgStarting = false;
let tgError = '';
let tgBot = null;
let tgInfo = null;
let full = { enabled: false, error: '', meta: null, auto: null };
let webImproveLast = '';

const startedAt = new Date().toISOString();
const envFlag = (name) => String(process.env[name] || '').toLowerCase() === 'true';
const digits = (value) => String(value || '').replace(/\D/g, '');
const phoneNumber = () => digits(process.env.WA_PHONE_NUMBER || process.env.WHATSAPP_PHONE_NUMBER || process.env.PHONE_NUMBER || '');
const telegramToken = () => String(process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const telegramEnabled = () => Boolean(telegramToken() && !envFlag('DISABLE_TELEGRAM'));
const authDir = () => process.env.WA_AUTH_DIR || './wa_auth';
const allowedTelegramIds = () => String(process.env.ALLOWED_TELEGRAM_CHAT_IDS || process.env.ALLOWED_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const chunkText = (text, size = 3800) => {
  const parts = [];
  let s = String(text || '');
  while (s.length > size) { parts.push(s.slice(0, size)); s = s.slice(size); }
  if (s) parts.push(s);
  return parts;
};

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

function currentProvider() {
  if (process.env.OPENROUTER_API_KEY) return { provider: 'openrouter', model: process.env.OPENROUTER_MODEL || 'openrouter/free' };
  if (process.env.DEEPSEEK_API_KEY) return { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest' };
  return { provider: 'none', model: 'none' };
}
function aiAvailable() { return Boolean(process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY); }

function statusPayload() {
  const p = currentProvider();
  return {
    ok: true,
    service: 'openclaw-agent-v2',
    router: 'router-full-web',
    mode: full.enabled ? 'full-agents' : 'stable-fallback',
    time: new Date().toISOString(),
    startedAt,
    node: process.version,
    provider: p.provider,
    model: p.model,
    aiAvailable: aiAvailable(),
    fullAgents: full.enabled,
    fullAgentsError: full.error,
    auto: Boolean(full.auto?.enabled),
    webSelfImprove: true,
    webSelfImproveWrite: envFlag('ALLOW_WEB_SELF_IMPROVE_WRITE') || envFlag('ALLOW_AGENT_WRITE'),
    webImproveLast,
    telegram: telegramEnabled(),
    telegramTokenConfigured: Boolean(telegramToken()),
    telegramStarted: tgStarted,
    telegramStarting: tgStarting,
    telegramUsername: tgInfo?.username || '',
    telegramId: tgInfo?.id || '',
    telegramError: tgError,
    whatsapp: Boolean(phoneNumber() && envFlag('ENABLE_WHATSAPP')),
    whatsappPhoneConfigured: Boolean(phoneNumber()),
    whatsappPhoneLast4: phoneNumber() ? phoneNumber().slice(-4) : '',
    whatsappConnected: waConnected,
    whatsappMode: waMode,
    whatsappSocketReady: Boolean(sock && waReady),
    whatsappPairingReady: Boolean(waPairingCode),
    whatsappPairingCode: process.env.EXPOSE_WA_PAIRING_CODE === 'true' ? waPairingCode : Boolean(waPairingCode),
    whatsappPairingAt: waPairingAt,
    whatsappLastError: waLastError,
    webApiToken: Boolean(process.env.WEB_API_TOKEN),
    gitWorkdir: process.env.AGENT_WORKDIR || process.cwd()
  };
}

async function loadFullAgents() {
  if (envFlag('DISABLE_FULL_AGENTS')) {
    full = { enabled: false, error: 'disabled by DISABLE_FULL_AGENTS', meta: null, auto: null };
    return full;
  }
  try {
    const MetaAgent = require('./meta-agent-v2');
    const AutoWorker = require('./sub-agents/auto-worker');
    const meta = new MetaAgent();
    const auto = new AutoWorker(meta);
    if (typeof meta.setAutoWorker === 'function') meta.setAutoWorker(auto);
    if (typeof auto.start === 'function' && envFlag('ENABLE_AUTO_WORKER')) auto.start();
    full = { enabled: true, error: '', meta, auto };
    console.log('✅ Full MetaAgent + sub-agents loaded.');
    return full;
  } catch (e) {
    full = { enabled: false, error: e.message || String(e), meta: null, auto: null };
    console.error('⚠️ Full agents failed to load:', full.error);
    return full;
  }
}

async function runWebImprove(writeMode = false) {
  try {
    const { runWebSelfImprove } = require('./sub-agents/web-self-improve');
    const out = await runWebSelfImprove({ write: writeMode });
    webImproveLast = new Date().toISOString();
    return out;
  } catch (e) {
    return 'Self‑Improve Web chyba: ' + (e.message || String(e));
  }
}

async function aiReplyFallback(text) {
  const p = currentProvider();
  const system = process.env.BOT_SYSTEM_PROMPT || 'Jsi Martybot, stručný český technický asistent. Odpovídej prakticky a jasně.';
  if (p.provider === 'none') return 'Martybot běží ✅\nFull agents: ' + (full.enabled ? 'ON' : 'OFF') + (full.error ? '\nChyba agentů: ' + full.error : '') + '\nAI klíč není nastavený.';
  const messages = [{ role: 'system', content: system }, { role: 'user', content: text }];
  if (p.provider === 'openrouter') {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY, 'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://railway.app', 'X-Title': 'Martybot' }, body: JSON.stringify({ model: p.model, messages }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'OpenRouter HTTP ' + r.status);
    return data.choices?.[0]?.message?.content || 'Bez odpovědi.';
  }
  if (p.provider === 'deepseek') {
    const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY }, body: JSON.stringify({ model: p.model, messages }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'DeepSeek HTTP ' + r.status);
    return data.choices?.[0]?.message?.content || 'Bez odpovědi.';
  }
  if (p.provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY }, body: JSON.stringify({ model: p.model, messages }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'OpenAI HTTP ' + r.status);
    return data.choices?.[0]?.message?.content || 'Bez odpovědi.';
  }
  if (p.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: p.model, max_tokens: 1200, system, messages: [{ role: 'user', content: text }] }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || 'Anthropic HTTP ' + r.status);
    return data.content?.map(x => x.text || '').join('\n').trim() || 'Bez odpovědi.';
  }
  return 'Provider není podporovaný.';
}

async function loadBaileys() {
  try {
    const mod = await import('@whiskeysockets/baileys');
    return { makeWASocket: mod.default || mod.makeWASocket, useMultiFileAuthState: mod.useMultiFileAuthState, DisconnectReason: mod.DisconnectReason, fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion };
  } catch {
    const mod = await import('baileys');
    return { makeWASocket: mod.default || mod.makeWASocket, useMultiFileAuthState: mod.useMultiFileAuthState, DisconnectReason: mod.DisconnectReason, fetchLatestBaileysVersion: mod.fetchLatestBaileysVersion };
  }
}
function printPairing(pair) { console.log('WHATSAPP_PAIRING_CODE=' + pair.code); console.log('WHATSAPP_PAIRING_PHONE=' + pair.phoneNumber); }
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
  sock = null; waConnected = false; waPairingCode = ''; waPairingRaw = ''; waPairingAt = ''; waReady = false; waMode = 'resetting';
  fs.rmSync(dir, { recursive: true, force: true });
  waLastError = '';
  await startWhatsApp();
  return { reset: true, authDir: dir, status: statusPayload() };
}
function extractWaText(message) { return String(message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '').trim(); }
async function startWhatsApp() {
  if (waStarting) return;
  if (!envFlag('ENABLE_WHATSAPP')) { waMode = 'disabled'; console.log('WhatsApp disabled. Set ENABLE_WHATSAPP=true.'); return; }
  const phone = phoneNumber();
  if (!phone) { waMode = 'missing-phone'; waLastError = 'Missing WA_PHONE_NUMBER'; console.log(waLastError); return; }
  waStarting = true;
  try {
    waMode = 'loading-baileys';
    const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();
    let logger; try { logger = require('pino')({ level: process.env.WA_LOG_LEVEL || 'silent' }); } catch { logger = { child() { return this; }, trace(){}, debug(){}, info(){}, warn(){}, error(){} }; }
    const { state, saveCreds } = await useMultiFileAuthState(authDir());
    const version = fetchLatestBaileysVersion ? (await fetchLatestBaileysVersion()).version : undefined;
    sock = makeWASocket({ version, logger, auth: state, printQRInTerminal: false, browser: ['Martybot', 'Chrome', '2.0'], markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'connecting') waMode = 'connecting';
      if (update.connection === 'open') { waConnected = true; waMode = 'connected'; waLastError = ''; console.log('✅ WhatsApp connected.'); }
      if (update.connection === 'close') { waConnected = false; waMode = 'closed'; waLastError = update.lastDisconnect?.error?.message || 'connection closed'; const code = update.lastDisconnect?.error?.output?.statusCode; if (code !== DisconnectReason?.loggedOut) setTimeout(() => startWhatsApp(), 5000); }
    });
    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages || []) {
        if (!msg?.message || msg.key?.fromMe) continue;
        const jid = msg.key.remoteJid; if (!jid) continue;
        if (!envFlag('ALLOW_WHATSAPP_GROUPS') && jid.endsWith('@g.us')) continue;
        const text = extractWaText(msg.message); if (!text) continue;
        const out = await handleCommandOrAI(text, 'whatsapp', digits(jid.split('@')[0]) || jid);
        for (const part of chunkText(out)) await sock.sendMessage(jid, { text: part }).catch(() => {});
      }
    });
    waReady = true; waMode = 'socket-ready'; console.log('📱 WhatsApp socket ready for ' + phone);
  } catch (e) { waMode = 'startup-error'; waLastError = e.message || String(e); console.error('WhatsApp startup failed:', waLastError); }
  finally { waStarting = false; }
}

function execGit(args, timeout = 10000) {
  const cwd = process.env.AGENT_WORKDIR || process.cwd();
  return new Promise((resolve) => execFile('git', args, { cwd, timeout }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), error: error ? error.message : '' })));
}
async function gitStatus() { const branch = await execGit(['rev-parse', '--abbrev-ref', 'HEAD']); const short = await execGit(['status', '--short']); return ['🧩 Git status', 'Branch: ' + (branch.stdout || 'unknown'), short.stdout ? short.stdout.slice(0,1200) : 'Working tree čistý ✅'].join('\n'); }
async function gitPull() { if (!envFlag('ALLOW_GIT_PULL') && !envFlag('ALLOW_AGENT_WRITE')) return 'Git pull je vypnutý. Nastav ALLOW_GIT_PULL=true.'; const res = await execGit(['pull', '--ff-only'], 30000); return '⬇️ Git pull\n' + (res.stdout || res.stderr || res.error || 'Hotovo.'); }
function formatStatus() { const s = statusPayload(); return ['✅ Martybot FULL router běží','Mode: '+s.mode,'Full agents: '+(s.fullAgents?'ON':'OFF'),s.fullAgentsError?'Agent error: '+s.fullAgentsError:'','Provider: '+s.provider,'Model: '+s.model,'AI: '+(s.aiAvailable?'ON':'OFF'),'Telegram: '+(s.telegramStarted?'ON':'OFF'),s.telegramUsername?'Telegram bot: @'+s.telegramUsername:'',s.telegramError?'Telegram error: '+s.telegramError:'','WhatsApp: '+s.whatsappMode,'Socket ready: '+s.whatsappSocketReady,'Connected: '+s.whatsappConnected,'Web self-improve: ON','Write mode: '+(s.webSelfImproveWrite?'ON':'OFF')].filter(Boolean).join('\n'); }
async function handleWithFullAgent(text, platform, userId) { if (!full.enabled || !full.meta || typeof full.meta.handle !== 'function') return null; const replies = []; const reply = async (msg) => chunkText(msg).forEach(p => replies.push(p)); await full.meta.handle({ userId: userId || platform + '_user', platform, text, reply }); return replies.join('\n') || 'Hotovo.'; }
async function handleCommandOrAI(text, platform = 'web', userId = 'web_user') {
  const raw = String(text || '').trim(); const cmd = raw.toLowerCase();
  if (!raw) return 'Prázdná zpráva.';
  if (cmd === '/start' || cmd === '/help') return ['Martybot FULL ✅','','Příkazy:','/status','/git','/git pull','/tg restart','/wa pair','/wa reset','/web improve','/web improve write','/agent reload'].join('\n');
  if (cmd === '/status' || cmd === '/wa status' || cmd === '/tg status' || cmd === '/telegram status') return formatStatus();
  if (cmd === '/agent reload') { await loadFullAgents(); return formatStatus(); }
  if (cmd === '/tg restart' || cmd === '/telegram restart') { await restartTelegram(); return formatStatus(); }
  if (cmd === '/git') return await gitStatus();
  if (cmd === '/git pull' || cmd === '/pull') return await gitPull();
  if (cmd === '/web improve' || cmd === '/self improve web' || cmd === '/improve web') return await runWebImprove(false);
  if (cmd === '/web improve write' || cmd === '/self improve web write') return await runWebImprove(true);
  if (cmd === '/wa pair' || cmd === '/whatsapp pair') { const pair = await requestPairingCode(); return pair.alreadyRegistered ? 'WhatsApp už je spárovaný ✅' : 'Čerstvý WhatsApp kód:\n\n' + pair.code; }
  if (cmd === '/wa reset' || cmd === '/whatsapp reset') { await resetWhatsAppSession(); return 'WhatsApp session reset ✅\nPočkej cca 10 sekund a napiš /wa pair.'; }
  try { const fullOut = await handleWithFullAgent(raw, platform, userId); if (fullOut) return fullOut; } catch (e) { return 'Chyba původního agenta: ' + (e.message || String(e)); }
  try { return await aiReplyFallback(raw); } catch (e) { return 'AI chyba: ' + (e.message || String(e)); }
}

async function stopTelegram() {
  try {
    if (tgBot && typeof tgBot.stopPolling === 'function') await tgBot.stopPolling({ cancel: true });
  } catch (e) {
    tgError = 'stopPolling: ' + (e.message || String(e));
  }
  tgBot = null;
  tgInfo = null;
  tgStarted = false;
}

async function startTelegram() {
  if (tgStarting) return;
  const token = telegramToken();
  if (envFlag('DISABLE_TELEGRAM') || !token) {
    tgStarted = false;
    tgInfo = null;
    tgError = envFlag('DISABLE_TELEGRAM') ? 'disabled' : 'missing token. Set TELEGRAM_TOKEN or TELEGRAM_BOT_TOKEN';
    console.log('Telegram disabled/not configured:', tgError);
    return;
  }
  tgStarting = true;
  try {
    const TelegramBot = require('node-telegram-bot-api');

    // Important: create the bot with polling disabled, remove any webhook first,
    // then start polling. Starting polling before deleteWebHook can make Telegram
    // getUpdates fail when the bot previously used a webhook.
    tgBot = new TelegramBot(token, { polling: false });
    try { await tgBot.deleteWebHook({ drop_pending_updates: false }); } catch (e) { console.warn('Telegram deleteWebHook warning:', e.message || e); }
    tgInfo = await tgBot.getMe();

    tgBot.on('message', async (msg) => {
      const chatId = String(msg.chat.id);
      const text = String(msg.text || '').trim();
      const allow = allowedTelegramIds();
      if (allow.length && !allow.includes(chatId) && !allow.includes('tg_' + chatId)) {
        await tgBot.sendMessage(chatId, '🚫 Chat není v allowlistu. ID: ' + chatId);
        return;
      }
      try {
        const out = await handleCommandOrAI(text, 'telegram', 'tg_' + chatId);
        for (const part of chunkText(out, 3900)) await tgBot.sendMessage(chatId, part, { disable_web_page_preview: true });
      } catch (e) {
        await tgBot.sendMessage(chatId, 'Chyba: ' + (e.message || String(e)));
      }
    });

    tgBot.on('polling_error', (e) => {
      tgError = e.message || String(e);
      console.error('Telegram polling error:', tgError);
      if (/409|ETELEGRAM.*Conflict|terminated by other getUpdates/i.test(tgError)) {
        console.error('Telegram conflict: another instance is polling this bot token. Stop the duplicate deployment/process.');
      }
    });

    await tgBot.startPolling({ restart: true });
    tgStarted = true;
    tgError = '';
    console.log('✅ Telegram FULL started as @' + (tgInfo.username || 'unknown'));
  } catch (e) {
    tgStarted = false;
    tgError = e.message || String(e);
    console.error('Telegram startup failed:', tgError);
  } finally {
    tgStarting = false;
  }
}

async function restartTelegram() {
  await stopTelegram();
  await startTelegram();
  return { restarted: tgStarted, status: statusPayload() };
}
function startHttp() { const port = Number(process.env.PORT || process.env.HTTP_PORT || 3000); http.createServer(async (req,res)=>{ if(req.method==='OPTIONS') return json(res,204,{}); const url = new URL(req.url,'http://'+(req.headers.host||'localhost')); try { if(['/','/health','/api/status','/api/whatsapp/status','/api/telegram/status'].includes(url.pathname)){ if(!authOk(req)) return json(res,401,{ok:false,error:'Unauthorized'}); return json(res,200,statusPayload()); } if(url.pathname==='/api/telegram/restart'){ if(!authOk(req)) return json(res,401,{ok:false,error:'Unauthorized'}); return json(res,200,{ok:true,...(await restartTelegram())}); } if(url.pathname==='/api/whatsapp/pair'){ if(!authOk(req)) return json(res,401,{ok:false,error:'Unauthorized'}); return json(res,200,{ok:true,...(await requestPairingCode())}); } if(url.pathname==='/api/whatsapp/reset'){ if(!authOk(req)) return json(res,401,{ok:false,error:'Unauthorized'}); return json(res,200,{ok:true,...(await resetWhatsAppSession())}); } if(url.pathname==='/api/web/improve'){ if(!authOk(req)) return json(res,401,{ok:false,error:'Unauthorized'}); const write = url.searchParams.get('write')==='1'; return json(res,200,{ok:true,reply:await runWebImprove(write)}); } if(url.pathname==='/api/chat'&&req.method==='POST'){ if(!authOk(req)) return json(res,401,{ok:false,error:'Unauthorized'}); const body=await readJson(req); const reply=await handleCommandOrAI(String(body.text||body.message||''),'web',String(body.userId||'web_user')); return json(res,200,{ok:true,replies:chunkText(reply)}); } return json(res,404,{ok:false,error:'Not found',path:url.pathname}); } catch(e){ return json(res,500,{ok:false,error:e.message||String(e),status:statusPayload()}); } }).listen(port,'0.0.0.0',()=>console.log('🌐 HTTP API listening on 0.0.0.0:'+port+' router-full-web')); }

console.log('🚀 router-full-web starting');
startHttp();
loadFullAgents();
startTelegram();
startWhatsApp();
