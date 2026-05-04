// meta-agent.js — Orchestrator that routes tasks to sub-agents
// Planner → Executor → Memory → SelfImprove → Email → Learner → AutoWorker → GitWorkspace

const Planner = require('./sub-agents/planner');
const Executor = require('./sub-agents/executor');
const Memory = require('./sub-agents/memory');
const SelfImprove = require('./sub-agents/self-improve');
const WebImprove = require('./sub-agents/web-improve');
const EmailAgent = require('./sub-agents/email');
const Learner = require('./sub-agents/learner');
const GitWorkspace = require('./sub-agents/git-workspace');
const {
  applyPreset,
  listPresetsText,
  statusSummary,
  getProvider,
  getModelForProvider,
} = require('./sub-agents/model-presets');

const COMMANDS = {
  git: ['git', 'git status', 'git setup', 'git pull', 'repo'],
  auto: ['auto', 'autonomně', 'autonomne', 'autonomie', 'autonomní režim', 'autonomni rezim'],
  model: ['model', 'models', 'přepni model', 'prepni model', 'jazykový model', 'jazykovy model'],
  email: ['email', 'mail', 'send email', 'pošli email', 'posli email', 'pošli mail', 'posli mail'],
  learn: ['learn', 'nauč se', 'nauc se', 'načti', 'nacti', 'ulož zdroj', 'uloz zdroj'],
  backup: ['backup', 'záloha', 'zaloha', 'export memory', 'export paměti', 'export pameti'],
  restore: ['restore', 'obnov', 'import memory', 'import paměti', 'import pameti'],
  remember: ['remember', 'zapamatuj', 'ulož', 'uloz', 'pamatuj'],
  facts: ['facts', 'poznámky', 'poznamky', 'paměť', 'pamet', 'knowledge'],
  memoryclear: ['clear facts', 'smaž poznámky', 'smaz poznamky', 'clear knowledge'],
  analyze: ['analyze', 'analyzuj', 'analyse'],
  plan: ['plan', 'plán', 'naplánuj'],
  execute: ['execute', 'exec', 'spusť', 'spust', 'udělej', 'udelej'],
  improve: ['improve', 'zlepši', 'zlepsi', 'vylepši', 'vylepsi', 'vylepši svůj kód', 'vylepsi svuj kod', 'self-improve', 'refactor self'],
  webimprove: ['web improve', 'improve web', 'zlepši web', 'zlepsi web', 'vylepši web', 'vylepsi web', 'update web'],
  reset: ['reset', 'zapomeň', 'zapomen', 'forget', 'clear'],
  help: ['start', 'help', 'pomoc', 'příkazy', 'prikazy'],
  status: ['status', 'stav'],
  chat: [],
};

function normalizeIncomingText(text) {
  const raw = String(text || '').trim();
  return raw.replace(/^\/+/, '').replace(/^([^\s@]+)@[^\s]+/, '$1');
}

function parseCommand(text) {
  const normalized = normalizeIncomingText(text);
  const lower = normalized.toLowerCase().trim();

  // Keep multi-word git commands usable while still routing to the git handler.
  if (lower === 'git' || lower.startsWith('git ')) {
    return { command: 'git', task: normalized.slice(3).trim() };
  }

  for (const [cmd, keywords] of Object.entries(COMMANDS)) {
    for (const kw of keywords) {
      if (lower.startsWith(kw + ' ') || lower === kw) {
        return { command: cmd, task: normalized.slice(kw.length).trim() };
      }
    }
  }

  return { command: 'chat', task: normalized };
}

function friendlyError(err) {
  const raw = [err?.message, err?.stack, JSON.stringify(err || {})].filter(Boolean).join('\n');
  const lower = raw.toLowerCase();

  if (lower.includes('credit balance is too low') || lower.includes('purchase credits') || lower.includes('plans & billing')) {
    return 'Claude/Anthropic API nemá kredit. Buď dobij kredit v Anthropic Console, nebo použij /model openrouter free.';
  }
  if (lower.includes('missing authentication header') || lower.includes('401')) {
    return 'API klíč pro aktuální provider chybí nebo je špatně vložený. Zkontroluj Railway Variables pro aktuální model.';
  }
  if (lower.includes('invalid api key') || lower.includes('authentication') || lower.includes('unauthorized')) {
    return 'API klíč je špatný nebo chybí. Zkontroluj Railway Variables klíč pro aktuální LLM provider.';
  }
  if (lower.includes('not a legal http header value') || lower.includes('bytestring')) {
    return 'V API klíči je placeholder nebo český znak. Smaž hodnotu typu „tvůj_klíč“ a vlož skutečný API key bez uvozovek a mezer.';
  }
  if (lower.includes('connection error')) {
    return 'Connection error při volání AI API. Zkontroluj klíč, kredit/billing a zkus redeploy. Pro free režim použij /model openrouter free.';
  }
  if (lower.includes('not found') && lower.includes('git')) {
    return 'V Railway kontejneru zřejmě není dostupný git. Zkus v Railway build/runtime ověřit, že image obsahuje git, nebo použij Nixpacks/Node runtime s gitem.';
  }
  return err?.message || 'Neznámá systémová chyba.';
}

