// router.js — Unified message router for Telegram + optional WhatsApp + HTTP API
// Railway-ready: Telegram by default, WhatsApp optional, HTTP API for Vercel web frontend.

const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const MetaAgent = require('./meta-agent');
const AutoWorker = require('./sub-agents/auto-worker');
const { memoryBackendStatus } = require('./sub-agents/memory');
require('dotenv').config();

const meta = new MetaAgent();
const autoWorker = new AutoWorker(meta);
meta.setAutoWorker?.(autoWorker);

// ─── Access Control ───────────────────────────────────────────────────────────

function splitEnv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isAllowAllEnabled() {
  return envFlag('ALLOW_ALL_USERS');
}

function isAuthorized({ platform, userId, rawId }) {
  if (isAllowAllEnabled()) return true;

  const genericAllowed = new Set(splitEnv('ALLOWED_USER_IDS'));
  const candidates = new Set([String(userId || ''), String(rawId || '')]);

  if (platform === 'telegram') {
    const raw = String(rawId || '').replace(/^tg_/, '');
    candidates.add(raw);
    candidates.add(`tg_${raw}`);
    for (const id of splitEnv('ALLOWED_TELEGRAM_CHAT_IDS')) {
      genericAllowed.add(id);
      genericAllowed.add(`tg_${id}`);
    }
  }

  if (platform === 'whatsapp') {
    const rawDigits = digitsOnly(rawId || userId);
    candidates.add(rawDigits);
    for (const phone of splitEnv('ALLOWED_WHATSAPP_NUMBERS')) {
      genericAllowed.add(digitsOnly(phone));
    }
  }

  if (platform === 'web') {
    candidates.add(String(userId || 'web_user'));
    for (const id of splitEnv('ALLOWED_WEB_USER_IDS')) genericAllowed.add(id);
  }

  for (const candidate of candidates) {
    if (candidate && genericAllowed.has(candidate)) return true;
  }

  return false;
}

async function guardMessage({ platform, userId, rawId, reply }) {
  if (isAuthorized({ platform, userId, rawId })) return true;

  console.warn(`🚫 Blocked unauthorized ${platform} user: ${rawId || userId}`);
  await reply('🚫 Tento bot je soukromý. Přidej svoje ID/číslo do allowlistu v Railway Variables.');
  return false;
}

// ─── HTTP API for Vercel Web ──────────────────────────────────────────────────

function getAllowedOrigins() {
  return splitEnv('WEB_ALLOWED_ORIGINS');
}

function wildcardOriginMatch(origin, pattern) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return origin === pattern;

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(origin);
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const allowed = getAllowedOrigins();
  if (!allowed.length) return true;
  return allowed.some((pattern) => wildcardOriginMatch(origin, pattern));
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Agent-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function isApiAuthorized(req) {
  const token = process.env.WEB_API_TOKEN;
  if (!token) return true;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const alt = req.headers['x-agent-token'] || '';
  return bearer === token || alt === token;
}

