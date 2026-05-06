const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

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

function exists(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch { return false; }
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function webScore(html) {
  const checks = [
    ['doctype', /<!doctype\s+html>/i.test(html)],
    ['viewport-fit', /viewport-fit=cover/i.test(html)],
    ['manifest', /rel=["']manifest["']/i.test(html)],
    ['theme-color', /theme-color/i.test(html)],
    ['description meta', /name=["']description["']/i.test(html)],
    ['color-scheme meta', /name=["']color-scheme["']/i.test(html)],
    ['service worker', /service-worker\.js/i.test(html)],
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

function targetHtml() {
  const workdir = path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  const webDir = path.resolve(process.env.WEB_DIR || path.join(workdir, 'web'));
  const candidates = ['index.clean.html', 'index.html', 'premium.html'];
  const name = candidates.find((item) => exists(path.join(webDir, item)));
  if (!name) throw new Error('No web HTML target found in ' + webDir);
  return { workdir, webDir, name, file: path.join(webDir, name) };
}

async function runSafeWebImprove() {
  const target = targetHtml();
  const before = readText(target.file);
  const beforeScore = webScore(before);
  const after = polishHtml(before);
  const afterScore = webScore(after);

  const lines = [];
  lines.push('🌐 Safe Web Improve');
  lines.push('Soubor: web/' + target.name);
  lines.push('Skóre: ' + beforeScore.ok + '/' + beforeScore.total + ' → ' + afterScore.ok + '/' + afterScore.total);
  lines.push('');
  for (const [name, pass] of afterScore.checks) lines.push((pass ? '✅ ' : '⚠️ ') + name);

  if (after === before) {
    lines.push('');
    lines.push('ℹ️ Nebyla potřeba žádná bezpečná automatická úprava.');
    return lines.join('\n');
  }

  const backup = path.join('/tmp', 'martybot-web-backups', target.name + '.' + Date.now() + '.bak');
  writeText(backup, before);
  writeText(target.file, after);
  lines.push('');
  lines.push('✅ HTML upraveno lokálně.');
  lines.push('🧯 Záloha: ' + backup);

  const rel = path.relative(target.workdir, target.file).replace(/\\/g, '/');
  await runFile('git', ['config', 'user.email', 'martybot@users.noreply.github.com'], { cwd: target.workdir });
  await runFile('git', ['config', 'user.name', 'Martybot'], { cwd: target.workdir });
  await runFile('git', ['add', rel], { cwd: target.workdir });

  const status = await runFile('git', ['status', '--porcelain', '--', rel], { cwd: target.workdir });
  if (!status.stdout) {
    lines.push('ℹ️ Git nevidí žádnou změnu k commitnutí.');
    return lines.join('\n');
  }

  const commit = await runFile('git', ['commit', '-m', 'web-improve: safe polish web ui'], { cwd: target.workdir, timeout: 120000 });
  if (!commit.ok) {
    lines.push('⚠️ Commit selhal: ' + (commit.stderr || commit.error));
    return lines.join('\n');
  }

  const branch = process.env.GIT_BRANCH || 'main';
  const push = await runFile('git', ['push', 'origin', branch], { cwd: target.workdir, timeout: 120000 });
  if (push.ok) lines.push('✅ Commit a push hotový.');
  else lines.push('⚠️ Commit hotový, push selhal: ' + (push.stderr || push.error));

  return lines.join('\n');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Agent-Token'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function install() {
  if (http.__martybotSafeWebImproveInstalled) return;
  http.__martybotSafeWebImproveInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithSafeWebImprove(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = async (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
      if (req.method === 'OPTIONS' && pathname === '/api/web/improve-safe') return sendJson(res, 204, {});
      if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/web/improve-safe') {
        try {
          const reply = await runSafeWebImprove();
          return sendJson(res, 200, { ok: true, reply, replies: [reply] });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: err.message || String(err) });
        }
      }
      if (typeof listener === 'function') return listener(req, res);
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    };

    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };

  console.log('[web-safe-improve-endpoint] installed at /api/web/improve-safe');
}

install();
module.exports = { runSafeWebImprove };
