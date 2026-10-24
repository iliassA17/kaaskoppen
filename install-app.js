'use strict';
(() => {
  const dialog = document.getElementById('install-dialog');
  const nativeButton = document.getElementById('install-native');
  const already = document.getElementById('install-already');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let prompt = null;
  const tabs = Array.from(dialog.querySelectorAll('[role="tab"]'));
  const selectDevice = tab => {
    tabs.forEach(button => {
      const selected = button === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectDevice(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        event.key === 'ArrowRight' ? (index + 1) % tabs.length :
        event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
      if (next === null) return;
      event.preventDefault(); selectDevice(tabs[next]); tabs[next].focus();
    });
  });
  const appleDevice = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  selectDevice(document.getElementById(appleDevice ? 'install-tab-iphone' : 'install-tab-android'));

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
