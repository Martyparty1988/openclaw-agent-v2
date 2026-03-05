// router.js — Unified message router for WhatsApp + Telegram
// Railway-ready: uses pairing code instead of QR scan

const { createBot, createProvider, createFlow, addKeyword } = require('@builderbot/bot');
const BaileysProvider = require('@builderbot/provider-baileys');
const TelegramBot = require('node-telegram-bot-api');
const MetaAgent = require('./meta-agent');
require('dotenv').config();

const meta = new MetaAgent();

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

let waProvider = null;

const waFlow = addKeyword([
  'execute', 'analyze', 'plan', 'chat', 'improve', 'reset', 'help',
  'exec', 'spusť', 'analyzuj', 'naplánuj', 'zlepši', 'zapomeň', 'pomoc',
]).addAction(async (ctx, { flowDynamic }) => {
  const reply = async (text) => {
    const chunks = chunkText(text, 3800);
    for (const chunk of chunks) {
      await flowDynamic(chunk);
    }
  };

  const msg = {
    userId: ctx.from,
    platform: 'whatsapp',
    text: ctx.body.trim(),
    reply,
  };

  await meta.handle(msg);
});

async function startWhatsApp() {
  const adapterFlow = createFlow([waFlow]);

  const adapterProvider = createProvider(BaileysProvider, {
    usePairingCode: true,
    phoneNumber: process.env.WA_PHONE_NUMBER,
  });

  adapterProvider.on('ready', (p) => {
    waProvider = p;
    console.log('✅ WhatsApp connected and ready.');
  });

  createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: null,
  });

  console.log('📱 WhatsApp: pairing code will appear in logs...');
  console.log(`📱 Phone number: ${process.env.WA_PHONE_NUMBER}`);
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

function startTelegram() {
  if (!process.env.TELEGRAM_TOKEN) {
    console.log('⚠️ TELEGRAM_TOKEN not set — Telegram disabled.');
    return;
  }

  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  bot.on('message', async (msg) => {
    const userId = String(msg.chat.id);
    const text = msg.text || '';

    const reply = async (messageText) => {
      const chunks = chunkText(messageText, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(msg.chat.id, chunk, { parse_mode: 'Markdown' });
        await sleep(200);
      }
    };

    await meta.handle({ userId: `tg_${userId}`, platform: 'telegram', text, reply });
  });

  console.log('✅ Telegram bot started.');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function chunkText(text, maxLen) {
  const chunks = [];
  let rest = text || '';

  while (rest.length > maxLen) {
    chunks.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 OpenClaw Agent starting on Railway...');

  if (!process.env.WA_PHONE_NUMBER) {
    console.error('❌ WA_PHONE_NUMBER not set! Add it to Railway Variables.');
    process.exit(1);
  }

  await startWhatsApp();
  startTelegram();
}

main();
