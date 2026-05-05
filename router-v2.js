// router-v2.js — Telegram/Web router with Supabase-backed agent settings and proactive notifications.

const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const MetaAgent = require('./meta-agent-v2');
const AutoWorker = require('./sub-agents/auto-worker');
const { memoryBackendStatus } = require('./sub-agents/memory');
require('dotenv').config();

const meta = new MetaAgent();
const autoWorker = new AutoWorker(meta);
meta.setAutoWorker?.(autoWorker);

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function splitEnv(name) {
  return (process.env[name] || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function chunkText(text, maxLen = 3900) {
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

function isAuthorized({ platform, userId, rawId }) {
  if (envFlag('ALLOW_ALL_USERS')) return true;

  const allowed = new Set(splitEnv('ALLOWED_USER_IDS'));
  const candidates = new Set([String(userId || ''), String(rawId || '')]);

  if (platform === 'telegram') {
    const raw = String(rawId || '').replace(/^tg_/, '');
    candidates.add(raw);
    candidates.add(`tg_${raw}`);
    for (const id of splitEnv('ALLOWED_TELEGRAM_CHAT_IDS')) {
      allowed.add(id);
      allowed.add(`tg_${id}`);
    }
  }

  if (platform === 'whatsapp') {
    const rawDigits = digitsOnly(rawId || userId);
    candidates.add(rawDigits);
    for (const phone of splitEnv('ALLOWED_WHATSAPP_NUMBERS')) allowed.add(digitsOnly(phone));
  }

  if (platform === 'web') {
    candidates.add(String(userId || 'web_user'));
    for (const id of splitEnv('ALLOWED_WEB_USER_IDS')) allowed.add(id);
  }

  for (const candidate of candidates) {
    if (candidate && allowed.has(candidate)) return true;
  }
  return false;
}

async function guardMessage({ platform, userId, rawId, reply }) {
  if (isAuthorized({ platform, userId, rawId })) return true;
  console.warn(`🚫 Blocked unauthorized ${platform} user: ${rawId || userId}`);
  await reply('🚫 Tento bot je soukromý. Přidej svoje ID/číslo do allowlistu v Railway Variables.');
  return false;
}

function getAllowedOrigins() {
  return splitEnv('WEB_ALLOWED_ORIGINS');
}

function wildcardOriginMatch(origin, pattern) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return origin === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
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

function readJsonBody(req, maxBytes = 30000) {
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
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function currentModel() {
  const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
  const modelByProvider = {
    anthropic: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
    openrouter: process.env.OPENROUTER_MODEL || 'openrouter/free',
    deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
  return { provider, model: modelByProvider[provider] || 'unknown' };
}

function publicStatus() {
  const memory = memoryBackendStatus();
  const model = currentModel();
  return {
    ok: true,
    service: 'openclaw-agent-v2',
    router: 'router-v2',
    time: new Date().toISOString(),
    provider: model.provider,
    model: model.model,
    telegram: Boolean(process.env.TELEGRAM_TOKEN),
    whatsapp: Boolean(process.env.WA_PHONE_NUMBER),
    email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    auto: Boolean(autoWorker.enabled),
    proactiveCapable: true,
    memoryBackend: memory.backend,
    memorySupabaseRequested: memory.requested,
    memorySupabaseTable: memory.supabaseTable,
    memorySupabaseDisabledReason: memory.disabledReason,
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
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      if (req.method === 'GET' && ['/', '/health', '/api/status'].includes(url.pathname)) {
        if (url.pathname === '/api/status' && !isApiAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
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

  server.listen(port, () => console.log(`🌐 HTTP API listening on :${port} (router-v2)`));
  return true;
}

async function startWhatsApp() {
  if (!envFlag('ENABLE_WHATSAPP') || envFlag('DISABLE_WHATSAPP') || !process.env.WA_PHONE_NUMBER) {
    console.log('⚪ WhatsApp disabled. Set ENABLE_WHATSAPP=true and WA_PHONE_NUMBER to enable.');
    return false;
  }

  try {
    const builderbot = require('@builderbot/bot');
    const providerModule = require('@builderbot/provider-baileys');
    const { createBot, createProvider, createFlow, addKeyword } = builderbot;
    const BaileysProvider = providerModule?.default || providerModule?.BaileysProvider || providerModule;
    if (typeof BaileysProvider !== 'function') throw new Error('WhatsApp provider is not a constructor.');

    const waFlow = addKeyword(['.*'], { regex: true }).addAction(async (ctx, { flowDynamic }) => {
      const rawId = ctx.from;
      const userId = digitsOnly(rawId) || String(rawId || 'unknown');
      const text = String(ctx.body || '').trim();
      if (!text) return;
      const reply = async (messageText) => {
        for (const chunk of chunkText(messageText, 3800)) await flowDynamic(chunk);
      };
      if (!(await guardMessage({ platform: 'whatsapp', userId, rawId, reply }))) return;
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
  } catch (err) {
    console.error('❌ WhatsApp startup failed:', err.message);
    return false;
  }
}

function telegramMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🩺 Status', callback_data: '/status' }, { text: '🧠 Agent', callback_data: '/agent' }],
        [{ text: '👨‍💻 Developer', callback_data: '/agent developer' }, { text: '🚀 Deploy', callback_data: '/agent deploy' }],
        [{ text: '🔍 Auto code', callback_data: '/auto code' }, { text: '🤖 Auto audit', callback_data: '/auto run' }],
        [{ text: '🧩 Git', callback_data: '/git' }, { text: '🧠 Memory', callback_data: '/facts' }],
        [{ text: '📣 Proactive ON', callback_data: '/proactive on' }, { text: '🔕 Proactive OFF', callback_data: '/proactive off' }],
      ],
    },
    disable_web_page_preview: true,
  };
}

function startTelegram() {
  if (envFlag('DISABLE_TELEGRAM') || !process.env.TELEGRAM_TOKEN) {
    console.log('⚪ Telegram disabled or TELEGRAM_TOKEN missing.');
    return false;
  }

  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  const sendTelegram = async (chatId, messageText, options = {}) => {
    for (const chunk of chunkText(messageText, 3900)) {
      await bot.sendMessage(chatId, chunk, options);
      await sleep(160);
    }
  };

  autoWorker.setNotifier?.(async (userId, messageText) => {
    const chatId = String(userId || '').replace(/^tg_/, '');
    if (!chatId) return;
    await sendTelegram(chatId, messageText, { disable_web_page_preview: true });
  });

  const handleTelegramText = async (chatId, rawId, text) => {
    const userId = `tg_${rawId}`;
    const reply = async (messageText) => {
      const options = text === '/menu' || text.toLowerCase() === 'menu' ? telegramMenuKeyboard() : { disable_web_page_preview: true };
      await sendTelegram(chatId, messageText, options);
    };
    if (!(await guardMessage({ platform: 'telegram', userId, rawId, reply }))) return;
    await meta.handle({ userId, platform: 'telegram', text, reply });
  };

  bot.on('message', async (msg) => {
    const rawId = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    if (!text) return;
    await handleTelegramText(msg.chat.id, rawId, text);
  });

  bot.on('callback_query', async (query) => {
    const msg = query.message;
    const data = String(query.data || '').trim();
    if (!msg || !data) return;
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await handleTelegramText(msg.chat.id, String(msg.chat.id), data);
  });

  bot.on('polling_error', (err) => console.error('❌ Telegram polling error:', err.message));
  console.log('✅ Telegram bot started.');
  return true;
}

async function main() {
  console.log('🚀 OpenClaw Agent router-v2 starting on Railway...');
  const httpStarted = startHttpApi();
  const telegramStarted = startTelegram();
  const whatsappStarted = await startWhatsApp();
  autoWorker.start();

  if (!httpStarted && !whatsappStarted && !telegramStarted) {
    console.error('❌ No platform configured. Set TELEGRAM_TOKEN and/or ENABLE_WHATSAPP=true with WA_PHONE_NUMBER.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
