(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const commands=[
    ['🧑‍⚕️ Doctor','/api/doctor','hot'],
    ['🩺 Diagnostika','/api/diagnostics',''],
    ['📜 Logs','/api/logs',''],
    ['⬇️ Pull','/api/git/pull-safe',''],
    ['🧪 Push','/api/git/test-push',''],
    ['✨ Improve','/api/web/improve-safe','hot']
  ];
  const apiBase=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const token=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  function headers(){const h={}; if(token())h['X-Agent-Token']=token(); return h;}
  function toast(msg,type){ if(window.toast)window.toast(msg,type); else console.log(msg); }
  function addSystem(title,body,bad){
    const box=$('messages'); if(!box){alert(title+'\n\n'+body);return;}
    const wrap=document.createElement('div'); wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div'); msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,9000))+'</code></pre>';
    const btn=document.createElement('button'); btn.type='button'; btn.className='copy-fab'; btn.textContent='copy';
    btn.onclick=async()=>{try{await navigator.clipboard.writeText(String(body||''));toast('Zkopírováno','ok')}catch{toast('Kopírování selhalo','err')}};
    msg.appendChild(btn); wrap.appendChild(msg); box.appendChild(wrap); box.scrollTop=box.scrollHeight;
  }
  async function callEndpoint(label,path){
    addSystem(label+' ⏳','Spouštím servisní akci…',false);
    try{
      const r=await fetch(apiBase()+path,{method:'POST',headers:headers()});
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.ok===false)throw new Error(data.error||JSON.stringify(data,null,2));
      addSystem(label+' ✅',data.reply||data.text||JSON.stringify(data,null,2),false);
      refreshHealth();
    }catch(e){addSystem(label+' ❌',e.message||String(e),true);}
  }
  function makeRibbon(){
    const top=document.querySelector('.top'); if(!top||$('cockpitRibbon'))return;
    const r=document.createElement('div'); r.id='cockpitRibbon'; r.className='cockpit-ribbon';
    commands.forEach(([label,path,cls])=>{const b=document.createElement('button');b.type='button';b.className=cls||'';b.textContent=label;b.onclick=()=>callEndpoint(label,path);r.appendChild(b);});
    top.appendChild(r);
  }
  function makeHealth(){
    const top=document.querySelector('.top'); if(!top||$('quickHealth'))return;
    const h=document.createElement('div'); h.id='quickHealth'; h.className='quick-health';
    h.innerHTML='<div class="qh-card" id="qhAi"><small>AI</small><b>—</b></div><div class="qh-card" id="qhGit"><small>Git</small><b>—</b></div><div class="qh-card" id="qhWa"><small>WhatsApp</small><b>—</b></div>';
    top.appendChild(h);
  }
  function setCard(id,state,text){const el=$(id); if(!el)return; el.classList.remove('ok','warn','bad'); el.classList.add(state); const b=el.querySelector('b'); if(b)b.textContent=text;}
  async function refreshHealth(){
    try{
      const r=await fetch(apiBase()+'/api/status',{headers:headers()});
      const s=await r.json();
      setCard('qhAi',s.aiAvailable?'ok':'bad',s.aiAvailable?'ON':'OFF');
      setCard('qhGit',s.gitWorkdir?'ok':'warn',s.gitWorkdir?'OK':'—');
      const wa=s.whatsappMode||'off';
      setCard('qhWa',s.whatsappConnected?'ok':(wa==='socket-ready'||wa==='connected'?'warn':'bad'),s.whatsappConnected?'ON':wa);
    }catch{setCard('qhAi','bad','ERR');setCard('qhGit','bad','ERR');setCard('qhWa','bad','ERR');}
  }
  function enhanceTextarea(){
    const ta=$('textInput'); if(!ta||ta.dataset.autoGrow)return; ta.dataset.autoGrow='1';
    const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(150,ta.scrollHeight)+'px';};
    ta.addEventListener('input',grow); grow();
  }
  function addCopyToExisting(){
    document.querySelectorAll('.msg pre').forEach(pre=>{
      const msg=pre.closest('.msg'); if(!msg||msg.querySelector('.copy-fab'))return;
      const body=pre.textContent||'';
      const btn=document.createElement('button');btn.type='button';btn.className='copy-fab';btn.textContent='copy';
      btn.onclick=async()=>{try{await navigator.clipboard.writeText(body);toast('Zkopírováno','ok')}catch{toast('Kopírování selhalo','err')}};
      msg.appendChild(btn);
    });
  }
  function groupServiceActions(){
    document.querySelectorAll('#desktopActions,#bigActions').forEach(grid=>{
      if(!grid||grid.dataset.grouped)return;
      grid.dataset.grouped='1';
      const first=document.createElement('div'); first.className='service-group-title'; first.textContent='Health & logs';
      grid.prepend(first);
    });
  }
  function boot(){makeRibbon();makeHealth();enhanceTextarea();refreshHealth();groupServiceActions();setInterval(refreshHealth,30000);setInterval(addCopyToExisting,1600);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,600)):setTimeout(boot,600);
})();
