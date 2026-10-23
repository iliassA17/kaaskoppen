'use strict';
(() => {
  const menu = document.getElementById('site-nav');
  const toggle = document.querySelector('.nav-toggle');
  const setMenu = open => {
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Menu sluiten' : 'Menu openen');
  };
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('open')) { setMenu(false); toggle.focus(); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.site-header')) setMenu(false); });
  window.matchMedia('(min-width: 601px)').addEventListener('change', () => setMenu(false));

  const demo = document.querySelector('.demo');
  const play = document.getElementById('demo-play');
  const caption = document.getElementById('demo-caption');
  const steps = Array.from(document.querySelectorAll('[data-demo-step]'));
  const form = document.querySelector('.demo-form');
  const result = document.querySelector('.demo-result');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const captions = [
    'Een klant stuurt je een bericht. Jullie spreken een moment af.',
    'Jij vult de naam, datum en starttijd in en voegt de boeking toe.',
    'Emma staat in je planning. Je houdt de afspraak en betaalstatus bij.'
  ];
  let step = 0, playing = false, finished = false, timer = null, started = 0, remaining = 4000;
  function label() {
    if (motion.matches) play.innerHTML = '<span aria-hidden="true">→</span> ' + (step === 2 ? 'Opnieuw bekijken' : 'Bekijk volgende stap');
    else if (playing) play.innerHTML = '<svg class="inline-icon" aria-hidden="true"><use href="#i-pause"/></svg> Pauzeer demo';
    else play.innerHTML = '<svg class="inline-icon" aria-hidden="true"><use href="#i-play"/></svg> ' + (finished ? 'Opnieuw afspelen' : step === 0 && remaining === 4000 ? 'Speel demo af' : 'Speel verder');
  }
  function render() {
    demo.dataset.step = String(step);
    demo.dataset.playing = String(playing);
    caption.textContent = captions[step];
    document.querySelector('.demo-number').textContent = '0' + (step + 1);
    document.querySelector('.app-caption').textContent = step === 2 ? '03 / Je houdt overzicht' : '02 / Je voert de afspraak in';
    form.hidden = step === 2; result.hidden = step !== 2;
    steps.forEach((button, index) => { if (index === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    label();
  }
  function schedule() {
    clearTimeout(timer); started = performance.now();
    timer = setTimeout(() => {
      if (step === 2) { playing = false; finished = true; remaining = 4000; render(); return; }
      step++; remaining = 4000; render(); schedule();
    }, remaining);
  }
  function pause() {
    if (!playing) return;
    remaining = Math.max(1, remaining - (performance.now() - started));
    clearTimeout(timer); timer = null; playing = false; render();
  }
  play.addEventListener('click', () => {
    if (motion.matches) { clearTimeout(timer); playing = false; step = (step + 1) % 3; remaining = 4000; finished = false; render(); return; }
    if (playing) { pause(); return; }
    if (finished) { step = 0; finished = false; remaining = 4000; }
    playing = true; render(); schedule();
  });
  steps.forEach((button, index) => button.addEventListener('click', () => {
    clearTimeout(timer); timer = null; playing = false; finished = false; step = index; remaining = 4000; render();
  }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  motion.addEventListener('change', () => { pause(); render(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { if (!entries[0].isIntersecting) pause(); }, {threshold: 0}).observe(demo);
  render();
})();
