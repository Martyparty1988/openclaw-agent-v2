// sub-agents/web-self-improve.js
// Standalone web self-improve helper for Martybot.
// It is intentionally dependency-free and safe by default.

const fs = require('fs');
const path = require('path');

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function read(file, max = 14000) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > max ? text.slice(0, max) + '\n<!-- truncated -->' : text;
  } catch { return ''; }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function scoreHtml(html) {
  const checks = [
    ['viewport-fit=cover', /viewport-fit=cover/i.test(html)],
    ['PWA manifest', /rel=["']manifest["']/i.test(html)],
    ['theme-color', /theme-color/i.test(html)],
    ['safe-area', /safe-area-inset/i.test(html)],
    ['bottom tabbar', /tabbar/i.test(html)],
    ['localStorage', /localStorage/i.test(html)],
    ['status endpoint', /api\/status/i.test(html)],
    ['chat endpoint', /api\/chat/i.test(html)],
    ['glass/blur design', /backdrop-filter|blur\(/i.test(html)],
    ['mobile responsive', /@media\s*\(/i.test(html)]
  ];
  const ok = checks.filter(([, pass]) => pass).length;
  return { ok, total: checks.length, checks };
}

function makeStandalonePage() {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#06110b">
  <title>Martybot · Self Improve Web</title>
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--bg:#06110b;--card:rgba(255,255,255,.06);--line:rgba(46,255,112,.18);--green:#2eff70;--text:#e7fff0;--muted:rgba(231,255,240,.58)}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,rgba(46,255,112,.18),transparent 26rem),linear-gradient(180deg,var(--bg),#030805);color:var(--text);padding:calc(env(safe-area-inset-top) + 18px) 14px calc(env(safe-area-inset-bottom) + 18px)}
    .wrap{max-width:680px;margin:0 auto}.card{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:20px;box-shadow:0 24px 80px rgba(0,0,0,.42);backdrop-filter:blur(22px)}
    .badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:7px 11px;color:var(--green);background:rgba(46,255,112,.08);font-weight:800;font-size:12px}h1{font-size:30px;letter-spacing:-.04em;margin:14px 0 8px}p{color:var(--muted);line-height:1.55}button,a{display:inline-flex;justify-content:center;align-items:center;min-height:46px;border:0;border-radius:16px;padding:12px 16px;font-weight:900;text-decoration:none}button{width:100%;background:linear-gradient(135deg,var(--green),#8dffb5);color:#041008}a{color:var(--green);border:1px solid var(--line);background:rgba(255,255,255,.05);margin-top:10px;width:100%}textarea{width:100%;min-height:220px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:rgba(0,0,0,.25);color:var(--text);padding:13px;margin-top:14px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:15px;background:rgba(0,0,0,.25);color:var(--text);padding:13px;margin:8px 0}.row{display:grid;gap:10px;margin-top:14px}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <span class="badge">WEB SELF-IMPROVE</span>
      <h1>Martybot web upgrade</h1>
      <p>Samostatná obrazovka pro spuštění analýzy a self-improve webové části. Posílá příkaz do backendu: <b>/web improve</b>.</p>
      <input id="api" placeholder="Backend URL, např. https://xxx.up.railway.app" />
      <input id="token" placeholder="WEB_API_TOKEN volitelně" type="password" />
      <div class="row">
        <button onclick="runImprove()">Spustit Self‑Improve Web</button>
        <a href="/web/premium.html">Zpět do Martybot appky</a>
      </div>
      <textarea id="out" readonly>Výstup se zobrazí tady…</textarea>
    </section>
  </main>
<script>
const api=document.getElementById('api'), token=document.getElementById('token'), out=document.getElementById('out');
api.value=localStorage.getItem('martybotBackendUrl')||''; token.value=localStorage.getItem('martybotWebToken')||'';
async function runImprove(){
  localStorage.setItem('martybotBackendUrl',api.value.trim()); localStorage.setItem('martybotWebToken',token.value.trim());
  out.value='Spouštím /web improve…';
  const base=(api.value.trim()||'').replace(/\/$/,'');
  const headers={'Content-Type':'application/json'}; if(token.value.trim()) headers.Authorization='Bearer '+token.value.trim();
  try{
    const r=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({userId:'web_user',text:'/web improve'})});
    const d=await r.json();
    out.value=(d.replies&&d.replies.length?d.replies.join('\n\n'):JSON.stringify(d,null,2));
  }catch(e){ out.value='Chyba: '+e.message+'\nZkontroluj Backend URL a token.'; }
}
</script>
</body>
</html>`;
}

async function runWebSelfImprove(options = {}) {
  const root = options.root || process.cwd();
  const webDir = options.webDir || path.join(root, 'web');
  const premium = path.join(webDir, 'premium.html');
  const index = path.join(webDir, 'index.html');
  const standalone = path.join(webDir, 'self-improve.html');
  const reportFile = path.join(webDir, 'SELF_IMPROVE_REPORT.md');

  const premiumHtml = read(premium);
  const indexHtml = read(index);
  const targetHtml = premiumHtml || indexHtml;
  const score = scoreHtml(targetHtml);

  const lines = [];
  lines.push('🧬 Self‑Improve Web');
  lines.push('');
  lines.push('Skóre webu: ' + score.ok + '/' + score.total);
  lines.push('');
  for (const [name, pass] of score.checks) lines.push((pass ? '✅ ' : '⚠️ ') + name);
  lines.push('');
  lines.push('Zkontrolované soubory:');
  lines.push('- web/premium.html: ' + (exists(premium) ? 'ano' : 'ne'));
  lines.push('- web/index.html: ' + (exists(index) ? 'ano' : 'ne'));
  lines.push('- web/self-improve.html: ' + (exists(standalone) ? 'ano' : 'ne'));

  const shouldWrite = options.write === true || process.env.ALLOW_WEB_SELF_IMPROVE_WRITE === 'true' || process.env.ALLOW_AGENT_WRITE === 'true';
  if (shouldWrite) {
    write(standalone, makeStandalonePage());
    const report = '# Martybot Web Self‑Improve Report\n\n' + lines.join('\n') + '\n\nGenerated: ' + new Date().toISOString() + '\n';
    write(reportFile, report);
    lines.push('');
    lines.push('✅ Zapsáno: web/self-improve.html');
    lines.push('✅ Zapsáno: web/SELF_IMPROVE_REPORT.md');
  } else {
    lines.push('');
    lines.push('Režim zápisu je vypnutý. Pro automatické zapisování nastav v Railway:');
    lines.push('ALLOW_WEB_SELF_IMPROVE_WRITE=true');
  }

  lines.push('');
  lines.push('Samostatná URL po deployi: /web/self-improve.html');
  return lines.join('\n');
}

module.exports = { runWebSelfImprove, makeStandalonePage };
