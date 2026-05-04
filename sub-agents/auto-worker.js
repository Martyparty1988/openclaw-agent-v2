// sub-agents/auto-worker.js
// Lightweight autonomous worker for Martybot.
// It runs safe periodic checks inside the Railway process.
// It does NOT edit files, push git, or spend paid APIs unless explicit env flags allow it.

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

class AutoWorker {
  constructor(metaAgent) {
    this.metaAgent = metaAgent;
    this.memory = new Memory();
    this.timer = null;
    this.lastRun = null;
    this.lastResult = 'AutoWorker ještě neběžel.';
    this.running = false;
    this.intervalMs = Math.max(Number(process.env.AUTO_INTERVAL_MINUTES || 60), 5) * 60 * 1000;
    this.userId = process.env.AUTO_USER_ID || '';
    this.enabled = envFlag('AUTO_MODE');
    this.gitOk = false;
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
      const report = await this.safeAudit();
      this.lastResult = report;
      await this.memory.addKnowledge(this.userId, report, {
        source: 'auto-worker',
        title: `Auto audit ${this.lastRun}`,
      });

      if (this.shouldRunAutoImprove()) {
        const improveResult = await this.metaAgent.selfImprove.run((step) => console.log(`[auto] ${step}`));
        await this.memory.addKnowledge(this.userId, improveResult, {
          source: 'auto-improve',
          title: `Auto improve ${now()}`,
        });
        this.lastResult += `\n\nAuto-improve:\n${improveResult}`;
      } else if (envFlag('AUTO_IMPROVE') || envFlag('ALLOW_AUTONOMOUS_WRITES')) {
        const reason = [
          !envFlag('ALLOW_AUTONOMOUS_WRITES') ? 'ALLOW_AUTONOMOUS_WRITES není true' : '',
          !envFlag('AUTO_IMPROVE_CONFIRMED') ? 'AUTO_IMPROVE_CONFIRMED není true' : '',
          !this.gitOk ? 'git workspace není OK' : '',
        ].filter(Boolean).join(', ');
        console.log(`[auto] Auto-improve skipped: ${reason || 'pojistka'}`);
      }
    } finally {
      this.running = false;
    }
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

    if (envFlag('AUTO_IMPROVE')) {
      checks.push(`Auto-improve pojistka: ${this.shouldRunAutoImprove() ? 'povoleno' : 'blokováno'}`);
      if (!envFlag('AUTO_IMPROVE_CONFIRMED')) checks.push('Auto-improve důvod: chybí AUTO_IMPROVE_CONFIRMED=true');
      if (!gitOk) checks.push('Auto-improve důvod: git workspace není OK');
    }

    const stats = await this.memory.stats(this.userId);
    checks.push(`Paměť: ${stats.knowledge} poznámek, ${stats.messages} zpráv`);

    return `🤖 Auto audit\n${checks.map((line) => `• ${line}`).join('\n')}`;
  }

  statusText() {
    return [
      '🤖 Autonomní režim',
      `• Stav: ${this.enabled && this.timer ? 'zapnutý' : 'vypnutý'}`,
      `• Běží teď: ${this.running ? 'ano' : 'ne'}`,
      `• Interval: ${Math.round(this.intervalMs / 60000)} min`,
      `• AUTO_USER_ID: ${this.userId || 'nenastaven'}`,
      `• Poslední běh: ${this.lastRun || 'zatím nikdy'}`,
      '',
      this.lastResult,
      '',
      'Bezpečnost:',
      `• AUTO_IMPROVE: ${envFlag('AUTO_IMPROVE') ? 'true' : 'false'}`,
      `• ALLOW_AUTONOMOUS_WRITES: ${envFlag('ALLOW_AUTONOMOUS_WRITES') ? 'true' : 'false'}`,
      `• AUTO_IMPROVE_CONFIRMED: ${envFlag('AUTO_IMPROVE_CONFIRMED') ? 'true' : 'false'}`,
      `• GIT_AUTO_SETUP: ${envFlag('GIT_AUTO_SETUP') ? 'true' : 'false'}`,
      'Autonomní změny kódu se spustí jen když jsou AUTO_IMPROVE=true, ALLOW_AUTONOMOUS_WRITES=true, AUTO_IMPROVE_CONFIRMED=true a git workspace je OK.',
    ].join('\n');
  }
}

module.exports = AutoWorker;
