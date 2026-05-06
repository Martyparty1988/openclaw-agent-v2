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

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function isFile(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isFile(); } catch { return false; }
}

function isDir(file) {
  try { return fs.existsSync(file) && fs.statSync(file).isDirectory(); } catch { return false; }
}

function runFile(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd: opts.cwd || process.cwd(),
      timeout: opts.timeout || 8000,
      maxBuffer: 512 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), error: error ? error.message : '' });
    });
  });
}

function mask(text) {
  return String(text || '')
    .replace(/https:\/\/[^\s/@]+@github\.com/gi, 'https://***@github.com')
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***')
    .replace(/[0-9]{8,12}:[A-Za-z0-9_-]{25,}/g, 'telegram_token_***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}

function currentProvider() {
  if (configured('OPENROUTER_API_KEY')) return { provider: 'openrouter', model: process.env.OPENROUTER_MODEL || 'openrouter/free' };
  if (configured('DEEPSEEK_API_KEY')) return { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  if (configured('OPENAI_API_KEY')) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
  if (configured('ANTHROPIC_API_KEY')) return { provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest' };
  return { provider: 'none', model: 'none' };
}

function addIssue(issues, severity, title, detail, action) {
  issues.push({ severity, title, detail, action });
}

function severityIcon(severity) {
  if (severity === 'critical') return '🚨';
  if (severity === 'high') return '❌';
  if (severity === 'medium') return '⚠️';
  return 'ℹ️';
}

function severityScore(severity) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity] || 0;
}

async function runDoctor() {
  const workdir = path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  const webDir = path.resolve(process.env.WEB_DIR || path.join(workdir, 'web'));
  const htmlCandidates = ['index.clean.html', 'index.html', 'premium.html'];
  const html = htmlCandidates.find((name) => isFile(path.join(webDir, name))) || '';
  const provider = currentProvider();
  const issues = [];
  const facts = [];

  facts.push('Node: ' + process.version);
  facts.push('Workdir: ' + workdir);
  facts.push('Web dir: ' + webDir);
  facts.push('AI: ' + provider.provider + ' / ' + provider.model);

  if (!isDir(workdir)) {
    addIssue(issues, 'critical', 'AGENT_WORKDIR neexistuje', workdir, 'Nastav AGENT_WORKDIR=/data/openclaw-agent-v2 a udělej redeploy.');
  }

  const gitRepo = isDir(path.join(workdir, '.git'));
  if (!gitRepo) {
    addIssue(issues, 'critical', 'Workdir není git repo', workdir, 'Zkontroluj GIT_REPO_URL, GIT_BRANCH a GIT_TOKEN/GITHUB_TOKEN.');
  } else {
    const branch = await runFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workdir });
    const commit = await runFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: workdir });
    const status = await runFile('git', ['status', '--short'], { cwd: workdir });
    const remote = await runFile('git', ['remote', 'get-url', 'origin'], { cwd: workdir });
    facts.push('Git: ' + (branch.stdout || 'unknown') + ' @ ' + (commit.stdout || 'unknown'));
    facts.push('Remote: ' + mask(remote.stdout || 'unknown'));
    if (status.stdout) {
      addIssue(issues, 'medium', 'Git workspace má lokální změny', status.stdout.slice(0, 1200), 'Nejdřív klikni Git Test Push, nebo rozhodni, jestli změny commitnout/resetnout.');
    }
  }

  if (!isDir(webDir)) {
    addIssue(issues, 'high', 'Web složka neexistuje', webDir, 'Repo musí obsahovat složku web a web-static-patch má mířit na aktivní klon.');
  } else if (!html) {
    addIssue(issues, 'high', 'Chybí aktivní HTML', webDir, 'Přidej web/index.clean.html nebo web/index.html.');
  } else {
    facts.push('Active HTML: web/' + html);
  }

  const endpointFiles = [
    ['Diagnostika', 'diagnostics-endpoint.js'],
    ['Runtime Logs', 'runtime-logs-endpoint.js'],
    ['Safe Web Improve', 'web-safe-improve-endpoint.js'],
    ['Git Test Push', 'git-push-test-endpoint.js'],
    ['Safe Git Pull', 'git-pull-endpoint.js'],
  ];
  for (const [label, file] of endpointFiles) {
    if (!isFile(path.join(__dirname, file))) {
      addIssue(issues, 'medium', 'Chybí endpoint: ' + label, file, 'Pullni poslední commit z GitHubu nebo redeployni aktuální verzi.');
    }
  }

  if (!configured('WEB_API_TOKEN')) {
    addIssue(issues, 'medium', 'WEB_API_TOKEN není nastavený', 'API je otevřené bez vlastního tokenu.', 'Nastav WEB_API_TOKEN v Railway Variables a stejný token vlož ve webu do nastavení.');
  }

  if (provider.provider === 'none') {
    addIssue(issues, 'high', 'Není nastavený žádný AI provider', 'Žádný API klíč pro OpenRouter/DeepSeek/OpenAI/Anthropic.', 'Nastav OPENROUTER_API_KEY nebo DEEPSEEK_API_KEY pro levný provoz.');
  }

  if (!configured('TELEGRAM_TOKEN') && !configured('TELEGRAM_BOT_TOKEN')) {
    addIssue(issues, 'low', 'Telegram token není nastavený', 'Telegram bot nepoběží.', 'Nastav TELEGRAM_BOT_TOKEN nebo TELEGRAM_TOKEN, pokud chceš Telegram.');
  }

  if (envFlag('ENABLE_WHATSAPP') && !configured('WA_PHONE_NUMBER') && !configured('WHATSAPP_PHONE_NUMBER')) {
    addIssue(issues, 'medium', 'WhatsApp je zapnutý, ale chybí číslo', 'ENABLE_WHATSAPP=true bez WA_PHONE_NUMBER.', 'Doplň WA_PHONE_NUMBER v mezinárodním formátu bez pluska.');
  }

  const openclawDir = process.env.OPENCLAW_UPSTREAM_DIR || '/data/openclaw-upstream';
  if (!isDir(path.join(openclawDir, '.git'))) {
    addIssue(issues, 'low', 'OpenClaw upstream není naklonovaný', openclawDir, 'Zkontroluj openclaw-upstream logy, případně ENABLE_OPENCLAW_UPSTREAM.');
  }

  issues.sort((a, b) => severityScore(b.severity) - severityScore(a.severity));
  const criticalCount = issues.filter((x) => x.severity === 'critical' || x.severity === 'high').length;
  const health = criticalCount ? 'needs-attention' : issues.length ? 'minor-issues' : 'healthy';

  const lines = [];
  lines.push('🧑‍⚕️ Martybot Doctor');
  lines.push('Stav: ' + (health === 'healthy' ? '✅ zdravý' : health === 'minor-issues' ? '⚠️ drobnosti' : '🚨 chce pozornost'));
  lines.push('Nálezů: ' + issues.length);
  lines.push('Čas: ' + new Date().toISOString());
  lines.push('');
  lines.push('📌 Fakta:');
  facts.forEach((x) => lines.push('• ' + x));
  lines.push('');
  if (!issues.length) {
    lines.push('✅ Všechno vypadá dobře. Doporučený další klik: Git Test Push → Web Improve.');
  } else {
    lines.push('🧯 Co opravit:');
    issues.slice(0, 8).forEach((issue, index) => {
      lines.push((index + 1) + '. ' + severityIcon(issue.severity) + ' ' + issue.title);
      lines.push('   Detail: ' + issue.detail);
      lines.push('   Akce: ' + issue.action);
    });
  }
  lines.push('');
  lines.push('🎛️ Doporučené pořadí tlačítek: Diagnostika → Runtime Logs → Git Pull → Git Test Push → Web Improve');
  lines.push('Poznámka: tokeny a citlivé hodnoty jsou maskované.');

  return { ok: health !== 'needs-attention', health, issues, facts, text: lines.join('\n') };
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
  if (http.__martybotDoctorInstalled) return;
  http.__martybotDoctorInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithDoctor(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = async (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
      if (req.method === 'OPTIONS' && pathname === '/api/doctor') return sendJson(res, 204, {});
      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/doctor') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        try {
          const result = await runDoctor();
          return sendJson(res, 200, { ...result, reply: result.text, replies: [result.text] });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: mask(err.message || String(err)) });
        }
      }
      if (typeof listener === 'function') return listener(req, res);
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    };

    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };

  console.log('[doctor-endpoint] installed at /api/doctor');
}

install();
module.exports = { runDoctor };
