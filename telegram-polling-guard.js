// telegram-polling-guard.js — prevents Telegram 409 conflicts during Railway rolling deploys.
// Telegram long polling allows only one active getUpdates consumer per bot token.
// During redeploys, old and new containers may overlap for a moment. This guard
// delays initial polling and retries automatically after a 409 Conflict.

const DEFAULT_START_DELAY_MS = 15000;
const DEFAULT_RETRY_DELAY_MS = 30000;

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isConflict(error) {
  const text = String(error && (error.message || error.description || error.body || error) || '');
  return /409|Conflict|terminated by other getUpdates/i.test(text);
}

function installGuard() {
  let TelegramBot;
  try {
    TelegramBot = require('node-telegram-bot-api');
  } catch (err) {
    console.warn('[telegram-guard] node-telegram-bot-api not available:', err.message || err);
    return;
  }

  const proto = TelegramBot && TelegramBot.prototype;
  if (!proto || proto.__martyPollingGuardInstalled) return;
  proto.__martyPollingGuardInstalled = true;

  const originalStartPolling = proto.startPolling;
  const originalStopPolling = proto.stopPolling;
  const originalEmit = proto.emit;

  proto.startPolling = function guardedStartPolling(options = {}) {
    const delayMs = this.__martyFirstPollingDone ? 0 : numEnv('TELEGRAM_START_DELAY_MS', DEFAULT_START_DELAY_MS);
    this.__martyFirstPollingDone = true;

    if (!delayMs) return originalStartPolling.call(this, options);

    console.log('[telegram-guard] delaying Telegram polling by ' + delayMs + ' ms to avoid deployment overlap');
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          Promise.resolve(originalStartPolling.call(this, options)).then(resolve, reject);
        } catch (err) {
          reject(err);
        }
      }, delayMs);
    });
  };

  proto.emit = function guardedEmit(eventName, error, ...rest) {
    if (eventName === 'polling_error' && isConflict(error) && !this.__martyConflictRetryTimer) {
      const retryMs = numEnv('TELEGRAM_CONFLICT_RETRY_MS', DEFAULT_RETRY_DELAY_MS);
      console.warn('[telegram-guard] 409 conflict detected. Pausing Telegram polling and retrying in ' + retryMs + ' ms');

      try {
        if (typeof originalStopPolling === 'function') {
          Promise.resolve(originalStopPolling.call(this, { cancel: true })).catch(() => {});
        }
      } catch {}

      this.__martyConflictRetryTimer = setTimeout(() => {
        this.__martyConflictRetryTimer = null;
        console.log('[telegram-guard] retrying Telegram polling after conflict');
        try {
          Promise.resolve(originalStartPolling.call(this, { restart: true })).catch((err) => {
            console.error('[telegram-guard] retry failed:', err.message || err);
          });
        } catch (err) {
          console.error('[telegram-guard] retry failed:', err.message || err);
        }
      }, retryMs);
    }

    return originalEmit.call(this, eventName, error, ...rest);
  };

  console.log('[telegram-guard] installed');
}

installGuard();
