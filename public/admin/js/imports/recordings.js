/**
 * Home Channel Master Control - Importar un archivo que ya está en el servidor
 * (descargas_mkv del disco 2TB o grabaciones).
 */

import { $, on } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml } from '/shared/format.js';
import { store } from '../store.js';
import { goToTab } from '../tabs.js';
import { refreshTranscode } from '../transcode.js';
import { titleFromFilename, episodeFromFilename } from './episodeNames.js';

/** Asociaciones nombre de archivo → serie para preseleccionarla. */
const SHOW_HINTS = [];

const isMkvSource = () => ($('importSourceSelect') ? $('importSourceSelect').value === 'mkv' : true);

async function loadFiles() {
  const select = $('importFileSelect');
  const mkv = isMkvSource();
  try {
    select.innerHTML = '<option value="">Cargando archivos del servidor...</option>';
    const files = await api.get(mkv ? '/api/admin/mkv-downloads' : '/api/admin/recordings');
    if (!Array.isArray(files) || !files.length) {
      select.innerHTML = `<option value="">No hay archivos en la carpeta de ingesta local</option>`;
      return;
    }
    select.innerHTML = files.map(f => `<option value="${escapeHtml(f.filename)}">${escapeHtml(f.filename)} (${escapeHtml(f.sizeMB)} MB)</option>`).join('');
    if ($('importTitleInput')) $('importTitleInput').value = titleFromFilename(files[0].filename);
  } catch (e) {
    select.innerHTML = '<option value="">Error cargando archivos</option>';
  }
}

function onFileChosen(filename) {
  if (!filename) return;
  if ($('importTitleInput')) $('importTitleInput').value = titleFromFilename(filename);
  const episode = episodeFromFilename(filename);
  if (episode && $('importEpisodeInput')) $('importEpisodeInput').value = episode;

  const lower = filename.toLowerCase();
  const hint = SHOW_HINTS.find(h => h.file.some(w => lower.includes(w)));
  const show = hint && store.get('shows').find(s => s.title.toLowerCase().includes(hint.show));
  if (show && $('importShowSelect')) $('importShowSelect').value = show.id;
}

async function submit(e, modal) {
  e.preventDefault();
  const filename = $('importFileSelect').value;
  if (!filename) return alert('Selecciona un archivo del servidor.');
  try {
    const data = await api.post(isMkvSource() ? '/api/admin/import-mkv' : '/api/admin/import-recording', {
      filename,
      type: $('importTypeSelect').value,
      showId: $('importShowSelect') ? $('importShowSelect').value : null,
      season: $('importSeasonInput') ? $('importSeasonInput').value : 1,
      episode: $('importEpisodeInput') ? $('importEpisodeInput').value : 1,
      title: $('importTitleInput').value.trim()
    });
    if (!data.success) return alert('Error: ' + data.error);
    alert('¡Archivo importado con éxito! Se ha agregado a la cola de emisión y transcodificación.');
    modal.close();
    goToTab('tabTranscode');
    refreshTranscode();
  } catch (err) {
    alert('Error al importar: ' + err.message);
  }
}

export function initRecordingsImport() {
  const modal = new Modal('importModal', {
    openers: ['btnOpenImportModal'],
    closers: ['btnCloseImportModal', 'btnCancelImport'],
    onOpen: async () => {
      const select = $('importShowSelect');
      if (select) select.innerHTML = store.get('shows').map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join('');
      await loadFiles();
    }
  });
  on('importTypeSelect', 'change', (e) => {
    const wrapper = $('importShowFieldsWrapper');
    if (wrapper) wrapper.style.display = e.target.value === 'show' ? 'block' : 'none';
  });
  on('importSourceSelect', 'change', loadFiles);
  on('importFileSelect', 'change', (e) => onFileChosen(e.target.value));
  on('importRecordingForm', 'submit', (e) => submit(e, modal));
}
