// scripts/ensure-git-workdir.js
// Prepares a real git working directory for Martybot self-improve on Railway.
// Secrets stay in Railway Variables. This file never stores tokens.
// Important: Git setup must never prevent Telegram/Web backend from starting unless REQUIRE_GIT_WORKDIR=true.

const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const repo = process.env.GITHUB_REPO || 'Martyparty1988/openclaw-agent-v2';
const branch = process.env.GIT_BRANCH || 'main';
const workdir = path.resolve(process.env.AGENT_WORKDIR || '/data/openclaw-agent-v2');
const enabled = String(process.env.GIT_AUTO_SETUP || 'false').toLowerCase() === 'true';
const required = String(process.env.REQUIRE_GIT_WORKDIR || 'false').toLowerCase() === 'true';

function log(message) {
  console.log(`[git-setup] ${message}`);
}

function warn(message) {
  console.warn(`[git-setup] ${message}`);
}

function sanitize(text = '') {
  return String(text)
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***')
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_***')
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@')
    .trim();
}

function explainGitFailure(err) {
  const raw = sanitize([err?.message, err?.stderr, err?.stdout].filter(Boolean).join('\n'));
  const lower = raw.toLowerCase();

  if (lower.includes('write access to repository not granted') || lower.includes('403') || lower.includes('invalid username or token') || lower.includes('authentication failed')) {
    return [
      'GitHub odmítl GIT_TOKEN nebo token nemá práva k repozitáři.',
      'Bot se spustí dál bez git self-improve workspace.',
      'Oprava pro Git funkce: v Railway nastav nový GIT_TOKEN s přístupem k Martyparty1988/openclaw-agent-v2 a oprávněním Contents: Read and write.',
      'Token nech pouze v Railway Variables. Nikdy ho nedávej do GitHub URL, .env v repozitáři ani do chatu.',
      raw,
    ].filter(Boolean).join('\n');
  }

  if (lower.includes('could not read username') || lower.includes('terminal prompts disabled')) {
    return [
      'Git potřebuje přihlašovací údaje, ale Railway nemá interaktivní terminál.',
      'Bot se spustí dál bez git self-improve workspace.',
      'Oprava pro Git funkce: nastav GIT_TOKEN v Railway Variables.',
      raw,
    ].join('\n');
  }

  return raw || 'Neznámá Git chyba. Bot se spustí dál bez git workspace.';
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

async function git(args, options = {}) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };

  if (process.env.GIT_TOKEN) {
    env.GIT_ASKPASS = await makeAskPass();
  }

  try {
    return await execFileAsync('git', args, {
      env,
      timeout: options.timeout || 120000,
      cwd: options.cwd || process.cwd(),
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    throw new Error(explainGitFailure(err));
  }
}

async function ensureWorkdir() {
  if (!enabled) {
    log('GIT_AUTO_SETUP=false, skipping git workspace setup.');
    return;
  }

  if (!repo.includes('/')) {
    throw new Error(`Invalid GITHUB_REPO: ${repo}. Use owner/repo.`);
  }

  if (workdir === '/app') {
    throw new Error('AGENT_WORKDIR=/app is not suitable for git self-improve. Use /data/openclaw-agent-v2 with Railway Volume mounted at /data.');
  }

  const remote = `https://github.com/${repo}.git`;
  const parent = path.dirname(workdir);
  await fs.mkdir(parent, { recursive: true });

  const gitDir = path.join(workdir, '.git');
  if (!(await exists(gitDir))) {
    log(`Cloning ${repo}@${branch} into ${workdir}...`);
    await fs.rm(workdir, { recursive: true, force: true });
    await git(['clone', '--branch', branch, '--single-branch', remote, workdir]);
    log('Clone complete.');
    return;
  }

  log(`Updating existing git workspace in ${workdir}...`);
  await git(['remote', 'set-url', 'origin', remote], { cwd: workdir });
  await git(['fetch', 'origin', branch], { cwd: workdir });
  await git(['checkout', branch], { cwd: workdir });
  await git(['pull', '--ff-only', 'origin', branch], { cwd: workdir });
  log('Git workspace ready.');
}

ensureWorkdir().catch((err) => {
  warn(err.message);
  if (required) {
    warn('REQUIRE_GIT_WORKDIR=true, stopping startup.');
    process.exit(1);
  }
  warn('Continuing startup without git workspace. Telegram/Web backend can still run.');
  process.exit(0);
});
