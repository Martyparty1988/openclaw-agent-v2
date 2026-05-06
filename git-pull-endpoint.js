const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

function authOk(req) {
  const token = process.env.WEB_API_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return bearer === token || req.headers['x-agent-token'] === token;
}

function mask(text) {
  return String(text || '')
    .replace(/https:\/\/[^\s/@]+@github\.com/gi, 'https://***@github.com')
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***');
}

function runGit(args, opts = {}) {
  const cwd = opts.cwd || path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      timeout: opts.timeout || 60000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        error: error ? error.message : '',
      });
    });
  });
}

function isGitRepo(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; }
}

function explain(raw) {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('local changes') || lower.includes('would be overwritten')) {
    return 'V repu jsou lokální změny. Nejdřív je commitni, nebo udělej čistý redeploy/pull po záloze.';
  }
  if (lower.includes('authentication') || lower.includes('could not read username') || lower.includes('terminal prompts disabled')) {
    return 'Git nemá funkční autentizaci. Zkontroluj GIT_TOKEN nebo GITHUB_TOKEN v Railway Variables.';
  }
  if (lower.includes('403') || lower.includes('permission') || lower.includes('access denied')) {
    return 'Token nemá potřebná oprávnění. Pro pull stačí read, pro push je potřeba Contents: Read and write.';
  }
  if (lower.includes('not a git repository')) {
    return 'AGENT_WORKDIR není git repozitář. Nastav AGENT_WORKDIR na /data/openclaw-agent-v2 a redeploy.';
  }
  if (lower.includes('no such file or directory')) {
    return 'Chybí pracovní složka nebo git remote. Zkontroluj AGENT_WORKDIR a GIT_REPO_URL.';
  }
  return 'Zkontroluj Git remote, branch, token a Railway logy.';
}

async function runSafeGitPull() {
  const workdir = path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  const lines = [];
  lines.push('⬇️ Safe Git Pull');
  lines.push('Workdir: ' + workdir);
  lines.push('');

  if (!isGitRepo(workdir)) {
    lines.push('❌ AGENT_WORKDIR není git repozitář.');
    lines.push('Doporučení: nastav AGENT_WORKDIR=/data/openclaw-agent-v2 a udělej redeploy.');
    return { ok: false, text: lines.join('\n') };
  }

  const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workdir });
  const remote = await runGit(['remote', 'get-url', 'origin'], { cwd: workdir });
  lines.push('Branch: ' + (branch.stdout || 'unknown'));
  lines.push('Remote: ' + mask(remote.stdout || 'unknown'));

  const local = await runGit(['status', '--short'], { cwd: workdir });
  if (local.stdout) {
    lines.push('');
    lines.push('⚠️ Lokální změny před pullem:');
    lines.push(local.stdout.slice(0, 2000));
    lines.push('');
    lines.push('Pull radši nepouštím, aby se nic nepřepsalo.');
    lines.push('Doporučení: nejdřív commitni změny nebo použij Git Test Push.');
    return { ok: false, text: lines.join('\n') };
  }

  const fetch = await runGit(['fetch', 'origin', process.env.GIT_BRANCH || branch.stdout || 'main'], { cwd: workdir, timeout: 120000 });
  if (!fetch.ok) {
    const raw = mask(fetch.stderr || fetch.error || fetch.stdout);
    lines.push('');
    lines.push('❌ Fetch selhal: ' + raw);
    lines.push('Doporučení: ' + explain(raw));
    return { ok: false, text: lines.join('\n') };
  }

  const pull = await runGit(['pull', '--ff-only', 'origin', process.env.GIT_BRANCH || branch.stdout || 'main'], { cwd: workdir, timeout: 120000 });
  if (!pull.ok) {
    const raw = mask(pull.stderr || pull.error || pull.stdout);
    lines.push('');
    lines.push('❌ Pull selhal: ' + raw);
    lines.push('Doporučení: ' + explain(raw));
    return { ok: false, text: lines.join('\n') };
  }

  const commit = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: workdir });
  lines.push('');
  lines.push('✅ Pull hotový.');
  lines.push('Aktuální commit: ' + (commit.stdout || 'unknown'));
  lines.push(pull.stdout || 'Already up to date.');
  return { ok: true, text: lines.join('\n') };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Agent-Token',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function install() {
  if (http.__martybotGitPullInstalled) return;
  http.__martybotGitPullInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithGitPull(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = async (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
      if (req.method === 'OPTIONS' && pathname === '/api/git/pull-safe') return sendJson(res, 204, {});
      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/git/pull-safe') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        try {
          const result = await runSafeGitPull();
          return sendJson(res, result.ok ? 200 : 500, { ok: result.ok, reply: result.text, replies: [result.text] });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: mask(err.message || String(err)) });
        }
      }
      if (typeof listener === 'function') return listener(req, res);
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    };

    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };

  console.log('[git-pull-endpoint] installed at /api/git/pull-safe');
}

install();
module.exports = { runSafeGitPull };
