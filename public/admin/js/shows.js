/**
 * Home Channel HLS Master Control - Series y capítulos.
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

const SHOWS_PAGE_SIZE = 24;
let showsVisibleCount = SHOWS_PAGE_SIZE;
let showsSearchQuery = '';
let showsSearchDebounce = null;
let lastShowsList = [];

// Modal de gestión de programa
let manageModal = null;
let currentManagedShowId = null;
let currentSeasonFilter = 'all';
let currentEpSearchQuery = '';

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

function showCardHtml(show) {
  const count = (show.episodes || []).length;
  const color = escapeHtml(show.color || 'var(--cyan)');
  const epInfo = findEpisodicInfo(show);

  let statusHtml = '';
  if (epInfo) {
    statusHtml = `
      <div class="show-card-status-pill episodic" title="Emisión aleatoria activa">
        <span>🎲 <strong>Aleatorio:</strong> ${epInfo.seenCount}/${epInfo.totalEpisodes}</span>
        <span class="show-card-status-badge">Ciclo ${epInfo.cycle} (${epInfo.percent}%)</span>
      </div>`;
  } else if (count > 0) {
    const curIdx = Math.min(Math.max(show.currentEpisodeIndex || 0, 0), count - 1);
    const nextEp = show.episodes[curIdx] || show.episodes[0];
    const nextLabel = nextEp ? `T${nextEp.season}E${nextEp.episode} · ${escapeHtml(nextEp.title)}` : 'Capítulo 1';
    statusHtml = `
      <div class="show-card-status-pill sequential" title="Próximo capítulo a emitir">
        <span>📡 <strong>Próximo:</strong></span>
        <span class="show-card-status-ep">${nextLabel}</span>
      </div>`;
  } else {
    statusHtml = `
      <div class="show-card-status-pill empty">
        <span>⚠️ Sin capítulos cargados</span>
      </div>`;
  }

  return `
    <div class="show-card" data-action="open-manage-show" data-show="${escapeHtml(show.id)}" style="border-left: 4px solid ${color}; --tag: ${color};">
      <div class="show-card-header">
        <div>
          <h3 class="show-title">${escapeHtml(show.title)}</h3>
          <span class="show-desc">${escapeHtml(show.description || 'Sin descripción')}</span>
        </div>
        <span class="show-category-tag">${escapeHtml(show.category || 'General')}</span>
      </div>
      ${statusHtml}
      <div class="show-card-footer">
        <span class="count-label">📦 ${count} ${count === 1 ? 'capítulo' : 'capítulos'}</span>
        <span class="btn-micro" style="pointer-events: none;">⚙️ Administrar</span>
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

  // Si el modal está abierto, refrescar su contenido
  if (manageModal && manageModal.isOpen && currentManagedShowId) {
    const updatedShow = store.findShow(currentManagedShowId);
    if (updatedShow) {
      renderModalProgression(updatedShow);
      renderModalEpisodes(updatedShow);
    }
  }
}

/** Cambio en la base que afecta la emisión: recargar series y parrilla. */
async function mutate(request, errorLabel) {
  try {
    const data = await request();
    if (!data.success) return alert(`${errorLabel}: ${data.error || 'Desconocido'}`);
    await reload('shows');
    await refreshScheduleBlocks();
    return data;
  } catch (e) {
    alert(`${errorLabel}: ${e.message}`);
    return null;
  }
}

/* ===================================================================
   MODAL DE GESTIÓN DE PROGRAMA
   =================================================================== */

