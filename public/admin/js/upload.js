/**
 * Home Channel Master Control - Subir un video (capítulo, comercial o bumper) para
 * transcodificarlo a 1080p.
 */

import { $, on } from '/shared/dom.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml } from '/shared/format.js';
import { store } from './store.js';
import { ChunkedUploader } from './ChunkedUploader.js';
import { goToTab } from './tabs.js';
import { refreshTranscode } from './transcode.js';

const DROP_TEXT = 'Arrastra un video aquí o haz clic para seleccionar';
const SUBMIT_TEXT = '🚀 SUBIR Y COMENZAR TRANSCODIFICACIÓN';
const titleFromFile = (name) => name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

let modal = null;

function toggleShowFields(isShow) {
  const wrapper = $('showFieldsWrapper');
  if (wrapper) wrapper.style.display = isShow ? 'block' : 'none';
}

/** Abre el formulario ya configurado (desde la tarjeta de una serie o "subir comercial"). */
export function openUploadModal({ type = 'show', showId = null } = {}) {
  const typeSelect = $('uploadTypeSelect');
  if (typeSelect) {
    typeSelect.value = type;
    toggleShowFields(type === 'show');
  }
  if (showId && $('uploadShowSelect')) $('uploadShowSelect').value = showId;
  modal.open();
}

function paintShowOptions(shows) {
  const select = $('uploadShowSelect');
  if (!select) return;
  select.innerHTML = shows && shows.length
    ? shows.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)} (${(s.episodes || []).length} capítulos)</option>`).join('')
    : '<option value="">No hay programas creados</option>';
}

function selectFile(file) {
  const dropText = $('dropzoneText');
  if (dropText) dropText.textContent = `Archivo seleccionado: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  const title = $('uploadTitleInput');
  if (title && !title.value) title.value = titleFromFile(file.name);
}

function initDropzone() {
  const zone = $('fileDropzone');
  const input = $('videoFileInput');
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      selectFile(input.files[0]);
    }
  });
  input.addEventListener('change', () => {
    if (input.files && input.files.length) selectFile(input.files[0]);
  });
}

function paintProgress(text, percent) {
  const bar = $('uploadProgressBar');
  if (bar && percent !== undefined) bar.style.width = `${percent}%`;
  const label = $('uploadProgressText');
  if (label) label.textContent = text;
}

async function submit(e) {
  e.preventDefault();
  const form = e.target;
  const input = $('videoFileInput');
  if (!input.files || !input.files.length) return alert('Por favor selecciona un archivo de video primero.');

  const file = input.files[0];
  const fields = {
    type: $('uploadTypeSelect').value,
    showId: $('uploadShowSelect') ? $('uploadShowSelect').value : '',
    title: $('uploadTitleInput').value.trim() || file.name.replace(/\.[^/.]+$/, ''),
    season: $('uploadSeasonInput') ? $('uploadSeasonInput').value : 1,
    episode: $('uploadEpisodeInput') ? $('uploadEpisodeInput').value : 1
  };
  const progressBox = $('uploadProgressBox');
  const btn = $('btnSubmitUpload');
  if (progressBox) progressBox.style.display = 'flex';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Iniciando subida...';
  }

  try {
    const uploader = new ChunkedUploader(file, fields, ({ index, total, percent }) =>
      paintProgress(`Subiendo parte ${index + 1} de ${total} (${percent}%)...`, percent));
    const last = await uploader.upload();
    if (last && last.completed) paintProgress('¡Video ensamblado! Transcodificando a 1080p...', 100);

    alert('¡Video subido con éxito! Se ha ensamblado en CasaOS y enviado a la cola de transcodificación a 1080p.');
    modal.close();
    form.reset();
    if ($('dropzoneText')) $('dropzoneText').textContent = DROP_TEXT;
    if (progressBox) progressBox.style.display = 'none';
    goToTab('tabTranscode');
    refreshTranscode();
  } catch (err) {
    alert('Error en la subida: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = SUBMIT_TEXT;
    }
  }
}

export function initUpload() {
  modal = new Modal('uploadModal', { openers: ['btnOpenUploadModal'], closers: ['btnCloseUploadModal', 'btnCancelUpload'] });
  on('btnUploadCommercialModal', 'click', () => openUploadModal({ type: 'commercial' }));
  on('uploadTypeSelect', 'change', (e) => toggleShowFields(e.target.value === 'show'));
  on('uploadVideoForm', 'submit', submit);
  initDropzone();
  store.on('shows', paintShowOptions);
}
