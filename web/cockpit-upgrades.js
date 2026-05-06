(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const commands=[
    {label:'🔗 WhatsApp Pair',wa:'pair',hot:true,desc:'Vygeneruje párovací kód pro WhatsApp'},
    {label:'🧼 Fresh WhatsApp Pair',wa:'fresh',hot:true,desc:'Resetne session a vyžádá nový kód'},
    {label:'♻️ WhatsApp Reset',wa:'reset',desc:'Smaže aktuální WhatsApp session'},
    {label:'🧑‍⚕️ Doctor',path:'/api/doctor',hot:true,desc:'Jedním klikem zkontroluje celý systém'},
    {label:'🩺 Diagnostika',path:'/api/diagnostics',desc:'Detailní checklist systému'},
    {label:'📜 Runtime Logs',path:'/api/logs',desc:'Poslední runtime logy bez Railway'},
    {label:'📡 Status',chat:'/status',desc:'Pošle /status do chatu'}
  ];
  const histKey='martybotServiceHistory';
  const apiBase=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const token=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  function headers(json){const h={}; if(json)h['Content-Type']='application/json'; if(token())h['X-Agent-Token']=token(); return h;}
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function toast(msg,type){ if(window.toast)window.toast(msg,type); else console.log(msg); }
  function readHistory(){try{return JSON.parse(localStorage.getItem(histKey)||'[]')}catch{return []}}
  function writeHistory(item){const list=[{ts:new Date().toISOString(),...item},...readHistory()].slice(0,24);localStorage.setItem(histKey,JSON.stringify(list));renderHistory();}
  async function api(path,body){const r=await fetch(apiBase()+path,{method:'POST',headers:headers(!!body),body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={reply:text}} if(!r.ok||data.ok===false)throw new Error(data.error||data.reply||text||('HTTP '+r.status));return data;}
  function addSystem(title,body,bad){
    const box=$('messages'); if(!box){alert(title+'\n\n'+body);return;}
    const wrap=document.createElement('div'); wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div'); msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,9000))+'</code></pre>';
    const btn=document.createElement('button'); btn.type='button'; btn.className='copy-fab'; btn.textContent='copy';
    btn.onclick=async()=>{try{await navigator.clipboard.writeText(String(body||''));toast('Zkopírováno','ok')}catch{toast('Kopírování selhalo','err')}};
    msg.appendChild(btn); wrap.appendChild(msg); box.appendChild(wrap); box.scrollTop=box.scrollHeight;
  }
  function normalizePair(data){
    const code=String(data.code||data.raw||'').trim();
    const raw=String(data.raw||code).replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
    const pretty=code||((raw.match(/.{1,4}/g)||[]).join('-'));
    const phone=data.phoneNumber||data.status?.whatsappPhoneLast4||'';
    return {raw,pretty,phone,already:!!data.alreadyRegistered};
  }
  function renderWaCode(pair){
    closeWaWizard();
    makeWaWizard();
    const modal=$('waWizard'); modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
    const code=$('waCode'), raw=$('waRaw'), phone=$('waPhone'), countdown=$('waCountdown');
    if(code)code.textContent=pair.already?'WhatsApp už je spárovaný ✅':(pair.pretty||'—');
    if(raw)raw.textContent=pair.raw||'—';
    if(phone)phone.textContent=pair.phone?'Telefon: '+pair.phone:'Telefon podle Railway proměnné';
    if(countdown)startCountdown(60);
    addSystem('WhatsApp Pair ✅',pair.already?'WhatsApp už je spárovaný.':waInstructions(pair),false);
  }
  function waInstructions(pair){return [
    'Telefon: '+(pair.phone||'—'),
    'Kód bez pomlčky: '+(pair.raw||'—'),
    'Kód s pomlčkou: '+(pair.pretty||'—'),
    '',
    'Postup:',
    '1. Otevři WhatsApp v telefonu.',
    '2. Nastavení → Propojená zařízení.',
    '3. Propojit zařízení.',
    '4. Zvol Propojit pomocí telefonního čísla.',
    '5. Zadej kód ideálně bez pomlček.',
    '',
    'Když kód nefunguje, klikni Fresh WhatsApp Pair.'
  ].join('\n');}
  let countdownTimer=null;
  function startCountdown(sec){clearInterval(countdownTimer);const el=$('waCountdown');let n=sec;const tick=()=>{if(el)el.textContent=n>0?'Kód je čerstvý cca '+n+' s':'Kód může být prošlý · dej Fresh Pair';n--;if(n<0)clearInterval(countdownTimer)};tick();countdownTimer=setInterval(tick,1000);}
  async function runWhatsApp(action){
    closePalette(); makeWaWizard(); openWaWizard(); setWaBusy(true);
    const started=Date.now();
    try{
      if(action==='reset'){
        const data=await api('/api/whatsapp/reset');
        const body='WhatsApp session reset ✅\nPočkej pár sekund a potom klikni Fresh WhatsApp Pair.';
        addSystem('WhatsApp Reset ✅',body,false); writeHistory({label:'WhatsApp Reset',path:'/api/whatsapp/reset',ok:true,ms:Date.now()-started,body}); await refreshHealth(); return;
      }
      if(action==='fresh'){
        setWaStep('Resetuji starou session…');
        await api('/api/whatsapp/reset');
        setWaStep('Čekám na nový WhatsApp socket…');
        await wait(15000);
      }
      setWaStep('Žádám nový párovací kód…');
      const data=await api('/api/whatsapp/pair');
      const pair=normalizePair(data);
      renderWaCode(pair); writeHistory({label:action==='fresh'?'Fresh WhatsApp Pair':'WhatsApp Pair',path:'/api/whatsapp/pair',ok:true,ms:Date.now()-started,body:waInstructions(pair)});
      await refreshHealth();
    }catch(e){
      const body=(e.message||String(e))+'\n\nTip: pokud socket není připravený, počkej 10–15 sekund a dej Fresh WhatsApp Pair.';
      setWaStep('Chyba při párování.'); addSystem('WhatsApp Pair ❌',body,true); writeHistory({label:'WhatsApp Pair',path:'/api/whatsapp/pair',ok:false,ms:Date.now()-started,body});
    }finally{setWaBusy(false);}
  }
  async function callEndpoint(cmd){
    closePalette();
    if(cmd.wa)return runWhatsApp(cmd.wa);
    if(cmd.chat){ if(window.martybotSend)window.martybotSend(cmd.chat); return; }
    const label=cmd.label, path=cmd.path; addSystem(label+' ⏳','Spouštím servisní akci…',false); const started=Date.now();
    try{const data=await api(path); const body=data.reply||data.text||JSON.stringify(data,null,2); addSystem(label+' ✅',body,false); writeHistory({label,path,ok:true,ms:Date.now()-started,body:String(body).slice(0,700)}); refreshHealth();}
    catch(e){const body=e.message||String(e); addSystem(label+' ❌',body,true); writeHistory({label,path,ok:false,ms:Date.now()-started,body:String(body).slice(0,700)});}
  }
  function makeRibbon(){
    const top=document.querySelector('.top'); if(!top||$('cockpitRibbon'))return;
    const r=document.createElement('div'); r.id='cockpitRibbon'; r.className='cockpit-ribbon';
    commands.slice(0,6).forEach(cmd=>{const b=document.createElement('button');b.type='button';b.className=(cmd.hot?'hot ':'')+(cmd.wa?'wa-hot':'');b.textContent=cmd.label;b.onclick=()=>callEndpoint(cmd);r.appendChild(b);});
    const more=document.createElement('button');more.type='button';more.textContent='⌘ Palette';more.onclick=openPalette;r.appendChild(more);top.appendChild(r);
  }
  function makeHealth(){const top=document.querySelector('.top'); if(!top||$('quickHealth'))return;const h=document.createElement('div');h.id='quickHealth';h.className='quick-health';h.innerHTML='<div class="qh-card" id="qhAi"><small>AI</small><b>—</b></div><div class="qh-card" id="qhGit"><small>Git</small><b>—</b></div><div class="qh-card" id="qhWa"><small>WhatsApp</small><b>—</b></div>';top.appendChild(h);}
  function setCard(id,state,text){const el=$(id); if(!el)return; el.classList.remove('ok','warn','bad'); el.classList.add(state); const b=el.querySelector('b'); if(b)b.textContent=text;}
  async function refreshHealth(){try{const r=await fetch(apiBase()+'/api/status',{headers:headers()});const s=await r.json();setCard('qhAi',s.aiAvailable?'ok':'bad',s.aiAvailable?'ON':'OFF');setCard('qhGit',s.gitWorkdir?'ok':'warn',s.gitWorkdir?'OK':'—');const wa=s.whatsappMode||'off';setCard('qhWa',s.whatsappConnected?'ok':(wa==='socket-ready'||wa==='connected'?'warn':'bad'),s.whatsappConnected?'ON':wa);updateWaStatus(s);}catch{setCard('qhAi','bad','ERR');setCard('qhGit','bad','ERR');setCard('qhWa','bad','ERR');}}
  function updateWaStatus(s){const el=$('waStatusText');if(!el)return;el.textContent=s.whatsappConnected?'Připojeno ✅':'Stav: '+(s.whatsappMode||'neznámý');}
  function enhanceTextarea(){const ta=$('textInput'); if(!ta||ta.dataset.autoGrow)return;ta.dataset.autoGrow='1';const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(150,ta.scrollHeight)+'px';};ta.addEventListener('input',grow);grow();}
  function addCopyToExisting(){document.querySelectorAll('.msg pre').forEach(pre=>{const msg=pre.closest('.msg');if(!msg||msg.querySelector('.copy-fab'))return;const body=pre.textContent||'';const btn=document.createElement('button');btn.type='button';btn.className='copy-fab';btn.textContent='copy';btn.onclick=async()=>{try{await navigator.clipboard.writeText(body);toast('Zkopírováno','ok')}catch{toast('Kopírování selhalo','err')}};msg.appendChild(btn);});}
  function groupServiceActions(){document.querySelectorAll('#desktopActions,#bigActions').forEach(grid=>{if(!grid||grid.dataset.grouped)return;grid.dataset.grouped='1';const first=document.createElement('div');first.className='service-group-title';first.textContent='WhatsApp pairing';grid.prepend(first);});}
  function makePalette(){
    if($('cockpitPalette'))return;const wrap=document.createElement('div');wrap.id='cockpitPalette';wrap.className='cockpit-palette';wrap.setAttribute('aria-hidden','true');
    wrap.innerHTML='<div class="cp-backdrop"></div><div class="cp-card" role="dialog" aria-label="Command palette"><div class="cp-head"><strong>⚡ Martybot Palette</strong><button type="button" id="cpClose">×</button></div><div class="cp-search"><input id="cpSearch" placeholder="Hledej akci… whatsapp, pair, fresh, reset" autocomplete="off"></div><div class="cp-list" id="cpList"></div><div class="cp-foot">Tip: Ctrl/Cmd + K · Esc zavře</div></div>';
    document.body.appendChild(wrap);wrap.querySelector('.cp-backdrop').onclick=closePalette;$('cpClose').onclick=closePalette;$('cpSearch').addEventListener('input',renderPalette);renderPalette();}
  function renderPalette(){const list=$('cpList');if(!list)return;const q=String($('cpSearch')?.value||'').toLowerCase();const filtered=commands.filter(cmd=>(cmd.label+' '+cmd.desc+' '+(cmd.path||cmd.chat||cmd.wa||'')).toLowerCase().includes(q));list.innerHTML=filtered.map((cmd,i)=>'<button type="button" class="cp-item '+(cmd.hot?'hot':'')+'" data-i="'+i+'"><span>'+esc(cmd.label)+'</span><small>'+esc(cmd.desc||cmd.path||cmd.chat||cmd.wa)+'</small></button>').join('')||'<div class="cp-empty">Nic jsem nenašel.</div>';[...list.querySelectorAll('.cp-item')].forEach((b,idx)=>{const cmd=filtered[idx];b.onclick=()=>cmd&&callEndpoint(cmd);});}
  function openPalette(){makePalette();const p=$('cockpitPalette');p.classList.add('open');p.setAttribute('aria-hidden','false');setTimeout(()=>$('cpSearch')?.focus(),40);}function closePalette(){const p=$('cockpitPalette');if(!p)return;p.classList.remove('open');p.setAttribute('aria-hidden','true');}
  function makeFab(){if($('cockpitFab'))return;const b=document.createElement('button');b.id='cockpitFab';b.type='button';b.className='cockpit-fab wa-fab';b.textContent='🔗';b.title='WhatsApp Pair';b.onclick=()=>runWhatsApp('pair');document.body.appendChild(b);}
  function makeWaWizard(){
    if($('waWizard'))return;const w=document.createElement('div');w.id='waWizard';w.className='wa-wizard';w.setAttribute('aria-hidden','true');
    w.innerHTML='<div class="wa-backdrop"></div><div class="wa-card" role="dialog" aria-label="WhatsApp pairing"><div class="wa-head"><div><strong>🔗 WhatsApp Pairing</strong><small id="waStatusText">Kontroluji stav…</small></div><button id="waClose" type="button">×</button></div><div class="wa-codebox"><small id="waPhone">Telefon podle Railway proměnné</small><div id="waCode" class="wa-code">—</div><div class="wa-raw"><span>Kód bez pomlček:</span><b id="waRaw">—</b></div><small id="waCountdown">Kód se zobrazí po vygenerování</small></div><div class="wa-actions"><button id="waPairBtn" class="primary-btn" type="button">Vygenerovat kód</button><button id="waFreshBtn" class="ghost-btn" type="button">Fresh Pair</button><button id="waResetBtn" class="ghost-btn" type="button">Reset session</button><button id="waCopyBtn" class="ghost-btn" type="button">Kopírovat kód</button></div><ol class="wa-steps"><li>Otevři WhatsApp v telefonu.</li><li>Nastavení → Propojená zařízení.</li><li>Propojit zařízení.</li><li>Propojit pomocí telefonního čísla.</li><li>Zadej kód bez pomlček.</li></ol><p class="wa-help" id="waStep">Když kód nejde, dej Fresh Pair. Ten nejdřív resetne session a pak vyžádá nový kód.</p></div>';
    document.body.appendChild(w);w.querySelector('.wa-backdrop').onclick=closeWaWizard;$('waClose').onclick=closeWaWizard;$('waPairBtn').onclick=()=>runWhatsApp('pair');$('waFreshBtn').onclick=()=>runWhatsApp('fresh');$('waResetBtn').onclick=()=>runWhatsApp('reset');$('waCopyBtn').onclick=async()=>{const raw=$('waRaw')?.textContent||'';try{await navigator.clipboard.writeText(raw);toast('WhatsApp kód zkopírován','ok')}catch{toast('Kopírování selhalo','err')}};refreshHealth();}
  function openWaWizard(){makeWaWizard();const w=$('waWizard');w.classList.add('open');w.setAttribute('aria-hidden','false');}
  function closeWaWizard(){const w=$('waWizard');if(!w)return;w.classList.remove('open');w.setAttribute('aria-hidden','true');}
  function setWaBusy(on){['waPairBtn','waFreshBtn','waResetBtn','waCopyBtn'].forEach(id=>{const b=$(id);if(b)b.disabled=!!on;});}
  function setWaStep(text){const el=$('waStep');if(el)el.textContent=text;}
  function renderHistory(){const side=document.querySelector('.sidebar');if(!side)return;let block=$('serviceHistoryBlock');if(!block){block=document.createElement('div');block.className='sblock service-history';block.id='serviceHistoryBlock';side.prepend(block);}const list=readHistory().slice(0,5);block.innerHTML='<h2>WhatsApp historie</h2>'+(list.length?list.map(x=>'<button type="button" class="hist-row '+(x.ok?'ok':'bad')+'"><b>'+(x.ok?'✅':'❌')+' '+esc(x.label)+'</b><small>'+new Date(x.ts).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})+' · '+Math.round((x.ms||0)/100)/10+'s</small><em>'+esc(x.body||'').slice(0,120)+'</em></button>').join(''):'<p class="hint">Zatím žádné párování.</p>');[...block.querySelectorAll('.hist-row')].forEach((row,i)=>{const item=list[i];row.onclick=()=>addSystem(item.label+' · historie',item.body,!item.ok);});}
  function keyboardShortcuts(){document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();openPalette();}if((e.metaKey||e.ctrlKey)&&String(e.key).toLowerCase()==='w'){e.preventDefault();openWaWizard();}if(e.key==='Escape'){closePalette();closeWaWizard();}});}
  function boot(){makeRibbon();makeHealth();makePalette();makeFab();makeWaWizard();enhanceTextarea();refreshHealth();groupServiceActions();renderHistory();keyboardShortcuts();setInterval(refreshHealth,30000);setInterval(addCopyToExisting,1600);}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,600)):setTimeout(boot,600);
})();
