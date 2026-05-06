(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const commands=[
    {label:'🧑‍⚕️ Doctor',path:'/api/doctor',hot:true,desc:'Jedním klikem zkontroluje celý systém'},
    {label:'🩺 Diagnostika',path:'/api/diagnostics',desc:'Detailní checklist systému'},
    {label:'📜 Runtime Logs',path:'/api/logs',desc:'Poslední runtime logy bez Railway'},
    {label:'⬇️ Git Pull',path:'/api/git/pull-safe',desc:'Bezpečný pull bez přepsání změn'},
    {label:'🧪 Git Test Push',path:'/api/git/test-push',desc:'Ověří GitHub zápis'},
    {label:'✨ Web Improve',path:'/api/web/improve-safe',hot:true,desc:'Bezpečně vylepší web'},
    {label:'📡 Status',chat:'/status',desc:'Pošle /status do chatu'},
    {label:'🧩 Git status',chat:'/git',desc:'Pošle /git do chatu'},
    {label:'❓ Help',chat:'/help',desc:'Zobrazí nápovědu'}
  ];
  const histKey='martybotServiceHistory';
  const apiBase=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const token=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  function headers(){const h={}; if(token())h['X-Agent-Token']=token(); return h;}
  function toast(msg,type){ if(window.toast)window.toast(msg,type); else console.log(msg); }
  function readHistory(){try{return JSON.parse(localStorage.getItem(histKey)||'[]')}catch{return []}}
  function writeHistory(item){
    const list=[{ts:new Date().toISOString(),...item},...readHistory()].slice(0,24);
    localStorage.setItem(histKey,JSON.stringify(list));
    renderHistory();
  }
  function addSystem(title,body,bad){
    const box=$('messages'); if(!box){alert(title+'\n\n'+body);return;}
    const wrap=document.createElement('div'); wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div'); msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,9000))+'</code></pre>';
    const btn=document.createElement('button'); btn.type='button'; btn.className='copy-fab'; btn.textContent='copy';
    btn.onclick=async()=>{try{await navigator.clipboard.writeText(String(body||''));toast('Zkopírováno','ok')}catch{toast('Kopírování selhalo','err')}};
    msg.appendChild(btn); wrap.appendChild(msg); box.appendChild(wrap); box.scrollTop=box.scrollHeight;
  }
  async function callEndpoint(cmd){
    closePalette();
    if(cmd.chat){ if(window.martybotSend)window.martybotSend(cmd.chat); return; }
    const label=cmd.label, path=cmd.path;
    addSystem(label+' ⏳','Spouštím servisní akci…',false);
    const started=Date.now();
    try{
      const r=await fetch(apiBase()+path,{method:'POST',headers:headers()});
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.ok===false)throw new Error(data.error||JSON.stringify(data,null,2));
      const body=data.reply||data.text||JSON.stringify(data,null,2);
      addSystem(label+' ✅',body,false);
      writeHistory({label,path,ok:true,ms:Date.now()-started,body:String(body).slice(0,700)});
      refreshHealth();
    }catch(e){
      const body=e.message||String(e);
      addSystem(label+' ❌',body,true);
      writeHistory({label,path,ok:false,ms:Date.now()-started,body:String(body).slice(0,700)});
    }
  }
  function makeRibbon(){
    const top=document.querySelector('.top'); if(!top||$('cockpitRibbon'))return;
    const r=document.createElement('div'); r.id='cockpitRibbon'; r.className='cockpit-ribbon';
    commands.slice(0,6).forEach(cmd=>{const b=document.createElement('button');b.type='button';b.className=cmd.hot?'hot':'';b.textContent=cmd.label;b.onclick=()=>callEndpoint(cmd);r.appendChild(b);});
    const more=document.createElement('button');more.type='button';more.textContent='⌘ Palette';more.onclick=openPalette;r.appendChild(more);
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
  function makePalette(){
    if($('cockpitPalette'))return;
    const wrap=document.createElement('div'); wrap.id='cockpitPalette'; wrap.className='cockpit-palette'; wrap.setAttribute('aria-hidden','true');
    wrap.innerHTML='<div class="cp-backdrop"></div><div class="cp-card" role="dialog" aria-label="Command palette"><div class="cp-head"><strong>⚡ Martybot Palette</strong><button type="button" id="cpClose">×</button></div><div class="cp-search"><input id="cpSearch" placeholder="Hledej akci… doctor, git, logs, improve" autocomplete="off"></div><div class="cp-list" id="cpList"></div><div class="cp-foot">Tip: Ctrl/Cmd + K · Esc zavře</div></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('.cp-backdrop').onclick=closePalette;
    $('cpClose').onclick=closePalette;
    $('cpSearch').addEventListener('input',renderPalette);
    renderPalette();
  }
  function renderPalette(){
    const list=$('cpList'); if(!list)return;
    const q=String($('cpSearch')?.value||'').toLowerCase();
    const filtered=commands.filter(cmd=>(cmd.label+' '+cmd.desc+' '+(cmd.path||cmd.chat||'')).toLowerCase().includes(q));
    list.innerHTML=filtered.map((cmd,i)=>'<button type="button" class="cp-item '+(cmd.hot?'hot':'')+'" data-i="'+i+'"><span>'+esc(cmd.label)+'</span><small>'+esc(cmd.desc||cmd.path||cmd.chat)+'</small></button>').join('')||'<div class="cp-empty">Nic jsem nenašel.</div>';
    [...list.querySelectorAll('.cp-item')].forEach((b,idx)=>{const cmd=filtered[idx];b.onclick=()=>cmd&&callEndpoint(cmd);});
  }
  function openPalette(){makePalette();const p=$('cockpitPalette');p.classList.add('open');p.setAttribute('aria-hidden','false');setTimeout(()=>$('cpSearch')?.focus(),40);}
  function closePalette(){const p=$('cockpitPalette');if(!p)return;p.classList.remove('open');p.setAttribute('aria-hidden','true');}
  function makeFab(){
    if($('cockpitFab'))return;
    const b=document.createElement('button'); b.id='cockpitFab'; b.type='button'; b.className='cockpit-fab'; b.textContent='⚡'; b.title='Martybot Palette'; b.onclick=openPalette;
    document.body.appendChild(b);
  }
  function renderHistory(){
    const side=document.querySelector('.sidebar'); if(!side)return;
    let block=$('serviceHistoryBlock');
    if(!block){block=document.createElement('div');block.className='sblock service-history';block.id='serviceHistoryBlock';side.prepend(block);}
    const list=readHistory().slice(0,5);
    block.innerHTML='<h2>Servisní historie</h2>'+(list.length?list.map(x=>'<button type="button" class="hist-row '+(x.ok?'ok':'bad')+'"><b>'+(x.ok?'✅':'❌')+' '+esc(x.label)+'</b><small>'+new Date(x.ts).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})+' · '+Math.round((x.ms||0)/100)/10+'s</small><em>'+esc(x.body||'').slice(0,120)+'</em></button>').join(''):'<p class="hint">Zatím žádná servisní akce.</p>');
    [...block.querySelectorAll('.hist-row')].forEach((row,i)=>{const item=list[i];row.onclick=()=>addSystem(item.label+' · historie',item.body,!item.ok);});
  }
  function keyboardShortcuts(){
    document.addEventListener('keydown',e=>{
      if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();openPalette();}
      if(e.key==='Escape')closePalette();
    });
  }
  function boot(){makeRibbon();makeHealth();makePalette();makeFab();enhanceTextarea();refreshHealth();groupServiceActions();renderHistory();keyboardShortcuts();setInterval(refreshHealth,30000);setInterval(addCopyToExisting,1600);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,600)):setTimeout(boot,600);
})();
