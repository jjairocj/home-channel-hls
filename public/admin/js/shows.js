/**
 * Home Channel Master Control - Series y capítulos.
 */

import { $, delegate } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml } from '/shared/format.js';
import { store, reload } from './store.js';
import { refreshScheduleBlocks } from './schedule/blocks.js';
import { openUploadModal } from './upload.js';

const EMPTY = `
  <div class="muted center" style="grid-column: 1 / -1;">
    No hay programas registrados todavía. Haz clic en <strong>+ CREAR NUEVO PROGRAMA</strong> para comenzar.
  </div>`;

const SHOWS_PAGE_SIZE = 12;
let showsVisibleCount = SHOWS_PAGE_SIZE;
let showsSearchQuery = '';
let showsSearchDebounce = null;
let lastShowsList = [];

function episodeListHtml(show) {
  const episodes = show.episodes || [];
  if (!episodes.length) return '<div class="muted">Sin capítulos aún. Sube el primero con el botón de abajo.</div>';
  return episodes.map(ep => `
    <div class="episode-item">
      <span class="ep-name">T${ep.season}E${ep.episode}: ${escapeHtml(ep.title)}</span>
      <span class="ep-duration">${escapeHtml(ep.durationFormatted)}</span>
      <button class="btn-delete-icon" data-action="delete-episode" data-show="${escapeHtml(show.id)}" data-ep="${escapeHtml(ep.id)}" title="Eliminar este capítulo">&times;</button>
    </div>`).join('');
}

function findEpisodicInfo(show) {
  const list = store.get('episodic') || [];
  if (!list.length) return null;
  const title = (show.title || '').toLowerCase();
  const cleanTitle = title.replace(/\s*-\s*temporada.*/i, '').trim();
  return list.find(e => {
    const epLabel = (e.label || '').toLowerCase();
    const epKey = (e.sagaKey || e.key || '').toLowerCase();
    return title.includes(epLabel) || epLabel.includes(cleanTitle) || title.includes(epKey) || epKey.includes(cleanTitle);
  });
}

function progressSelectHtml(show) {
  const episodes = show.episodes || [];
  if (!episodes.length) return '';
  const current = show.currentEpisodeIndex || 0;
  return `
    <div class="show-progression-bar">
      <span>📡 <strong>Próximo:</strong></span>
      <select class="admin-input-compact" data-action="set-progress" data-show="${escapeHtml(show.id)}">
        ${episodes.map((e, i) => `<option value="${i}" ${i === current ? 'selected' : ''}>Ep ${i + 1}: ${escapeHtml(e.title)}</option>`).join('')}
      </select>
    </div>`;
}

function showCardHtml(show) {
  const count = (show.episodes || []).length;
  const color = escapeHtml(show.color || 'var(--cyan)');
  const epInfo = findEpisodicInfo(show);
  const progressionHtml = epInfo
    ? `
      <div class="episodic-cycle-bar" style="margin: 6px 0 10px 0; padding: 7px 10px; background: rgba(0, 240, 255, 0.08); border: 1px solid rgba(0, 240, 255, 0.25); border-radius: 6px; font-size: 11px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span>🎲 <strong>Emisión aleatoria:</strong> ${epInfo.seenCount}/${epInfo.totalEpisodes} emitidos (Ciclo ${epInfo.cycle})</span>
          <button class="btn-micro" data-action="reset-episodic" data-key="${escapeHtml(epInfo.key)}" style="font-size: 10px; padding: 2px 6px;" title="Reiniciar ciclo de emisión aleatoria">🔄 Reiniciar</button>
        </div>
        <div style="width: 100%; background: rgba(255,255,255,0.1); height: 4px; border-radius: 2px; overflow: hidden;">
          <div style="width: ${epInfo.percent}%; background: var(--cyan); height: 100%; transition: width 0.3s;"></div>
        </div>
      </div>`
    : progressSelectHtml(show);
  return `
    <div class="show-card" style="border-left: 4px solid ${color}; --tag: ${color};">
      <div class="show-card-header">
        <div>
          <h3 class="show-title">${escapeHtml(show.title)}</h3>
          <span class="show-desc">${escapeHtml(show.description || 'Sin descripción')}</span>
        </div>
        <span class="show-category-tag">${escapeHtml(show.category || 'General')}</span>
      </div>
      ${progressionHtml}
      <div class="show-episodes-list">${episodeListHtml(show)}</div>
      <div class="show-card-footer">
        <span class="count-label">${count} ${count === 1 ? 'capítulo' : 'capítulos'}</span>
        <div class="actions">
          <button class="btn-micro" data-action="upload-for-show" data-show="${escapeHtml(show.id)}">+ Subir Capítulo</button>
          <button class="btn-micro-danger" data-action="delete-show" data-show="${escapeHtml(show.id)}" title="Eliminar este programa y todos sus capítulos físicos del disco">🗑️ Borrar Programa</button>
        </div>
      </div>
    </div>`;
}