function renderModalProgression(show) {
  const container = $('manageShowProgressionSection');
  if (!container) return;

  const epInfo = findEpisodicInfo(show);
  if (epInfo) {
    container.innerHTML = `
      <div class="episodic-cycle-bar" style="padding: 2px 0; font-size: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span>🎲 <strong>Emisión aleatoria:</strong> ${epInfo.seenCount}/${epInfo.totalEpisodes} emitidos (Ciclo ${epInfo.cycle})</span>
          <button type="button" class="btn-micro" id="btnModalResetEpisodic" data-key="${escapeHtml(epInfo.key)}" style="font-size: 11px; padding: 3px 8px;" title="Reiniciar ciclo de emisión aleatoria">🔄 Reiniciar ciclo</button>
        </div>
        <div style="width: 100%; background: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden;">
          <div style="width: ${epInfo.percent}%; background: var(--cyan); height: 100%; transition: width 0.3s;"></div>
        </div>
      </div>`;
    const btnReset = $('btnModalResetEpisodic');
    if (btnReset) {
      btnReset.addEventListener('click', async () => {
        if (!confirm(`¿Reiniciar el ciclo de emisión aleatoria para ${epInfo.key}?\n\nComenzará de nuevo con todos los capítulos en una nueva mezcla aleatoria sin repeticiones.`)) return;
        try {
          await api.post(`/api/admin/shows/episodic-progress/${encodeURIComponent(epInfo.key)}/reset`);
          await reload('episodic');
          await reload('shows');
          await reload('programming');
          await refreshScheduleBlocks();
        } catch (e) {
          alert('Error al reiniciar ciclo: ' + e.message);
        }
      });
    }
  } else {
    const episodes = show.episodes || [];
    if (!episodes.length) {
      container.innerHTML = '<span class="muted" style="font-size: 12px;">⚠️ Sin capítulos cargados. Sube episodios para configurar el orden de emisión.</span>';
    } else {
      const current = Math.min(Math.max(show.currentEpisodeIndex || 0, 0), episodes.length - 1);
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
          <label for="manageShowProgressSelect" style="font-size: 12px; font-weight: 600; color: var(--heading); white-space: nowrap; margin-bottom: 0;">
            📡 Próximo capítulo a emitir:
          </label>
          <select id="manageShowProgressSelect" class="admin-input-compact" style="flex: 1; min-width: 260px;">
            ${episodes.map((e, i) => `<option value="${i}" ${i === current ? 'selected' : ''}>T${e.season}E${e.episode}: ${escapeHtml(e.title)}</option>`).join('')}
          </select>
        </div>`;
      const select = $('manageShowProgressSelect');
      if (select) {
        select.addEventListener('change', async (e) => {
          const episodeIndex = parseInt(e.target.value, 10);
          await mutate(
            () => api.post(`/api/admin/shows/${show.id}/progress`, { episodeIndex }),
            'Error al actualizar progreso'
          );
        });
      }
    }
  }
}

function renderModalEpisodes(show) {
  if (!show) show = store.findShow(currentManagedShowId);
  if (!show) return;

  const container = $('manageShowEpListContainer');
  const countBadge = $('manageShowEpCountBadge');
  if (!container) return;

  const episodes = show.episodes || [];
  const totalCount = episodes.length;

  let filtered = episodes;
  if (currentSeasonFilter !== 'all') {
    const sNum = parseInt(currentSeasonFilter, 10);
    filtered = filtered.filter(e => e.season === sNum);
  }
  if (currentEpSearchQuery) {
    filtered = filtered.filter(e => {
      const title = (e.title || '').toLowerCase();
      const epCode = `t${e.season}e${e.episode}`.toLowerCase();
      return title.includes(currentEpSearchQuery) || epCode.includes(currentEpSearchQuery);
    });
  }

  if (countBadge) {
    countBadge.textContent = `${totalCount} ${totalCount === 1 ? 'capítulo' : 'capítulos'}${filtered.length !== totalCount ? ` (${filtered.length} mostrados)` : ''}`;
  }

  if (!filtered.length) {
    container.innerHTML = totalCount === 0
      ? '<div class="muted" style="padding: 12px; text-align: center;">Sin capítulos aún. Sube el primero usando el botón <strong>＋ Subir Capítulo</strong>.</div>'
      : '<div class="muted" style="padding: 12px; text-align: center;">No hay capítulos que coincidan con la búsqueda o filtro de temporada.</div>';
    return;
  }

  container.innerHTML = filtered.map(ep => `
    <div class="episode-item" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #f1f5f9;">
      <span class="ep-name" style="font-size: 12px;"><strong>T${ep.season}E${ep.episode}:</strong> ${escapeHtml(ep.title)}</span>
      <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
        <span class="ep-duration" style="font-size: 11px; color: var(--text-dim);">${escapeHtml(ep.durationFormatted || '')}</span>
        <button type="button" class="btn-delete-icon" data-action="delete-modal-ep" data-show="${escapeHtml(show.id)}" data-ep="${escapeHtml(ep.id)}" title="Eliminar este capítulo de la emisión">&times;</button>
      </div>
    </div>
  `).join('');
}

function openManageShow(showId) {
  const show = store.findShow(showId);
  if (!show) return;

  currentManagedShowId = showId;
  currentSeasonFilter = 'all';
  currentEpSearchQuery = '';

  const modalTitle = $('manageShowModalTitle');
  if (modalTitle) modalTitle.textContent = `🎬 Administrar: ${show.title}`;

  if ($('manageShowId')) $('manageShowId').value = show.id;
  if ($('manageShowTitle')) $('manageShowTitle').value = show.title || '';
  if ($('manageShowCategory')) $('manageShowCategory').value = show.category || 'General';
  if ($('manageShowColor')) $('manageShowColor').value = show.color || '#00f0ff';
  if ($('manageShowDesc')) $('manageShowDesc').value = show.description || '';

  // Filtro de temporadas
  const seasonSelect = $('manageShowSeasonFilter');
  if (seasonSelect) {
    const seasons = [...new Set((show.episodes || []).map(e => e.season).filter(s => s !== undefined && s !== null))].sort((a, b) => a - b);
    let optionsHtml = '<option value="all">Todas las temporadas</option>';
    for (const s of seasons) {
      optionsHtml += `<option value="${s}">Temporada ${s}</option>`;
    }
    seasonSelect.innerHTML = optionsHtml;
    seasonSelect.value = 'all';
  }

  const epSearch = $('manageShowEpSearch');
  if (epSearch) epSearch.value = '';

  renderModalProgression(show);
  renderModalEpisodes(show);

  if (manageModal) manageModal.open();
}

function initManageShowModal() {
  manageModal = new Modal('manageShowModal', {
    closers: ['btnCloseManageShowModal', 'btnCancelManageShow'],
    closeOnBackdrop: true
  });

  const form = $('manageShowForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentManagedShowId) return;
      const title = $('manageShowTitle').value.trim();
      if (!title) return alert('El nombre del programa es obligatorio');
      const category = $('manageShowCategory').value;
      const color = $('manageShowColor').value;
      const description = $('manageShowDesc').value.trim();

      try {
        await api.put(`/api/admin/shows/${currentManagedShowId}`, { title, category, color, description });
        await reload('shows');
        await refreshScheduleBlocks();
        const updatedShow = store.findShow(currentManagedShowId);
        if (updatedShow) {
          const modalTitle = $('manageShowModalTitle');
          if (modalTitle) modalTitle.textContent = `🎬 Administrar: ${updatedShow.title}`;
        }
        alert(`¡Programa "${title}" actualizado exitosamente!`);
      } catch (err) {
        alert('Error actualizando programa: ' + err.message);
      }
    });
  }

  const seasonFilter = $('manageShowSeasonFilter');
  if (seasonFilter) {
    seasonFilter.addEventListener('change', (e) => {
      currentSeasonFilter = e.target.value;
      renderModalEpisodes();
    });
  }

  const epSearch = $('manageShowEpSearch');
  if (epSearch) {
    epSearch.addEventListener('input', (e) => {
      currentEpSearchQuery = (e.target.value || '').toLowerCase().trim();
      renderModalEpisodes();
    });
  }

  const btnDeleteShow = $('btnManageDeleteShow');
  if (btnDeleteShow) {
    btnDeleteShow.addEventListener('click', async () => {
      if (!currentManagedShowId) return;
      const show = store.findShow(currentManagedShowId);
      const name = show ? `"${show.title}"` : 'este programa';
      if (!confirm(`¿Estás seguro de eliminar ${name} y todos sus capítulos?\nEsta acción también borrará los archivos físicos de video del disco de 2TB y regenerará la parrilla de emisión.`)) return;
      await mutate(() => api.del(`/api/admin/shows/${currentManagedShowId}`), 'Error al eliminar programa');
      if (manageModal) manageModal.close();
      currentManagedShowId = null;
    });
  }

  const btnUploadEp = $('btnManageUploadEp');
  if (btnUploadEp) {
    btnUploadEp.addEventListener('click', () => {
      if (!currentManagedShowId) return;
      const targetShowId = currentManagedShowId;
      if (manageModal) manageModal.close();
      openUploadModal({ type: 'show', showId: targetShowId });
    });
  }

  // Delegación de borrado de episodios dentro del modal
  const epContainer = $('manageShowEpListContainer');
  if (epContainer) {
    delegate(epContainer, 'click', {
      'delete-modal-ep': async (el) => {
        if (!confirm('¿Eliminar este capítulo de la emisión y borrar el archivo físico del disco de 2TB?')) return;
        const showId = el.dataset.show;
        const epId = el.dataset.ep;
        await mutate(() => api.del(`/api/admin/shows/${showId}/episodes/${epId}`), 'Error al eliminar capítulo');
        const show = store.findShow(showId);
        if (show) {
          renderModalProgression(show);
          renderModalEpisodes(show);
        }
      }
    });
  }
}

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
  delegate(container, 'click', {
    'open-manage-show': (el) => openManageShow(el.dataset.show)
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
  initManageShowModal();
  store.on('shows', renderShows);
  store.on('episodic', () => renderShows());
}
