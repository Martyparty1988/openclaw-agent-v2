// router.js — Unified message router for Telegram + optional WhatsApp
// Railway-ready: Telegram by default, WhatsApp only when ENABLE_WHATSAPP=true

const TelegramBot = require('node-telegram-bot-api');
const MetaAgent = require('./meta-agent');
const AutoWorker = require('./sub-agents/auto-worker');
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

  const telegramStarted = startTelegram();
  const whatsappStarted = await startWhatsApp();
  autoWorker.start();

  if (!whatsappStarted && !telegramStarted) {
    console.error('❌ No platform configured. Set TELEGRAM_TOKEN and/or ENABLE_WHATSAPP=true with WA_PHONE_NUMBER.');
    process.exit(1);
  }

  if (!isAllowAllEnabled() && !splitEnv('ALLOWED_USER_IDS').length && !splitEnv('ALLOWED_TELEGRAM_CHAT_IDS').length && !splitEnv('ALLOWED_WHATSAPP_NUMBERS').length) {
    console.warn('⚠️ No allowlist configured. All users will be blocked until you set ALLOWED_* variables or ALLOW_ALL_USERS=true.');
  }
}

main().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
