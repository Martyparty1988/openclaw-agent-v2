// telegram-env-check.js — safe Telegram env diagnostics without printing secrets.
// Helps detect when an older env variable shadows the fresh BotFather token.

function maskToken(token) {
  const value = String(token || '').trim();
  if (!value) return 'empty';
  const parts = value.split(':');
  const tail = value.slice(-6);
  return `len=${value.length}, id=${parts[0] || '?'}, tail=***${tail}`;
}

function tokenFormatLooksValid(token) {
  return /^\d{6,}:[A-Za-z0-9_-]{25,}$/.test(String(token || '').trim());
}

function pickTelegramToken() {
  const candidates = [
    ['TELEGRAM_TOKEN', process.env.TELEGRAM_TOKEN],
    ['TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN],
    ['BOT_TOKEN', process.env.BOT_TOKEN],
  ].map(([name, value]) => ({ name, value: String(value || '').trim() }));

  const configured = candidates.filter((item) => Boolean(item.value));
  const selected = configured[0] || { name: 'none', value: '' };

  if (!configured.length) {
    console.log('[telegram-env] no Telegram token configured');
    return;
  }

  console.log(`[telegram-env] selected=${selected.name} ${maskToken(selected.value)} format=${tokenFormatLooksValid(selected.value) ? 'ok' : 'invalid'}`);

  if (configured.length > 1) {
    console.warn('[telegram-env] multiple token variables configured. Priority is TELEGRAM_TOKEN > TELEGRAM_BOT_TOKEN > BOT_TOKEN. Remove old duplicates in Railway Variables.');
    for (const item of configured) {
      console.warn(`[telegram-env] candidate=${item.name} ${maskToken(item.value)} format=${tokenFormatLooksValid(item.value) ? 'ok' : 'invalid'}`);
    }
  }

  if (!tokenFormatLooksValid(selected.value)) {
    console.warn(`[telegram-env] selected token from ${selected.name} does not look like a BotFather token. Check Railway Variables.`);
  }
}

pickTelegramToken();