function renderShows(shows) {
  if (shows) lastShowsList = shows;
  const container = $('showsListContainer');
  if (!container) return;

  const allShows = lastShowsList || [];
  let filtered = allShows;

  if (showsSearchQuery) {
    filtered = filtered.filter(show => {
      const title = (show.title || '').toLowerCase();
      const cat = (show.category || '').toLowerCase();
      const desc = (show.description || '').toLowerCase();
      return title.includes(showsSearchQuery) || cat.includes(showsSearchQuery) || desc.includes(showsSearchQuery);
    });
  }

  const countLabel = $('showsCountLabel');
  if (countLabel) {
    countLabel.textContent = `${filtered.length} ${filtered.length === 1 ? 'programa' : 'programas'}${showsSearchQuery ? ' encontrados' : ''}`;
  }

  if (!filtered.length) {
    container.innerHTML = showsSearchQuery
      ? `<div class="muted center" style="grid-column: 1 / -1;">No se encontraron programas que coincidan con "${escapeHtml(showsSearchQuery)}".</div>`
      : EMPTY;
    return;
  }

  const total = filtered.length;
  const sliced = filtered.slice(0, showsVisibleCount);
  const remaining = total - sliced.length;

  let html = sliced.map(showCardHtml).join('');
  if (remaining > 0) {
    html += `
      <div class="shows-pagination-bar" style="grid-column: 1 / -1;">
        <div class="pagination-info">Mostrando ${sliced.length} de ${total} programas</div>
        <div class="pagination-actions">
          <button type="button" id="btnLoadMoreShows" class="btn-studio btn-primary">🔽 Cargar más (${Math.min(remaining, SHOWS_PAGE_SIZE)} siguientes · ${remaining} restantes)</button>
          <button type="button" id="btnLoadAllShows" class="btn-studio btn-secondary">Mostrar todos (${remaining})</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/** Cambio en la base que afecta la emisión: recargar series y parrilla. */
async function mutate(request, errorLabel) {
  try {
    const data = await request();
    if (!data.success) return alert(`${errorLabel}: ${data.error || 'Desconocido'}`);
    await reload('shows');
    await refreshScheduleBlocks();
  } catch (e) {
    alert(`${errorLabel}: ${e.message}`);
  }
}

const actions = {
  'delete-episode': (el) => {
    if (!confirm('¿Eliminar este capítulo de la emisión y borrar el archivo físico del disco de 2TB?')) return;
    mutate(() => api.del(`/api/admin/shows/${el.dataset.show}/episodes/${el.dataset.ep}`), 'Error al eliminar capítulo');
  },
  'delete-show': (el) => {
    const show = store.findShow(el.dataset.show);
    const name = show ? `"${show.title}"` : 'este programa';
    if (!confirm(`¿Estás seguro de eliminar ${name} y todos sus capítulos?\nEsta acción también borrará los archivos físicos de video del disco de 2TB y regenerará la parrilla de emisión.`)) return;
    mutate(() => api.del(`/api/admin/shows/${el.dataset.show}`), 'Error al eliminar programa');
  },
  'upload-for-show': (el) => openUploadModal({ type: 'show', showId: el.dataset.show }),
  'reset-episodic': async (el) => {
    const key = el.dataset.key;
    if (!confirm(`¿Reiniciar el ciclo de emisión aleatoria para ${key}?\n\nComenzará de nuevo con todos los capítulos en una nueva mezcla aleatoria sin repeticiones.`)) return;
    try {
      await api.post(`/api/admin/shows/episodic-progress/${encodeURIComponent(key)}/reset`);
      await reload('episodic');
      await reload('shows');
      await reload('programming');
      await refreshScheduleBlocks();
    } catch (e) {
      alert('Error al reiniciar ciclo: ' + e.message);
    }
  }
};

/* ---------- Crear serie ---------- */

function initCreateShowForm() {
  const modal = new Modal('createShowModal', {
    openers: ['btnCreateShowModal'],
    closers: ['btnCloseCreateShowModal', 'btnCancelCreateShow']
  });
  const form = $('createShowForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('newShowTitle').value.trim();
    if (!title) return;
    try {
      await api.post('/api/admin/shows', {
        title,
        category: $('newShowCategory').value,
        color: $('newShowColor').value,
        description: $('newShowDesc').value.trim()
      });
      modal.close();
      form.reset();
      await reload('shows');
      alert(`¡Serie "${title}" creada exitosamente! Ahora puedes subir sus capítulos.`);
    } catch (err) {
      alert('Error creando serie: ' + err.message);
    }
  });
}

export function initShows() {
  const container = $('showsListContainer');
  delegate(container, 'click', actions);
  delegate(container, 'change', {
    'set-progress': (el) => mutate(
      () => api.post(`/api/admin/shows/${el.dataset.show}/progress`, { episodeIndex: parseInt(el.value, 10) }),
      'Error al actualizar progreso'
    )
  });

  if (container) {
    container.addEventListener('click', (e) => {
      if (e.target.closest('#btnLoadMoreShows')) {
        showsVisibleCount += SHOWS_PAGE_SIZE;
        renderShows();
      } else if (e.target.closest('#btnLoadAllShows')) {
        showsVisibleCount = Infinity;
        renderShows();
      }
    });
  }

  const searchInput = $('showsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(showsSearchDebounce);
      showsSearchDebounce = setTimeout(() => {
        showsSearchQuery = (e.target.value || '').toLowerCase().trim();
        showsVisibleCount = SHOWS_PAGE_SIZE;
        renderShows();
      }, 150);
    });
  }

  initCreateShowForm();
  store.on('shows', renderShows);
  store.on('episodic', () => renderShows());
}
