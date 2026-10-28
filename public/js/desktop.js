/**
 * Home Channel HLS - Escritorio: menú Inicio, íconos, cuadro de mensaje y contador.
 */

import { $ } from '../shared/dom.js';

/**
 * @param {Object} actions - { tv, fullscreen, openTab(tabId) }
 * @param {Function} onEscape - cierra ventanas abiertas
 */
export function initDesktop(actions, onEscape) {
  const startBtn = $('btnStart');
  const startMenu = $('startMenu');
  const setStartOpen = (open) => {
    if (!startMenu || !startBtn) return;
    startMenu.classList.toggle('open', open);
    startBtn.setAttribute('aria-expanded', String(open));
  };

  startBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setStartOpen(!startMenu.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (startMenu && !startMenu.contains(e.target)) setStartOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    setStartOpen(false);
    closeMessage();
    onEscape();
  });

  // Íconos del escritorio y menú Inicio comparten data-action
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      if (action === 'tv') actions.tv();
      else if (action === 'fullscreen') actions.fullscreen();
      else if (action && action.startsWith('tab')) actions.openTab(action);
      setStartOpen(false);
    });
  });

  document.querySelectorAll('[data-close-msgbox]').forEach(el => el.addEventListener('click', closeMessage));
  paintHitCounter();
}

export function closeMessage() {
  $('msgBox')?.classList.remove('active');
}

/** Contador de visitas a la antigua (por navegador). */
function paintHitCounter() {
  const counter = $('hitCounter');
  if (!counter) return;
  let hits = 1999;
  try {
    hits = parseInt(localStorage.getItem('x99_hits') || '1998', 10) + 1;
    localStorage.setItem('x99_hits', String(hits));
  } catch (e) {}
  counter.textContent = String(hits).padStart(6, '0');
}
