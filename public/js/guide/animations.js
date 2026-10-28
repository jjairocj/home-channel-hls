/**
 * Home Channel HLS - Animaciones GSAP de la revista: movimientos cortos y "a saltos" (steps)
 * como los gráficos de TV de los 90.
 *
 *   intro    al cargar (cuando la revista entra en pantalla)
 *   flip     cambio de día (la página gira sobre el lomo)
 *   shuffle  cambio de franja
 */

let idleTweens = [];

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playIntro(gsap, mag, items, feature) {
  const tl = gsap.timeline({ defaults: { ease: 'back.out(2.2)' } });
  tl.from(mag.querySelectorAll('.tg-logo-tele, .tg-logo-guia'), { y: -40, opacity: 0, rotation: -10, duration: 0.45, stagger: 0.12 })
    .from(mag.querySelector('.tg-logo-x99'), { scale: 0, rotation: 200, duration: 0.5 }, '-=0.15')
    .from(mag.querySelector('.tg-mag-page-box'), { scale: 1.8, opacity: 0, rotation: 12, duration: 0.35, ease: 'power4.in' }, '-=0.3')
    .from(mag.querySelector('.tg-cover-burst'), { scale: 0, rotation: -180, duration: 0.6, ease: 'elastic.out(1, 0.45)' }, '-=0.1')
    .from(mag.querySelectorAll('.tg-day-btn, .tg-filter-btn'), { y: 10, opacity: 0, duration: 0.25, stagger: 0.03, ease: 'steps(3)', clearProps: 'transform,opacity' }, '-=0.4');
  if (feature && !feature.hidden) tl.from(feature, { x: -30, opacity: 0, duration: 0.4, ease: 'power3.out' }, '-=0.2');
  tl.from(items, { y: 16, opacity: 0, duration: 0.3, ease: 'steps(4)', stagger: { amount: 0.8 } }, '-=0.2');

  // El sticker de portada se queda bailando
  const cover = mag.querySelector('.tg-cover-burst');
  if (cover) idleTweens.push(gsap.to(cover, { rotation: '+=10', duration: 0.8, ease: 'steps(2)', repeat: -1, yoyo: true, delay: 2 }));
}

/** Stickers que "tiemblan" como avisos de oferta (se reinician en cada render). */
function wobbleStickers(gsap, mag) {
  idleTweens.forEach(t => t.kill());
  idleTweens = [];
  mag.querySelectorAll('.tg-now-burst, .tg-feature-burst').forEach(el => {
    idleTweens.push(gsap.fromTo(el, { rotation: -8, scale: 1 }, { rotation: 8, scale: 1.08, duration: 0.6, ease: 'steps(3)', repeat: -1, yoyo: true }));
  });
}

export function animateGuide(mode) {
  const gsap = window.gsap;
  if (!gsap || reducedMotion()) return;
  const mag = document.getElementById('tvGuideMagazine');
  const content = document.getElementById('tgMagazineContent');
  if (!mag || !content) return;

  const items = content.querySelectorAll('.tg-section-head, .tg-listing');
  const feature = document.getElementById('tgFeature');
  wobbleStickers(gsap, mag);

  if (mode === 'intro') {
    if (!('IntersectionObserver' in window)) return playIntro(gsap, mag, items, feature);
    const io = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      playIntro(gsap, mag, items, feature);
    }, { threshold: 0.12 });
    io.observe(mag);
  } else if (mode === 'flip') {
    gsap.fromTo(content, { rotationY: -80, transformOrigin: 'left center', opacity: 0 },
      { rotationY: 0, opacity: 1, duration: 0.7, ease: 'power3.out', clearProps: 'transform,opacity' });
    if (feature && !feature.hidden) gsap.from(feature, { y: -12, opacity: 0, duration: 0.35, ease: 'steps(4)' });
    gsap.from(items, { opacity: 0, duration: 0.2, stagger: { amount: 0.4 }, delay: 0.25 });
  } else if (mode === 'shuffle') {
    gsap.from(items, { x: -12, opacity: 0, duration: 0.25, ease: 'steps(3)', stagger: { amount: 0.35 } });
  }
}
