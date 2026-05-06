// web-agent-sync-patch.js
// Makes long-running agent commands return their full result through the Web API.
// Telegram can stream follow-up replies later, but HTTP needs the whole answer before the response closes.

function friendlyAgentError(err) {
  const raw = [err && err.message, err && err.stack].filter(Boolean).join('\n');
  const lower = raw.toLowerCase();
  if (lower.includes('anthropic_api_key') || lower.includes('api key')) return 'Chybí nebo je špatně nastavený ANTHROPIC_API_KEY / API klíč pro model.';
  if (lower.includes('credit') || lower.includes('balance')) return 'API účet nemá kredit/billing. Přepni model nebo dobij kredit.';
  if (lower.includes('write access') || lower.includes('403')) return 'GitHub push odmítl práva tokenu. GIT_TOKEN musí mít Contents: Read and write pro repo.';
  return (err && err.message) || String(err || 'Neznámá chyba');
}

function normalizeCommand(text) {
  return String(text || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isSelfImproveCommand(cmd) {
  return ['improve', 'self-improve', 'refactor self', 'vylepsi', 'vylepši', 'zlepsi', 'zlepši'].includes(cmd);
}

function isWebImproveCommand(cmd) {
  return [
    'web improve',
    'web improve write',
    'improve web',
    'self improve web',
    'self-improve web',
    'vylepsi web',
    'vylepši web',
    'zlepsi web',
    'zlepši web',
    'update web',
  ].includes(cmd);
}

async function runAndCollect({ title, runner, reply }) {
  const lines = [title, ''];
  const stepReply = async (step) => {
    const line = String(step || '').trim();
    if (line) lines.push('⏳ ' + line.replace(/^⏳\s*/, ''));
  };

  try {
    const result = await runner(stepReply);
    lines.push('');
    lines.push(String(result || 'Hotovo.'));
  } catch (err) {
    lines.push('');
    lines.push('❌ Selhalo: ' + friendlyAgentError(err));
  }

  await reply(lines.join('\n'));
}

try {
  const MetaAgent = require('./meta-agent-v2');
  if (MetaAgent && MetaAgent.prototype && !MetaAgent.prototype.__martybotWebSyncPatch) {
    const originalHandle = MetaAgent.prototype.handle;

    MetaAgent.prototype.handle = async function patchedHandle(msg) {
      const platform = String(msg && msg.platform || '').toLowerCase();
      const cmd = normalizeCommand(msg && msg.text);
      const reply = msg && msg.reply;

      if (platform === 'web' && typeof reply === 'function') {
        if (isWebImproveCommand(cmd) && this.webImprove && typeof this.webImprove.run === 'function') {
          console.log(`[WEB][${msg.userId || 'web_user'}] web-improve-sync: ${cmd}`);
          return runAndCollect({
            title: '🌐 Web-improve spuštěn synchronně pro web API.',
            runner: (onStep) => this.webImprove.run(onStep),
            reply,
          });
        }

        if (isSelfImproveCommand(cmd) && this.selfImprove && typeof this.selfImprove.run === 'function') {
          console.log(`[WEB][${msg.userId || 'web_user'}] self-improve-sync: ${cmd}`);
          return runAndCollect({
            title: '🧬 Self-improve spuštěn synchronně pro web API.',
            runner: (onStep) => this.selfImprove.run(onStep),
            reply,
          });
        }
      }

      return originalHandle.call(this, msg);
    };

    MetaAgent.prototype.__martybotWebSyncPatch = true;
    console.log('[web-agent-sync-patch] installed');
  }
} catch (err) {
  console.error('[web-agent-sync-patch] failed:', err && err.message || err);
}
