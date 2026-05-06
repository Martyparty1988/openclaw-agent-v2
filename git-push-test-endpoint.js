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

function mask(text) {
  return String(text || '')
    .replace(/https:\/\/[^\s/@]+@github\.com/gi, 'https://***@github.com')
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***');
}

function isGitRepo(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; }
}

function writeCheckFile(workdir) {
  const dir = path.join(workdir, 'health');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'git-push-check.txt');
  const content = [
    'Martybot Git Push Check',
    'Updated: ' + new Date().toISOString(),
    'Runtime: ' + process.version,
    'Branch: ' + (process.env.GIT_BRANCH || 'main'),
    '',
  ].join('\n');
  fs.writeFileSync(file, content, 'utf8');
  return { file, rel: path.relative(workdir, file).replace(/\\/g, '/') };
}

function explainFailure(raw) {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('403') || lower.includes('write access') || lower.includes('permission')) {
    return 'Token nemá právo zapisovat do repozitáře. Vytvoř fine-grained GitHub token s oprávněním Contents: Read and write pro Martyparty1988/openclaw-agent-v2.';
  }
  if (lower.includes('authentication') || lower.includes('could not read username') || lower.includes('terminal prompts disabled')) {
    return 'Git nemá funkční autentizaci. Zkontroluj GIT_TOKEN nebo GITHUB_TOKEN v Railway Variables a redeploy.';
  }
  if (lower.includes('non-fast-forward') || lower.includes('fetch first')) {
    return 'Vzdálený branch je napřed. Spusť Git Pull a potom Git Test Push znovu.';
  }
  return 'Zkontroluj GitHub token, branch, remote a Railway logy.';
}

async function runGitPushTest() {
  const workdir = path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  const lines = [];
  lines.push('🧪 Git Test Push');
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

  await runGit(['config', 'user.email', 'martybot@users.noreply.github.com'], { cwd: workdir });
  await runGit(['config', 'user.name', 'Martybot'], { cwd: workdir });

  const check = writeCheckFile(workdir);
  lines.push('Soubor: ' + check.rel);

  const add = await runGit(['add', check.rel], { cwd: workdir });
  if (!add.ok) {
    lines.push('❌ Git add selhal: ' + mask(add.stderr || add.error));
    return { ok: false, text: lines.join('\n') };
  }

  const status = await runGit(['status', '--porcelain', '--', check.rel], { cwd: workdir });
  if (!status.stdout) {
    lines.push('ℹ️ Testovací soubor se nezměnil, není co commitnout.');
  } else {
    const commit = await runGit(['commit', '-m', 'health: git push check'], { cwd: workdir, timeout: 120000 });
    if (!commit.ok) {
      const raw = mask(commit.stderr || commit.error || commit.stdout);
      lines.push('❌ Commit selhal: ' + raw);
      lines.push('Doporučení: ' + explainFailure(raw));
      return { ok: false, text: lines.join('\n') };
    }
    lines.push('✅ Commit vytvořen.');
  }

  const pushBranch = process.env.GIT_BRANCH || branch.stdout || 'main';
  const push = await runGit(['push', 'origin', pushBranch], { cwd: workdir, timeout: 120000 });
  if (!push.ok) {
    const raw = mask(push.stderr || push.error || push.stdout);
    lines.push('❌ Push selhal: ' + raw);
    lines.push('Doporučení: ' + explainFailure(raw));
    return { ok: false, text: lines.join('\n') };
  }

  lines.push('✅ Push prošel. GitHub zápis funguje.');
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
  if (http.__martybotGitPushTestInstalled) return;
  http.__martybotGitPushTestInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithGitPushTest(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = async (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
      if (req.method === 'OPTIONS' && pathname === '/api/git/test-push') return sendJson(res, 204, {});
      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/git/test-push') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        try {
          const result = await runGitPushTest();
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

  console.log('[git-push-test-endpoint] installed at /api/git/test-push');
}

install();
module.exports = { runGitPushTest };