function splitLongText(text, maxLen = 3600) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > maxLen) {
    out.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  if (rest) out.push(rest);
  return out;
}

function modeNote(provider) {
  if (provider === 'openrouter') return 'OpenRouter režim je text-only. Free volba: /model openrouter free.';
  if (provider === 'deepseek') return 'DeepSeek režim je text-only provider přes OpenAI-compatible API.';
  if (provider === 'anthropic') return 'Anthropic režim podporuje tool-calling executor, ale vyžaduje API kredit.';
  if (provider === 'openai') return 'OpenAI režim je v této verzi text-only.';
  return 'Neznámý provider.';
}

class MetaAgent {
  constructor() {
    this.planner = new Planner();
    this.executor = new Executor();
    this.memory = new Memory();
    this.selfImprove = new SelfImprove();
    this.webImprove = new WebImprove();
    this.email = new EmailAgent();
    this.learner = new Learner();
    this.gitWorkspace = GitWorkspace;
    this.autoWorker = null;
  }

  setAutoWorker(autoWorker) {
    this.autoWorker = autoWorker;
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

        case 'git': {
          const action = String(task || 'status').trim().toLowerCase();
          if (!action || action === 'status' || action === 'stav') {
            const s = await this.gitWorkspace.status();
            await reply(this.gitWorkspace.formatStatus(s));
            break;
          }
          if (['setup', 'init', 'clone', 'napoj', 'napojit', 'oprav'].includes(action)) {
            await reply('🧩 Připravuji git workspace v AGENT_WORKDIR...');
            const out = await this.gitWorkspace.ensure();
            await reply(out);
            break;
          }
          if (action === 'pull' || action === 'update' || action === 'aktualizuj') {
            await reply('⬇️ Dělám git pull...');
            const out = await this.gitWorkspace.pull();
            await reply(out);
            break;
          }
          await reply('Použití: /git, /git status, /git setup, /git pull');
          break;
        }

        case 'auto': {
          if (!this.autoWorker) {
            await reply('❌ Autonomní worker není připojený v routeru.');
            break;
          }

          const action = String(task || 'status').trim().toLowerCase();
          if (!action || action === 'status' || action === 'stav') {
            await reply(this.autoWorker.statusText());
            break;
          }
          if (action === 'on' || action === 'zapnout') {
            this.autoWorker.enable(userId);
            await reply([
              '✅ Autonomní režim zapnutý pro aktuální běh procesu.',
              '',
              this.autoWorker.statusText(),
              '',
              'Natrvalo nastav v Railway Variables: AUTO_MODE=true a AUTO_USER_ID=' + userId,
            ].join('\n'));
            break;
          }
          if (action === 'off' || action === 'vypnout') {
            this.autoWorker.stop();
            await reply('🛑 Autonomní režim vypnutý pro aktuální běh procesu. Natrvalo nastav AUTO_MODE=false v Railway.');
            break;
          }
          if (action === 'run' || action === 'teď' || action === 'ted') {
            await reply('🤖 Spouštím jednorázový auto audit...');
            this.autoWorker.userId = userId;
            await this.autoWorker.tick();
            await reply(this.autoWorker.statusText());
            break;
          }

          await reply('Použití: /auto, /auto on, /auto off, /auto run, /auto status');
          break;
        }

        case 'model': {
          if (!task) {
            const current = statusSummary();
            await reply([listPresetsText(), '', `Aktuálně: ${current.provider} / ${current.model}`, `API klíč pro aktuální provider: ${current.tokenSet ? 'nastaven' : 'CHYBÍ'}`].join('\n'));
            break;
          }
          const selected = applyPreset(task);
          if (!selected) {
            await reply(`❌ Neznámý model preset: ${task}\n\n${listPresetsText()}`);
            break;
          }
          const current = statusSummary();
          await reply([
            '✅ Model přepnut pro aktuálně běžící bot proces.',
            `• Provider: ${current.provider}`,
            `• Model: ${current.model}`,
            `• API klíč: ${current.tokenSet ? 'nastaven' : 'CHYBÍ'}`,
            '',
            'Poznámka: přepnutí přes chat platí do restartu/redeploye. Natrvalo nastav stejné hodnoty v Railway Variables.',
          ].join('\n'));
          break;
        }

        case 'status': {
          const provider = getProvider();
          const stats = await this.memory.stats(userId);
          const current = statusSummary();
          await reply([
            '🩺 Stav bota',
            `• Jazyk: čeština natvrdo`,
            `• LLM provider: ${provider}`,
            `• Model: ${getModelForProvider(provider)}`,
            `• API klíč pro provider: ${current.tokenSet ? 'nastaven' : 'CHYBÍ'}`,
            `• Telegram token: ${process.env.TELEGRAM_TOKEN ? 'nastaven' : 'nenastaven'}`,
            `• Email SMTP: ${this.email.isConfigured() ? 'nastaven' : 'nenastaven'}`,
            `• Email účet: ${process.env.SMTP_USER || 'nenastaven'}`,
            `• WhatsApp číslo: ${process.env.WA_PHONE_NUMBER ? 'nastaveno' : 'nenastaveno'}`,
            `• Autonomní režim: ${this.autoWorker && this.autoWorker.enabled ? 'zapnutý' : 'vypnutý'}`,
            `• Bash tools: ${process.env.ALLOW_AGENT_BASH === 'true' ? 'zapnuté' : 'vypnuté'}`,
            `• Write tools: ${process.env.ALLOW_AGENT_WRITE === 'true' ? 'zapnuté' : 'vypnuté'}`,
            `• Memory backend: ${stats.backend}`,
            `• Supabase requested: ${stats.supabaseRequested ? 'ano' : 'ne'}`,
            `• Supabase table: ${stats.supabaseTable || '—'}`,
            stats.supabaseDisabledReason ? `• Supabase důvod fallbacku: ${stats.supabaseDisabledReason}` : '',
            `• Zprávy v paměti: ${stats.messages}`,
            `• Trvalé poznámky: ${stats.knowledge}`,
            `• Memory dir: ${stats.memoryDir}`,
            '',
            modeNote(provider),
          ].filter(Boolean).join('\n'));
          break;
        }

        case 'email': {
          if (!task) return reply('❌ Použití: /email komu@example.com | Předmět | Text zprávy');
          await reply('📨 Odesílám email...');
          const info = await this.email.sendFromCommand(task);
          await reply(['✅ Email odeslán.', `• Přijato: ${info.accepted.join(', ') || '—'}`, info.rejected.length ? `• Odmítnuto: ${info.rejected.join(', ')}` : '', `• Message ID: ${info.messageId || '—'}`].filter(Boolean).join('\n'));
          break;
        }

        case 'learn': {
          if (!task) return reply('❌ Použití: /learn <text nebo veřejná URL>');
          await reply('📚 Učím se ze zdroje...');
          const learned = await this.learner.learn(task);
          const item = await this.memory.addKnowledge(userId, learned.content, { source: learned.source, title: learned.title, url: learned.url });
          await reply(['✅ Zdroj uložen do trvalé paměti.', `• Název: ${learned.title || 'bez názvu'}`, `• Zdroj: ${learned.url || learned.source}`, `• Délka: ${learned.content.length} znaků`, `• ID: ${item.id}`].join('\n'));
          break;
        }

        case 'backup': {
          const backup = await this.memory.exportJson(userId);
          await reply('📦 Záloha paměti níže. Ulož si ji bezpečně.');
          for (const chunk of splitLongText(backup, 3500)) await reply(chunk);
          break;
        }

        case 'restore': {
          if (!task) return reply('❌ Použití: /restore <JSON záloha z /backup>');
          const restored = await this.memory.importJson(userId, task, { merge: true });
          await reply(`✅ Paměť obnovena/sloučena. Zprávy: ${restored.messages.length}, poznámky: ${restored.knowledge.length}.`);
          break;
        }

        case 'remember': {
          if (!task) return reply('❌ Napiš co si mám zapamatovat. Příklad: /remember Martin pracuje na Railway botovi.');
          const item = await this.memory.addKnowledge(userId, task, { source: 'manual' });
          await reply(`✅ Uloženo do trvalé paměti.\nID: ${item.id}`);
          break;
        }

        case 'facts': {
          const items = await this.memory.listKnowledge(userId, 20);
          if (!items.length) return reply('ℹ️ Zatím nemám uložené žádné trvalé poznámky. Použij: /remember ...');
          await reply([`🧠 Trvalá paměť (${items.length} posledních položek):`, '', ...items.map((item, index) => `${index + 1}. ${item.content.slice(0, 500)}\n   ID: ${item.id}`)].join('\n'));
          break;
        }

        case 'memoryclear':
          await this.memory.clearKnowledge(userId);
          await reply('🧹 Trvalé poznámky smazány.');
          break;

        case 'reset':
          await this.memory.clear(userId);
          await reply('🧹 Konverzační paměť smazána. Trvalé poznámky zůstaly.');
          break;

        case 'analyze': {
          if (!task) return reply('❌ Zadej co analyzovat. Příklad: /analyze agents.js');
          await reply('🔍 Analyzuji...');
          const result = await this.executor.run(userId, `Analyze only, no changes: ${task}`, null);
          await this.memory.add(userId, 'user', text);
          await this.memory.add(userId, 'assistant', result.output);
          await reply(`🔍 Analýza:\n\n${result.output}`);
          break;
        }

        case 'plan': {
          if (!task) return reply('❌ Zadej co naplánovat. Příklad: /plan deploy solartrack');
          await reply('📋 Plánuji...');
          const plan = await this.planner.create(userId, task);
          await this.memory.add(userId, 'user', text);
          await this.memory.add(userId, 'assistant', JSON.stringify(plan));
          await reply(formatPlan(plan));
          break;
        }

        case 'execute': {
          if (!task) return reply('❌ Zadej co spustit. Příklad: /execute oprav bug v router.js');
          await reply('⚙️ Spouštím agenta... Dostaneš notifikaci až bude hotovo.');
          setImmediate(async () => {
            const steps = [];
            try {
              const plan = await this.planner.create(userId, task);
              const result = await this.executor.run(userId, plan, (s) => steps.push(s));
              await this.memory.add(userId, 'user', text);
              await this.memory.add(userId, 'assistant', result.output);
              const summary = ['✅ Hotovo!', '', result.output, steps.length ? `\n🔧 ${steps.length} kroků provedeno` : ''].filter(Boolean).join('\n');
              await reply(summary);
            } catch (err) {
              await reply(`❌ Chyba: ${friendlyError(err)}`);
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
              await reply(`❌ Self-improve selhal: ${friendlyError(err)}`);
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
              await reply(`❌ Web-improve selhal: ${friendlyError(err)}`);
            }
          });
          break;
        }

        case 'chat':
        default: {
          await reply('💬 Přemýšlím...');
          const history = await this.memory.getHistory(userId);
          const knowledge = await this.memory.getKnowledgeContext(userId);
          const czechInstruction = 'Vždy odpovídej česky, přátelsky, prakticky a krok za krokem. Nepoužívej polštinu ani angličtinu, pokud o to uživatel výslovně nepožádá.';
          const enrichedTask = [czechInstruction, knowledge ? `Relevantní trvalá paměť o uživateli a projektu:\n${knowledge}` : '', `Aktuální zpráva uživatele:\n${task}`].filter(Boolean).join('\n\n');
          const result = await this.executor.chat(userId, enrichedTask, history);
          await this.memory.add(userId, 'user', task);
          await this.memory.add(userId, 'assistant', result);
          await reply(result);
          break;
        }
      }
    } catch (err) {
      console.error('[MetaAgent Error]', err);
      await reply(`❌ Systémová chyba: ${friendlyError(err)}`);
    }
  }
}

