// MARTYBOT — same-origin-only.js
// Force the app to connect only to the same domain it is served from.
(function(){
  localStorage.removeItem('martybotBackendUrl');
  localStorage.setItem('martybotMode','auto');
  window.MARTYBOT_SAME_ORIGIN_ONLY=true;
  document.documentElement.classList.add('same-origin-only');
  if(document.body) document.body.classList.add('same-origin-only');
})();
