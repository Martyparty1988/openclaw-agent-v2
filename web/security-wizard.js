(function(){
  const TOKEN_KEY='martybotWebToken';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const getToken=()=>String(localStorage.getItem(TOKEN_KEY)||'').trim();
  const apiBase=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  let step=0;
  const steps=[
    {title:'1. Vygeneruj token',icon:'🎲'},
    {title:'2. Vlož do Railway',icon:'🚂'},
    {title:'3. Redeploy',icon:'🚀'},
    {title:'4. Ulož ve webu',icon:'💾'},
    {title:'5. Otestuj',icon:'✅'}
  ];
  function toast(msg,type){if(window.toast)window.toast(msg,type);else console.log(type||'log',msg)}
  async function copyText(text,label){try{await navigator.clipboard.writeText(String(text||''));toast((label||'Text')+' zkopírován','ok');return true;}catch{toast('Kopírování selhalo','err');return false;}}
  function generateToken(){
    if(window.martybotSecurity?.generateToken) return window.martybotSecurity.generateToken();
    const bytes=new Uint8Array(32); if(crypto&&crypto.getRandomValues)crypto.getRandomValues(bytes); else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
    const raw=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return 'martybot_'+raw.slice(0,16)+'_'+raw.slice(16,40)+'_'+raw.slice(40);
  }
  function railwayBlock(token){
    if(window.martybotSecurityExtras?.railwayBlock)return window.martybotSecurityExtras.railwayBlock(token);
    return 'WEB_API_TOKEN='+String(token||getToken()).trim();
  }
  function setToken(token){
    token=String(token||'').trim();
    if(!token)return;
    localStorage.setItem(TOKEN_KEY,token);
    document.querySelectorAll('.sec-token-input').forEach(i=>{i.value=token});
  }
  async function testToken(){
    if(window.martybotSecurity?.testToken)return window.martybotSecurity.testToken();
    const r=await fetch(apiBase()+'/api/doctor',{method:'POST',headers:{'X-Agent-Token':getToken()}});
    return {ok:r.ok,message:r.ok?'OK':'HTTP '+r.status};
  }
  function ensure(){
    if($('securityWizard'))return;
    const root=document.createElement('div');root.id='securityWizard';root.className='security-wizard';root.setAttribute('aria-hidden','true');
    root.innerHTML='<div class="sw-backdrop"></div><div class="sw-card" role="dialog" aria-label="Security setup wizard"><div class="sw-head"><div><strong>🔐 Security Setup Wizard</strong><small>Zamkni Martybot API za 2 minuty</small></div><button type="button" id="swClose">×</button></div><div class="sw-progress" id="swProgress"></div><div class="sw-body" id="swBody"></div><div class="sw-nav"><button type="button" class="ghost-btn" id="swPrev">Zpět</button><button type="button" class="primary-btn" id="swNext">Další</button></div></div>';
    document.body.appendChild(root);
    root.querySelector('.sw-backdrop').onclick=close;
    $('swClose').onclick=close;
    $('swPrev').onclick=()=>{step=Math.max(0,step-1);render()};
    $('swNext').onclick=()=>{step=Math.min(steps.length-1,step+1);render()};
    render();
  }
  function renderProgress(){
    const p=$('swProgress'); if(!p)return;
    p.innerHTML=steps.map((s,i)=>'<button type="button" class="'+(i===step?'active ':i<step?'done ':'')+'" data-step="'+i+'"><span>'+s.icon+'</span><small>'+s.title+'</small></button>').join('');
    p.querySelectorAll('button').forEach(b=>b.onclick=()=>{step=Number(b.dataset.step||0);render()});
  }
  function render(){
    ensure();renderProgress();
    const b=$('swBody'), prev=$('swPrev'), next=$('swNext'); if(!b)return;
    if(prev)prev.disabled=step===0;
    if(next)next.textContent=step===steps.length-1?'Hotovo':'Další';
    if(step===0){
      const token=getToken()||generateToken();
      b.innerHTML='<h2>🎲 Vygeneruj silný token</h2><p>Token je heslo pro servisní endpointy. Ulož ho do Railway i do tohoto webu.</p><div class="sw-token" id="swToken">'+esc(token)+'</div><div class="sw-actions"><button class="primary-btn" id="swGen">Vygenerovat nový</button><button class="ghost-btn" id="swUse">Použít ve webu</button><button class="ghost-btn" id="swCopyToken">Kopírovat token</button></div>';
      $('swGen').onclick=()=>{const t=generateToken();$('swToken').textContent=t;copyText('WEB_API_TOKEN='+t,'Railway token')};
      $('swUse').onclick=()=>{setToken($('swToken').textContent);toast('Token uložen lokálně','ok')};
      $('swCopyToken').onclick=()=>copyText($('swToken').textContent,'Token');
    }
    if(step===1){
      const block=railwayBlock(getToken()||$('swToken')?.textContent||'');
      b.innerHTML='<h2>🚂 Vlož token do Railway</h2><p>V Railway otevři projekt → Variables → New Variable a vlož tento řádek.</p><pre class="sw-code"><code>'+esc(block)+'</code></pre><div class="sw-actions"><button class="primary-btn" id="swCopyRailway">Copy Railway block</button></div><p class="sw-note">Když tam už máš AI proměnné, stačí přidat hlavně <b>WEB_API_TOKEN</b>.</p>';
      $('swCopyRailway').onclick=()=>copyText(block,'Railway block');
    }
    if(step===2){
      b.innerHTML='<h2>🚀 Redeploy</h2><p>Po přidání <b>WEB_API_TOKEN</b> musíš službu znovu nasadit, aby si Railway proměnnou načetla.</p><div class="sw-check"><b>Checklist:</b><label><input type="checkbox"> WEB_API_TOKEN je v Railway Variables</label><label><input type="checkbox"> Dal jsem Redeploy</label><label><input type="checkbox"> Log ukazuje nový start kontejneru</label></div><p class="sw-note">Bez redeploye bude Doctor pořád hlásit API otevřené.</p>';
    }
    if(step===3){
      b.innerHTML='<h2>💾 Ulož stejný token ve webu</h2><p>Web posílá token v hlavičce <code>X-Agent-Token</code>. Tady ho uložíš jen do tohoto zařízení.</p><input class="sw-input" id="swInput" placeholder="Vlož WEB_API_TOKEN" value="'+esc(getToken())+'"><div class="sw-actions"><button class="primary-btn" id="swSave">Uložit lokálně</button><button class="ghost-btn" id="swPaste">Vložit ze schránky</button></div>';
      $('swSave').onclick=()=>{setToken($('swInput').value);toast('Token uložen','ok')};
      $('swPaste').onclick=async()=>{try{$('swInput').value=(await navigator.clipboard.readText()).trim();toast('Vloženo','ok')}catch{toast('Schránka nedostupná','err')}};
    }
    if(step===4){
      b.innerHTML='<h2>✅ Otestuj zabezpečení</h2><p>Test zavolá Doctor endpoint a ověří, že token sedí.</p><div class="sw-result" id="swResult">Čekám na test…</div><div class="sw-actions"><button class="primary-btn" id="swTest">Spustit test</button><button class="ghost-btn" id="swOpenPanel">Otevřít Security panel</button></div>';
      $('swTest').onclick=async()=>{const box=$('swResult');box.className='sw-result checking';box.textContent='Testuji…';try{const r=await testToken();box.className='sw-result '+(r.ok?'ok':'bad');box.textContent=r.message||String(r.status||'Hotovo')}catch(e){box.className='sw-result bad';box.textContent=e.message||String(e)}};
      $('swOpenPanel').onclick=()=>{close();window.martybotSecurityExtras?.focusSecurityPanel?.()};
    }
  }
  function open(){ensure();$('securityWizard').classList.add('open');$('securityWizard').setAttribute('aria-hidden','false');render()}
  function close(){const w=$('securityWizard');if(!w)return;w.classList.remove('open');w.setAttribute('aria-hidden','true')}
  function mountButton(){
    if($('securityWizardButton'))return;
    const settings=$('view-settings'); if(!settings)return;
    const card=document.createElement('div');card.className='page-card security-wizard-card';card.innerHTML='<p class="sec-title" style="margin-top:0">🧙 Security Wizard</p><p class="hint">Krokový průvodce pro WEB_API_TOKEN, Railway Variables a test zabezpečení.</p><button class="primary-btn btn-full" id="securityWizardButton" type="button">Spustit průvodce</button>';
    settings.prepend(card);
    $('securityWizardButton').onclick=open;
  }
  function boot(){ensure();mountButton();if(new URLSearchParams(location.search).get('setup')==='security')open();}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1400)):setTimeout(boot,1400);
  window.martybotSecurityWizard={open,close};
})();
