#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const required = ['ANTHROPIC_API_KEY', 'WA_PHONE_NUMBER'];
const optional = ['TELEGRAM_TOKEN', 'GIT_TOKEN', 'OPENAI_MODEL', 'CLAUDE_MODEL', 'GIT_BRANCH', 'AGENT_WORKDIR', 'MEMORY_DIR'];

const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());

const checks = [
  { name: 'router.js exists', ok: fs.existsSync(path.join(process.cwd(), 'router.js')) },
  { name: 'meta-agent.js exists', ok: fs.existsSync(path.join(process.cwd(), 'meta-agent.js')) },
  { name: 'web/index.html exists', ok: fs.existsSync(path.join(process.cwd(), 'web', 'index.html')) },
  { name: 'railway.json exists', ok: fs.existsSync(path.join(process.cwd(), 'railway.json')) },
];

console.log('🚦 OpenClaw deployment preflight\n');

required.forEach((key) => {
  const set = Boolean(process.env[key] && String(process.env[key]).trim());
  console.log(`${set ? '✅' : '❌'} ${key}`);
});

optional.forEach((key) => {
  const set = Boolean(process.env[key] && String(process.env[key]).trim());
  console.log(`${set ? 'ℹ️' : '⚪'} ${key}${set ? '' : ' (optional)'}`);
});

console.log('');
checks.forEach((check) => {
  console.log(`${check.ok ? '✅' : '❌'} ${check.name}`);
});

if (missing.length) {
  console.error(`\n❌ Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const failedChecks = checks.filter((check) => !check.ok);
if (failedChecks.length) {
  console.error(`\n❌ Missing required files: ${failedChecks.map((check) => check.name).join(', ')}`);
  process.exit(1);
}

console.log('\n✅ Preflight passed. Ready to deploy.');
