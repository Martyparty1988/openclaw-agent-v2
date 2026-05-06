// Force Martybot web to use the same domain it is opened from.
// This removes the need for a Backend URL field when hosted directly on Railway.
(function(){
  localStorage.removeItem('martybotBackendUrl');
  localStorage.setItem('martybotMode','auto');
  window.MARTYBOT_SAME_ORIGIN_ONLY=true;
})();