function readJsonBody(req, maxBytes = 20000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function publicStatus() {
  const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
  const memory = memoryBackendStatus();
  const modelByProvider = {
    anthropic: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
    openrouter: process.env.OPENROUTER_MODEL || 'openrouter/free',
    deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };

  return {
    ok: true,
    service: 'openclaw-agent-v2',
    time: new Date().toISOString(),
    provider,
    model: modelByProvider[provider] || 'unknown',
    telegram: Boolean(process.env.TELEGRAM_TOKEN),
    whatsapp: Boolean(process.env.WA_PHONE_NUMBER),
    email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    auto: Boolean(autoWorker.enabled),
    memoryBackend: memory.backend,
    memorySupabaseRequested: memory.requested,
    memorySupabaseTable: memory.supabaseTable,
    memorySupabaseDisabledReason: memory.disabledReason,
    memoryDir: process.env.MEMORY_DIR || './agent-memory',
    gitWorkdir: process.env.AGENT_WORKDIR || process.cwd(),
    bashTools: envFlag('ALLOW_AGENT_BASH'),
    writeTools: envFlag('ALLOW_AGENT_WRITE'),
    webApiToken: Boolean(process.env.WEB_API_TOKEN),
    allowedOrigins: getAllowedOrigins().length ? getAllowedOrigins() : ['any'],
  };
}

function startHttpApi() {
  const port = Number(process.env.PORT || process.env.HTTP_PORT || 3000);

  const server = http.createServer(async (req, res) => {
    setCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return sendJson(res, 200, publicStatus());
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!isApiAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return sendJson(res, 200, publicStatus());
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const tokenProtected = Boolean(process.env.WEB_API_TOKEN);
        if (!isApiAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

        const body = await readJsonBody(req);
        const text = String(body.text || body.message || '').trim();
        const userId = String(body.userId || 'web_user');

        if (!text) return sendJson(res, 400, { ok: false, error: 'Missing text.' });

        const replies = [];
        const reply = async (messageText) => {
          for (const chunk of chunkText(messageText, 3800)) replies.push(chunk);
        };

        // If WEB_API_TOKEN is set and valid, the web caller is already authenticated.
        // Without WEB_API_TOKEN, fall back to allowlist checks.
        if (!tokenProtected) {
          const allowed = await guardMessage({ platform: 'web', userId, rawId: userId, reply });
          if (!allowed) return sendJson(res, 403, { ok: false, replies, error: 'Forbidden' });
        }

        await meta.handle({ userId, platform: 'web', text, reply });
        return sendJson(res, 200, { ok: true, replies });
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      console.error('[http-api]', err);
      return sendJson(res, 500, { ok: false, error: err.message || 'Internal error' });
    }
  });

  server.listen(port, () => {
    console.log(`🌐 HTTP API listening on :${port}`);
  });

  return true;
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

async function startWhatsApp() {
  if (!envFlag('ENABLE_WHATSAPP')) {
    console.log('⚪ WhatsApp disabled by default. Set ENABLE_WHATSAPP=true to enable.');
    return false;
  }

  if (envFlag('DISABLE_WHATSAPP')) {
    console.log('⚪ WhatsApp disabled by DISABLE_WHATSAPP=true.');
    return false;
  }

  if (!process.env.WA_PHONE_NUMBER) {
    console.log('⚪ WA_PHONE_NUMBER not set — WhatsApp disabled.');
    return false;
  }

  let builderbot;
  let providerModule;
  try {
    builderbot = require('@builderbot/bot');
    providerModule = require('@builderbot/provider-baileys');
  } catch (err) {
    console.error('❌ WhatsApp dependencies failed to load:', err.message);
    return false;
  }

  const { createBot, createProvider, createFlow, addKeyword } = builderbot;
  const BaileysProvider = providerModule?.default || providerModule?.BaileysProvider || providerModule;

  if (typeof BaileysProvider !== 'function') {
    console.error('❌ WhatsApp provider is not a constructor. Keep ENABLE_WHATSAPP=false or adjust @builderbot/provider-baileys import.');
    return false;
  }

  const waFlow = addKeyword([
    'execute', 'analyze', 'plan', 'chat', 'improve', 'reset', 'help', 'status', 'auto', 'model',
    'exec', 'spusť', 'analyzuj', 'naplánuj', 'zlepši', 'zapomeň', 'pomoc', 'stav',
  ]).addAction(async (ctx, { flowDynamic }) => {
    const reply = async (text) => {
      const chunks = chunkText(text, 3800);
      for (const chunk of chunks) await flowDynamic(chunk);
    };

    const rawId = ctx.from;
    const userId = digitsOnly(rawId) || String(rawId || 'unknown');
    const text = String(ctx.body || '').trim();
    if (!text) return;

    const allowed = await guardMessage({ platform: 'whatsapp', userId, rawId, reply });
    if (!allowed) return;

    await meta.handle({ userId, platform: 'whatsapp', text, reply });
  });

  const adapterFlow = createFlow([waFlow]);
  const adapterProvider = createProvider(BaileysProvider, {
    usePairingCode: true,
    phoneNumber: process.env.WA_PHONE_NUMBER,
  });

  adapterProvider.on('ready', () => console.log('✅ WhatsApp connected and ready.'));
  createBot({ flow: adapterFlow, provider: adapterProvider, database: null });

  console.log('📱 WhatsApp: pairing code will appear in logs...');
  console.log(`📱 Phone number: ${process.env.WA_PHONE_NUMBER}`);
  return true;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

function startTelegram() {
  if (envFlag('DISABLE_TELEGRAM')) {
    console.log('⚪ Telegram disabled by DISABLE_TELEGRAM=true.');
    return false;
  }

  if (!process.env.TELEGRAM_TOKEN) {
    console.log('⚪ TELEGRAM_TOKEN not set — Telegram disabled.');
    return false;
  }

  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  bot.on('message', async (msg) => {
    const rawId = String(msg.chat.id);
    const userId = `tg_${rawId}`;
    const text = String(msg.text || '').trim();
    if (!text) return;

    const reply = async (messageText) => {
      const chunks = chunkText(messageText, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(msg.chat.id, chunk, { disable_web_page_preview: true });
        await sleep(200);
      }
    };

    const allowed = await guardMessage({ platform: 'telegram', userId, rawId, reply });
    if (!allowed) return;

    await meta.handle({ userId, platform: 'telegram', text, reply });
  });

  bot.on('polling_error', (err) => console.error('❌ Telegram polling error:', err.message));
  console.log('✅ Telegram bot started.');
  return true;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function chunkText(text, maxLen) {
  const chunks = [];
  let rest = String(text || '');

  while (rest.length > maxLen) {
    chunks.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }

  if (rest) chunks.push(rest);
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 OpenClaw Agent starting on Railway...');

  const httpStarted = startHttpApi();
  const telegramStarted = startTelegram();
  const whatsappStarted = await startWhatsApp();
  autoWorker.start();

  if (!httpStarted && !whatsappStarted && !telegramStarted) {
    console.error('❌ No platform configured. Set TELEGRAM_TOKEN and/or ENABLE_WHATSAPP=true with WA_PHONE_NUMBER.');
    process.exit(1);
  }

  if (!isAllowAllEnabled() && !splitEnv('ALLOWED_USER_IDS').length && !splitEnv('ALLOWED_TELEGRAM_CHAT_IDS').length && !splitEnv('ALLOWED_WHATSAPP_NUMBERS').length && !splitEnv('ALLOWED_WEB_USER_IDS').length && !process.env.WEB_API_TOKEN) {
    console.warn('⚠️ No allowlist/API token configured. Web without WEB_API_TOKEN requires ALLOWED_WEB_USER_IDS or ALLOW_ALL_USERS=true.');
  }
}

main().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
