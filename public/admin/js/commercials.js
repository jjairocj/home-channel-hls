/**
 * Home Channel Master Control - Comerciales, cortinillas y control de rotación.
 */

import { $, on, delegate } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { escapeHtml } from '/shared/format.js';
import { Modal } from '/shared/modal.js';
import { store, reload, describeResync } from './store.js';
import { goToTab } from './tabs.js';
import { refreshTranscode } from './transcode.js';

const ROTATIONS = {
  high: 'Alta (2x)',
  normal: 'Normal (1x)',
  low: 'Baja (≈1/3)',
  very_low: 'Muy Baja (≈1/6)',
  paused: 'Pausado (no sale)'
};

let filter = 'all';
let searchQuery = '';
let visibleCount = 24;
const PAGE_SIZE = 24;
let debounceTimer = null;
let viewMode = localStorage.getItem('commercials_view_mode') || 'grid';
let tableSortCol = 'airCount';
let tableSortDir = 'desc';

const EMPTY = `
  <div class="muted center" style="grid-column: 1 / -1; padding: 24px;">
    No hay elementos en esta categoría. Puedes subir tandas con <strong>+ SUBIR COMERCIAL / BUMPER</strong>.
  </div>`;

function formatRelativeTime(isoStr) {
  if (!isoStr) return '<span style="color: #94a3b8;">Sin emisiones</span>';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  if (diffMs < 0) return 'Ahora';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '<span style="color: #059669; font-weight: 600;">Ahora mismo</span>';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} d`;
}

function cardHtml(c) {
  const isBumper = c.type === 'bumper';
  const title = escapeHtml(c.title || 'Sin título');
  const filename = c.filename || (c.path ? c.path.split('/').pop() : '');
  const rotation = c.rotation || 'normal';
  const videoUrl = c.videoUrl || `/api/admin/commercials/${encodeURIComponent(c.id)}/video`;
  const airCount = c.airCount || 0;
  const isCoolingDown = !!c.isCoolingDown;
  const remainingCooldown = c.remainingCooldownBlocks || 0;

  const coolingBadge = isBumper
    ? `<span class="badge-ready" style="background: rgba(255, 170, 0, 0.12); border-color: rgba(255, 170, 0, 0.35); color: #ffaa00;" title="Cortinilla fija: se emite automáticamente según su función (apertura, corte o cierre)">🏷️ Cortinilla Fija</span>`
    : (isCoolingDown
      ? `<span class="badge-cooling" title="En enfriamiento para evitar repeticiones seguidas">❄️ Enfriando (${remainingCooldown} blq)</span>`
      : `<span class="badge-ready" title="Disponible para salir al aire">✅ Listo</span>`);

  // Solo los comerciales rotan; los bumpers se eligen por su función
  const rotationSelect = isBumper ? '' : `
      <label class="comm-rotation" style="margin-top: 4px;">
        Rotación:
        <select class="admin-input-compact" data-action="rotation" data-id="${escapeHtml(c.id)}">
          ${Object.entries(ROTATIONS).map(([k, label]) => `<option value="${k}" ${k === rotation ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>`;
  const dimmed = rotation === 'paused' || rotation === 'low' || rotation === 'very_low' ? ` ${rotation}` : '';

  return `
    <div class="comm-card${dimmed}" id="comm-card-${escapeHtml(c.id)}">
      <div class="comm-header">
        <span class="show-category-tag comm-type-tag ${isBumper ? 'bumper' : 'commercial'}">
          ${escapeHtml((c.type || 'commercial').toUpperCase())}
        </span>
        <div style="display: flex; gap: 4px; align-items: center;">
          <a href="${escapeHtml(videoUrl)}" download="${escapeHtml(filename)}" class="btn-studio btn-secondary btn-sm" title="Descargar video MP4" style="padding: 2px 7px; font-size: 11px;">⬇ MP4</a>
          <button class="btn-micro-danger" data-action="delete-commercial" data-id="${escapeHtml(c.id)}" title="Eliminar ${escapeHtml(c.type)}">🗑️</button>
        </div>
      </div>
      <div class="comm-title" title="${title}">${title}</div>
      <div class="comm-player video-player-wrap" style="margin: 6px 0;">
        <div class="bumper-video-placeholder" data-video-url="${escapeHtml(videoUrl)}" title="Haz clic para reproducir ${escapeHtml(title)}">
          <div class="bumper-play-btn">
            <span class="play-icon">▶</span>
            <span class="play-label">Reproducir Video</span>
          </div>
          <span class="bumper-video-badge">${escapeHtml(c.durationFormatted || '00:00')} · MP4</span>
        </div>
      </div>
      <div class="comm-meta">
        <span class="comm-duration">${escapeHtml(c.durationFormatted || '00:00')}</span>
        <span class="comm-size">${escapeHtml(c.sizeMB || '0')} MB</span>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin: 2px 0;">
        <span class="badge-air-count" title="Total de veces que ha salido al aire">📊 ${airCount} emisiones</span>
        ${coolingBadge}
      </div>
      <div class="comm-filename" title="${escapeHtml(filename)}">
        📁 ${escapeHtml(filename)}
      </div>${rotationSelect}
    </div>`;
}

function tableRowHtml(c) {
  const isBumper = c.type === 'bumper';
  const title = escapeHtml(c.title || 'Sin título');
  const filename = c.filename || (c.path ? c.path.split('/').pop() : '');
  const rotation = c.rotation || 'normal';
  const videoUrl = c.videoUrl || `/api/admin/commercials/${encodeURIComponent(c.id)}/video`;
  const airCount = c.airCount || 0;
  const isCoolingDown = !!c.isCoolingDown;
  const remainingCooldown = c.remainingCooldownBlocks || 0;

  const coolingBadge = isBumper
    ? `<span class="badge-ready" style="background: rgba(255, 170, 0, 0.12); border-color: rgba(255, 170, 0, 0.35); color: #ffaa00;" title="Cortinilla fija: se emite automáticamente según su función">🏷️ Cortinilla Fija</span>`
    : (isCoolingDown
      ? `<span class="badge-cooling" title="En enfriamiento activo">❄️ Enfriando (${remainingCooldown} blq)</span>`
      : `<span class="badge-ready" title="Listo para salir al aire">✅ Listo</span>`);

  const rotationSelect = isBumper ? '<span class="muted" style="font-size: 11px;">Bumper Fijo</span>' : `
      <select class="admin-input-compact" data-action="rotation" data-id="${escapeHtml(c.id)}" style="font-size: 11px; padding: 2px 4px;">
        ${Object.entries(ROTATIONS).map(([k, label]) => `<option value="${k}" ${k === rotation ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`;

  return `
    <tr id="comm-row-${escapeHtml(c.id)}">
      <td style="text-align: center;">
        <button type="button" class="comm-mini-play" data-action="play-modal" data-video-url="${escapeHtml(videoUrl)}" data-title="${title}" title="Reproducir video">▶</button>
      </td>
      <td>
        <strong style="color: #1e3a5f;">${title}</strong>
        <div style="font-size: 11px; color: #94a3b8; font-family: var(--font-mono);">${escapeHtml(filename)}</div>
      </td>
      <td>
        <span class="show-category-tag comm-type-tag ${isBumper ? 'bumper' : 'commercial'}" style="font-size: 10px;">
          ${escapeHtml((c.type || 'commercial').toUpperCase())}
        </span>
      </td>
      <td style="text-align: center; font-variant-numeric: tabular-nums;">${escapeHtml(c.durationFormatted || '00:00')}</td>
      <td style="text-align: center;">
        <span class="badge-air-count">${airCount} veces</span>
      </td>
      <td style="font-size: 12px;">${formatRelativeTime(c.lastAiredAt)}</td>
      <td style="text-align: center;">${coolingBadge}</td>
      <td>${rotationSelect}</td>
      <td style="text-align: center;">
        <div style="display: flex; gap: 4px; justify-content: center; align-items: center;">
          <a href="${escapeHtml(videoUrl)}" download="${escapeHtml(filename)}" class="btn-studio btn-secondary btn-sm" title="Descargar MP4" style="padding: 2px 6px; font-size: 11px;">⬇</a>
          <button class="btn-micro-danger" data-action="delete-commercial" data-id="${escapeHtml(c.id)}" title="Eliminar ${escapeHtml(c.type)}">🗑️</button>
        </div>
      </td>
    </tr>`;
}

function getFilteredItems() {
  let items = (store.get('commercials') || []).filter(c => filter === 'all' || c.type === filter);

  if (searchQuery) {
    items = items.filter(c => {
      const title = (c.title || '').toLowerCase();
      const fn = (c.filename || (c.path ? c.path.split('/').pop() : '')).toLowerCase();
      const type = (c.type || '').toLowerCase();
      return title.includes(searchQuery) || fn.includes(searchQuery) || type.includes(searchQuery);
    });
  }
  return items;
}

function sortTableItems(items) {
  const sorted = [...items];
  const mult = tableSortDir === 'desc' ? -1 : 1;

  sorted.sort((a, b) => {
    if (tableSortCol === 'airCount') {
      return ((a.airCount || 0) - (b.airCount || 0)) * mult;
    }
    if (tableSortCol === 'duration') {
      return ((a.duration || 0) - (b.duration || 0)) * mult;
    }
    if (tableSortCol === 'lastAired') {
      const ta = a.lastAiredAt ? new Date(a.lastAiredAt).getTime() : 0;
      const tb = b.lastAiredAt ? new Date(b.lastAiredAt).getTime() : 0;
      return (ta - tb) * mult;
    }
    if (tableSortCol === 'type') {
      return (a.type || '').localeCompare(b.type || '') * mult;
    }
    // Default title
    return (a.title || '').localeCompare(b.title || '') * mult;
  });
  return sorted;
}

function render() {
  const gridContainer = $('commercialsListContainer');
  const tableWrap = $('commercialsTableWrap');
  const tableBody = $('commercialsTableBody');
  if (!gridContainer || !tableWrap) return;

  const items = getFilteredItems();

  const countLabel = $('commercialsCountLabel');
  if (countLabel) {
    countLabel.textContent = `${items.length} ${items.length === 1 ? 'elemento' : 'elementos'}`;
  }

  // Update view mode toggle buttons
  const btnGrid = $('btnCommercialsViewGrid');
  const btnTable = $('btnCommercialsViewTable');
  if (btnGrid && btnTable) {
    btnGrid.classList.toggle('active', viewMode === 'grid');
    btnTable.classList.toggle('active', viewMode === 'table');
  }

  if (viewMode === 'grid') {
    gridContainer.style.display = 'grid';
    tableWrap.style.display = 'none';

    if (!items.length) {
      gridContainer.innerHTML = EMPTY;
      return;
    }

    const totalItems = items.length;
    const visibleItems = items.slice(0, visibleCount);
    const remaining = totalItems - visibleItems.length;

    let paginationHtml = '';
    if (remaining > 0) {
      paginationHtml = `
        <div class="bumpers-pagination-bar" style="grid-column: 1 / -1;">
          <div class="pagination-info">Mostrando ${visibleItems.length} de ${totalItems} elementos</div>
          <div class="pagination-actions">
            <button type="button" id="btnLoadMoreCommercials" class="btn-studio btn-primary">
              🔽 Cargar más (${Math.min(remaining, PAGE_SIZE)} siguientes · ${remaining} restantes)
            </button>
            <button type="button" id="btnLoadAllCommercials" class="btn-studio btn-secondary">
              Mostrar todos (${remaining})
            </button>
          </div>
        </div>
      `;
    }

    gridContainer.innerHTML = visibleItems.map(cardHtml).join('') + paginationHtml;
  } else {
    gridContainer.style.display = 'none';
    tableWrap.style.display = 'block';

    if (!items.length) {
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="9" class="muted center" style="padding: 24px;">No se encontraron comerciales en esta vista.</td></tr>`;
      return;
    }

    const sorted = sortTableItems(items);
    if (tableBody) {
      tableBody.innerHTML = sorted.map(tableRowHtml).join('');
    }

    // Update table header sorting indicators
    const headers = document.querySelectorAll('#commercialsRotationTable th[data-sort]');
    headers.forEach(th => {
      const col = th.dataset.sort;
      if (col === tableSortCol) {
        th.setAttribute('aria-sort', tableSortDir === 'desc' ? 'descending' : 'ascending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }
}

async function loadRotationConfig() {
  try {
    const res = await api.get('/api/admin/commercials/rotation');
    if (!res || !res.success) return;

    const sepSelect = $('rotationMinSeparationSelect');
    if (sepSelect && res.config && res.config.minSeparationBlocks != null) {
      sepSelect.value = String(res.config.minSeparationBlocks);
    }

    const spotsSelect = $('rotationMaxSpotsSelect');
    if (spotsSelect && res.config && res.config.maxSpotsPerBreak != null) {
      spotsSelect.value = String(res.config.maxSpotsPerBreak);
    }

    const statComms = $('rotationStatTotalComms');
    if (statComms && res.summary) {
      statComms.textContent = `📼 ${res.summary.totalCommercials} comerciales (${res.summary.activeCommercials} activos)`;
    }

    const statAirings = $('rotationStatTotalAirings');
    if (statAirings && res.summary) {
      statAirings.textContent = `📊 ${res.summary.totalAirings} emisiones registradas`;
    }
  } catch (e) {
    console.warn('[Commercials] No se pudo cargar config de rotación:', e.message);
  }
}

async function saveRotationConfig() {
  const sepSelect = $('rotationMinSeparationSelect');
  const spotsSelect = $('rotationMaxSpotsSelect');
  if (!sepSelect || !spotsSelect) return;

  const minSeparationBlocks = parseInt(sepSelect.value, 10);
  const maxSpotsPerBreak = parseInt(spotsSelect.value, 10);

  const btn = $('btnSaveRotationConfig');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando...';
  }

  try {
    const res = await api.put('/api/admin/commercials/rotation/config', {
      minSeparationBlocks,
      maxSpotsPerBreak
    });

    if (res.success) {
      await reload('commercials');
      await loadRotationConfig();
      alert(`Ajustes de rotación guardados exitosamente.\n\n• Separación mínima: ${minSeparationBlocks} bloques (${(minSeparationBlocks * 30) / 60} horas)\n• Spots por tanda: ${maxSpotsPerBreak > 0 ? maxSpotsPerBreak : 'Sin límite'}.${describeResync(res.resyncAt)}`);
    } else {
      alert('Error al guardar configuración: ' + (res.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error al guardar configuración de rotación: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar y Aplicar Rotación';
    }
  }
}

async function resetRotationStats() {
  if (!confirm('¿Deseas reiniciar los contadores de emisión e historial de rotación?\n\nTodos los comerciales volverán a 0 emisiones y quedarán listos para emitir sin tiempos de espera.')) return;

  const btn = $('btnResetRotationStats');
  if (btn) btn.disabled = true;

  try {
    const res = await api.post('/api/admin/commercials/rotation/reset', {});
    if (res.success) {
      await reload('commercials');
      await loadRotationConfig();
      alert('Contadores de emisión e historial reiniciados correctamente.' + describeResync(res.resyncAt));
    } else {
      alert('Error al reiniciar historial: ' + (res.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error al reiniciar historial: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function setRotation(id, rotation) {
  try {
    const data = await api.put(`/api/admin/commercials/${id}`, { rotation });
    if (!data.success) throw new Error(data.error || 'No se pudo guardar');
    await reload('commercials');
    await loadRotationConfig();
  } catch (e) {
    alert('Error al cambiar la rotación: ' + e.message);
  }
}

async function deleteCommercial(id) {
  const item = (store.get('commercials') || []).find(c => c.id === id);
  const name = item && item.title ? `"${item.title}"` : 'este comercial o cortinilla';
  if (!confirm(`¿Eliminar definitivamente ${name} del servidor y de la emisión?`)) return;
  try {
    const data = await api.del(`/api/admin/commercials/${id}`);
    if (data.success) {
      await reload('commercials');
      await loadRotationConfig();
      alert(`Eliminado.${describeResync(data.resyncAt)}`);
    }
    else alert('Error al eliminar: ' + (data.error || 'No se pudo eliminar el elemento.'));
  } catch (e) {
    alert('Error al eliminar: ' + e.message);
  }
}

export function initCommercials() {
  const buttons = document.querySelectorAll('#tabCommercials .filter-bar .pill-btn[data-cfilter]');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.toggle('active', b === btn));
    filter = btn.dataset.cfilter || 'all';
    visibleCount = PAGE_SIZE;
    render();
  }));

  // Toggle Mosaico vs Tabla de Control
  const btnGrid = $('btnCommercialsViewGrid');
  const btnTable = $('btnCommercialsViewTable');
  if (btnGrid) {
    btnGrid.addEventListener('click', () => {
      viewMode = 'grid';
      localStorage.setItem('commercials_view_mode', 'grid');
      render();
    });
  }
  if (btnTable) {
    btnTable.addEventListener('click', () => {
      viewMode = 'table';
      localStorage.setItem('commercials_view_mode', 'table');
      render();
    });
  }

  // Sorting in Table View
  const headers = document.querySelectorAll('#commercialsRotationTable th[data-sort]');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (tableSortCol === col) {
        tableSortDir = tableSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        tableSortCol = col;
        tableSortDir = 'desc';
      }
      render();
    });
  });

  // Rotation config actions
  const btnSaveConfig = $('btnSaveRotationConfig');
  if (btnSaveConfig) btnSaveConfig.addEventListener('click', saveRotationConfig);

  const btnResetStats = $('btnResetRotationStats');
  if (btnResetStats) btnResetStats.addEventListener('click', resetRotationStats);

  const searchInput = $('commercialsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = (e.target.value || '').toLowerCase().trim();
        visibleCount = PAGE_SIZE;
        render();
      }, 150);
    });
  }

  // Delegated click handler on container for lazy video loading and pagination
  const container = $('commercialsListContainer');
  if (container) {
    container.addEventListener('click', (e) => {
      const placeholder = e.target.closest('.bumper-video-placeholder');
      if (placeholder) {
        const videoUrl = placeholder.dataset.videoUrl;
        const parent = placeholder.parentElement;
        if (videoUrl && parent) {
          parent.innerHTML = `<video controls autoplay src="${escapeHtml(videoUrl)}" class="aero-video-player" playsinline></video>`;
        }
        return;
      }

      if (e.target.closest('#btnLoadMoreCommercials')) {
        visibleCount += PAGE_SIZE;
        render();
        return;
      }

      if (e.target.closest('#btnLoadAllCommercials')) {
        visibleCount = Infinity;
        render();
        return;
      }
    });
  }

  // Delegated click on table body for modal preview or direct play
  const tableBody = $('commercialsTableBody');
  if (tableBody) {
    tableBody.addEventListener('click', (e) => {
      const playBtn = e.target.closest('[data-action="play-modal"]');
      if (playBtn) {
        const videoUrl = playBtn.dataset.videoUrl;
        const title = playBtn.dataset.title;
        if (videoUrl) {
          // Open quick modal or play in a floating box
          let previewModalEl = $('commQuickPreviewModal');
          if (!previewModalEl) {
            previewModalEl = document.createElement('div');
            previewModalEl.id = 'commQuickPreviewModal';
            previewModalEl.className = 'aero-modal';
            previewModalEl.innerHTML = `
              <div class="aero-modal-backdrop" id="btnCommQuickModalCloseBackdrop"></div>
              <div class="aero-window aero-modal-dialog" style="max-width: 680px; width: 90%;">
                <div class="window-titlebar">
                  <div class="window-title"><span class="window-icon">▶</span> <span id="commQuickModalTitle">Video</span></div>
                  <div class="window-controls">
                    <button class="win-btn win-close" id="btnCommQuickModalClose">✕</button>
                  </div>
                </div>
                <div class="window-body" style="padding: 12px; background: #000;">
                  <div style="aspect-ratio: 16/9; width: 100%; display: flex; align-items: center; justify-content: center;">
                    <video id="commQuickModalVideo" controls autoplay style="width: 100%; height: 100%; object-fit: contain;"></video>
                  </div>
                </div>
              </div>
            `;
            document.body.appendChild(previewModalEl);
            const closeBtn = $('btnCommQuickModalClose');
            const backdrop = $('btnCommQuickModalCloseBackdrop');
            const closeModal = () => {
              const video = $('commQuickModalVideo');
              if (video) { video.pause(); video.src = ''; }
              previewModalEl.style.display = 'none';
            };
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (backdrop) backdrop.addEventListener('click', closeModal);
          }
          const video = $('commQuickModalVideo');
          const modalTitle = $('commQuickModalTitle');
          if (modalTitle) modalTitle.textContent = title || 'Comercial';
          if (video) {
            video.src = videoUrl;
            video.play().catch(() => {});
          }
          previewModalEl.style.display = 'flex';
        }
      }
    });
  }

  delegate($('commercialsListContainer'), 'click', { 'delete-commercial': (el) => deleteCommercial(el.dataset.id) });
  delegate($('commercialsListContainer'), 'change', { rotation: (el) => setRotation(el.dataset.id, el.value) });

  if (tableBody) {
    delegate(tableBody, 'click', { 'delete-commercial': (el) => deleteCommercial(el.dataset.id) });
    delegate(tableBody, 'change', { rotation: (el) => setRotation(el.dataset.id, el.value) });
  }

  store.on('commercials', () => {
    render();
    loadRotationConfig();
  });



  // Initial load of rotation config
  loadRotationConfig();
}
