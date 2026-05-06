(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const base=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const token=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  const hdr=()=>{const h={};if(token())h['X-Agent-Token']=token();return h;};
  function ring(on,warn){return '<span class="pro-ring '+(on?'on':warn?'warn':'')+'"></span>';}
  function addBadge(){const h=document.querySelector('.brand-text h1');if(h&&!h.querySelector('.pro-badge'))h.insertAdjacentHTML('beforeend','<span class="pro-badge">PRO</span>');}
  function addOps(){if($('proOps'))return;const stats=document.querySelector('.stats');if(!stats)return;const ops=document.createElement('section');ops.id='proOps';ops.className='pro-ops';ops.innerHTML='<div class="pro-ops-card"><small>Telegram bot</small><strong id="opsTelegram">—</strong></div><div class="pro-ops-card"><small>WhatsApp socket</small><strong id="opsWhatsApp">—</strong></div><div class="pro-ops-card"><small>OpenClaw upstream</small><strong id="opsOpenClaw">—</strong></div><div class="pro-ops-card"><small>Write mode</small><strong id="opsWrite">—</strong></div>';stats.insertAdjacentElement('afterend',ops);}
  function addCommandChips(){if($('proChips'))return;const sugg=$('suggestions');if(!sugg)return;const row=document.createElement('div');row.id='proChips';row.className='pro-command-row';[['⚡ Status','/status'],['🧠 Reload','/agent reload'],['🧩 Git','/git'],['🔗 WA Pair','/wa pair'],['✨ Improve','/web improve'],['🦾 OpenClaw','OpenClaw Pull']].forEach(([label,cmd])=>{const b=document.createElement('button');b.className='pro-mini';b.type='button';b.textContent=label;b.onclick=()=>{if(cmd==='OpenClaw Pull'){document.querySelector('[data-service-action="openclaw-pull"]')?.click();}else if(window.martybotSend)window.martybotSend(cmd);};row.appendChild(b);});sugg.insertAdjacentElement('beforebegin',row);}
  function addFooter(){if(document.querySelector('.marty-footer'))return;const app=document.querySelector('.app');if(app)app.insertAdjacentHTML('beforeend','<div class="marty-footer">Martybot <b>Control Center</b> · modular web · Telegram · WhatsApp · Git · OpenClaw</div>');}
  async function refresh(){try{const r=await fetch(base()+'/api/status',{headers:hdr()});const s=await r.json();if($('opsTelegram'))$('opsTelegram').innerHTML=ring(s.telegramStarted,false)+esc(s.telegramStarted?('@'+(s.telegramUsername||'bot')):(s.telegramError?'ERROR':'OFF'));if($('opsWhatsApp'))$('opsWhatsApp').innerHTML=ring(s.whatsappConnected,s.whatsappSocketReady)+esc(s.whatsappConnected?'connected':s.whatsappMode||'—');if($('opsWrite'))$('opsWrite').innerHTML=ring(s.webSelfImproveWrite,false)+esc(s.webSelfImproveWrite?'ON':'OFF');}catch{if($('opsTelegram'))$('opsTelegram').innerHTML=ring(false,true)+'API?';}
    try{const r=await fetch(base()+'/api/openclaw/status',{headers:hdr()});const o=await r.json();if($('opsOpenClaw'))$('opsOpenClaw').innerHTML=ring(o.present,false)+esc(o.commit||'not synced');}catch{}
  }
  function boot(){addBadge();addOps();addCommandChips();addFooter();refresh();setInterval(refresh,15000);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,450)):setTimeout(boot,450);
})();
