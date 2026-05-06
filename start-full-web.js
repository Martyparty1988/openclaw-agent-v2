// start-full-web.js — bootstrap real Git workdir, then start Martybot full web router.
// Railway deploys a snapshot without .git, so /git would show branch unknown.
// This wrapper clones/pulls the repo into AGENT_WORKDIR and then starts router-full-web.js.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BOOT_VERSION = 'martybot-web-ui-2026-05-06-v4';
const DEFAULT_REPO = 'https://github.com/Martyparty1988/openclaw-agent-v2.git';
const repoUrl = process.env.GIT_REPO_URL || DEFAULT_REPO;
const branch = process.env.GIT_BRANCH || 'main';
const workdir = process.env.AGENT_WORKDIR || '/tmp/martybot-workdir';

console.log('[boot] ' + BOOT_VERSION);
console.log('[boot] app snapshot dir=' + __dirname);

function mask(url) {
  return String(url || '').replace(/(https:\/\/)([^@]+)@/i, '$1***@');
}

function withToken(url) {
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
    ...opts
  });
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function ensureWorkdir() {
  process.env.AGENT_WORKDIR = workdir;

  try {
    fs.mkdirSync(path.dirname(workdir), { recursive: true });

    if (!isGitRepo(workdir)) {
      if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true, force: true });
      console.log('[git-bootstrap] cloning ' + mask(repoUrl) + ' → ' + workdir);
      run('git', ['clone', '--branch', branch, '--single-branch', withToken(repoUrl), workdir], { stdio: 'inherit', timeout: 120000 });
    } else {
      console.log('[git-bootstrap] existing repo found: ' + workdir);
      run('git', ['fetch', 'origin', branch], { cwd: workdir, stdio: 'inherit', timeout: 120000 });
      run('git', ['checkout', branch], { cwd: workdir, stdio: 'inherit', timeout: 60000 });
      run('git', ['pull', '--ff-only', 'origin', branch], { cwd: workdir, stdio: 'inherit', timeout: 120000 });
    }

    const currentBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workdir }).trim();
    const currentCommit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: workdir }).trim();
    console.log('[git-bootstrap] ready. branch=' + currentBranch + ' commit=' + currentCommit + ' workdir=' + workdir);
  } catch (err) {
    console.error('[git-bootstrap] failed:', err.message || err);
    console.error('[git-bootstrap] continuing with app snapshot. /git may show branch unknown.');
  }
}

ensureWorkdir();
require('./telegram-env-check.js');
require('./web-static-patch.js');
require('./router-full-web.js');
