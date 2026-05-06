// shortcuts-upstream.js — read-only upstream reference for joshfarrant/shortcuts-js.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const enabled = String(process.env.ENABLE_SHORTCUTS_UPSTREAM || 'true').toLowerCase() !== 'false';
const repoUrl = process.env.SHORTCUTS_UPSTREAM_URL || 'https://github.com/joshfarrant/shortcuts-js.git';
const branch = process.env.SHORTCUTS_UPSTREAM_BRANCH || 'master';
const dir = process.env.SHORTCUTS_UPSTREAM_DIR || '/data/shortcuts-js-upstream';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: opts.stdio || 'pipe', encoding: 'utf8', timeout: opts.timeout || 60000, ...opts });
}

function isRepo(folder) {
  return fs.existsSync(path.join(folder, '.git'));
}

function commit() {
  try { return run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir }).trim(); } catch { return ''; }
}

function branchName() {
  try { return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).trim(); } catch { return ''; }
}

function topFiles() {
  try { return fs.readdirSync(dir).filter(name => name !== '.git').slice(0, 40); } catch { return []; }
}

function statusPayload(extra = {}) {
  const present = isRepo(dir);
  return { ok: !extra.error, enabled, repoUrl, branch, dir, present, currentBranch: present ? branchName() : '', commit: present ? commit() : '', files: present ? topFiles() : [], ...extra };
}

function syncShortcuts() {
  if (!enabled) return statusPayload({ ok: false, error: 'disabled' });
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (!isRepo(dir)) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      console.log('[shortcuts-js] cloning ' + repoUrl + ' → ' + dir);
      run('git', ['clone', '--branch', branch, '--single-branch', repoUrl, dir], { stdio: 'inherit', timeout: 180000 });
    } else {
      console.log('[shortcuts-js] existing repo found: ' + dir);
      run('git', ['fetch', 'origin', branch], { cwd: dir, stdio: 'inherit', timeout: 120000 });
      run('git', ['checkout', branch], { cwd: dir, stdio: 'inherit', timeout: 60000 });
      run('git', ['pull', '--ff-only', 'origin', branch], { cwd: dir, stdio: 'inherit', timeout: 120000 });
    }
    console.log('[shortcuts-js] ready. branch=' + branchName() + ' commit=' + commit() + ' dir=' + dir);
    return statusPayload({ lastSync: new Date().toISOString() });
  } catch (err) {
    console.error('[shortcuts-js] sync failed:', err.message || err);
    return statusPayload({ ok: false, error: err.message || String(err) });
  }
}

const bootStatus = syncShortcuts();
module.exports = { syncShortcuts, statusPayload, bootStatus };
