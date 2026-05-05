// sub-agents/auto-worker.js
// Lightweight autonomous worker for Martybot.
// It runs safe periodic checks inside the Railway process.
// It can proactively notify the user, but edits/pushes code only when explicit safety flags allow it.

const fs = require('fs').promises;
const path = require('path');
const Memory = require('./memory');
const GitWorkspace = require('./git-workspace');
const { statusSummary } = require('./model-presets');

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function now() {
  return new Date().toISOString();
}

function rel(workdir, file) {
  return path.join(workdir, file);
}

function minutesSince(iso) {
  if (!iso) return Infinity;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Infinity;
  return (Date.now() - time) / 60000;
}

class AutoWorker {
  constructor(metaAgent) {
    this.metaAgent = metaAgent;
    this.memory = new Memory();
    this.timer = null;
    this.notifier = null;
    this.lastRun = null;
    this.lastResult = 'AutoWorker ještě neběžel.';
    this.lastCodeReview = 'Audit kódu ještě neběžel.';
    this.running = false;
    this.intervalMs = Math.max(Number(process.env.AUTO_INTERVAL_MINUTES || 60), 5) * 60 * 1000;
    this.userId = process.env.AUTO_USER_ID || '';
    this.enabled = envFlag('AUTO_MODE');
    this.gitOk = false;
  }

  setNotifier(fn) {
    this.notifier = typeof fn === 'function' ? fn : null;
  }

