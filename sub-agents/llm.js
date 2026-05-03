const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const PROVIDER = (process.env.LLM_PROVIDER || ((process.env.OPENAI_API_KEY && 'openai') || 'anthropic')).toLowerCase();
const MODEL = PROVIDER === 'openai'
  ? (process.env.OPENAI_MODEL || 'gpt-4.1')
  : (process.env.CLAUDE_MODEL || 'claude-opus-4-5');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function textFromAnthropic(content = []) {
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function textFromOpenAI(message = {}) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  }
  return '';
}

async function createMessage({ system, messages, maxTokens = 1024 }) {
  if (PROVIDER === 'anthropic') {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    return { text: textFromAnthropic(res.content), provider: 'anthropic', raw: res };
  }

  const res = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      ...messages,
    ],
  });
  return { text: textFromOpenAI(res.choices[0]?.message), provider: 'openai', raw: res };
}

module.exports = { createMessage, PROVIDER, MODEL };
