/**
 * Home Channel Master Control - Próximos capítulos: qué episodio sale en cada bloque y,
 * en los estrenos, cambiarlo (mueve el puntero de la serie: sale el elegido y sigue en
 * orden desde ahí). Entra al aire en el próximo :00/:30.
 */

import { $, on, setText } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml, clock12, formatSec } from '/shared/format.js';
import { store, reload, describeResync } from './store.js';
import { refreshScheduleBlocks } from './schedule/blocks.js';

const KINDS = {
  premiere: { label: 'Estreno', badge: 'b-premiere' },
  repeat: { label: 'Repetición', badge: 'b-repeat' },
  marathon: { label: 'Maratón', badge: 'b-marathon' },
  random: { label: 'Al azar', badge: 'b-random' },
  override: { label: 'Pedido a mano', badge: 'b-off' }
};
const DAYS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

let hours = 24;
let airings = [];
let picking = null;
let pickModal = null;

/** "T2 · E05 · Título" (o solo el título si no hay numeración). */
function episodeLabel({ season, episode, title }) {
  const num = [season ? `T${season}` : '', episode ? `E${String(episode).padStart(2, '0')}` : ''].filter(Boolean).join(' · ');
  return num ? `${num} · ${title || ''}` : (title || '');
}

function whenLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return `${sameDay ? '' : `${DAYS[d.getDay()]} `}${clock12(d)}`;
}

/* ---------- Lista ---------- */

function visibleAirings() {
  const q = ($('upcomingSearch')?.value || '').trim().toLowerCase();
  const kind = $('upcomingKind')?.value || '';
  return airings.filter(a => (!kind || a.kind === kind)
    && (!q || `${a.series} ${a.episodeTitle} ${a.showTitle || ''}`.toLowerCase().includes(q)));
}

function rowHtml(a, i) {
  const k = KINDS[a.kind] || KINDS.premiere;
  const pos = a.index >= 0 && a.total ? `<div class="prog-members">${a.index + 1} de ${a.total}</div>` : '';
  const live = a.onAir ? ' <span class="upcoming-live">AL AIRE</span>' : '';
  // Solo los estrenos de series en orden se cambian (lo demás repite un estreno o es al azar)
  const canChange = a.kind === 'premiere' && a.showId && !a.onAir;
  return `
    <tr class="${a.onAir ? 'is-on-air' : ''}">
      <td class="upcoming-time">${escapeHtml(whenLabel(a.startTime))}${live}</td>
      <td><strong>${escapeHtml(a.series)}</strong>${a.showTitle && a.showTitle !== a.series ? `<div class="prog-members">${escapeHtml(a.showTitle)}</div>` : ''}</td>
      <td>${escapeHtml(episodeLabel({ season: a.season, episode: a.episode, title: a.episodeTitle }))}${pos}</td>
      <td><span class="wk-badge ${k.badge}">${k.label}</span></td>
      <td class="num">${canChange ? `<button type="button" class="btn-micro" data-pick="${i}">Cambiar</button>` : ''}</td>
    </tr>`;
}

function render() {
  const body = $('upcomingBody');
  if (!body) return;
  const list = visibleAirings();
  body.innerHTML = list.length
    ? list.map(a => rowHtml(a, airings.indexOf(a))).join('')
    : '<tr><td colspan="5" class="cell-empty">No hay capítulos que coincidan.</td></tr>';
}

export async function refreshUpcoming() {
  try {
    const data = await api.get(`/api/admin/programming/upcoming?hours=${hours}`);
    if (data.success === false) throw new Error(data.error);
    airings = data.airings || [];
    render();
    const premieres = airings.filter(a => a.kind === 'premiere').length;
    setText('upcomingStatus', `${airings.length} capítulos · ${premieres} estrenos${data.pendingResyncAt ? ` · cambio pendiente para las ${clock12(data.pendingResyncAt)}` : ''}`);
  } catch (e) {
    setText('upcomingStatus', `No se pudo cargar: ${e.message}`);
  }
}

/* ---------- Elegir otro capítulo ---------- */

function renderPick() {
  const { airing, show } = picking;
  const q = ($('episodePickSearch')?.value || '').trim().toLowerCase();
  const rows = (show.episodes || []).map((ep, index) => ({ ep, index }))
    .filter(({ ep, index }) => !q || `${index + 1} ${episodeLabel(ep)}`.toLowerCase().includes(q));
  $('episodePickBody').innerHTML = rows.map(({ ep, index }) => {
    const current = index === airing.index;
    return `
      <tr class="${current ? 'is-current' : ''}">
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(episodeLabel(ep))}${current ? ' <span class="prog-members">(el que sale ahora)</span>' : ''}</td>
        <td class="num">${ep.duration ? formatSec(ep.duration) : ''}</td>
        <td class="num">${current ? '' : `<button type="button" class="btn-micro" data-choose="${index}">Poner este</button>`}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="4" class="cell-empty">Ningún capítulo coincide.</td></tr>';
  // El actual a la vista
  $('episodePickBody').querySelector('.is-current')?.scrollIntoView({ block: 'center' });
}

async function openPick(airing) {
  if (!store.findShow(airing.showId)) await reload('shows');
  const show = store.findShow(airing.showId);
  if (!show) return alert('No se encontró la serie.');
  picking = { airing, show };
  $('episodePickDesc').innerHTML = `<strong>${escapeHtml(airing.series)}</strong> · estreno de ${escapeHtml(whenLabel(airing.startTime))}. Sale el capítulo que elijas y la serie sigue en orden desde ahí.`;
  $('episodePickSearch').value = '';
  await pickModal.open();
  renderPick();
}

async function choose(index) {
  const { airing, show } = picking;
  const ep = show.episodes[index];
  if (!confirm(`¿Poner «${episodeLabel(ep)}» en el estreno de ${airing.series} (${whenLabel(airing.startTime)})?\nLos estrenos siguientes siguen en orden desde ese capítulo.`)) return;
  try {
    const data = await api.post(`/api/admin/shows/${encodeURIComponent(show.id)}/progress`, { episodeIndex: index });
    if (data.success === false || data.error) throw new Error(data.error);
    pickModal.close();
    await reload('shows');
    await refreshUpcoming();
    refreshScheduleBlocks();
    setText('upcomingStatus', `✔ ${airing.series}: sale «${episodeLabel(ep)}».${describeResync(data.resyncAt)}`);
  } catch (e) {
    alert('No se pudo cambiar el capítulo: ' + e.message);
  }
}

export function initEpisodes() {
  pickModal = new Modal('episodePickModal', { closers: ['btnCloseEpisodePick', 'btnCancelEpisodePick'], closeOnBackdrop: true });
  on('btnRefreshUpcoming', 'click', refreshUpcoming);
  on('upcomingSearch', 'input', render);
  on('upcomingKind', 'change', render);
  on('episodePickSearch', 'input', renderPick);
  document.querySelectorAll('#tabEpisodes [data-hours]').forEach(btn => btn.addEventListener('click', () => {
    hours = parseInt(btn.dataset.hours, 10);
    document.querySelectorAll('#tabEpisodes [data-hours]').forEach(b => b.classList.toggle('active', b === btn));
    refreshUpcoming();
  }));
  on('upcomingBody', 'click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (btn) openPick(airings[+btn.dataset.pick]);
  });
  on('episodePickBody', 'click', (e) => {
    const btn = e.target.closest('[data-choose]');
    if (btn) choose(+btn.dataset.choose);
  });
}
