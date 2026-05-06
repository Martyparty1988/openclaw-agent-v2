(function(){
  const KEY='martybotWebToken';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const apiBase=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const getToken=()=>String(localStorage.getItem(KEY)||'').trim();
  function toast(msg,type){if(window.toast)window.toast(msg,type);else console.log(type||'log',msg)}
  function maskToken(t){t=String(t||'');if(!t)return 'není uložený';if(t.length<=10)return '••••';return t.slice(0,6)+'••••••'+t.slice(-4)}
  function headers(token){const h={};const t=String(token||getToken()).trim();if(t)h['X-Agent-Token']=t;return h}
  function tokenStrength(t){
    t=String(t||'');let score=0;
    if(t.length>=24)score++; if(t.length>=40)score++; if(/[a-z]/.test(t)&&/[A-Z]/.test(t))score++; if(/\d/.test(t))score++; if(/[^a-zA-Z0-9]/.test(t)||/_|-/.test(t))score++;
    if(!t)return {level:'empty',text:'žádný token'};
    if(score>=4)return {level:'strong',text:'silný'};
    if(score>=2)return {level:'mid',text:'střední'};
    return {level:'weak',text:'slabý'};
  }
  function setState(state,text){
    document.querySelectorAll('[data-sec-state]').forEach(el=>{el.className='sec-state '+state;el.textContent=text});
    document.querySelectorAll('[data-sec-token-label]').forEach(el=>{el.textContent=maskToken(getToken())});
    updateSecurityBadge(state,text);
    updateStrengthAll();
  }
  function updateStrengthAll(){
    document.querySelectorAll('.sec-token-input').forEach(input=>{
      const panel=input.closest('.security-panel'); if(!panel)return;
      const s=tokenStrength(input.value||getToken());
      const bar=panel.querySelector('.sec-strength-fill'); const label=panel.querySelector('.sec-strength-label');
      if(bar){bar.className='sec-strength-fill '+s.level;bar.style.width=s.level==='strong'?'100%':s.level==='mid'?'62%':s.level==='weak'?'28%':'0%';}
      if(label)label.textContent=s.text;
    });
  }
  function addChat(title,body,bad){
    const box=$('messages'); if(!box){alert(title+'\n\n'+String(body||''));return;}
    const wrap=document.createElement('div');wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div');msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,7000))+'</code></pre>';
    wrap.appendChild(msg);box.appendChild(wrap);box.scrollTop=box.scrollHeight;
  }
  function generateToken(){
    const bytes=new Uint8Array(32);
    if(window.crypto&&crypto.getRandomValues)crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
    const raw=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return 'martybot_'+raw.slice(0,16)+'_'+raw.slice(16,40)+'_'+raw.slice(40);
  }
  async function copyText(text,label){
    try{await navigator.clipboard.writeText(String(text||''));toast((label||'Text')+' zkopírován','ok');return true;}catch{toast('Kopírování selhalo','err');return false;}
  }
  function railwayLine(token){return 'WEB_API_TOKEN='+String(token||getToken()).trim();}
  async function pasteInto(input){
    try{const text=await navigator.clipboard.readText();if(text){input.value=text.trim();updateStrengthAll();toast('Vloženo ze schránky','ok')}}catch{toast('Schránka není dostupná','err')}
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
  function updateSecurityBadge(state,text){
    const b=$('securityBadge'); if(!b)return;
    b.className='security-badge '+state;
    b.textContent=state==='ok'?'🔐 API chráněné':state==='bad'?'🚫 Token problém':state==='checking'?'🔎 Kontrola API':'🔓 API otevřené';
    b.title=text||'';
  }
  function makeBadge(){
    if($('securityBadge'))return;
    const top=document.querySelector('.top'); if(!top)return;
    const b=document.createElement('button');b.type='button';b.id='securityBadge';b.className='security-badge warn';b.textContent='🔓 API otevřené';b.onclick=()=>document.getElementById('securityPanelDesktopInput')?.focus();
    top.appendChild(b);
  }
  function fillGenerated(inputId){
    const input=$(inputId); if(!input)return;
    const t=generateToken(); input.value=t; document.querySelectorAll('.sec-token-input').forEach(i=>{i.value=t}); updateStrengthAll();
    copyText(railwayLine(t),'Railway WEB_API_TOKEN');
    addChat('🔐 WEB_API_TOKEN vygenerován','Zkopíroval jsem ti řádek pro Railway:\n\n'+railwayLine(t)+'\n\nPostup:\n1. Railway → Variables\n2. Přidej WEB_API_TOKEN s touhle hodnotou\n3. Redeploy\n4. V tomto panelu dej Uložit/Otestovat',false);
  }
  function makePanel(id,compact){
    const saved=getToken();
    return '<div class="security-panel '+(compact?'compact':'')+'" id="'+id+'">'+
      '<div class="sec-head"><div><strong>🔐 API Security</strong><small>WEB_API_TOKEN pro servisní endpointy</small></div><span class="sec-state '+(saved?'checking':'warn')+'" data-sec-state>'+(saved?'Kontroluji…':'Token není uložený')+'</span></div>'+
      '<div class="sec-current">Lokálně uložený token: <b data-sec-token-label>'+esc(maskToken(saved))+'</b></div>'+
      '<div class="sec-form"><input class="sec-token-input" id="'+id+'Input" type="password" placeholder="Vlož stejný WEB_API_TOKEN jako v Railway" value="'+esc(saved)+'" autocomplete="off" spellcheck="false"><button type="button" class="primary-btn" id="'+id+'Save">Uložit</button></div>'+
      '<div class="sec-strength"><span class="sec-strength-track"><i class="sec-strength-fill"></i></span><b class="sec-strength-label">—</b></div>'+
      '<div class="sec-actions"><button type="button" class="ghost-btn" id="'+id+'Generate">Generovat</button><button type="button" class="ghost-btn" id="'+id+'Paste">Vložit</button><button type="button" class="ghost-btn" id="'+id+'CopyEnv">Copy env</button><button type="button" class="ghost-btn" id="'+id+'Test">Otestovat</button><button type="button" class="ghost-btn" id="'+id+'Show">Ukázat</button><button type="button" class="ghost-btn danger" id="'+id+'Clear">Smazat</button></div>'+
      '<div class="sec-checklist"><b>Mini postup</b><ol><li>Vygeneruj token.</li><li>V Railway nastav <code>WEB_API_TOKEN</code>.</li><li>Redeployni službu.</li><li>Vlož stejný token sem a dej Otestovat.</li></ol></div>'+
      '<p class="sec-help">Token se neukládá do GitHubu ani Railway z webu. Je jen v localStorage tohoto prohlížeče a posílá se jako <code>X-Agent-Token</code>.</p>'+
    '</div>';
  }
  function wire(id){
    const input=$(id+'Input'), save=$(id+'Save'), test=$(id+'Test'), show=$(id+'Show'), clear=$(id+'Clear'), gen=$(id+'Generate'), paste=$(id+'Paste'), copyEnv=$(id+'CopyEnv');
    if(!input||input.dataset.wired)return;input.dataset.wired='1';
    input.addEventListener('input',updateStrengthAll);
    save.onclick=()=>saveToken(id+'Input');
    test.onclick=()=>testToken(input.value).then(res=>addChat('🔐 Security test '+(res.ok?'✅':'❌'),res.message,!res.ok));
    show.onclick=()=>{input.type=input.type==='password'?'text':'password';show.textContent=input.type==='password'?'Ukázat':'Skrýt'};
    clear.onclick=clearToken;
    gen.onclick=()=>fillGenerated(id+'Input');
    paste.onclick=()=>pasteInto(input);
    copyEnv.onclick=()=>copyText(railwayLine(input.value||getToken()),'Railway env');
  }
  function mount(){
    makeBadge();
    const sidebar=document.querySelector('.sidebar');
    if(sidebar&&!$('securityPanelDesktop')){const box=document.createElement('div');box.className='sblock';box.innerHTML=makePanel('securityPanelDesktop',true);sidebar.prepend(box);wire('securityPanelDesktop')}
    const settings=$('view-settings');
    if(settings&&!$('securityPanelMobile')){const card=document.createElement('div');card.className='page-card';card.innerHTML=makePanel('securityPanelMobile',false);settings.prepend(card);wire('securityPanelMobile')}
    const repair=$('view-repair');
    if(repair&&!$('securityPanelRepair')){const card=document.createElement('div');card.className='page-card';card.innerHTML=makePanel('securityPanelRepair',false);repair.appendChild(card);wire('securityPanelRepair')}
    if(getToken())testToken();else setState('warn','Token není uložený');
    updateStrengthAll();
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,900)):setTimeout(mount,900);
  window.martybotSecurity={testToken,clearToken,getToken,generateToken};
})();
