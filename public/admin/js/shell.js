/**
 * Home Channel Master Control - Escritorio: menú Inicio, reloj de la barra de tareas y
 * luz de estado de la señal.
 */

import { $, on } from '/shared/dom.js';

const pad2 = (n) => String(n).padStart(2, '0');

function initStartMenu() {
  const orb = $('btnStartOrb');
  const menu = $('startMenu');
  if (!orb || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    orb.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.start-item')?.focus({ preventScroll: true });
  };

  on(orb, 'click', (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  // Elegir una opción o hacer clic fuera cierra el menú
  on(menu, 'click', (e) => {
    if (e.target.closest('.start-item, .start-link, .start-lock')) setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== orb) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      orb.focus();
    }
  });
}

function tickClock() {
  const el = $('trayClock');
  if (!el) return;
  const now = new Date();
  el.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  el.title = now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Refleja en la barra de tareas si la emisión está al aire. */
export function setTrayLive(running) {
  const dot = $('trayLive');
  if (!dot) return;
  dot.classList.toggle('off', !running);
  dot.title = running ? 'Al aire' : 'Emisión detenida';
}

export function initShell() {
  initStartMenu();
  tickClock();
  setInterval(tickClock, 15000);
}
