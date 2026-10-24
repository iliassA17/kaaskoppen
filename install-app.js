'use strict';
(() => {
  const dialog = document.getElementById('install-dialog');
  const nativeButton = document.getElementById('install-native');
  const already = document.getElementById('install-already');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let prompt = null;

  const update = () => {
    const installed = standalone.matches || navigator.standalone === true;
    already.hidden = !installed;
    nativeButton.hidden = !prompt || installed;
  };
  const open = () => {
    if (typeof zetMenuOpen === 'function') zetMenuOpen(false);
    update();
    if (!dialog.open) dialog.showModal();
  };
  document.querySelectorAll('[data-open-install]').forEach(button => button.addEventListener('click', open));
  document.getElementById('install-app-link').textContent = location.origin + '/app/';
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event; update();
  });
  window.addEventListener('appinstalled', () => { prompt = null; nativeButton.hidden = true; });
  standalone.addEventListener('change', update);
  nativeButton.addEventListener('click', async () => {
    if (!prompt) return;
    const request = prompt; prompt = null; update();
    try { await request.prompt(); } catch (_) { /* Manual instructions remain available. */ }
  });
  if (location.hash === '#installeren') {
    history.replaceState(history.state, '', location.pathname + location.search);
    open();
  }
  update();
})();
