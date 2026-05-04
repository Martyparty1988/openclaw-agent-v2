// meta-agent.js — Orchestrator that routes tasks to sub-agents
// Planner → Executor → Memory → SelfImprove

const Planner = require('./sub-agents/planner');
const Executor = require('./sub-agents/executor');
const Memory = require('./sub-agents/memory');
const SelfImprove = require('./sub-agents/self-improve');
const WebImprove = require('./sub-agents/web-improve');

const COMMANDS = {
  analyze:  ['analyze', 'analyzuj', 'analyse'],
  plan:     ['plan', 'plán', 'naplánuj'],
  execute:  ['execute', 'exec', 'spusť', 'udělej'],
  improve:  ['improve', 'zlepši', 'self-improve', 'refactor self'],
  webimprove: ['web improve', 'improve web', 'zlepši web', 'update web'],
  reset:    ['reset', 'zapomeň', 'forget', 'clear'],
  help:     ['help', 'pomoc', 'příkazy'],
  status:   ['status', 'stav'],
  chat:     [], // fallback
};

function parseCommand(text) {
  const lower = text.toLowerCase().trim();
  for (const [cmd, keywords] of Object.entries(COMMANDS)) {
    for (const kw of keywords) {
      if (lower.startsWith(kw + ' ') || lower === kw) {
        return { command: cmd, task: text.slice(kw.length).trim() };
      }
    }
  }
  return { command: 'chat', task: text };
}

class MetaAgent {
  constructor() {
    this.planner = new Planner();
    this.executor = new Executor();
    this.memory = new Memory();
    this.selfImprove = new SelfImprove();
    this.webImprove = new WebImprove();
  }

  async handle(msg) {
    const { userId, platform, text, reply } = msg;
    const { command, task } = parseCommand(text);

    console.log(`[${platform.toUpperCase()}][${userId}] ${command}: ${task || '—'}`);

    try {
      switch (command) {
        case 'help':
          await reply(HELP_TEXT);
          break;

        case 'status': {
          const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
          const tokenByProvider = {
            anthropic: !!process.env.ANTHROPIC_API_KEY,
            openrouter: !!process.env.OPENROUTER_API_KEY,
            openai: !!process.env.OPENAI_API_KEY,
          };
          const modelByProvider = {
            anthropic: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
            openrouter: process.env.OPENROUTER_MODEL || 'openrouter/free',
            openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          };
          const isTokenSet = tokenByProvider[provider];
          const telegramOn = !!process.env.TELEGRAM_TOKEN;
          const whatsappOn = !!process.env.WA_PHONE_NUMBER;
          const modeNote = provider === 'openrouter'
            ? 'Free OpenRouter režim je text-only. Pro opravdové tools použij Anthropic.'
            : provider === 'anthropic'
              ? 'Anthropic režim podporuje tool-calling executor.'
              : 'OpenAI režim je v této verzi text-only.';

          await reply([
            '🩺 Stav bota',
            `• LLM provider: ${provider}`,
            `• Model: ${modelByProvider[provider] || 'neznámý'}`,
            `• API klíč pro provider: ${isTokenSet ? 'nastaven' : 'CHYBÍ'}`,
            `• Telegram token: ${telegramOn ? 'nastaven' : 'nenastaven'}`,
            `• WhatsApp číslo: ${whatsappOn ? 'nastaveno' : 'nenastaveno'}`,
            `• Bash tools: ${process.env.ALLOW_AGENT_BASH === 'true' ? 'zapnuté' : 'vypnuté'}`,
            `• Write tools: ${process.env.ALLOW_AGENT_WRITE === 'true' ? 'zapnuté' : 'vypnuté'}`,
            '',
            modeNote,
          ].join('\n'));
          break;
        }

        case 'reset':
          await this.memory.clear(userId);
          await reply('🧹 Paměť smazána. Začínáme znovu!');
          break;

        case 'analyze': {
          if (!task) return reply('❌ Zadej co analyzovat. Příklad: analyze agents.js');
          await reply('🔍 Analyzuji...');
          const result = await this.executor.run(userId, `Analyze only, no changes: ${task}`, null);
          await this.memory.add(userId, 'user', text);
          await this.memory.add(userId, 'assistant', result.output);
          await reply(`🔍 Analýza:\n\n${result.output}`);
          break;
        }

        case 'plan': {
          if (!task) return reply('❌ Zadej co naplánovat. Příklad: plan deploy solartrack');
          await reply('📋 Plánuji...');
          const plan = await this.planner.create(userId, task);
          await this.memory.add(userId, 'user', text);
          await this.memory.add(userId, 'assistant', JSON.stringify(plan));
          await reply(formatPlan(plan));
          break;
        }

        case 'execute': {
          if (!task) return reply('❌ Zadej co spustit. Příklad: execute oprav bug v router.js');
          await reply('⚙️ Spouštím agenta... Dostaneš notifikaci až bude hotovo.');

          setImmediate(async () => {
            const steps = [];
            try {
              const plan = await this.planner.create(userId, task);
              const result = await this.executor.run(userId, plan, (s) => steps.push(s));

              await this.memory.add(userId, 'user', text);
              await this.memory.add(userId, 'assistant', result.output);

              const summary = [
                '✅ Hotovo!',
                '',
                result.output,
                steps.length ? `\n🔧 ${steps.length} kroků provedeno` : '',
              ].filter(Boolean).join('\n');

              await reply(summary);
            } catch (err) {
              await reply(`❌ Chyba: ${err.message}`);
            }
          });
          break;
        }

        case 'improve': {
          await reply('🧬 Self-improve spuštěn... Analyzuji svůj kód, refaktoruji, testuji a commitnu změny.');

          setImmediate(async () => {
            try {
              const result = await this.selfImprove.run((step) => reply(`⏳ ${step}`));
              await reply(`✅ Self-improve dokončen!\n\n${result}`);
            } catch (err) {
              await reply(`❌ Self-improve selhal: ${err.message}`);
            }
          });
          break;
        }

        case 'webimprove': {
          await reply('🌐 Web-improve spuštěn... Analyzuji web, generuji vylepšení a commitnu.');
          setImmediate(async () => {
            try {
              const result = await this.webImprove.run((step) => reply(`⏳ ${step}`));
              await reply(`✅ Web-improve dokončen!\n\n${result}`);
            } catch (err) {
              await reply(`❌ Web-improve selhal: ${err.message}`);
            }
          });
          break;
        }

        case 'chat':
        default: {
          await reply('💬 Přemýšlím...');
          const history = await this.memory.getHistory(userId);
          const result = await this.executor.chat(userId, task, history);
          await this.memory.add(userId, 'user', task);
          await this.memory.add(userId, 'assistant', result);
          await reply(result);
          break;
        }
      }
    } catch (err) {
      console.error('[MetaAgent Error]', err);
      await reply(`❌ Systémová chyba: ${err.message}`);
    }
  }
}

function formatPlan(plan) {
  return [
    `📋 ${plan.goal}`,
    '',
    ...plan.steps.map((s) => `${s.id}. ${s.action}\n   ${s.details}`),
  ].join('\n');
}

const HELP_TEXT = `🤖 OpenClaw Meta-Agent

Příkazy:
• analyze <co> — analyzuje soubor nebo kód
• plan <úkol> — vytvoří plán
• execute <úkol> — spustí agenta async
• improve — self-improve cyklus
• status — stav providera/modelu
• reset — smaže session paměť
• help — tato nápověda

Výchozí free režim: OpenRouter openrouter/free.
Plné nástroje pro práci se soubory a bashem: Anthropic režim + bezpečnostní env flagy.`;

module.exports = MetaAgent;
