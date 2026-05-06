(function(){
  const actions=[
    ['📨','Restart Telegram','/api/telegram/restart'],
    ['🔗','WhatsApp Pair Code','/api/whatsapp/pair'],
    ['♻️','WhatsApp Reset','/api/whatsapp/reset'],
    ['⬇️','Git Pull','/api/chat','/git pull'],
    ['🦾','OpenClaw Pull','/api/openclaw/pull'],
    ['✨','Web Improve','/api/web/improve?write=1'],
    ['🧠','Agent Reload','/api/chat','/agent reload']
  ];
  const $=id=>document.getElementById(id);
  const esc=s=>String(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const base=()=>String(localStorage.getItem('martybotBackendUrl')||'').trim().replace(/\/+$/,'');
  const tok=()=>String(localStorage.getItem('martybotWebToken')||'').trim();
  const hdr=json=>{const h={}; if(json)h['Content-Type']='application/json'; if(tok())h['X-Agent-Token']=tok(); return h;};
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
  async function run(a){
    const title=a[1], path=a[2], cmd=a[3];
    try{
      let r;
      if(cmd){
        r=await fetch(base()+path,{method:'POST',headers:hdr(true),body:JSON.stringify({text:cmd,userId:'web_service'})});
      }else{
        r=await fetch(base()+path,{method:'POST',headers:hdr(false)});
      }
      const t=await r.text(); let data=t; try{data=JSON.stringify(JSON.parse(t),null,2)}catch{}
      if(!r.ok)throw new Error(data);
      note(title+' ✅',data,false);
    }catch(e){note(title+' ❌',e.message||String(e),true);}
  }
  function btn(a,big){
    const el=document.createElement('button');
    el.type='button';
    el.className=big?'big-card':'act-btn';
    el.innerHTML='<span class="ico">'+a[0]+'</span><span><strong>'+a[1]+'</strong><small>Servisní akce Martybotu</small></span>';
    el.addEventListener('click',()=>run(a));
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
