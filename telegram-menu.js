// telegram-menu.js — nice inline button menu for Martybot Telegram.
// It wraps node-telegram-bot-api message handlers without changing router-full-web.js.

function allowedTelegramIds() {
  return String(process.env.ALLOWED_TELEGRAM_CHAT_IDS || process.env.ALLOWED_USER_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function isAllowed(chatId) {
  const id = String(chatId || '');
  const allow = allowedTelegramIds();
  return !allow.length || allow.includes(id) || allow.includes('tg_' + id);
}

function mainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📡 Status', callback_data: 'm:cmd:/status' },
          { text: '🧠 Agent', callback_data: 'm:agent' }
        ],
        [
          { text: '📱 WhatsApp', callback_data: 'm:wa' },
          { text: '🧩 Git', callback_data: 'm:git' }
        ],
        [
          { text: '🌐 Web/Ops', callback_data: 'm:web' },
          { text: '🦾 OpenClaw', callback_data: 'm:openclaw' }
        ],
        [
          { text: '⚡ Shortcuts', callback_data: 'm:shortcuts' },
          { text: '🆘 Panic', callback_data: 'm:panic' }
        ]
      ]
    },
    disable_web_page_preview: true
  };
}

function submenuKeyboard(name) {
  const back = { text: '⬅️ Zpět', callback_data: 'm:home' };
  const sets = {
    wa: [
      [{ text: '📱 WA status', callback_data: 'm:cmd:/wa status' }, { text: '🔗 Pair code', callback_data: 'm:cmd:/wa pair' }],
      [{ text: '🧼 Fresh pair', callback_data: 'm:freshwa' }, { text: '♻️ Reset WA', callback_data: 'm:cmd:/wa reset' }],
      [back]
    ],
    git: [
      [{ text: '🧩 Git status', callback_data: 'm:cmd:/git' }, { text: '⬇️ Git pull', callback_data: 'm:cmd:/git pull' }],
      [back]
    ],
    web: [
      [{ text: '✨ Web improve', callback_data: 'm:cmd:/web improve' }, { text: '✍️ Improve write', callback_data: 'm:cmd:/web improve write' }],
      [{ text: '🔄 Telegram restart', callback_data: 'm:cmd:/tg restart' }, { text: '📡 Status', callback_data: 'm:cmd:/status' }],
      [back]
    ],
    agent: [
      [{ text: '🧠 Reload agent', callback_data: 'm:cmd:/agent reload' }, { text: '📡 Status', callback_data: 'm:cmd:/status' }],
      [back]
    ],
    openclaw: [
      [{ text: '🦾 OpenClaw status', callback_data: 'm:cmd:OpenClaw status' }, { text: '⬇️ OpenClaw pull', callback_data: 'm:cmd:OpenClaw pull' }],
      [back]
    ],
    shortcuts: [
      [{ text: '⚡ Shortcuts status', callback_data: 'm:cmd:Shortcuts status' }, { text: '🏗️ Builder idea', callback_data: 'm:cmd:Navrhni Apple Shortcuts Builder pro Martybot' }],
      [back]
    ],
    panic: [
      [{ text: '🆘 Spustit panic check', callback_data: 'm:cmd:/status' }, { text: '🧩 Git', callback_data: 'm:cmd:/git' }],
      [{ text: '📱 WA pair', callback_data: 'm:cmd:/wa pair' }, { text: '🧠 Reload', callback_data: 'm:cmd:/agent reload' }],
      [back]
    ]
  };
  return { reply_markup: { inline_keyboard: sets[name] || [[back]] }, disable_web_page_preview: true };
}

function menuText() {
  return [
    '🤖 *Martybot Control Center*',
    '',
    'Vyber akci tlačítkem níže.',
    'Nemusíš psát příkazy ručně — jen klikej.'
  ].join('\n');
}

function submenuText(name) {
  const titles = {
    wa: '📱 *WhatsApp menu*',
    git: '🧩 *Git menu*',
    web: '🌐 *Web/Ops menu*',
    agent: '🧠 *Agent menu*',
    openclaw: '🦾 *OpenClaw menu*',
    shortcuts: '⚡ *Apple Shortcuts menu*',
    panic: '🆘 *Panic menu*'
  };
  return (titles[name] || '⚙️ *Menu*') + '\n\nVyber akci:';
}

function fakeMessageFromCallback(query, text) {
  return {
    message_id: query.message?.message_id || 0,
    from: query.from,
    chat: query.message?.chat || { id: query.from?.id, type: 'private' },
    date: Math.floor(Date.now() / 1000),
    text
  };
}

function installTelegramMenu() {
  let TelegramBot;
  try { TelegramBot = require('node-telegram-bot-api'); }
  catch (e) { console.warn('[telegram-menu] node-telegram-bot-api not available:', e.message || e); return; }

  const proto = TelegramBot && TelegramBot.prototype;
  if (!proto || proto.__martyMenuInstalled) return;
  proto.__martyMenuInstalled = true;

  const originalOn = proto.on;

  proto.on = function patchedOn(eventName, listener) {
    if (eventName === 'message' && typeof listener === 'function') {
      if (!this.__martyMenuCallbackInstalled) {
        this.__martyMenuCallbackInstalled = true;
        originalOn.call(this, 'callback_query', async (query) => {
          const data = String(query && query.data || '');
          const chatId = query.message?.chat?.id || query.from?.id;

          try { await this.answerCallbackQuery(query.id); } catch {}

          if (!isAllowed(chatId)) {
            try { await this.sendMessage(chatId, '🚫 Chat není v allowlistu. ID: ' + chatId); } catch {}
            return;
          }

          try {
            if (data === 'm:home') {
              await this.editMessageText(menuText(), { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...mainKeyboard() });
              return;
            }

            if (data.startsWith('m:') && !data.startsWith('m:cmd:') && data !== 'm:freshwa') {
              const name = data.slice(2);
              await this.editMessageText(submenuText(name), { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', ...submenuKeyboard(name) });
              return;
            }

            if (data === 'm:freshwa') {
              await this.sendMessage(chatId, '🧼 Fresh pair flow:\n1) spouštím /wa reset\n2) po pár sekundách klikni Pair code nebo napiš /wa pair');
              listener(fakeMessageFromCallback(query, '/wa reset'));
              return;
            }

            if (data.startsWith('m:cmd:')) {
              const cmd = data.slice('m:cmd:'.length);
              await this.sendMessage(chatId, '▶️ Spouštím: `' + cmd.replace(/`/g, '') + '`', { parse_mode: 'Markdown' });
              listener(fakeMessageFromCallback(query, cmd));
              return;
            }
          } catch (e) {
            try { await this.sendMessage(chatId, 'Menu chyba: ' + (e.message || String(e))); } catch {}
          }
        });
      }

      const wrapped = async (msg) => {
        const text = String(msg && msg.text || '').trim().toLowerCase();
        const chatId = msg?.chat?.id;
        if ((text === '/start' || text === '/menu' || text === '/help') && isAllowed(chatId)) {
          await this.sendMessage(chatId, menuText(), { parse_mode: 'Markdown', ...mainKeyboard() });
          return;
        }
        return listener(msg);
      };
      return originalOn.call(this, eventName, wrapped);
    }

    return originalOn.call(this, eventName, listener);
  };

  console.log('[telegram-menu] installed');
}

installTelegramMenu();
