(function(){
  const actions=[
    ['🩺','Diagnostika','/api/diagnostics'],
    ['🧪','Git Test Push','/api/git/test-push'],
    ['📨','Restart Telegram','/api/telegram/restart'],
    ['🔗','WhatsApp Pair Code','/api/whatsapp/pair'],
    ['🧼','WhatsApp Fresh Pair','fresh-wa'],
    ['♻️','WhatsApp Reset','/api/whatsapp/reset'],
    ['⬇️','Git Pull','/api/chat','/git pull'],
    ['🦾','OpenClaw Pull','/api/openclaw/pull'],
    ['✨','Web Improve','/api/web/improve-safe'],
    ['🧠','Agent Reload','/api/chat','/agent reload']
  ];
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const base=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const tok=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  const hdr=json=>{const h={}; if(json)h['Content-Type']='application/json'; if(tok())h['X-Agent-Token']=tok(); return h;};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function note(title,body,bad){
    const box=$('messages');
    if(!box){alert(title+'\n\n'+String(body||''));return;}
    const wrap=document.createElement('div');
    wrap.className='msg-wrap '+(bad?'sys':'bot');
    const msg=document.createElement('div');
    msg.className='msg';
    msg.innerHTML='<strong>'+esc(title)+'</strong><pre><code>'+esc(String(body||'').slice(0,5000))+'</code></pre>';
    wrap.appendChild(msg); box.appendChild(wrap); box.scrollTop=box.scrollHeight;
  }
  async function call(path,json){
    const r=await fetch(base()+path,{method:'POST',headers:hdr(!!json),body:json?JSON.stringify(json):undefined});
    const t=await r.text(); let data; try{data=JSON.parse(t)}catch{data=t}
    if(!r.ok)throw new Error(typeof data==='string'?data:JSON.stringify(data,null,2));
    return data;
  }
  function formatPair(data){
    const code=String(data.code||data.raw||'').trim();
    const raw=String(data.raw||code).replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
    const phone=data.phoneNumber||data.status?.whatsappPhoneLast4||'';
    return [
      'Telefon: '+phone,
      'Kód bez pomlčky: '+raw,
      'Kód s pomlčkou: '+code,
      '',
      'Použij WhatsApp → Propojená zařízení → Propojit pomocí telefonního čísla.',
      'Zadej ideálně kód bez pomlčky a bez mezery. Platí jen poslední vygenerovaný kód.'
    ].join('\n');
  }
  function formatGeneric(data){
    if(Array.isArray(data?.replies)) return data.replies.join('\n\n');
    if(data?.reply) return data.reply;
    if(data?.text) return data.text;
    return typeof data==='string'?data:JSON.stringify(data,null,2);
  }
  function setBtnLoading(el,on){
    if(!el)return;
    el.disabled=!!on;
    el.classList.toggle('loading',!!on);
    const small=el.querySelector('small');
    if(small){
      if(!small.dataset.original)small.dataset.original=small.textContent||'';
      small.textContent=on?'Běžím, počkej…':small.dataset.original;
    }
  }
  async function freshPair(){
    note('WhatsApp Fresh Pair ⏳','Resetuji session…',false);
    await call('/api/whatsapp/reset');
    note('WhatsApp Fresh Pair ⏳','Čekám 15 sekund na nový socket…',false);
    await wait(15000);
    const pair=await call('/api/whatsapp/pair');
    note('WhatsApp Fresh Pair ✅',formatPair(pair),false);
  }
  async function run(a,button){
    const title=a[1], path=a[2], cmd=a[3];
    setBtnLoading(button,true);
    note(title+' ⏳','Akce spuštěná…',false);
    try{
      if(path==='fresh-wa'){await freshPair();return;}
      let data;
      if(cmd){data=await call(path,{text:cmd,userId:'web_service'});}else{data=await call(path);}
      if(path.includes('/api/whatsapp/pair')) note(title+' ✅',formatPair(data),false);
      else note(title+' ✅',formatGeneric(data),false);
    }catch(e){note(title+' ❌',e.message||String(e),true);}
    finally{setBtnLoading(button,false);}
  }
  function btn(a,big){
    const el=document.createElement('button');
    el.type='button';
    el.className=big?'big-card':'act-btn';
    el.innerHTML='<span class="ico">'+a[0]+'</span><span><strong>'+a[1]+'</strong><small>Servisní akce Martybotu</small></span>';
    el.addEventListener('click',()=>run(a,el));
    return el;
  }
  function mount(){
    const d=$('desktopActions');
    if(d&&!d.dataset.serviceActions){d.dataset.serviceActions='1'; actions.forEach(a=>d.appendChild(btn(a,false)));}
    const m=$('bigActions');
    if(m&&!m.dataset.serviceActions){m.dataset.serviceActions='1'; actions.forEach(a=>m.appendChild(btn(a,true)));}
  }
  setTimeout(mount,400);
})();
