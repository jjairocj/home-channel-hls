/**
 * Home Channel Master Control - Cola de transcodificación: métricas, hilos GPU/CPU activos
 * y tabla de trabajos con filtro y búsqueda.
 */

import { $, on, setText } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { escapeHtml } from '/shared/format.js';
import { goToTab } from './tabs.js';
import { reload } from './store.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DEFAULT_AVG_SECONDS = 88;
const JOBS_PAGE_SIZE = 30;

const view = { filter: 'all', search: '', lastData: null, visibleCount: JOBS_PAGE_SIZE };
let searchDebounceTimer = null;

const IDLE_CARD = `
  <div class="active-job-card" id="activeJobCard">
    <div class="job-status-line">
      <span class="pulse-dot idle"></span>
      <strong id="activeJobTitle">No hay transcodificaciones en curso</strong>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar-fill" id="activeJobProgress" style="width: 0%;"></div>
    </div>
    <div class="job-details-line">
      <span id="activeJobPercent">0%</span>
      <span id="activeJobFps">0 fps</span>
      <span id="activeJobStatus">En espera de nuevos videos para transcodificar</span>
    </div>
  </div>`;

const STATUS_BADGES = {
  pending: '<span class="job-status pending">⏱ En cola</span>',
  processing: '<span class="job-status processing blink-text">▶ Procesando</span>',
  completed: '<span class="job-status completed">✓ Completado</span>',
  error: '<span class="job-status error">✗ Error</span>'
};

const isPending = (j) => j.status === 'pending' || j.status === 'processing';

/** Cifras de la cola (con valores de respaldo si el servidor no trae métricas). */
function summarize(data) {
  const metrics = data.metrics || {};
  const active = data.activeJobs && data.activeJobs.length ? data.activeJobs : (data.activeJob ? [data.activeJob] : []);
  const inQueue = (data.queue ? data.queue.length : 0) + active.length;
  const threads = Math.max(1, active.length);
  const avgSec = metrics.avgSecondsPerEpisode || DEFAULT_AVG_SECONDS;
  return {
    metrics,
    active,
    inQueue,
    avgSec,
    perHour: metrics.episodesPerHour || (avgSec > 0 ? parseFloat(((3600 / avgSec) * threads).toFixed(1)) : 0),
    eta: metrics.etaFormatted || (inQueue > 0 ? `${Math.ceil((inQueue * avgSec) / (threads * 3600))}h` : '0m'),
    totalFps: metrics.totalFps || Math.round(active.reduce((acc, j) => acc + (parseFloat(j.fps) || 0), 0))
  };
}

