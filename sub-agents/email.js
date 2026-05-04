// sub-agents/email.js
// Simple SMTP email sender for Martybot/OpenClaw.
// Configure via Railway Variables. Do not commit passwords.

const nodemailer = require('nodemailer');

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`${name} is missing.`);
  return String(value).trim();
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

function parseEmailCommand(task) {
  const parts = String(task || '').split('|').map((p) => p.trim());
  if (parts.length < 3) {
    throw new Error('Use: /email komu@example.com | Předmět | Text zprávy');
  }

  const [to, subject, ...bodyParts] = parts;
  const body = bodyParts.join(' | ').trim();

  if (!to || !subject || !body) {
    throw new Error('Use: /email komu@example.com | Předmět | Text zprávy');
  }

  return { to, subject, body };
}

class EmailAgent {
  constructor() {
    this.transporter = null;
  }

  isConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  getTransporter() {
    if (this.transporter) return this.transporter;

    const host = required('SMTP_HOST');
    const port = envInt('SMTP_PORT', 465);
    const secure = envBool('SMTP_SECURE', port === 465);
    const user = required('SMTP_USER');
    const pass = required('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    return this.transporter;
  }

  async send({ to, subject, body }) {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const transporter = this.getTransporter();

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: body,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    };
  }

  async sendFromCommand(task) {
    return this.send(parseEmailCommand(task));
  }
}

module.exports = EmailAgent;
