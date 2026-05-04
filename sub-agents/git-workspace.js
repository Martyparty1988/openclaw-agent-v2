// sub-agents/git-workspace.js
// Safe git workspace manager for Railway.
// Secrets stay in Railway Variables. This module never prints or stores tokens.

const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execFileAsync = util.promisify(execFile);

function getConfig() {
  return {
    repo: process.env.GITHUB_REPO || 'Martyparty1988/openclaw-agent-v2',
    branch: process.env.GIT_BRANCH || 'main',
    workdir: path.resolve(process.env.AGENT_WORKDIR || '/data/openclaw-agent-v2'),
    hasToken: Boolean(process.env.GIT_TOKEN),
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function makeAskPass() {
  const dir = '/tmp/martybot-git';
  const file = path.join(dir, 'askpass.sh');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, [
    '#!/bin/sh',
    'case "$1" in',
    '  *Username*) echo "x-access-token" ;;',
    '  *Password*) echo "$GIT_TOKEN" ;;',
    '  *) echo "" ;;',
    'esac',
    '',
  ].join('\n'), 'utf-8');
  await fs.chmod(file, 0o700);
  return file;
}

async function git(args, cwd, timeout = 120000) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };

  if (process.env.GIT_TOKEN) env.GIT_ASKPASS = await makeAskPass();

  const result = await execFileAsync('git', args, {
    cwd,
    env,
    timeout,
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function status() {
  const cfg = getConfig();
  const gitDir = path.join(cfg.workdir, '.git');
  const hasWorkdir = await exists(cfg.workdir);
  const hasGit = await exists(gitDir);
  let branch = '';
  let remote = '';
  let lastCommit = '';
  let dirty = '';

  if (hasGit) {
    try { branch = (await git(['branch', '--show-current'], cfg.workdir)).stdout; } catch {}
    try { remote = (await git(['remote', 'get-url', 'origin'], cfg.workdir)).stdout.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@'); } catch {}
    try { lastCommit = (await git(['log', '-1', '--oneline'], cfg.workdir)).stdout; } catch {}
    try { dirty = (await git(['status', '--porcelain'], cfg.workdir)).stdout ? 'ano' : 'ne'; } catch {}
  }

  return {
    ...cfg,
    hasWorkdir,
    hasGit,
    branch,
    remote,
    lastCommit,
    dirty,
  };
}

function formatStatus(s) {
  return [
    '🧩 Git workspace',
    `• Repo: ${s.repo}`,
    `• Branch: ${s.branch || s.branch === '' ? (s.branch || s.branch === '' && s.hasGit ? 'neznámá' : s.branch) : s.branch}`,
    `• Cílová branch: ${s.branch || 'main'}`,
    `• Workdir: ${s.workdir}`,
    `• Složka existuje: ${s.hasWorkdir ? 'ano' : 'ne'}`,
    `• .git existuje: ${s.hasGit ? 'ano' : 'ne'}`,
    `• GIT_TOKEN: ${s.hasToken ? 'nastaven' : 'CHYBÍ'}`,
    s.remote ? `• Remote: ${s.remote}` : '',
    s.lastCommit ? `• Poslední commit: ${s.lastCommit}` : '',
    s.dirty ? `• Lokální změny: ${s.dirty}` : '',
  ].filter(Boolean).join('\n');
}

async function ensure() {
  const cfg = getConfig();

  if (!cfg.repo.includes('/')) throw new Error(`Invalid GITHUB_REPO: ${cfg.repo}. Použij owner/repo.`);
  if (cfg.workdir === '/app') throw new Error('AGENT_WORKDIR=/app není vhodné pro git. Nastav /data/openclaw-agent-v2.');

  const remote = `https://github.com/${cfg.repo}.git`;
  const parent = path.dirname(cfg.workdir);
  await fs.mkdir(parent, { recursive: true });

  const gitDir = path.join(cfg.workdir, '.git');
  if (!(await exists(gitDir))) {
    await fs.rm(cfg.workdir, { recursive: true, force: true });
    await git(['clone', '--branch', cfg.branch, '--single-branch', remote, cfg.workdir], parent, 180000);
    const s = await status();
    return `✅ Git workspace naklonovaný.\n\n${formatStatus(s)}`;
  }

  await git(['remote', 'set-url', 'origin', remote], cfg.workdir);
  await git(['fetch', 'origin', cfg.branch], cfg.workdir);
  await git(['checkout', cfg.branch], cfg.workdir);
  await git(['pull', '--ff-only', 'origin', cfg.branch], cfg.workdir);

  const s = await status();
  return `✅ Git workspace aktualizovaný.\n\n${formatStatus(s)}`;
}

async function pull() {
  const cfg = getConfig();
  if (!(await exists(path.join(cfg.workdir, '.git')))) throw new Error('Chybí .git. Nejdřív spusť /git setup.');
  await git(['pull', '--ff-only', 'origin', cfg.branch], cfg.workdir);
  const s = await status();
  return `✅ Pull hotový.\n\n${formatStatus(s)}`;
}

module.exports = {
  status,
  ensure,
  pull,
  formatStatus,
};