function paintSummary(data, s) {
  setText('statQueueCount', s.inQueue.toLocaleString());
  const eta = $('statQueueEta');
  if (eta) {
    eta.textContent = s.inQueue > 0 ? `⏱️ ~${s.eta}` : 'LISTO';
    eta.style.display = 'inline-block';
  }
  if (s.active.length) {
    const gpu = s.active.filter(j => j.workerType !== 'cpu').length;
    setText('statQueueDesc', `⚡ ${s.active.length} Hilos activos (${gpu} GPU NVENC + ${s.active.length - gpu} CPU Ryzen)`);
  } else {
    setText('statQueueDesc', data.isProcessing ? 'Transcodificando ahora' : 'Sin tareas pendientes');
  }
  setText('statQueueRate', s.inQueue > 0
    ? `⚡ Prom: ~${s.avgSec}s/cap | ${s.perHour} cap/h (${s.totalFps} FPS)`
    : '⚡ Cola vacía · 100% remasterizado');

  setText('telemetryEta', s.inQueue > 0 ? `~${s.eta}` : 'Completado');
  if (s.inQueue > 0 && s.metrics.etaTimestamp) {
    const d = new Date(s.metrics.etaTimestamp);
    setText('telemetryEtaDate', `Finaliza aprox: ${DAYS[d.getDay()]} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } else {
    setText('telemetryEtaDate', s.inQueue > 0 ? 'Estimando finalización...' : 'Todos los videos procesados');
  }
  setText('telemetryAvgEpisode', `~${s.avgSec}s / cap`);
  const sample = s.metrics.sampleSize || 0;
  setText('telemetryAvgDetails', sample > 0 ? `Medido en vivo (${sample} caps analizados)` : 'Tiempo real NVENC (~225 FPS)');
  setText('telemetryRate', `~${s.perHour} cap/h`);
  setText('telemetryFpsCombined', `${s.totalFps} FPS combinados (${s.active.length} hilos)`);
}

function threadCardHtml(j, i) {
  const cpu = j.workerType === 'cpu';
  const eta = j.remainingFormatted ? `<span class="thread-eta-pill" title="Tiempo restante estimado para este capítulo">⏱️ ~${escapeHtml(j.remainingFormatted)}</span>` : '';
  return `
    <div class="active-job-card thread-card${cpu ? ' cpu-card' : ''}" id="threadCard_${i}">
      <div class="thread-header-row">
        <div class="thread-badge">
          <span class="pulse-dot ${cpu ? 'purple' : 'green'}"></span>
          <span class="thread-num">${escapeHtml(j.workerLabel || `HILO ${j.slotId || (i + 1)}`)}</span>
          <span class="thread-gpu-pill${cpu ? ' cpu-pill' : ''}">${cpu ? '🧠 AMD Ryzen (CPU x264)' : '⚡ NVIDIA NVENC (GPU)'}</span>
        </div>
        <div class="thread-meta">
          ${eta}
          <div class="thread-fps-pill${cpu ? ' cpu-fps' : ''}">${j.fps ? Math.round(j.fps) : 0} fps</div>
        </div>
      </div>
      <div class="thread-title-box">
        <strong class="thread-title" title="${escapeHtml(j.title || j.originalFilename)}">${escapeHtml(j.title || 'Video en proceso')}</strong>
        <span class="thread-filename" title="${escapeHtml(j.originalFilename || '')}">${escapeHtml(j.originalFilename || '')}</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill${cpu ? ' cpu-fill' : ''}" style="width: ${j.progress || 0}%;"></div>
      </div>
      <div class="job-details-line">
        <span class="thread-percent-val">${j.progress || 0}%</span>
        <span class="thread-dest">Salida: 1080p H.264 + EBU R128</span>
        <span class="thread-status-badge${cpu ? ' cpu-badge' : ''}">${cpu ? 'ACTIVO EN CPU' : 'ACTIVO EN GPU'}</span>
      </div>
    </div>`;
}

/** Activos + cola + historial, sin duplicados. */
function mergeJobs(data, active) {
  const seen = new Set();
  const jobs = [];
  const add = (j, status) => {
    if (seen.has(j.id)) return;
    seen.add(j.id);
    jobs.push(status ? { ...j, status } : j);
  };
  active.forEach(j => add(j, 'processing'));
  (data.queue || []).forEach(j => add(j, j.status || 'pending'));
  (data.allJobs || []).forEach(j => add(j));
  return jobs;
}

function jobRowHtml(j) {
  const date = j.createdAt ? new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--';
  const progress = j.status === 'completed' ? 100 : (j.progress || 0);
  return `
    <tr>
      <td>${STATUS_BADGES[j.status] || STATUS_BADGES.pending}</td>
      <td class="job-title-cell">
        <div>
          <strong>${escapeHtml(j.title || 'Video')}</strong>
          <span>${escapeHtml(j.originalFilename || '')}</span>
        </div>
      </td>
      <td><span class="badge badge-studio">${escapeHtml((j.type || 'show').toUpperCase())}</span></td>
      <td>
        <div class="job-progress-cell">
          <b>${progress}%</b>
          <div class="mini-progress"><span class="${j.status === 'completed' ? 'done' : ''}" style="width:${progress}%;"></span></div>
        </div>
      </td>
      <td class="job-date">${date}</td>
    </tr>`;
}

function paintJobsTable(jobs) {
  const completed = jobs.filter(j => j.status === 'completed').length;
  setText('jobsTotalCount', jobs.length);
  setText('countFilterAll', jobs.length);
  setText('countFilterPending', jobs.filter(isPending).length);
  setText('countFilterCompleted', completed);
  setText('telemetryGlobalPercent', `${jobs.length ? ((completed / jobs.length) * 100).toFixed(1) : 0}%`);
  setText('telemetryGlobalRatio', `${completed.toLocaleString()} / ${jobs.length.toLocaleString()} completados`);

  const body = $('jobsTableBody');
  if (!body) return;
  const message = (text) => `<tr><td colspan="5" class="cell-empty">${text}</td></tr>`;
  if (!jobs.length) {
    body.innerHTML = message('No hay registros en la cola de transcodificación');
    return;
  }
  let shown = jobs;
  if (view.filter === 'pending') shown = shown.filter(isPending);
  else if (view.filter === 'completed') shown = shown.filter(j => j.status === 'completed');
  if (view.search) {
    shown = shown.filter(j => (j.title || '').toLowerCase().includes(view.search) || (j.originalFilename || '').toLowerCase().includes(view.search));
  }

  if (!shown.length) {
    body.innerHTML = message('No se encontraron trabajos con el filtro seleccionado');
    return;
  }

  const totalShown = shown.length;
  const sliced = shown.slice(0, view.visibleCount || JOBS_PAGE_SIZE);
  const remaining = totalShown - sliced.length;

  let rowsHtml = sliced.map(jobRowHtml).join('');
  if (remaining > 0) {
    rowsHtml += `
      <tr class="table-pagination-row">
        <td colspan="5">
          <div class="table-pagination-bar">
            <span class="pagination-info">Mostrando ${sliced.length} de ${totalShown} trabajos</span>
            <div class="pagination-actions">
              <button type="button" id="btnLoadMoreJobs" class="btn-micro btn-studio">🔽 Cargar más (${Math.min(remaining, JOBS_PAGE_SIZE)} siguientes · ${remaining} restantes)</button>
              <button type="button" id="btnLoadAllJobs" class="btn-micro btn-studio btn-secondary">Mostrar todos (${remaining})</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }
  body.innerHTML = rowsHtml;
}

function render(data) {
  const s = summarize(data);
  paintSummary(data, s);
  const container = $('activeJobsContainer');
  if (container) container.innerHTML = s.active.length ? s.active.map(threadCardHtml).join('') : IDLE_CARD;
  paintJobsTable(mergeJobs(data, s.active));
}

/**
 * Trabajos que acaban de terminar: su serie o el listado de comerciales cambió.
 * La primera lectura solo registra los ya completados.
 */
let knownCompleted = null;
function reloadFinished(data) {
  const completed = (data.allJobs || []).filter(j => j.status === 'completed');
  if (knownCompleted) {
    const fresh = completed.filter(j => !knownCompleted.has(j.id));
    if (fresh.some(j => j.type === 'show')) reload('shows');
    if (fresh.some(j => j.type !== 'show')) reload('commercials');
  }
  knownCompleted = new Set(completed.map(j => j.id));
}

export async function refreshTranscode() {
  try {
    view.lastData = await api.get('/api/admin/transcode/status');
    render(view.lastData);
    reloadFinished(view.lastData);
  } catch (e) {}
}

export function initTranscode() {
  on('btnRefreshJobs', 'click', refreshTranscode);

  const searchInput = $('jobsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        view.search = (e.target.value || '').trim().toLowerCase();
        view.visibleCount = JOBS_PAGE_SIZE;
        if (view.lastData) render(view.lastData);
      }, 150);
    });
  }

  const buttons = document.querySelectorAll('.job-filter-btn');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.toggle('active', b === btn));
    view.filter = btn.dataset.filter || 'all';
    view.visibleCount = JOBS_PAGE_SIZE;
    if (view.lastData) render(view.lastData);
  }));

  const body = $('jobsTableBody');
  if (body) {
    body.addEventListener('click', (e) => {
      if (e.target.closest('#btnLoadMoreJobs')) {
        view.visibleCount = (view.visibleCount || JOBS_PAGE_SIZE) + JOBS_PAGE_SIZE;
        if (view.lastData) render(view.lastData);
      } else if (e.target.closest('#btnLoadAllJobs')) {
        view.visibleCount = Infinity;
        if (view.lastData) render(view.lastData);
      }
    });
  }

  on('queueMetricCard', 'click', () => goToTab('tabTranscode'));
}
