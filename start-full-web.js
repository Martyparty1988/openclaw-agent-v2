const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BOOT_VERSION = 'martybot-telegram-menu-2026-05-06-v12-provider-sync-cockpit';
const repoUrl = process.env.GIT_REPO_URL || 'https://github.com/Martyparty1988/openclaw-agent-v2.git';
const branch = process.env.GIT_BRANCH || 'main';
const workdir = process.env.AGENT_WORKDIR || '/tmp/martybot-workdir';

console.log('[boot] ' + BOOT_VERSION);
console.log('[boot] app snapshot dir=' + __dirname);

function maskUrl(url) {
  return String(url || '').replace(/(https:\/\/)([^/@]+)@/i, '$1***@');
}

function withGitToken(url) {
  const token = process.env.GIT_TOKEN || process.env.GITHUB_TOKEN || '';
  if (!token) return url;
  if (!/^https:\/\/github\.com\//i.test(url)) return url;
  return url.replace('https://github.com/', 'https://' + encodeURIComponent(token) + '@github.com/');
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: opts.stdio || 'pipe',
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    ...opts,
  });
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function safeRequire(file, label) {
  try {
    require(file);
    console.log('[boot] loaded ' + label);
  } catch (err) {
    console.error('[boot] failed ' + label + ':', err && err.message || err);
  }
}

function ensureWorkdir() {
  process.env.AGENT_WORKDIR = workdir;
  const authRepoUrl = withGitToken(repoUrl);
  try {
    fs.mkdirSync(path.dirname(workdir), { recursive: true });
    if (!isGitRepo(workdir)) {
      if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true, force: true });
      console.log('[git-bootstrap] cloning ' + maskUrl(repoUrl) + ' → ' + workdir);
      if (authRepoUrl !== repoUrl) console.log('[git-bootstrap] GitHub auth token detected for private repo clone');
      run('git', ['clone', '--branch', branch, '--single-branch', authRepoUrl, workdir], { stdio: 'inherit', timeout: 120000 });
    } else {
      console.log('[git-bootstrap] existing repo found: ' + workdir);
      run('git', ['remote', 'set-url', 'origin', authRepoUrl], { cwd: workdir, timeout: 60000 });
      run('git', ['fetch', 'origin', branch], { cwd: workdir, stdio: 'inherit', timeout: 120000 });
      run('git', ['checkout', branch], { cwd: workdir, stdio: 'inherit', timeout: 60000 });
      run('git', ['pull', '--ff-only', 'origin', branch], { cwd: workdir, stdio: 'inherit', timeout: 120000 });
    }
    const currentBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workdir }).trim();
    const currentCommit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: workdir }).trim();
    console.log('[git-bootstrap] ready. branch=' + currentBranch + ' commit=' + currentCommit + ' workdir=' + workdir);
  } catch (err) {
    const msg = String(err && err.message || err).replace(/https:\/\/[^/@]+@github\.com/gi, 'https://***@github.com');
    console.error('[git-bootstrap] failed:', msg);
    console.error('[git-bootstrap] continuing with app snapshot. Set GIT_TOKEN or GITHUB_TOKEN in Railway Variables for private repo clone.');
  }
}

ensureWorkdir();

try {
  const sync = require('./ai-provider-sync');
  sync.autoSyncFromEnv();
  console.log('[boot] ai provider sync checked');
} catch (err) {
  console.error('[boot] ai provider sync failed:', err && err.message || err);
}

require('./telegram-env-check.js');
require('./telegram-polling-guard.js');
require('./telegram-menu.js');
require('./openclaw-upstream.js');
require('./shortcuts-upstream.js');

safeRequire('./runtime-logs-endpoint.js', 'runtime logs endpoint');
safeRequire('./web-safe-improve-endpoint.js', 'safe web improve endpoint');
safeRequire('./diagnostics-endpoint.js', 'diagnostics endpoint');
safeRequire('./doctor-endpoint.js', 'doctor endpoint');
safeRequire('./git-push-test-endpoint.js', 'git push test endpoint');
safeRequire('./git-pull-endpoint.js', 'safe git pull endpoint');

require('./web-static-patch.js');
require('./web-agent-sync-patch.js');
require('./router-full-web.js');