function formatPlan(plan) {
  return [`📋 ${plan.goal}`, '', ...plan.steps.map((s) => `${s.id}. ${s.action}\n   ${s.details}`)].join('\n');
}

const HELP_TEXT = `🤖 OpenClaw Meta-Agent

Příkazy:
• /start nebo /help — nápověda
• /status — stav providera/modelu/paměti/emailu
• /git — stav git workspace
• /git setup — naklonuje/opraví git workspace v AGENT_WORKDIR
• /git pull — aktualizuje git workspace
• /auto — stav autonomního režimu
• /auto on — zapne autonomní režim pro aktuální běh
• /auto off — vypne autonomní režim pro aktuální běh
• /auto run — spustí jednorázový auto audit
• /model — vypíše dostupné modely
• /model openrouter free — přepne na free OpenRouter router
• /learn <text nebo URL> — uloží veřejný zdroj nebo text do znalostí
• /backup — pošle JSON zálohu paměti
• /restore <JSON> — obnoví/sloučí zálohu paměti
• /email komu@example.com | Předmět | Text — odešle email přes SMTP
• /remember <text> — uloží trvalou poznámku
• /facts — ukáže trvalé poznámky
• /analyze <co> — analyzuje soubor nebo kód
• /plan <úkol> — vytvoří plán
• /execute <úkol> — spustí agenta async
• /improve nebo vylepši svůj kód — self-improve cyklus
• /reset — smaže jen konverzační paměť

Jazyk: čeština natvrdo.
Autonomní zápisy kódu vyžadují AUTO_IMPROVE=true a ALLOW_AUTONOMOUS_WRITES=true v Railway.
Klíče zůstávají pouze v Railway Variables.`;

module.exports = MetaAgent;
