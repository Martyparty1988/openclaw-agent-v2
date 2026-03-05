// meta-agent.js — Orchestrator that routes tasks to sub-agents

const Planner = require('./sub-agents/planner');
const Executor = require('./sub-agents/executor');
const Memory = require('./sub-agents/memory');
const SelfImprove = require('./sub-agents/self-improve');
const WebImprove = require('./sub-agents/web-improve');
const QaAgent = require('./sub-agents/qa-agent');
const TaskManager = require('./sub-agents/task-manager');

const COMMANDS = {
  analyze: ['analyze', 'analyzuj', 'analyse'],
  plan: ['plan', 'plán', 'naplánuj'],
  execute: ['execute', 'exec', 'spusť', 'udělej'],
  improve: ['improve', 'zlepši', 'self-improve', 'refactor self'],
  webimprove: ['web improve', 'improve web', 'zlepši web', 'update web'],
  qa: ['qa', 'check', 'test', 'kontrola'],
  tasks: ['tasks', 'úkoly', 'todo', 'status'],
  doneall: ['done all', 'ukonci vsechny ulohy', 'ukonči všechny úkoly', 'finish all tasks'],
  reset: ['reset', 'zapomeň', 'forget', 'clear'],
  help: ['help', 'pomoc', 'příkazy'],
  chat: [],
};

function parseCommand(text) {
  const lower = text.toLowerCase().trim();
  for (const [command, keywords] of Object.entries(COMMANDS)) {
    for (const keyword of keywords) {
      if (lower.startsWith(`${keyword} `) || lower === keyword) {
        return { command, task: text.slice(keyword.length).trim() };
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
    this.qaAgent = new QaAgent();
    this.taskManager = new TaskManager();
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

        case 'reset':
          await this.memory.clear(userId);
          await reply('🧹 Paměť smazána. Začínáme znovu!');
          break;

        case 'tasks': {
          const tasks = await this.taskManager.list(userId);
          if (!tasks.length) {
            await reply('📭 Nemáš žádné uložené úkoly.');
            break;
          }
          const formatted = tasks
            .slice(-12)
            .map((item) => `• [${item.status === 'done' ? 'x' : ' '}] ${item.title}`)
            .join('\n');
          await reply(`🗂️ *Poslední úkoly:*\n${formatted}`);
          break;
        }

        case 'doneall': {
          const count = await this.taskManager.completeAll(userId);
          await reply(`✅ Hotovo. Uzavřeno úkolů: *${count}*.`);
          break;
        }

        case 'qa': {
          await reply('🧪 Spouštím QA kontrolu...');
          const qa = await this.qaAgent.run();
          const details = qa.results
            .map((item) => `${item.ok ? '✅' : '❌'} ${item.command}${item.error ? `\n   ${item.error}` : ''}`)
            .join('\n');
          await reply(`🧪 *QA report*\n${qa.summary}\n\n${details}`);
          break;
        }

        case 'analyze': {
          if (!task) return reply('❌ Zadej co analyzovat. Příklad: `analyze agents.js`');
          await reply('🔍 Analyzuji...');
          const result = await this.executor.run(userId, `Analyze only, no changes: ${task}`, null);
          await this.memory.add(userId, 'user', text);
          await this.memory.add(userId, 'assistant', result.output);
          await reply(`🔍 *Analýza:*\n\n${result.output}`);
          break;
        }

        case 'plan': {
          if (!task) return reply('❌ Zadej co naplánovat. Příklad: `plan deploy solartrack`');
          await reply('📋 Plánuji...');
          const plan = await this.planner.create(userId, task);
          await this.memory.add(userId, 'user', text);
          await this.memory.add(userId, 'assistant', JSON.stringify(plan));
          await reply(formatPlan(plan));
          break;
        }

        case 'execute': {
          if (!task) return reply('❌ Zadej co spustit. Příklad: `execute oprav bug v router.js`');
          await this.taskManager.add(userId, task);
          await reply('⚙️ *Spouštím agenta...*\n_Dostaneš notifikaci až bude hotovo._');

          setImmediate(async () => {
            const steps = [];
            try {
              const plan = await this.planner.create(userId, task);
              const result = await this.executor.run(userId, plan, (step) => steps.push(step));

              await this.memory.add(userId, 'user', text);
              await this.memory.add(userId, 'assistant', result.output);

              const summary = [
                '✅ *Hotovo!*',
                '',
                result.output,
                steps.length ? `\n🔧 _${steps.length} kroků provedeno_` : '',
              ]
                .filter(Boolean)
                .join('\n');

              await this.taskManager.completeAll(userId);
              await reply(summary);
            } catch (error) {
              await reply(`❌ *Chyba:* ${error.message}`);
            }
          });
          break;
        }

        case 'improve': {
          await reply('🧬 *Self-improve spuštěn...*\n_Analyzuji svůj kód, refaktoruji, testuji a commitnu změny._');
          setImmediate(async () => {
            try {
              const result = await this.selfImprove.run((step) => reply(`⏳ ${step}`));
              await reply(`✅ *Self-improve dokončen!*\n\n${result}`);
            } catch (error) {
              await reply(`❌ *Self-improve selhal:* ${error.message}`);
            }
          });
          break;
        }

        case 'webimprove': {
          await reply('🌐 *Web-improve spuštěn...*\n_Analyzuji web, generuji vylepšení a commitnu._');
          setImmediate(async () => {
            try {
              const result = await this.webImprove.run((step) => reply(`⏳ ${step}`));
              await reply(`✅ *Web-improve dokončen!*\n\n${result}`);
            } catch (error) {
              await reply(`❌ *Web-improve selhal:* ${error.message}`);
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
        }
      }
    } catch (error) {
      console.error('[MetaAgent Error]', error);
      await reply(`❌ Systémová chyba: ${error.message}`);
    }
  }
}

function formatPlan(plan) {
  return [`📋 *${plan.goal}*`, '', ...plan.steps.map((step) => `*${step.id}.* ${step.action}\n   _${step.details}_`)].join('\n');
}

const HELP_TEXT = `🤖 *OpenClaw Meta-Agent*

*Příkazy:*
• \`analyze <co>\` — Analyzuj soubor nebo kód
• \`plan <úkol>\` — Vytvoř plán
• \`execute <úkol>\` — Spusť agenta (async, notifikace)
• \`qa\` — Spustí interní QA kontroly (syntax + health check)
• \`tasks\` — Zobrazí poslední úkoly
• \`done all\` — Ukončí všechny uložené úkoly
• \`improve\` — 🧬 Self-improve: agent refaktoruje vlastní kód
• \`web improve\` — 🌐 Vylepší webovou prezentaci
• \`reset\` — Smaž session paměť
• \`help\` — Tato nápověda

*Platformy:* WhatsApp + Telegram + Web UI
*Agenti:* Planner · Executor · Memory · SelfImprove · WebImprove · QA · TaskManager`;

module.exports = MetaAgent;
