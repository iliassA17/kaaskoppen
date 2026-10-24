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
  const caption = document.getElementById('demo-caption');
  const steps = Array.from(document.querySelectorAll('[data-demo-step]'));
  const form = document.querySelector('.demo-form');
  const result = document.querySelector('.demo-result');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const captions = [
    'Spreek af met je klant en maak een screenshot met de datum en tijd.',
    'Scan je screenshot. Controleer de gevonden datum en tijd en voeg de boeking toe.',
    'Je boeking staat in je planning. Houd je volgende vrije plek en betaalstatus in beeld.'
  ];
  let step = 0, playing = false, inView = false, timer = null, started = 0, remaining = 4000;
  function render() {
    demo.dataset.step = String(step);
    demo.dataset.playing = String(playing);
    demo.dataset.reducedMotion = String(motion.matches);
    caption.textContent = captions[step];
    document.querySelector('.demo-number').textContent = '0' + (step + 1);
    document.querySelector('.app-caption').textContent = step === 2 ? '03 / Je houdt overzicht' : '02 / Je scant je screenshot';
    form.hidden = !motion.matches && step === 2;
    result.hidden = !motion.matches && step !== 2;
    steps.forEach((indicator, index) => { if (index === step) indicator.setAttribute('aria-current', 'step'); else indicator.removeAttribute('aria-current'); });
  }
  function schedule() {
    clearTimeout(timer); started = performance.now();
    timer = setTimeout(() => {
      step = (step + 1) % 3; remaining = 4000; render(); schedule();
    }, remaining);
  }
  function pause() {
    if (!playing) return;
    remaining = Math.max(1, remaining - (performance.now() - started));
    clearTimeout(timer); timer = null; playing = false; render();
  }
  function syncPlayback() {
    if (!inView || document.hidden || motion.matches) { pause(); render(); return; }
    if (!playing) { playing = true; render(); schedule(); }
  }
  document.addEventListener('visibilitychange', syncPlayback);
  motion.addEventListener('change', syncPlayback);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting && entries[0].intersectionRatio >= .25;
      syncPlayback();
    }, {threshold: [0, .25]}).observe(document.querySelector('.demo-stage'));
  } else {
    const measure = () => {
      const bounds = demo.getBoundingClientRect();
      inView = bounds.top < innerHeight * .75 && bounds.bottom > innerHeight * .25;
      syncPlayback();
    };
    window.addEventListener('scroll', measure, {passive: true});
    window.addEventListener('resize', measure); measure();
  }
  render();
})();
