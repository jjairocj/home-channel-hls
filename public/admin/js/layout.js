/**
 * Home Channel Master Control - Elementos generales del panel: métricas de la cabecera,
 * tablas legibles en móvil, re-escaneo de la mediateca y cierre de sesión.
 */

import { $, on, setText, withBusy } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { store } from './store.js';

function paintMetrics() {
  const shows = store.get('shows') || [];
  setText('statShowCount', shows.length);
  setText('statEpisodeCount', shows.reduce((n, s) => n + (s.episodes ? s.episodes.length : 0), 0));
  setText('statCommercialCount', (store.get('commercials') || []).length);
}

/**
 * Tablas en móvil: cada celda recibe el nombre de su columna (data-label) para
 * mostrarse como ficha apilada sin scroll horizontal.
 */
function labelTableCells(table) {
  const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
  table.querySelectorAll('tbody tr').forEach(tr => {
    Array.from(tr.children).forEach((td, i) => {
      if (!td.hasAttribute('colspan') && headers[i]) td.setAttribute('data-label', headers[i]);
    });
  });
}

function initMobileTables() {
  document.querySelectorAll('table.matrix-table, table.weekly-matrix-table').forEach(table => {
    labelTableCells(table);
    const body = table.querySelector('tbody');
    if (body) new MutationObserver(() => labelTableCells(table)).observe(body, { childList: true });
  });
}

function initLogout() {
  on('btnAdminLogout', 'click', async () => {
    if (!confirm('¿Desea bloquear el acceso al Master Control Studio?')) return;
    try { await api.post('/api/auth/logout'); } catch (e) {}
    try { sessionStorage.removeItem('x99_admin_auth'); } catch (e) {}
    window.location.href = '/admin/';
  });
}

/** @param {Function} reloadAll - recarga todos los datos del panel */
export function initLayout(reloadAll) {
  store.on('shows', paintMetrics);
  store.on('commercials', paintMetrics);
  initMobileTables();
  initLogout();

  const rescan = $('btnAdminRescanMedia');
  on(rescan, 'click', () => withBusy(rescan, 'Escaneando...', async () => {
    try {
      await api.post('/api/admin/media/rescan');
      await reloadAll();
      alert('¡Biblioteca de medios re-escaneada con éxito!');
    } catch (e) {}
  }));
}
