// web-agent-sync-patch.js
// Makes long-running agent commands return their full result through the Web API.
// Telegram can stream follow-up replies later, but HTTP needs the whole answer before the response closes.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function configureWebDir() {
  const workdir = String(process.env.AGENT_WORKDIR || '').trim();
  if (!process.env.WEB_DIR && workdir) {
    process.env.WEB_DIR = path.join(workdir, 'web');
    console.log('[web-agent-sync-patch] WEB_DIR=' + process.env.WEB_DIR);
  }
}

function friendlyAgentError(err) {
  const raw = [err && err.message, err && err.stack].filter(Boolean).join('\n');
  const lower = raw.toLowerCase();
  if (lower.includes('anthropic_api_key') || lower.includes('api key')) return 'Chybí nebo je špatně nastavený API klíč pro model.';
  if (lower.includes('credit') || lower.includes('balance')) return 'API účet nemá kredit/billing. Přepni model nebo dobij kredit.';
  if (lower.includes('write access') || lower.includes('403')) return 'GitHub push odmítl práva tokenu. Token musí mít oprávnění Contents: Read and write pro repo.';
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

function runFile(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd: opts.cwd || process.cwd(),
      timeout: opts.timeout || 60000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), error: error ? error.message : '' });
    });
  });
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, text) {
  fs.writeFileSync(file, text, 'utf8');
}

function exists(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch { return false; }
}

function webScore(html) {
  const checks = [
    ['doctype', /<!doctype\s+html>/i.test(html)],
    ['viewport-fit', /viewport-fit=cover/i.test(html)],
    ['manifest', /rel=["']manifest["']/i.test(html)],
    ['theme-color', /theme-color/i.test(html)],
    ['description meta', /name=["']description["']/i.test(html)],
    ['color-scheme meta', /name=["']color-scheme["']/i.test(html)],
    ['app script', /app\.js/i.test(html)],
    ['service actions', /service-actions\.js/i.test(html)],
    ['safe area', /safe-area-inset/i.test(html)],
    ['aria labels', /aria-label/i.test(html)],
  ];
  return { checks, ok: checks.filter(([, pass]) => pass).length, total: checks.length };
}

function polishHtml(html) {
  let out = String(html || '');
  if (!/name=["']description["']/i.test(out)) {
    out = out.replace(/<title>(.*?)<\/title>/i, '<title>$1</title>\n  <meta name="description" content="Martybot webové ovládání pro Telegram, WhatsApp, Git, agenty a servisní akce.">');
  }
  if (!/name=["']color-scheme["']/i.test(out)) {
    out = out.replace(/<meta name="theme-color"[^>]*>/i, (m) => m + '\n  <meta name="color-scheme" content="dark">');
  }
  if (!/preconnect" href="https:\/\/fonts\.gstatic\.com/i.test(out) && /fonts\.googleapis\.com/i.test(out)) {
    out = out.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/i, '$&\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  }
  return out;
}

async function safeWebImprove(onStep = () => {}) {
  const workdir = path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  const webDir = path.resolve(process.env.WEB_DIR || path.join(workdir, 'web'));
  const candidates = ['index.clean.html', 'index.html', 'premium.html'];
  const targetName = candidates.find((name) => exists(path.join(webDir, name)));
  if (!targetName) throw new Error('Nenašel jsem HTML soubor ve web složce: ' + webDir);

  const target = path.join(webDir, targetName);
  onStep('📄 Čtu aktivní web: web/' + targetName);
  const before = readText(target);
  const beforeScore = webScore(before);
  onStep('📊 Skóre před úpravou: ' + beforeScore.ok + '/' + beforeScore.total);

  const after = polishHtml(before);
  const afterScore = webScore(after);

  const lines = [];
  lines.push('🌐 Safe Web Improve');
  lines.push('Soubor: web/' + targetName);
  lines.push('Skóre: ' + beforeScore.ok + '/' + beforeScore.total + ' → ' + afterScore.ok + '/' + afterScore.total);
  lines.push('');
  for (const [name, pass] of afterScore.checks) lines.push((pass ? '✅ ' : '⚠️ ') + name);

  if (after === before) {
    lines.push('');
    lines.push('ℹ️ Nebyla potřeba žádná bezpečná automatická úprava.');
    return lines.join('\n');
  }

  writeText(target + '.bak', before);
  writeText(target, after);
  onStep('✅ HTML upraveno lokálně');

  const rel = path.relative(workdir, target).replace(/\\/g, '/');
  await runFile('git', ['config', 'user.email', 'martybot@users.noreply.github.com'], { cwd: workdir });
  await runFile('git', ['config', 'user.name', 'Martybot'], { cwd: workdir });
  await runFile('git', ['add', rel], { cwd: workdir });
  const status = await runFile('git', ['status', '--porcelain'], { cwd: workdir });
  if (!status.stdout) {
    lines.push('');
    lines.push('ℹ️ Git nevidí žádnou změnu k commitnutí.');
    return lines.join('\n');
  }

  const commit = await runFile('git', ['commit', '-m', 'web-improve: polish active web UI'], { cwd: workdir, timeout: 120000 });
  if (!commit.ok) {
    lines.push('');
    lines.push('⚠️ Commit selhal: ' + (commit.stderr || commit.error));
    return lines.join('\n');
  }

  const branch = process.env.GIT_BRANCH || 'main';
  const push = await runFile('git', ['push', 'origin', branch], { cwd: workdir, timeout: 120000 });
  lines.push('');
  if (push.ok) lines.push('✅ Commit a push hotový.');
  else lines.push('⚠️ Commit hotový, push selhal: ' + (push.stderr || push.error));
  return lines.join('\n');
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
  configureWebDir();
  const MetaAgent = require('./meta-agent-v2');
  if (MetaAgent && MetaAgent.prototype && !MetaAgent.prototype.__martybotWebSyncPatch) {
    const originalHandle = MetaAgent.prototype.handle;

    MetaAgent.prototype.handle = async function patchedHandle(msg) {
      const platform = String(msg && msg.platform || '').toLowerCase();
      const cmd = normalizeCommand(msg && msg.text);
      const reply = msg && msg.reply;

      if (platform === 'web' && typeof reply === 'function') {
        if (isWebImproveCommand(cmd)) {
          console.log(`[WEB][${msg.userId || 'web_user'}] web-improve-safe-sync: ${cmd}`);
          return runAndCollect({
            title: '🌐 Web-improve spuštěn synchronně pro web API.',
            runner: safeWebImprove,
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
