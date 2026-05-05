// sub-agents/model-presets.js
// Runtime model/provider switching. Secrets stay in Railway Variables.
// Default provider is Anthropic Claude. OpenRouter free remains available as fallback.

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const PRESETS = {
  'claude': { provider: 'anthropic', model: DEFAULT_CLAUDE_MODEL, envModelKey: 'CLAUDE_MODEL' },
  'claude sonnet': { provider: 'anthropic', model: DEFAULT_CLAUDE_MODEL, envModelKey: 'CLAUDE_MODEL' },
  'anthropic sonnet': { provider: 'anthropic', model: DEFAULT_CLAUDE_MODEL, envModelKey: 'CLAUDE_MODEL' },
  'anthropic old-sonnet': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', envModelKey: 'CLAUDE_MODEL' },
  'openrouter free': { provider: 'openrouter', model: 'openrouter/free', envModelKey: 'OPENROUTER_MODEL' },
  'openrouter qwen': { provider: 'openrouter', model: 'qwen/qwen-2.5-coder-32b-instruct:free', envModelKey: 'OPENROUTER_MODEL' },
  'openrouter llama': { provider: 'openrouter', model: 'meta-llama/llama-3.2-3b-instruct:free', envModelKey: 'OPENROUTER_MODEL' },
  'openrouter deepseek': { provider: 'openrouter', model: 'deepseek/deepseek-r1:free', envModelKey: 'OPENROUTER_MODEL' },
  'openai mini': { provider: 'openai', model: 'gpt-4o-mini', envModelKey: 'OPENAI_MODEL' },
  'deepseek flash': { provider: 'deepseek', model: 'deepseek-v4-flash', envModelKey: 'DEEPSEEK_MODEL' },
  'deepseek pro': { provider: 'deepseek', model: 'deepseek-v4-pro', envModelKey: 'DEEPSEEK_MODEL' },
};

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getProvider() {
  return normalize(process.env.LLM_PROVIDER || DEFAULT_PROVIDER);
}

function getModelForProvider(provider = getProvider()) {
  if (provider === 'anthropic') return process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || 'openrouter/free';
  if (provider === 'deepseek') return process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  if (provider === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return 'neznámý';
}

function getTokenInfo(provider = getProvider()) {
  if (provider === 'anthropic') return { value: process.env.ANTHROPIC_API_KEY, label: 'ANTHROPIC_API_KEY' };
  if (provider === 'openrouter') return { value: process.env.OPENROUTER_API_KEY, label: 'OPENROUTER_API_KEY' };
  if (provider === 'deepseek') return { value: process.env.DEEPSEEK_API_KEY, label: 'DEEPSEEK_API_KEY' };
  if (provider === 'openai') return { value: process.env.OPENAI_API_KEY, label: 'OPENAI_API_KEY' };
  return { value: '', label: 'UNKNOWN_API_KEY' };
}

function getChatCompletionsConfig(provider = getProvider()) {
  const model = getModelForProvider(provider);
  const token = getTokenInfo(provider);

  if (provider === 'openrouter') {
    return {
      providerName: provider,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model,
      token: token.value,
      tokenLabel: token.label,
    };
  }

  if (provider === 'deepseek') {
    return {
      providerName: provider,
      url: 'https://api.deepseek.com/chat/completions',
      model,
      token: token.value,
      tokenLabel: token.label,
    };
  }

  if (provider === 'openai') {
    return {
      providerName: provider,
      url: 'https://api.openai.com/v1/chat/completions',
      model,
      token: token.value,
      tokenLabel: token.label,
    };
  }

  return null;
}

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function applyPreset(input) {
  const key = normalize(input);
  const preset = PRESETS[key];
  if (!preset) return null;

  process.env.LLM_PROVIDER = preset.provider;
  process.env[preset.envModelKey] = preset.model;
  return { ...preset, key };
}

function listPresetsText() {
  return [
    '🧠 Přepínání modelů',
    '',
    'Výchozí režim:',
    '/model claude',
    '',
    'Použití:',
    '/model claude',
    '/model claude sonnet',
    '/model anthropic old-sonnet',
    '/model openrouter free',
    '/model openrouter qwen',
    '/model openrouter llama',
    '/model openrouter deepseek',
    '/model deepseek flash',
    '/model openai mini',
    '',
    'Fallback když Claude nemá kredit:',
    '/model openrouter free',
    '',
    'Poznámka: klíče se nepřeposílají v chatu. Musí být jen v Railway Variables.',
  ].join('\n');
}

function statusSummary() {
  const provider = getProvider();
  const model = getModelForProvider(provider);
  const token = getTokenInfo(provider);
  return {
    provider,
    model,
    tokenLabel: token.label,
    tokenSet: Boolean(token.value),
  };
}

module.exports = {
  PRESETS,
  DEFAULT_PROVIDER,
  DEFAULT_CLAUDE_MODEL,
  applyPreset,
  getProvider,
  getModelForProvider,
  getTokenInfo,
  getChatCompletionsConfig,
  getAnthropicClient,
  listPresetsText,
  statusSummary,
};
