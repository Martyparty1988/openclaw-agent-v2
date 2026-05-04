// sub-agents/learner.js
// Learns from plain text or public URLs and returns cleaned content for the knowledge base.

const http = require('http');
const https = require('https');

function isUrl(text) {
  try {
    const url = new URL(String(text || '').trim());
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getTitle(html, fallback) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return fallback || '';
  return stripHtml(match[1]).slice(0, 120) || fallback || '';
}

function fetchUrl(urlString) {
  const url = new URL(urlString);
  const lib = url.protocol === 'https:' ? https : http;
  const maxBytes = Number(process.env.LEARN_MAX_BYTES || 400000);

  return new Promise((resolve, reject) => {
    const req = lib.get(url, {
      timeout: Number(process.env.LEARN_TIMEOUT_MS || 15000),
      headers: {
        'User-Agent': 'OpenClaw-Martybot/1.0',
        Accept: 'text/html,text/plain,application/json;q=0.8,*/*;q=0.5',
      },
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        fetchUrl(nextUrl).then(resolve).catch(reject);
        return;
      }

      if (status >= 400) {
        res.resume();
        reject(new Error(`URL returned HTTP ${status}`));
        return;
      }

      let data = '';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > maxBytes) {
          req.destroy(new Error(`URL content is too large. Limit: ${maxBytes} bytes.`));
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve({ body: data, finalUrl: url.toString(), headers: res.headers }));
    });

    req.on('timeout', () => req.destroy(new Error('URL fetch timed out.')));
    req.on('error', reject);
  });
}

class Learner {
  async learn(input) {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('Use: /learn <text nebo veřejná URL>');

    if (!isUrl(raw)) {
      return {
        content: raw,
        source: 'manual-learn',
        title: raw.slice(0, 80),
        url: '',
      };
    }

    const { body, finalUrl, headers } = await fetchUrl(raw);
    const contentType = String(headers['content-type'] || '').toLowerCase();
    const cleaned = contentType.includes('html') ? stripHtml(body) : String(body || '').replace(/\s+/g, ' ').trim();
    const title = contentType.includes('html') ? getTitle(body, finalUrl) : finalUrl;

    if (!cleaned) throw new Error('URL was fetched but no readable text was found.');

    return {
      content: cleaned.slice(0, Number(process.env.LEARN_MAX_CHARS || 12000)),
      source: 'url',
      title,
      url: finalUrl,
    };
  }
}

module.exports = Learner;
