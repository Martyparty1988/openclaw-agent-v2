// openclaw-upstream.js — safe upstream GitHub integration for OpenClaw Mission Control.
// This does not run OpenClaw inside Martybot. It only clones/pulls the upstream repo
// so Martybot can inspect it, reference it, and keep it available in the runtime workdir.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const DEFAULT_URL = 'https://github.com/abhi1693/openclaw-mission-control.git';
const DEFAULT_BRANCH = 'master';
const DEFAULT_DIR = '/data/openclaw-upstream';

const enabled = String(process.env.ENABLE_OPENCLAW_UPSTREAM || 'true').toLowerCase() !== 'false';
const repoUrl = String(process.env.OPENCLAW_UPSTREAM_URL || DEFAULT_URL).trim();
const branch = String(process.env.OPENCLAW_UPSTREAM_BRANCH || DEFAULT_BRANCH).trim();
const upstreamDir = String(process.env.OPENCLAW_UPSTREAM_DIR || DEFAULT_DIR).trim();

let lastError = '';
let lastSync = '';
let lastCommit = '';

function mask(url) {
  return String(url || '').replace(/(https:\/\/)([^@]+)@/i, '$1***@');
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: opts.stdio || 'pipe',
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    ...opts,
  });
}

function existsGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function readCommit(dir = upstreamDir) {
  try {
    return run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir }).trim();
  } catch {
    return '';
  }
}

function readBranch(dir = upstreamDir) {
  try {
    return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).trim();
  } catch {
    return '';
  }
}

function syncOpenClaw({ force = false } = {}) {
  if (!enabled) {
    lastError = 'OpenClaw upstream integration disabled by ENABLE_OPENCLAW_UPSTREAM=false';
    return statusPayload();
  }

  try {
    fs.mkdirSync(path.dirname(upstreamDir), { recursive: true });

    if (force && fs.existsSync(upstreamDir)) {
      fs.rmSync(upstreamDir, { recursive: true, force: true });
    }

    if (!existsGitRepo(upstreamDir)) {
      if (fs.existsSync(upstreamDir)) fs.rmSync(upstreamDir, { recursive: true, force: true });
      console.log('[openclaw] cloning ' + mask(repoUrl) + ' → ' + upstreamDir);
      run('git', ['clone', '--branch', branch, '--single-branch', repoUrl, upstreamDir], {
        stdio: 'inherit',
        timeout: 180000,
      });
    } else {
      console.log('[openclaw] existing repo found: ' + upstreamDir);
      run('git', ['fetch', 'origin', branch], { cwd: upstreamDir, stdio: 'inherit', timeout: 120000 });
      run('git', ['checkout', branch], { cwd: upstreamDir, stdio: 'inherit', timeout: 60000 });
      run('git', ['pull', '--ff-only', 'origin', branch], { cwd: upstreamDir, stdio: 'inherit', timeout: 120000 });
    }

    lastCommit = readCommit();
    lastSync = new Date().toISOString();
    lastError = '';
    console.log('[openclaw] ready. branch=' + readBranch() + ' commit=' + lastCommit + ' dir=' + upstreamDir);
  } catch (err) {
    lastError = err.message || String(err);
    console.error('[openclaw] sync failed:', lastError);
  }

  return statusPayload();
}

function statusPayload() {
  const present = existsGitRepo(upstreamDir);
  return {
    ok: !lastError,
    enabled,
    repoUrl: mask(repoUrl),
    branch,
    dir: upstreamDir,
    present,
    currentBranch: present ? readBranch() : '',
    commit: present ? readCommit() || lastCommit : lastCommit,
    lastSync,
    lastError,
    note: 'OpenClaw is cloned as an upstream reference. It is not executed inside Martybot.'
  };
}

function installOpenClawEndpoint() {
  if (http.__openClawUpstreamInstalled) return;
  http.__openClawUpstreamInstalled = true;
  const originalCreateServer = http.createServer;

  http.createServer = function createServerWithOpenClaw(options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }

    const wrapped = (req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}

      if (pathname === '/api/openclaw/status' || pathname === '/openclaw/status') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(statusPayload(), null, 2));
        return;
      }

      if (pathname === '/api/openclaw/pull' || pathname === '/openclaw/pull') {
        const payload = syncOpenClaw({ force: false });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(payload, null, 2));
        return;
      }

      if (typeof listener === 'function') return listener(req, res);
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    };

    return options === undefined ? originalCreateServer(wrapped) : originalCreateServer(options, wrapped);
  };
}

installOpenClawEndpoint();
if (enabled) syncOpenClaw({ force: false });

module.exports = { syncOpenClaw, statusPayload };
