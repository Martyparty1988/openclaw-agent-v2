(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const base=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const token=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  const hdr=()=>{const h={}; if(token())h['X-Agent-Token']=token(); return h;};
  function dot(on,warn){return '<span class="pro-dot '+(on?'on':warn?'warn':'')+'"></span>';}
  function addHud(){if($('proHud'))return;const stats=document.querySelector('.stats');if(!stats)return;const hud=document.createElement('div');hud.id='proHud';hud.className='pro-hud';hud.innerHTML='<div class="pro-hud-card"><small>Telegram</small><b id="proTg">—</b></div><div class="pro-hud-card"><small>WhatsApp</small><b id="proWa">—</b></div><div class="pro-hud-card"><small>OpenClaw</small><b id="proOc">—</b></div><div class="pro-hud-card"><small>Git / AI</small><b id="proGit">—</b></div>';stats.insertAdjacentElement('afterend',hud);}
  function addCommand(){if($('proCommand'))return;const box=document.createElement('div');box.id='proCommand';box.className='pro-command';box.innerHTML='<input id="proCmdInput" placeholder="Rychlý příkaz: /status, /git, /wa pair…"><button id="proCmdSend">Run</button>';document.body.appendChild(box);$('proCmdSend').onclick=sendCmd;$('proCmdInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendCmd();});}
  function sendCmd(){const inp=$('proCmdInput');const text=String(inp.value||'').trim();if(!text)return;inp.value='';if(window.martybotSend)window.martybotSend(text);}
  async function refresh(){try{const r=await fetch(base()+'/api/status',{headers:hdr()});const s=await r.json();if($('proTg'))$('proTg').innerHTML=dot(s.telegramStarted,false)+esc(s.telegramStarted?'ON':s.telegramError?'ERR':'OFF');if($('proWa'))$('proWa').innerHTML=dot(s.whatsappConnected,s.whatsappSocketReady)+esc(s.whatsappConnected?'connected':s.whatsappMode||'—');if($('proGit'))$('proGit').innerHTML=dot(s.fullAgents,false)+esc((s.provider||'')+' · '+(s.model||''));}catch{if($('proTg'))$('proTg').innerHTML=dot(false,true)+'API?';}
    try{const r=await fetch(base()+'/api/openclaw/status',{headers:hdr()});const o=await r.json();if($('proOc'))$('proOc').innerHTML=dot(o.present,false)+esc(o.commit||'not synced');}catch{}
  }
  function boot(){document.body.classList.add('pro-ui-ready');addHud();addCommand();refresh();setInterval(refresh,15000);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,400)):setTimeout(boot,400);
})();
