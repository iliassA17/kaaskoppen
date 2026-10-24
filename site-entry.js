'use strict';
(() => {
  // Preserve old payment links, notification links and installed root shortcuts.
  // Ordinary visitors always get the introduction; no session is read here.
  const query = new URLSearchParams(location.search);
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const requestedIntro = location.hash === '#introductie';
  if ((installed && !requestedIntro) || query.has('betaling') || query.has('goto')) {
    location.replace('/app/' + location.search + location.hash);
  }
})();