  start() {
    if (!this.enabled) return false;
    if (!this.userId) {
      console.warn('[auto] AUTO_MODE=true, but AUTO_USER_ID is missing. AutoWorker disabled.');
      return false;
    }
    if (this.timer) return true;

    console.log(`[auto] AutoWorker started. interval=${this.intervalMs}ms user=${this.userId}`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('[auto] tick failed:', err.message));
    }, this.intervalMs);

    setTimeout(() => {
      this.tick().catch((err) => console.error('[auto] first tick failed:', err.message));
    }, 5000);

    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.enabled = false;
    this.lastResult = 'AutoWorker vypnutý.';
  }

  enable(userId) {
    if (userId) this.userId = userId;
    this.enabled = true;
    return this.start();
  }

  shouldRunAutoImprove() {
    return envFlag('AUTO_IMPROVE')
      && envFlag('ALLOW_AUTONOMOUS_WRITES')
      && envFlag('AUTO_IMPROVE_CONFIRMED')
      && this.gitOk;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    this.lastRun = now();

    try {
      let report = await this.safeAudit();
      this.lastResult = report;

      try {
        await this.memory.addAudit(this.userId, report, {
          source: 'auto-worker',
          title: `Auto audit ${this.lastRun}`,
        });
      } catch (err) {
        console.error('[auto] audit save failed:', err.message);
      }

      if (envFlag('AUTO_STORE_AUDITS')) {
        await this.memory.addKnowledge(this.userId, report, {
          source: 'auto-worker',
          title: `Auto audit ${this.lastRun}`,
        });
      }

      let improveResult = '';
      if (this.shouldRunAutoImprove()) {
        improveResult = await this.metaAgent.selfImprove.run((step) => console.log(`[auto] ${step}`));
        report += `\n\nAuto-improve:\n${improveResult}`;
        this.lastResult = report;

        try {
          await this.memory.addAudit(this.userId, improveResult, {
            source: 'auto-improve',
            title: `Auto improve ${now()}`,
          });
        } catch (err) {
          console.error('[auto] improve audit save failed:', err.message);
        }

        if (envFlag('AUTO_STORE_AUDITS')) {
          await this.memory.addKnowledge(this.userId, improveResult, {
            source: 'auto-improve',
            title: `Auto improve ${now()}`,
          });
        }
      } else if (envFlag('AUTO_IMPROVE') || envFlag('ALLOW_AUTONOMOUS_WRITES')) {
        const reason = [
          !envFlag('ALLOW_AUTONOMOUS_WRITES') ? 'ALLOW_AUTONOMOUS_WRITES není true' : '',
          !envFlag('AUTO_IMPROVE_CONFIRMED') ? 'AUTO_IMPROVE_CONFIRMED není true' : '',
          !this.gitOk ? 'git workspace není OK' : '',
        ].filter(Boolean).join(', ');
        console.log(`[auto] Auto-improve skipped: ${reason || 'pojistka'}`);
      }

      await this.maybeNotify(report, improveResult).catch((err) => {
        console.error('[auto] proactive notify failed:', err.message);
      });
    } finally {
      this.running = false;
    }
  }

  async maybeNotify(report, improveResult = '') {
    if (!this.notifier || !this.userId) return;

    const proactive = await this.memory.getSetting(this.userId, 'proactiveMessages', envFlag('AUTO_PROACTIVE'));
    if (!proactive) return;

    const cooldownMinutes = Math.max(Number(process.env.AUTO_PROACTIVE_COOLDOWN_MINUTES || 60), 5);
    const lastProactiveAt = await this.memory.getSetting(this.userId, 'lastProactiveAt', '');
    if (minutesSince(lastProactiveAt) < cooldownMinutes) return;

    const topSuggestions = String(report)
      .split('\n')
      .filter((line) => line.startsWith('• ') && (
        line.includes('.js:')
        || line.includes('Git workspace')
        || line.includes('Auto-improve')
        || line.includes('API klíč')
        || line.includes('Paměť')
      ))
      .slice(0, 7);

    const current = statusSummary();
    const message = [
      '🤖 Proaktivní návrh Martybotu',
      `• Čas: ${now()}`,
      `• Model: ${current.provider} / ${current.model}`,
      `• Git workspace: ${this.gitOk ? 'OK' : 'není OK'}`,
      `• Auto-improve: ${this.shouldRunAutoImprove() ? 'povoleno' : 'blokováno pojistkou'}`,
      improveResult ? '• Provedl jsem i auto-improve a mám výsledek v auditech.' : '',
      '',
      'Co jsem našel:',
      ...(topSuggestions.length ? topSuggestions : ['• Bez zásadních problémů. Doporučuji jen průběžný refaktor a kontrolu UX.']),
      '',
      'Rychlé akce:',
      '• /auto code — detailní návrhy',
      '• /improve — ruční self-improve',
      '• /agent developer — přepnout na vývojáře',
      '• /proactive off — vypnout tyhle zprávy',
    ].filter(Boolean).join('\n');

    await this.notifier(this.userId, message);
    await this.memory.setSetting(this.userId, 'lastProactiveAt', now());
    await this.memory.setSetting(this.userId, 'lastProactiveSummary', message);
  }

  async codeReview(workdir = process.env.AGENT_WORKDIR || process.cwd()) {
    const files = [
      'router-v2.js',
      'meta-agent-v2.js',
      'router.js',
      'meta-agent.js',
      'sub-agents/executor.js',
      'sub-agents/memory.js',
      'sub-agents/self-improve.js',
      'sub-agents/git-workspace.js',
      'sub-agents/auto-worker.js',
      'scripts/ensure-git-workdir.js',
    ];

    const suggestions = [];
    const missing = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(rel(workdir, file), 'utf-8');
        const lines = content.split('\n').length;

        if (lines > 450) suggestions.push(`• ${file}: soubor má ${lines} řádků — zvážit rozdělení na menší moduly.`);
        if (content.includes('process.exit(1)')) suggestions.push(`• ${file}: obsahuje process.exit(1) — u Railway raději graceful fallback, pokud nejde o fatální start.`);
        if (content.includes('console.error') && !content.includes('sanitize')) suggestions.push(`• ${file}: loguje chyby — zkontrolovat maskování tokenů a citlivých hodnot.`);
        if (content.includes('setImmediate') && !content.includes('try')) suggestions.push(`• ${file}: async background běh — ověřit try/catch a notifikaci uživateli.`);
        if (content.match(/TODO|FIXME/i)) suggestions.push(`• ${file}: obsahuje TODO/FIXME — projít a zařadit do plánu.`);
      } catch {
        missing.push(file);
      }
    }

    if (missing.length) suggestions.push(`• Chybějící soubory: ${missing.join(', ')}`);
    if (!suggestions.length) suggestions.push('• Statická kontrola nenašla zásadní problém. Další krok: testy + ruční review UX toků.');

    const report = [
      '🔍 Návrhy vylepšení kódu',
      `• Čas: ${now()}`,
      `• Workdir: ${workdir}`,
      '',
      ...suggestions.slice(0, 14),
      '',
      'Bezpečnostní režim: pouze návrhy. Kód se automaticky nemění, pokud nejsou zapnuté všechny pojistky.',
    ].join('\n');

    this.lastCodeReview = report;
    return report;
  }

  async safeAudit() {
    const current = statusSummary();
    const workdir = process.env.AGENT_WORKDIR || process.cwd();
    const checks = [];

    checks.push(`Čas: ${now()}`);
    checks.push(`Model: ${current.provider} / ${current.model}`);
    checks.push(`API klíč pro aktuální provider: ${current.tokenSet ? 'nastaven' : 'CHYBÍ'}`);
    checks.push(`AGENT_WORKDIR: ${workdir}`);
    checks.push(`Bash tools: ${envFlag('ALLOW_AGENT_BASH') ? 'zapnuté' : 'vypnuté'}`);
    checks.push(`Write tools: ${envFlag('ALLOW_AGENT_WRITE') ? 'zapnuté' : 'vypnuté'}`);
    checks.push(`Autonomní zápisy: ${envFlag('ALLOW_AUTONOMOUS_WRITES') ? 'povolené' : 'zakázané'}`);

    let gitOk = false;
    try {
      await fs.access(path.join(workdir, '.git'));
      gitOk = true;
      checks.push('Git workspace: OK, .git existuje');
    } catch {
      checks.push('Git workspace: chybí .git, self-improve neumí pushovat');
    }

    if (!gitOk && envFlag('GIT_AUTO_SETUP')) {
      try {
        checks.push('Git auto setup: zapnuto, zkouším opravit workspace...');
        await GitWorkspace.ensure();
        await fs.access(path.join(workdir, '.git'));
        gitOk = true;
        checks.push('Git auto setup: hotovo, .git už existuje');
      } catch (err) {
        checks.push(`Git auto setup: selhalo — ${err.message}`);
      }
    } else if (!gitOk) {
      checks.push('Git auto setup: vypnuto, nastav GIT_AUTO_SETUP=true nebo spusť /git setup');
    }

    this.gitOk = gitOk;

    const review = await this.codeReview(workdir);
    checks.push('Code review: hotovo, návrhy dostupné přes /auto code');

    if (envFlag('AUTO_IMPROVE')) {
      checks.push(`Auto-improve pojistka: ${this.shouldRunAutoImprove() ? 'povoleno' : 'blokováno'}`);
      if (!envFlag('AUTO_IMPROVE_CONFIRMED')) checks.push('Auto-improve důvod: chybí AUTO_IMPROVE_CONFIRMED=true');
      if (!gitOk) checks.push('Auto-improve důvod: git workspace není OK');
    }

    const stats = await this.memory.stats(this.userId);
    checks.push(`Paměť: ${stats.knowledge} poznámek, ${stats.messages} zpráv, ${stats.audits || 0} auditů`);

    return `🤖 Auto audit\n${checks.map((line) => `• ${line}`).join('\n')}\n\n${review}`;
  }

  statusText() {
    return [
      '🤖 Autonomní režim',
      `• Stav: ${this.enabled && this.timer ? 'zapnutý' : 'vypnutý'}`,
      `• Běží teď: ${this.running ? 'ano' : 'ne'}`,
      `• Interval: ${Math.round(this.intervalMs / 60000)} min`,
      `• AUTO_USER_ID: ${this.userId || 'nenastaven'}`,
      `• Poslední běh: ${this.lastRun || 'zatím nikdy'}`,
      `• Proaktivní notifikace: ${this.notifier ? 'napojené' : 'nenapojené'}`,
      '',
      this.lastResult,
      '',
      'Bezpečnost:',
      `• AUTO_IMPROVE: ${envFlag('AUTO_IMPROVE') ? 'true' : 'false'}`,
      `• ALLOW_AUTONOMOUS_WRITES: ${envFlag('ALLOW_AUTONOMOUS_WRITES') ? 'true' : 'false'}`,
      `• AUTO_IMPROVE_CONFIRMED: ${envFlag('AUTO_IMPROVE_CONFIRMED') ? 'true' : 'false'}`,
      `• GIT_AUTO_SETUP: ${envFlag('GIT_AUTO_SETUP') ? 'true' : 'false'}`,
      `• AUTO_PROACTIVE: ${envFlag('AUTO_PROACTIVE') ? 'true' : 'false'}`,
      `• AUTO_PROACTIVE_COOLDOWN_MINUTES: ${process.env.AUTO_PROACTIVE_COOLDOWN_MINUTES || 60}`,
      `• AUTO_STORE_AUDITS: ${envFlag('AUTO_STORE_AUDITS') ? 'true' : 'false'}`,
      'Autonomní změny kódu se spustí jen když jsou AUTO_IMPROVE=true, ALLOW_AUTONOMOUS_WRITES=true, AUTO_IMPROVE_CONFIRMED=true a git workspace je OK.',
    ].join('\n');
  }
}

module.exports = AutoWorker;
