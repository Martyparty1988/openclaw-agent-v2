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

function has(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function flag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function print(name, ok, note = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? ` — ${note}` : ''}`);
}

function info(name, ok, note = '') {
  console.log(`${ok ? 'ℹ️' : '⚪'} ${name}${note ? ` — ${note}` : ''}`);
}

loadDotEnv();

const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const llmRequirements = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const modelByProvider = {
  anthropic: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openrouter: process.env.OPENROUTER_MODEL || 'openrouter/free',
};

const llmKey = llmRequirements[provider];
const hasLlm = llmKey ? has(llmKey) : false;
const whatsappEnabled = !flag('DISABLE_WHATSAPP') && has('WA_PHONE_NUMBER');
const telegramEnabled = !flag('DISABLE_TELEGRAM') && has('TELEGRAM_TOKEN');
const hasAllowlist = flag('ALLOW_ALL_USERS') || has('ALLOWED_USER_IDS') || has('ALLOWED_TELEGRAM_CHAT_IDS') || has('ALLOWED_WHATSAPP_NUMBERS');

const fileChecks = [
  { name: 'router.js exists', ok: fs.existsSync(path.join(process.cwd(), 'router.js')) },
  { name: 'meta-agent.js exists', ok: fs.existsSync(path.join(process.cwd(), 'meta-agent.js')) },
  { name: 'web/index.html exists', ok: fs.existsSync(path.join(process.cwd(), 'web', 'index.html')) },
  { name: 'railway.json exists', ok: fs.existsSync(path.join(process.cwd(), 'railway.json')) },
  { name: '.gitignore exists', ok: fs.existsSync(path.join(process.cwd(), '.gitignore')) },
];

console.log('🚦 OpenClaw deployment preflight\n');

print(`LLM_PROVIDER=${provider}`, Boolean(llmKey), llmKey ? `requires ${llmKey}` : 'unsupported provider');
print(`Model=${modelByProvider[provider] || 'unknown'}`, Boolean(modelByProvider[provider]));
print(llmKey || 'LLM API key', hasLlm);
print('At least one platform configured', whatsappEnabled || telegramEnabled, `WhatsApp: ${whatsappEnabled ? 'on' : 'off'}, Telegram: ${telegramEnabled ? 'on' : 'off'}`);
print('Access allowlist configured', hasAllowlist, 'recommended for private bots');

console.log('');
info('ALLOW_AGENT_BASH', flag('ALLOW_AGENT_BASH'), flag('ALLOW_AGENT_BASH') ? 'enabled, trusted deployment only' : 'disabled by default');
info('ALLOW_AGENT_WRITE', flag('ALLOW_AGENT_WRITE'), flag('ALLOW_AGENT_WRITE') ? 'enabled, trusted deployment only' : 'disabled by default');
info('GIT_TOKEN', has('GIT_TOKEN'), has('GIT_TOKEN') ? 'set' : 'optional');
info('GITHUB_REPO', has('GITHUB_REPO'), process.env.GITHUB_REPO || 'optional');

console.log('');
fileChecks.forEach((check) => print(check.name, check.ok));

const failed = [];
if (!llmKey) failed.push(`Unsupported LLM_PROVIDER: ${provider}`);
if (!hasLlm) failed.push(`Missing ${llmKey}`);
if (!whatsappEnabled && !telegramEnabled) failed.push('Configure TELEGRAM_TOKEN and/or WA_PHONE_NUMBER');
if (!hasAllowlist) failed.push('Configure ALLOWED_* variables or explicitly set ALLOW_ALL_USERS=true');
failed.push(...fileChecks.filter((check) => !check.ok).map((check) => check.name));

if (failed.length) {
  console.error(`\n❌ Preflight failed:\n${failed.map((item) => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.log('\n✅ Preflight passed. Ready to deploy.');
