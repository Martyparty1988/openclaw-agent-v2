const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BOOT_VERSION = 'martybot-web-ui-openclaw-telegram-guard-2026-05-06-v6';
const repoUrl = process.env.GIT_REPO_URL || 'https://github.com/Martyparty1988/openclaw-agent-v2.git';
const branch = process.env.GIT_BRANCH || 'main';
const workdir = process.env.AGENT_WORKDIR || '/tmp/martybot-workdir';

console.log('[boot] ' + BOOT_VERSION);
console.log('[boot] app snapshot dir=' + __dirname);

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

function ensureWorkdir() {
  process.env.AGENT_WORKDIR = workdir;
  try {
    fs.mkdirSync(path.dirname(workdir), { recursive: true });
    if (!isGitRepo(workdir)) {
      if (fs.existsSync(workdir)) fs.rmSync(workdir, { recursive: true, force: true });
      console.log('[git-bootstrap] cloning ' + repoUrl + ' → ' + workdir);
      run('git', ['clone', '--branch', branch, '--single-branch', repoUrl, workdir], { stdio: 'inherit', timeout: 120000 });
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
    console.error('[git-bootstrap] continuing with app snapshot.');
  }
}

ensureWorkdir();
require('./telegram-env-check.js');
require('./telegram-polling-guard.js');
require('./openclaw-upstream.js');
require('./web-static-patch.js');
require('./router-full-web.js');
