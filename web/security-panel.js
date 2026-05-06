(function(){
  const KEY='martybotWebToken';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const apiBase=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const getToken=()=>String(localStorage.getItem(KEY)||'').trim();
  function toast(msg,type){if(window.toast)window.toast(msg,type);else console.log(type||'log',msg)}
  function maskToken(t){t=String(t||'');if(!t)return 'není uložený';if(t.length<=10)return '••••';return t.slice(0,6)+'••••••'+t.slice(-4)}
  function headers(token){const h={};const t=String(token||getToken()).trim();if(t)h['X-Agent-Token']=t;return h}
  function setState(state,text){
    document.querySelectorAll('[data-sec-state]').forEach(el=>{el.className='sec-state '+state;el.textContent=text});
    document.querySelectorAll('[data-sec-token-label]').forEach(el=>{el.textContent=maskToken(getToken())});
  }
  function addChat(title,body,bad){
    const box=$('messages'); if(!box){alert(title+'\n\n'+String(body||''));return;}
    const wrap=document.createElement('div');wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div');msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,7000))+'</code></pre>';
    wrap.appendChild(msg);box.appendChild(wrap);box.scrollTop=box.scrollHeight;
  }
  async function testToken(tokenOverride){
    const t=String(tokenOverride||getToken()).trim();
    setState('checking','Kontroluji…');
    try{
      const r=await fetch(apiBase()+'/api/doctor',{method:'POST',headers:headers(t)});
      const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={reply:text}}
      if(r.status===401){setState('bad','Zamčeno · token nesedí');return {ok:false,status:'unauthorized',message:'API odmítlo token. Zkontroluj WEB_API_TOKEN v Railway a lokální token ve webu.'}}
      if(!r.ok||data.ok===false){setState('bad','Chyba API');return {ok:false,status:'error',message:data.error||data.reply||text||('HTTP '+r.status)}}
      const body=String(data.reply||data.text||text||'');
      if(body.includes('WEB_API_TOKEN není nastavený')){setState('warn','API otevřené');return {ok:true,status:'open',message:'API funguje, ale Railway zatím nemá WEB_API_TOKEN. Po nastavení proměnné redeployni.'}}
      setState('ok','Zabezpečeno ✅');
      return {ok:true,status:'protected',message:'Token funguje. API je chráněné a web posílá správný X-Agent-Token.'};
    }catch(e){setState('bad','Nedostupné');return {ok:false,status:'network',message:e.message||String(e)}}
  }
  function saveToken(inputId){
    const input=$(inputId);const value=String(input?.value||'').trim();
    if(!value){toast('Token je prázdný','err');return;}
    localStorage.setItem(KEY,value);
    document.querySelectorAll('.sec-token-input').forEach(i=>{i.value=value});
    setState('checking','Uloženo · testuji…');
    toast('API token uložen jen v tomto zařízení','ok');
    testToken(value).then(res=>addChat('🔐 Security test '+(res.ok?'✅':'❌'),res.message,!res.ok));
  }
  function clearToken(){
    localStorage.removeItem(KEY);
    document.querySelectorAll('.sec-token-input').forEach(i=>{i.value=''});
    setState('warn','Token není uložený');
    toast('Lokální API token smazán','ok');
  }
  function makePanel(id,compact){
    const saved=getToken();
    return '<div class="security-panel '+(compact?'compact':'')+'" id="'+id+'">'+
      '<div class="sec-head"><div><strong>🔐 API Security</strong><small>WEB_API_TOKEN pro servisní endpointy</small></div><span class="sec-state '+(saved?'checking':'warn')+'" data-sec-state>'+(saved?'Kontroluji…':'Token není uložený')+'</span></div>'+
      '<div class="sec-current">Lokálně uložený token: <b data-sec-token-label>'+esc(maskToken(saved))+'</b></div>'+
      '<div class="sec-form"><input class="sec-token-input" id="'+id+'Input" type="password" placeholder="Vlož stejný WEB_API_TOKEN jako v Railway" value="'+esc(saved)+'" autocomplete="off" spellcheck="false"><button type="button" class="primary-btn" id="'+id+'Save">Uložit</button></div>'+
      '<div class="sec-actions"><button type="button" class="ghost-btn" id="'+id+'Test">Otestovat</button><button type="button" class="ghost-btn" id="'+id+'Show">Ukázat</button><button type="button" class="ghost-btn danger" id="'+id+'Clear">Smazat</button></div>'+
      '<p class="sec-help">Token se neukládá do GitHubu ani Railway z webu. Je jen v localStorage tohoto prohlížeče a posílá se jako <code>X-Agent-Token</code>.</p>'+
    '</div>';
  }
  function wire(id){
    const input=$(id+'Input'), save=$(id+'Save'), test=$(id+'Test'), show=$(id+'Show'), clear=$(id+'Clear');
    if(!input||input.dataset.wired)return;input.dataset.wired='1';
    save.onclick=()=>saveToken(id+'Input');
    test.onclick=()=>testToken(input.value).then(res=>addChat('🔐 Security test '+(res.ok?'✅':'❌'),res.message,!res.ok));
    show.onclick=()=>{input.type=input.type==='password'?'text':'password';show.textContent=input.type==='password'?'Ukázat':'Skrýt'};
    clear.onclick=clearToken;
  }
  function mount(){
    const sidebar=document.querySelector('.sidebar');
    if(sidebar&&!$('securityPanelDesktop')){const box=document.createElement('div');box.className='sblock';box.innerHTML=makePanel('securityPanelDesktop',true);sidebar.prepend(box);wire('securityPanelDesktop')}
    const settings=$('view-settings');
    if(settings&&!$('securityPanelMobile')){const card=document.createElement('div');card.className='page-card';card.innerHTML=makePanel('securityPanelMobile',false);settings.prepend(card);wire('securityPanelMobile')}
    const repair=$('view-repair');
    if(repair&&!$('securityPanelRepair')){const card=document.createElement('div');card.className='page-card';card.innerHTML=makePanel('securityPanelRepair',false);repair.appendChild(card);wire('securityPanelRepair')}
    if(getToken())testToken();else setState('warn','Token není uložený');
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,900)):setTimeout(mount,900);
  window.martybotSecurity={testToken,clearToken,getToken};
})();
