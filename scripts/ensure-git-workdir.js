// scripts/ensure-git-workdir.js
// Prepares a real git working directory for Martybot self-improve on Railway.
// Secrets stay in Railway Variables. This file never stores tokens.

const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const repo = process.env.GITHUB_REPO || 'Martyparty1988/openclaw-agent-v2';
const branch = process.env.GIT_BRANCH || 'main';
const workdir = path.resolve(process.env.AGENT_WORKDIR || '/data/openclaw-agent-v2');
const enabled = String(process.env.GIT_AUTO_SETUP || 'false').toLowerCase() === 'true';

function log(message) {
  console.log(`[git-setup] ${message}`);
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

  return execFileAsync('git', args, {
    env,
    timeout: options.timeout || 120000,
    cwd: options.cwd || process.cwd(),
    maxBuffer: 1024 * 1024,
  });
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
  console.error(`[git-setup] ${err.message}`);
  process.exit(1);
});
