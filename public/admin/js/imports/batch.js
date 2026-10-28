/**
 * Home Channel Master Control - Encolar una serie completa desde descargas_mkv, con
 * detección de capítulo y título editables antes de enviar.
 */

import { $, on } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml } from '/shared/format.js';
import { store, reload } from '../store.js';
import { goToTab } from '../tabs.js';
import { refreshTranscode } from '../transcode.js';
import { parseEpisodeInfo } from './episodeNames.js';

const NEW_SHOW = '__new__';
let files = [];

const el = {
  get container() { return $('batchItemsContainer'); },
  get showSelect() { return $('batchShowSelect'); },
  get filter() { return $('batchFilterInput'); },
  get newShowInput() { return $('batchNewShowTitleInput'); },
  get startBtn() { return $('btnStartBatchImport'); }
};

function toggleNewShowField() {
  const wrapper = $('batchNewShowTitleWrapper');
  const isNew = el.showSelect.value === NEW_SHOW;
  if (wrapper) wrapper.style.display = isNew ? 'block' : 'none';
  return isNew;
}

function paintShowOptions() {
  el.showSelect.innerHTML = `<option value="${NEW_SHOW}">+ Crear Nueva Serie...</option>` +
    store.get('shows').map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)} (${(s.episodes || []).length} cap.)</option>`).join('');
  toggleNewShowField();
}

/** Sugerencias iniciales según lo que haya en el disco. */
function suggestFilter() {
  if (el.filter.value) return;
  if (files.some(f => f.filename.includes('Copia de'))) {
    el.filter.value = 'Copia de';
    if (el.newShowInput) el.newShowInput.value = 'Death Note';
  } else if (files.some(f => f.filename.toLowerCase().includes('cbb'))) {
    el.filter.value = 'CBB';
    const cowboy = store.get('shows').find(s => s.title.toLowerCase().includes('cowboy'));
    if (cowboy) {
      el.showSelect.value = cowboy.id;
      toggleNewShowField();
    }
  }
}

async function loadFiles() {
  el.container.innerHTML = '<div class="muted center">Escaneando carpeta de ingesta local...</div>';
  try {
    const data = await api.get('/api/admin/mkv-downloads');
    files = Array.isArray(data) ? data : [];
    suggestFilter();
    renderItems();
  } catch (e) {
    el.container.innerHTML = `<div class="muted center red">Error al cargar archivos: ${escapeHtml(e.message)}</div>`;
  }
}

function itemHtml(item) {
  return `
    <div class="batch-item-row" data-filename="${escapeHtml(item.filename)}">
      <input type="checkbox" class="batch-checkbox" checked aria-label="Incluir">
      <span class="badge-ep">E${String(item.episode).padStart(2, '0')}</span>
      <div class="batch-item-main">
        <input type="text" class="batch-title-input admin-input" value="${escapeHtml(item.title)}" title="Título del capítulo">
        <span class="batch-filename" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
      </div>
      <div class="batch-item-side">
        <label>Cap:</label>
        <input type="number" class="batch-ep-input admin-input" value="${item.episode}" min="1">
        <span class="batch-size">${escapeHtml(item.sizeMB)} MB</span>
      </div>
    </div>`;
}

function renderItems() {
  const filter = (el.filter.value || '').toLowerCase().trim();
  const items = files
    .filter(f => !filter || f.filename.toLowerCase().includes(filter))
    .map(f => ({ ...f, ...parseEpisodeInfo(f.filename) }))
    .sort((a, b) => a.episode - b.episode);
  el.container.innerHTML = items.length
    ? items.map(itemHtml).join('')
    : '<div class="muted center">No hay archivos que coincidan con el filtro.</div>';
  updateCounters();
}

const selectedRows = () => Array.from(el.container.querySelectorAll('.batch-item-row')).filter(r => r.querySelector('.batch-checkbox')?.checked);

function updateCounters() {
  const rows = selectedRows();
  const totalMB = rows.reduce((sum, r) => {
    const file = files.find(f => f.filename === r.dataset.filename);
    return sum + (file ? parseFloat(file.sizeMB) || 0 : 0);
  }, 0);
  if ($('batchCountSelected')) $('batchCountSelected').textContent = rows.length;
  if ($('batchTotalSizeMB')) $('batchTotalSizeMB').textContent = totalMB >= 1024 ? `${(totalMB / 1024).toFixed(2)} GB` : `${totalMB.toFixed(1)} MB`;
  if (el.startBtn) {
    el.startBtn.textContent = `🚀 ENCOLAR SERIE COMPLETA (${rows.length} CAPÍTULOS)`;
    el.startBtn.disabled = rows.length === 0;
  }
}

function setAllChecked(checked) {
  el.container.querySelectorAll('.batch-checkbox').forEach(cb => { cb.checked = checked; });
  updateCounters();
}

async function start(modal) {
  const rows = selectedRows();
  if (!rows.length) return alert('Por favor selecciona al menos un capítulo.');
  const isNew = el.showSelect.value === NEW_SHOW;
  const newShowTitle = el.newShowInput ? el.newShowInput.value.trim() : '';
  if (isNew && !newShowTitle) {
    alert('Por favor ingresa el nombre de la nueva serie.');
    el.newShowInput?.focus();
    return;
  }

  const season = parseInt($('batchSeasonInput') ? $('batchSeasonInput').value : 1, 10) || 1;
  const items = rows.map(r => ({
    filename: r.dataset.filename,
    episode: parseInt(r.querySelector('.batch-ep-input').value, 10) || 1,
    title: r.querySelector('.batch-title-input').value.trim() || r.dataset.filename,
    season
  }));

  el.startBtn.disabled = true;
  el.startBtn.textContent = '⏳ Encolando capítulos...';
  try {
    const data = await api.post('/api/admin/batch-import', { showId: el.showSelect.value, newShowTitle, season, items });
    if (!data.success) return alert('Error al encolar: ' + (data.error || 'Desconocido'));
    alert(`✅ ¡Éxito! Se han encolado ${data.queuedCount} capítulos para codificación automática en segundo plano.`);
    modal.close();
    await reload('shows');
    goToTab('tabTranscode');
    refreshTranscode();
  } catch (err) {
    alert('Error de conexión al encolar lote: ' + err.message);
  } finally {
    updateCounters();
  }
}

export function initBatchImport() {
  if (!$('batchImportModal') || !$('btnOpenBatchImportModal')) return;
  const modal = new Modal('batchImportModal', {
    openers: ['btnOpenBatchImportModal'],
    closers: ['btnCloseBatchImportModal', 'btnCancelBatchImportModal'],
    onOpen: async () => {
      paintShowOptions();
      await loadFiles();
    }
  });
  on(el.showSelect, 'change', () => {
    if (toggleNewShowField()) el.newShowInput?.focus();
  });
  on(el.filter, 'input', renderItems);
  on(el.container, 'change', (e) => { if (e.target.classList.contains('batch-checkbox')) updateCounters(); });
  on('btnBatchSelectAll', 'click', () => setAllChecked(true));
  on('btnBatchDeselectAll', 'click', () => setAllChecked(false));
  on(el.startBtn, 'click', () => start(modal));
}
