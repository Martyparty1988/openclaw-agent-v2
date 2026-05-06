// MARTYBOT — martybot-pro.js
// PRO UI layer: badge, HUD, OPS panel, command bar and live status refresh.
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const base=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const token=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  const hdr=()=>{const h={}; if(token()) h['X-Agent-Token']=token(); return h;};
  async function api(path){const r=await fetch(base()+path,{headers:hdr()}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json();}
  const dot=state=>'<span class="pro-dot '+(state||'')+'"></span>';
  const ring=(on,warn)=>'<span class="pro-ring '+(on?'on':warn?'warn':'')+'"></span>';
  function badge(){const h=document.querySelector('.brand-text h1'); if(h&&!h.querySelector('.pro-badge')) h.insertAdjacentHTML('beforeend','<span class="pro-badge">PRO</span>');}
  function hud(){if($('proHud')) return; const stats=document.querySelector('.stats'); if(!stats) return; const el=document.createElement('div'); el.id='proHud'; el.className='pro-hud'; el.innerHTML='<div class="pro-hud-card"><small>Telegram</small><b id="proTg">—</b></div><div class="pro-hud-card"><small>WhatsApp</small><b id="proWa">—</b></div><div class="pro-hud-card"><small>OpenClaw</small><b id="proOc">—</b></div><div class="pro-hud-card"><small>Git / AI</small><b id="proGit">—</b></div>'; stats.insertAdjacentElement('afterend',el);}
  function ops(){if($('proOps')) return; const stats=document.querySelector('.stats'); if(!stats) return; const el=document.createElement('section'); el.id='proOps'; el.className='pro-ops'; el.innerHTML='<div class="pro-ops-card"><small>Telegram bot</small><strong id="opsTelegram">—</strong></div><div class="pro-ops-card"><small>WhatsApp socket</small><strong id="opsWhatsApp">—</strong></div><div class="pro-ops-card"><small>OpenClaw upstream</small><strong id="opsOpenClaw">—</strong></div><div class="pro-ops-card"><small>Write mode</small><strong id="opsWrite">—</strong></div>'; stats.insertAdjacentElement('afterend',el);}
  function command(){if($('proCommand')) return; const el=document.createElement('div'); el.id='proCommand'; el.className='pro-command is-hidden'; el.innerHTML='<input id="proCmdInput" type="text" placeholder="Příkaz: /status, /git, /wa pair…" autocomplete="off" spellcheck="false"><button id="proCmdSend" type="button">Run</button>'; document.body.appendChild(el); const send=()=>{const inp=$('proCmdInput'); const txt=String(inp.value||'').trim(); if(!txt) return; inp.value=''; if(window.martybotSend) window.martybotSend(txt);}; $('proCmdSend').onclick=send; $('proCmdInput').addEventListener('keydown',e=>{if(e.key==='Enter') send();});}
  function chips(){if($('proChips')) return; const sugg=$('suggestions'); if(!sugg) return; const row=document.createElement('div'); row.id='proChips'; row.className='pro-chip-row'; [['⚡ Status','/status'],['🧠 Reload','/agent reload'],['🧩 Git','/git'],['🔗 WA Pair','/wa pair'],['✨ Improve','/web improve']].forEach(([label,cmd])=>{const b=document.createElement('button'); b.type='button'; b.className='pro-chip'; b.textContent=label; b.onclick=()=>window.martybotSend&&window.martybotSend(cmd); row.appendChild(b);}); sugg.insertAdjacentElement('beforebegin',row);}
  function footer(){if(document.querySelector('.marty-footer')) return; const app=document.querySelector('.app'); if(app) app.insertAdjacentHTML('beforeend','<footer class="marty-footer">Martybot <b>Pro</b> · Telegram · WhatsApp · Git · OpenClaw</footer>');}
  async function refresh(){
    try{const s=await api('/api/status');
      if($('proTg')) $('proTg').innerHTML=dot(s.telegramStarted?'on':s.telegramError?'warn':'')+esc(s.telegramStarted?('@'+(s.telegramUsername||'bot')):(s.telegramError?'ERR':'OFF'));
      if($('proWa')) $('proWa').innerHTML=dot(s.whatsappConnected?'on':s.whatsappSocketReady?'warn':'')+esc(s.whatsappConnected?'connected':s.whatsappMode||'—');
      if($('proGit')) $('proGit').innerHTML=dot(s.fullAgents?'on':'')+esc((s.provider||'')+' · '+(s.model||''));
      if($('opsTelegram')) $('opsTelegram').innerHTML=ring(s.telegramStarted)+esc(s.telegramStarted?('@'+(s.telegramUsername||'bot')):(s.telegramError?'ERROR':'OFF'));
      if($('opsWhatsApp')) $('opsWhatsApp').innerHTML=ring(s.whatsappConnected,s.whatsappSocketReady)+esc(s.whatsappConnected?'connected':s.whatsappMode||'—');
      if($('opsWrite')) $('opsWrite').innerHTML=ring(s.webSelfImproveWrite)+esc(s.webSelfImproveWrite?'ON':'OFF');
    }catch{ if($('proTg')) $('proTg').innerHTML=dot('warn')+'API?'; if($('opsTelegram')) $('opsTelegram').innerHTML=ring(false,true)+'API?'; }
    try{const o=await api('/api/openclaw/status'); if($('proOc')) $('proOc').innerHTML=dot(o.present?'on':'')+esc(o.commit||'not synced'); if($('opsOpenClaw')) $('opsOpenClaw').innerHTML=ring(o.present)+esc(o.commit||'not synced');}catch{}
  }
  function boot(){document.body.classList.add('pro-ui-ready'); badge(); hud(); ops(); command(); chips(); footer(); refresh(); setInterval(refresh,15000);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,450)):setTimeout(boot,450);
})();
