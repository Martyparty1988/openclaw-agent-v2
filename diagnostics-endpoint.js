const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function authOk(req) {
  const token = process.env.WEB_API_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return bearer === token || req.headers['x-agent-token'] === token;
}

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
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

function currentProvider() {
  try {
    const { statusSummary } = require('./sub-agents/model-presets');
    const s = statusSummary();
    return { provider: s.provider || 'none', model: s.model || 'none', tokenSet: s.tokenSet };
  } catch {
    if (configured('AI_PROVIDER') || configured('LLM_PROVIDER')) return { provider: process.env.AI_PROVIDER || process.env.LLM_PROVIDER, model: process.env.AI_MODEL || 'unset', tokenSet: true };
    if (configured('OPENROUTER_API_KEY')) return { provider: 'openrouter', model: process.env.OPENROUTER_MODEL || 'openrouter/free', tokenSet: true };
    if (configured('DEEPSEEK_API_KEY')) return { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', tokenSet: true };
    if (configured('OPENAI_API_KEY')) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', tokenSet: true };
    if (configured('ANTHROPIC_API_KEY')) return { provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest', tokenSet: true };
    return { provider: 'none', model: 'none', tokenSet: false };
  }
}

function webDir() {
  const workdir = process.env.AGENT_WORKDIR || process.cwd();
  return process.env.WEB_DIR || path.join(workdir, 'web');
}

function pickHtml(web) {
  const candidates = ['index.clean.html', 'index.html', 'premium.html'];
  return candidates.find((name) => isFile(path.join(web, name))) || '';
}

function buildRecommendations(checks) {
  const recs = [];
  const byName = new Map(checks.map(([name, ok, detail]) => [name, { ok, detail }]));
  if (!byName.get('AGENT_WORKDIR exists')?.ok) recs.push('Nastav Railway variable AGENT_WORKDIR na /data/openclaw-agent-v2 a udělej redeploy.');
  if (!byName.get('Git repo')?.ok) recs.push('Zkontroluj GIT_REPO_URL, GIT_BRANCH a GIT_TOKEN. Repo se musí naklonovat do AGENT_WORKDIR.');
  if (!byName.get('Git clean')?.ok) recs.push('Git workspace má lokální změny. Spusť Git status a rozhodni, jestli je commitnout nebo resetnout.');
  if (!byName.get('Web dir exists')?.ok) recs.push('Web složka neexistuje. Ověř, že repo obsahuje /web a že web-static-patch servíruje správný klon.');
  if (!byName.get('Active HTML')?.ok) recs.push('Chybí aktivní HTML. Přidej web/index.clean.html nebo web/index.html.');
  if (!byName.get('Safe Web Improve endpoint file')?.ok) recs.push('Chybí web-safe-improve-endpoint.js. Pullni poslední změny z GitHubu nebo redeployni aktuální commit.');
  if (!byName.get('Diagnostics endpoint file')?.ok) recs.push('Chybí diagnostics-endpoint.js. Pullni poslední změny z GitHubu nebo redeployni aktuální commit.');
  if (!byName.get('Telegram token')?.ok) recs.push('Pokud chceš Telegram, nastav TELEGRAM_BOT_TOKEN nebo TELEGRAM_TOKEN.');
  if (!byName.get('AI provider')?.ok) recs.push('Nastav AI_PROVIDER + AI_MODEL a příslušný API klíč. Např. AI_PROVIDER=anthropic, AI_MODEL=claude-sonnet-4-20250514, ANTHROPIC_API_KEY=...');
  if (!byName.get('AI provider lock')?.ok) recs.push('Doporučení: nastav AI_PROVIDER a AI_MODEL v Railway Variables, aby /status a agent používali stejný model i po redeployi.');
  if (!byName.get('Web API token')?.ok) recs.push('Doporučení: nastav WEB_API_TOKEN, ať webové API není otevřené bez ochrany.');
  if (!byName.get('OpenClaw upstream')?.ok) recs.push('OpenClaw upstream není naklonovaný. V logu zkontroluj openclaw clone/pull, případně ENABLE_OPENCLAW_UPSTREAM.');
  if (!recs.length) recs.push('Všechno vypadá zdravě. Další krok: test /status, Git Test Push a Web Improve.');
  return recs;
}

async function collectDiagnostics() {
  const workdir = path.resolve(process.env.AGENT_WORKDIR || process.cwd());
  const web = path.resolve(webDir());
  const provider = currentProvider();
  const gitRepo = isDir(path.join(workdir, '.git'));
  const gitBranch = gitRepo ? await runFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workdir }) : { ok: false, stdout: '' };
  const gitCommit = gitRepo ? await runFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: workdir }) : { ok: false, stdout: '' };
  const gitStatus = gitRepo ? await runFile('git', ['status', '--short'], { cwd: workdir }) : { ok: false, stdout: '' };

  const openclawDir = process.env.OPENCLAW_UPSTREAM_DIR || '/data/openclaw-upstream';
  const openclawRepo = isDir(path.join(openclawDir, '.git'));
  const openclawCommit = openclawRepo ? await runFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: openclawDir }) : { ok: false, stdout: '' };

  const html = pickHtml(web);
  const safeEndpointFile = path.join(__dirname, 'web-safe-improve-endpoint.js');
  const diagnosticsFile = path.join(__dirname, 'diagnostics-endpoint.js');
  const providerLock = configured('AI_PROVIDER') || configured('LLM_PROVIDER');

  const checks = [
    ['Backend runtime', true, 'Node ' + process.version],
    ['AGENT_WORKDIR exists', isDir(workdir), workdir],
    ['Git repo', gitRepo, gitRepo ? 'branch ' + (gitBranch.stdout || 'unknown') + ', commit ' + (gitCommit.stdout || 'unknown') : 'not found'],
    ['Git clean', gitRepo && !gitStatus.stdout, gitStatus.stdout ? gitStatus.stdout.slice(0, 1000) : 'clean'],
    ['Web dir exists', isDir(web), web],
    ['Active HTML', Boolean(html), html || 'missing'],
    ['Safe Web Improve endpoint file', isFile(safeEndpointFile), exists(safeEndpointFile) ? 'present' : 'missing'],
    ['Diagnostics endpoint file', isFile(diagnosticsFile), exists(diagnosticsFile) ? 'present' : 'missing'],
    ['Telegram token', configured('TELEGRAM_TOKEN') || configured('TELEGRAM_BOT_TOKEN'), 'configured=' + (configured('TELEGRAM_TOKEN') || configured('TELEGRAM_BOT_TOKEN'))],
    ['WhatsApp enabled', envFlag('ENABLE_WHATSAPP'), 'phone configured=' + (configured('WA_PHONE_NUMBER') || configured('WHATSAPP_PHONE_NUMBER'))],
    ['AI provider', provider.provider !== 'none' && provider.tokenSet !== false, provider.provider + ' / ' + provider.model + ' / token=' + (provider.tokenSet === false ? 'missing' : 'ok')],
    ['AI provider lock', providerLock, providerLock ? 'AI_PROVIDER/LLM_PROVIDER set' : 'not set'],
    ['Web API token', configured('WEB_API_TOKEN'), configured('WEB_API_TOKEN') ? 'protected' : 'open'],
    ['OpenClaw upstream', openclawRepo, openclawRepo ? 'commit ' + (openclawCommit.stdout || 'unknown') : 'not cloned'],
  ];

  const recommendations = buildRecommendations(checks);
  const okCount = checks.filter(([, ok]) => ok).length;
  const lines = [];
  lines.push('🩺 Martybot diagnostika');
  lines.push('Skóre: ' + okCount + '/' + checks.length);
  lines.push('Čas: ' + new Date().toISOString());
  lines.push('');
  for (const [name, ok, detail] of checks) lines.push((ok ? '✅ ' : '⚠️ ') + name + ': ' + detail);
  lines.push('');
  lines.push('🧭 Doporučení:');
  recommendations.forEach((item, index) => lines.push((index + 1) + '. ' + item));
  lines.push('');
  lines.push('Poznámka: výstup neobsahuje žádné tokeny ani tajné hodnoty.');

  return { ok: true, score: okCount, total: checks.length, checks: checks.map(([name, ok, detail]) => ({ name, ok, detail })), recommendations, text: lines.join('\n') };
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
  if (http.__martybotDiagnosticsInstalled) return;
  http.__martybotDiagnosticsInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithDiagnostics(options, listener) {
    if (typeof options === 'function') { listener = options; options = undefined; }
    const wrapped = async (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
      if (req.method === 'OPTIONS' && pathname === '/api/diagnostics') return sendJson(res, 204, {});
      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/diagnostics') {
        if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        try { const data = await collectDiagnostics(); return sendJson(res, 200, { ...data, reply: data.text, replies: [data.text] }); }
        catch (err) { return sendJson(res, 500, { ok: false, error: err.message || String(err) }); }
      }
      if (typeof listener === 'function') return listener(req, res);
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    };
    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };
  console.log('[diagnostics-endpoint] installed at /api/diagnostics');
}

install();
module.exports = { collectDiagnostics };
