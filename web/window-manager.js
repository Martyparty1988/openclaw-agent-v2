(function(){
  const $=id=>document.getElementById(id);
  const state={command:false,hud:true,ops:true};
  function save(){try{localStorage.setItem('martybotWindowState',JSON.stringify(state));}catch{}}
  function load(){try{Object.assign(state,JSON.parse(localStorage.getItem('martybotWindowState')||'{}'));}catch{}}
  function apply(){
    document.body.classList.toggle('wm-command-open',!!state.command);
    const cmd=$('proCommand'); if(cmd)cmd.classList.toggle('is-hidden',!state.command);
    const hud=$('proHud'); if(hud)hud.classList.toggle('wm-panel-hidden',!state.hud);
    const ops=$('proOps'); if(ops)ops.classList.toggle('wm-panel-hidden',!state.ops);
    document.querySelectorAll('[data-wm-toggle]').forEach(b=>b.classList.toggle('active',!!state[b.dataset.wmToggle]));
    save();
  }
  function ensureCommandClose(){
    const cmd=$('proCommand'); if(!cmd||cmd.dataset.wmReady)return;
    cmd.dataset.wmReady='1'; cmd.classList.add('has-close');
    const close=document.createElement('button'); close.className='pro-close'; close.type='button'; close.textContent='×'; close.title='Zavřít příkazový panel';
    close.onclick=()=>{state.command=false;apply();}; cmd.appendChild(close);
    cmd.classList.toggle('is-hidden',!state.command);
  }
  function dock(){
    if($('proWindowDock'))return;
    const d=document.createElement('div'); d.id='proWindowDock'; d.className='pro-window-dock';
    d.innerHTML='<button data-wm-toggle="command">CMD</button><button data-wm-toggle="hud">HUD</button><button data-wm-toggle="ops">OPS</button><button class="hide-all" id="wmHideAll">×</button>';
    document.body.appendChild(d);
    d.querySelectorAll('[data-wm-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.wmToggle;state[k]=!state[k];apply();});
    $('wmHideAll').onclick=()=>{state.command=false;state.hud=false;state.ops=false;apply();};
  }
  function switcher(){
    if($('wmSwitcher'))return;
    const top=document.querySelector('.top'); if(!top)return;
    const s=document.createElement('div'); s.id='wmSwitcher'; s.className='wm-switcher';
    s.innerHTML='<button data-wm-toggle="hud">HUD panel</button><button data-wm-toggle="ops">OPS panel</button><button data-wm-toggle="command">Command bar</button>';
    top.appendChild(s);
    s.querySelectorAll('[data-wm-toggle]').forEach(b=>b.onclick=()=>{const k=b.dataset.wmToggle;state[k]=!state[k];apply();});
  }
  function boot(){load(); if(innerWidth<901)state.command=false; ensureCommandClose(); dock(); switcher(); apply();}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,700)):setTimeout(boot,700);
  setInterval(()=>{ensureCommandClose();apply();},2000);
})();
