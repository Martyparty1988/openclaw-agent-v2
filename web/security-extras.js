(function(){
  const TOKEN_KEY='martybotWebToken';
  const URL_KEY='martybotBackendUrl';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const getToken=()=>String(localStorage.getItem(TOKEN_KEY)||'').trim();
  const getBase=()=>String(localStorage.getItem(URL_KEY)||'').trim().replace(/\/+$/,'');
  const setBase=v=>{const x=String(v||'').trim().replace(/\/+$/,''); if(x)localStorage.setItem(URL_KEY,x); else localStorage.removeItem(URL_KEY); return x;};
  function toast(msg,type){if(window.toast)window.toast(msg,type);else console.log(type||'log',msg)}
  function addChat(title,body,bad){
    const box=$('messages'); if(!box){alert(title+'\n\n'+String(body||''));return;}
    const wrap=document.createElement('div');wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div');msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,7000))+'</code></pre>';
    wrap.appendChild(msg);box.appendChild(wrap);box.scrollTop=box.scrollHeight;
  }
  async function copyText(text,label){try{await navigator.clipboard.writeText(String(text||''));toast((label||'Text')+' zkopírován','ok');return true;}catch{toast('Kopírování selhalo','err');return false;}}
  function makeToken(){
    const bytes=new Uint8Array(32); if(crypto&&crypto.getRandomValues)crypto.getRandomValues(bytes); else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
    const raw=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); return 'martybot_'+raw.slice(0,16)+'_'+raw.slice(16,40)+'_'+raw.slice(40);
  }
  function railwayBlock(token){
    return [
      'WEB_API_TOKEN='+String(token||getToken()).trim(),
      'AI_PROVIDER=anthropic',
      'LLM_PROVIDER=anthropic',
      'AI_MODEL=claude-sonnet-4-20250514',
      'CLAUDE_MODEL=claude-sonnet-4-20250514',
      'ANTHROPIC_MODEL=claude-sonnet-4-20250514'
    ].join('\n');
  }
  function exportConfig(){
    const data={
      version:1,
      exportedAt:new Date().toISOString(),
      backendUrl:getBase(),
      hasToken:Boolean(getToken()),
      token:getToken(),
      note:'Lokální Martybot web nastavení. Token ukládej bezpečně.'
    };
    copyText(JSON.stringify(data,null,2),'Konfigurace');
    addChat('📦 Export web konfigurace',JSON.stringify({...data,token:data.token?data.token.slice(0,6)+'••••••'+data.token.slice(-4):''},null,2),false);
  }
  async function importConfig(){
    try{
      const text=await navigator.clipboard.readText();
      const data=JSON.parse(text);
      if(data.backendUrl!==undefined)setBase(data.backendUrl);
      if(data.token)localStorage.setItem(TOKEN_KEY,String(data.token).trim());
      syncInputs();
      toast('Konfigurace importována','ok');
      addChat('📥 Import web konfigurace','Hotovo. Backend URL a token byly načteny ze schránky. Teď dej Security test.',false);
      window.martybotSecurity?.testToken?.();
    }catch(e){toast('Import selhal','err');addChat('📥 Import selhal',e.message||String(e),true)}
  }
  function makeSetupBanner(){
    if($('securityQuickSetup'))return;
    const b=document.createElement('div');b.id='securityQuickSetup';b.className='security-quick-setup';
    b.innerHTML='<div><strong>🔐 Zabezpečení API</strong><small id="sqsText">Kontroluji token…</small></div><div class="sqs-actions"><button id="sqsGenerate" type="button">Generovat</button><button id="sqsCopy" type="button">Copy Railway</button><button id="sqsOpen" type="button">Panel</button><button id="sqsClose" type="button">×</button></div>';
    document.body.appendChild(b);
    $('sqsClose').onclick=()=>{b.classList.add('hidden');sessionStorage.setItem('martybotHideSecurityQuickSetup','1')};
    $('sqsGenerate').onclick=()=>{const t=makeToken();localStorage.setItem(TOKEN_KEY,t);syncInputs();copyText('WEB_API_TOKEN='+t,'WEB_API_TOKEN');window.martybotSecurity?.testToken?.();};
    $('sqsCopy').onclick=()=>copyText(railwayBlock(),'Railway block');
    $('sqsOpen').onclick=()=>focusSecurityPanel();
  }
  function updateBanner(){
    makeSetupBanner();
    const b=$('securityQuickSetup'), txt=$('sqsText'); if(!b||!txt)return;
    if(sessionStorage.getItem('martybotHideSecurityQuickSetup')==='1')b.classList.add('hidden');
    const has=Boolean(getToken());
    b.classList.toggle('needs-token',!has);
    txt.textContent=has?'Token je uložený lokálně. Klikni Test v Security panelu.':'Token zatím není uložený. Vygeneruj ho, vlož do Railway a potom sem.';
  }
  function focusSecurityPanel(){
    const tab=document.querySelector('[data-tab="settings"]'); if(tab)tab.click();
    setTimeout(()=>{const input=$('securityPanelMobileInput')||$('securityPanelDesktopInput')||$('securityPanelRepairInput');input?.scrollIntoView({behavior:'smooth',block:'center'});input?.focus();},250);
  }
  function makeUtilityPanel(){
    if($('securityUtilityPanel'))return;
    const settings=$('view-settings'); if(!settings)return;
    const card=document.createElement('div');card.className='page-card security-utility-card';card.id='securityUtilityPanel';
    card.innerHTML='<p class="sec-title" style="margin-top:0">🧰 Security utility</p><div class="backend-url-row"><label>Backend URL <small>Nech prázdné pro stejnou doménu</small></label><div><input id="backendUrlInput" placeholder="https://tvoje-app.railway.app" value="'+esc(getBase())+'"><button id="saveBackendUrl" type="button" class="primary-btn">Uložit</button></div></div><div class="utility-actions"><button id="copyRailwayBlock" type="button" class="ghost-btn">Copy Railway block</button><button id="copyCurlTest" type="button" class="ghost-btn">Copy curl test</button><button id="exportLocalConfig" type="button" class="ghost-btn">Export config</button><button id="importLocalConfig" type="button" class="ghost-btn">Import config</button></div><p class="sec-help">Backend URL se hodí, když web běží jinde než API. Běžně ji můžeš nechat prázdnou.</p>';
    settings.prepend(card);
    $('saveBackendUrl').onclick=()=>{setBase($('backendUrlInput').value);toast('Backend URL uložena','ok')};
    $('copyRailwayBlock').onclick=()=>copyText(railwayBlock(),'Railway block');
    $('copyCurlTest').onclick=()=>copyText('curl -X POST '+(getBase()||location.origin)+'/api/doctor -H "X-Agent-Token: '+getToken()+'"','curl test');
    $('exportLocalConfig').onclick=exportConfig;
    $('importLocalConfig').onclick=importConfig;
  }
  function syncInputs(){
    document.querySelectorAll('.sec-token-input').forEach(i=>{i.value=getToken()});
    const u=$('backendUrlInput'); if(u)u.value=getBase();
    updateBanner();
  }
  function boot(){makeSetupBanner();makeUtilityPanel();syncInputs();setInterval(updateBanner,4000)}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1200)):setTimeout(boot,1200);
  window.martybotSecurityExtras={railwayBlock,exportConfig,importConfig,focusSecurityPanel};
})();
