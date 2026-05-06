// ai-provider-sync.js
// Single runtime source of truth for provider/model selection.
// Router-full-web still auto-detects provider by visible API keys, so this module
// exposes only the selected provider key to the current Node process and keeps
// the original keys backed up for later runtime switching.

const PROVIDERS = {
  anthropic: {
    keys: ['ANTHROPIC_API_KEY'],
    modelKeys: ['AI_MODEL', 'ANTHROPIC_MODEL', 'CLAUDE_MODEL'],
    defaultModel: 'claude-sonnet-4-20250514',
  },
  openrouter: {
    keys: ['OPENROUTER_API_KEY'],
    modelKeys: ['AI_MODEL', 'OPENROUTER_MODEL'],
    defaultModel: 'openrouter/free',
  },
  deepseek: {
    keys: ['DEEPSEEK_API_KEY'],
    modelKeys: ['AI_MODEL', 'DEEPSEEK_MODEL'],
    defaultModel: 'deepseek-chat',
  },
  openai: {
    keys: ['OPENAI_API_KEY'],
    modelKeys: ['AI_MODEL', 'OPENAI_MODEL'],
    defaultModel: 'gpt-4o-mini',
  },
};

const KEY_TO_PROVIDER = Object.entries(PROVIDERS).reduce((acc, [provider, cfg]) => {
  for (const key of cfg.keys) acc[key] = provider;
  return acc;
}, {});

const BACKUP_PREFIX = '__MARTYBOT_BACKUP__';
let backedUp = false;

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'claude') return 'anthropic';
  if (raw === 'anthropic') return 'anthropic';
  if (raw === 'openrouter') return 'openrouter';
  if (raw === 'deepseek') return 'deepseek';
  if (raw === 'openai') return 'openai';
  return '';
}

function backupEnvKeys() {
  if (backedUp) return;
  for (const key of Object.keys(KEY_TO_PROVIDER)) {
    const backupKey = BACKUP_PREFIX + key;
    if (process.env[key] && !process.env[backupKey]) process.env[backupKey] = process.env[key];
  }
  backedUp = true;
}

function originalValue(key) {
  return process.env[BACKUP_PREFIX + key] || process.env[key] || '';
}

function getSelectedProvider() {
  return normalizeProvider(process.env.AI_PROVIDER || process.env.LLM_PROVIDER || process.env.PREFERRED_AI_PROVIDER || '');
}

function getSelectedModel(provider = getSelectedProvider()) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return process.env.AI_MODEL || '';
  for (const key of cfg.modelKeys) {
    if (process.env[key]) return process.env[key];
  }
  return cfg.defaultModel;
}

function applyModelEnv(provider, model) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return;
  const selectedModel = String(model || '').trim() || cfg.defaultModel;
  process.env.AI_MODEL = selectedModel;
  if (provider === 'anthropic') {
    process.env.ANTHROPIC_MODEL = selectedModel;
    process.env.CLAUDE_MODEL = selectedModel;
  }
  if (provider === 'openrouter') process.env.OPENROUTER_MODEL = selectedModel;
  if (provider === 'deepseek') process.env.DEEPSEEK_MODEL = selectedModel;
  if (provider === 'openai') process.env.OPENAI_MODEL = selectedModel;
}

function syncSelectedProvider(providerInput, modelInput) {
  backupEnvKeys();
  const provider = normalizeProvider(providerInput || getSelectedProvider());
  if (!provider || !PROVIDERS[provider]) return { changed: false, provider: '', model: '' };

  process.env.AI_PROVIDER = provider;
  process.env.LLM_PROVIDER = provider;
  const model = String(modelInput || getSelectedModel(provider) || '').trim() || PROVIDERS[provider].defaultModel;
  applyModelEnv(provider, model);

  for (const [key, keyProvider] of Object.entries(KEY_TO_PROVIDER)) {
    if (keyProvider === provider) {
      const value = originalValue(key);
      if (value) process.env[key] = value;
    } else {
      if (process.env[key]) process.env[BACKUP_PREFIX + key] = process.env[BACKUP_PREFIX + key] || process.env[key];
      delete process.env[key];
    }
  }

  console.log(`[ai-provider-sync] selected ${provider} / ${model}`);
  return { changed: true, provider, model };
}

function restoreProviderKeys(providerInput) {
  backupEnvKeys();
  const provider = normalizeProvider(providerInput || getSelectedProvider());
  if (!provider || !PROVIDERS[provider]) return false;
  for (const key of PROVIDERS[provider].keys) {
    const value = originalValue(key);
    if (value) process.env[key] = value;
  }
  return true;
}

function autoSyncFromEnv() {
  const selected = getSelectedProvider();
  if (!selected) return { changed: false, provider: '', model: '' };
  return syncSelectedProvider(selected, getSelectedModel(selected));
}

module.exports = {
  PROVIDERS,
  normalizeProvider,
  getSelectedProvider,
  getSelectedModel,
  syncSelectedProvider,
  restoreProviderKeys,
  autoSyncFromEnv,
};
