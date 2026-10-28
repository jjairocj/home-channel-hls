/**
 * Home Channel HLS // Master Control — Panel de Locución y Cortinillas Dinámicas.
 * Visualiza la caché de voces sintetizadas (ElevenLabs / Audio8) y los videos MP4
 * de cortinillas generados dinámicamente con reproductor multimedia optimizado.
 */

let bumpersData = null;
let currentFilter = 'all'; // 'all' | 'voice' | 'dynamic'
let searchQuery = '';
let visibleCount = 24;
const PAGE_SIZE = 24;
let debounceTimer = null;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initBumpers() {
  const btnRefresh = document.getElementById('btnRefreshBumpers');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => refreshBumpers());
  }

  const filterBtns = document.querySelectorAll('.bumpers-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter || 'all';
      visibleCount = PAGE_SIZE;
      renderItems();
    });
  });

  const searchInput = document.getElementById('bumpersSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = (e.target.value || '').toLowerCase().trim();
        visibleCount = PAGE_SIZE;
        renderItems();
      }, 150);
    });
  }

  // Delegated click handler on the container for lazy video loading and pagination
  const container = document.getElementById('bumpersGridContainer');
  if (container) {
    container.addEventListener('click', (e) => {
      // Lazy video play on click
      const placeholder = e.target.closest('.bumper-video-placeholder');
      if (placeholder) {
        const videoUrl = placeholder.dataset.videoUrl;
        const parent = placeholder.parentElement;
        if (videoUrl && parent) {
          parent.innerHTML = `<video controls autoplay src="${escapeHtml(videoUrl)}" class="aero-video-player" playsinline></video>`;
        }
        return;
      }

      // Load more button
      if (e.target.closest('#btnLoadMoreBumpers')) {
        visibleCount += PAGE_SIZE;
        renderItems();
        return;
      }

      // Load all button
      if (e.target.closest('#btnLoadAllBumpers')) {
        visibleCount = Infinity;
        renderItems();
        return;
      }
    });
  }
}

export async function refreshBumpers() {
  const container = document.getElementById('bumpersGridContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/bumpers');
    if (!res.ok) {
      if (res.status === 401) {
        container.innerHTML = '<div class="empty-box" style="grid-column: 1 / -1;">Sesión no autorizada. Ingresa con clave en el Master Control.</div>';
        return;
      }
      throw new Error(`Error HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Error al cargar cortinillas');
    bumpersData = data;

    renderStats(data.stats, data.config);
    renderItems();
  } catch (err) {
    console.error('[Bumpers] Error:', err);
    container.innerHTML = `<div class="empty-box error" style="grid-column: 1 / -1;">⚠️ No se pudieron cargar las grabaciones: ${escapeHtml(err.message)}</div>`;
  }
}

function renderStats(stats = {}, config = {}) {
  const elVoiceCount = document.getElementById('bumpersStatVoiceCount');
  const elVoiceSize = document.getElementById('bumpersStatVoiceSize');
  const elDynamicCount = document.getElementById('bumpersStatDynamicCount');
  const elDynamicSize = document.getElementById('bumpersStatDynamicSize');
  const elActiveVoice = document.getElementById('bumpersStatActiveVoice');
  const elBackupVoice = document.getElementById('bumpersStatBackupVoice');

  if (elVoiceCount) elVoiceCount.textContent = stats.voiceCount || 0;
  if (elVoiceSize) elVoiceSize.textContent = stats.voiceSize || '0 B';
  if (elDynamicCount) elDynamicCount.textContent = stats.dynamicCount || 0;
  if (elDynamicSize) elDynamicSize.textContent = stats.dynamicSize || '0 B';

  if (elActiveVoice) {
    elActiveVoice.textContent = `${config.voiceName || 'El Faraón'} (${config.modelId || 'eleven_v4'})`;
  }
  if (elBackupVoice) {
    elBackupVoice.textContent = `${config.backupVoice || 'Mario'} (Audio8_TTS)`;
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function renderItems() {
  const container = document.getElementById('bumpersGridContainer');
  if (!container || !bumpersData) return;

  const voices = bumpersData.voiceCache || [];
  const dynamics = bumpersData.dynamicBumpers || [];

  let items = [];

  if (currentFilter === 'all' || currentFilter === 'voice') {
    items.push(...voices.map(v => ({ ...v, itemKind: 'voice' })));
  }
  if (currentFilter === 'all' || currentFilter === 'dynamic') {
    items.push(...dynamics.map(d => ({ ...d, itemKind: 'dynamic' })));
  }

  if (searchQuery) {
    items = items.filter(item => {
      const name = (item.filename || '').toLowerCase();
      const title = (item.showTitle || '').toLowerCase();
      const kind = (item.kind || '').toLowerCase();
      const prov = (item.provider || '').toLowerCase();
      return name.includes(searchQuery) || title.includes(searchQuery) || kind.includes(searchQuery) || prov.includes(searchQuery);
    });
  }

  if (!items.length) {
    container.innerHTML = '<div class="empty-box" style="grid-column: 1 / -1;">No se encontraron grabaciones con los filtros seleccionados.</div>';
    return;
  }

  const totalItems = items.length;
  const visibleItems = items.slice(0, visibleCount);
  const remaining = totalItems - visibleItems.length;

  const html = visibleItems.map(item => {
    if (item.itemKind === 'voice') {
      return `
        <div class="bumper-card bumper-card-voice">
          <div class="bumper-card-header">
            <span class="bumper-badge badge-voice">🎙️ AUDIO VOZ</span>
            <span class="bumper-date">${formatDate(item.mtime)}</span>
          </div>
          <div class="bumper-title" title="${escapeHtml(item.filename)}">
            <strong>${escapeHtml(item.filename)}</strong>
          </div>
          <div class="bumper-meta">
            <span class="meta-tag">Proveedor: ${escapeHtml(item.provider)}</span>
            <span class="meta-tag">${escapeHtml(item.sizeFormatted)}</span>
          </div>
          <div class="bumper-player">
            <audio controls preload="none" src="${escapeHtml(item.url)}" class="aero-audio-player"></audio>
          </div>
          <div class="bumper-footer">
            <a href="${escapeHtml(item.url)}" download="${escapeHtml(item.filename)}" class="btn-studio btn-secondary btn-sm">⬇ Descargar MP3</a>
          </div>
        </div>
      `;
    }

    // Dynamic Video Bumper (Lazy loaded video element)
    const isBoard = item.kind === 'Cartelera de hoy';
    return `
      <div class="bumper-card bumper-card-video">
        <div class="bumper-card-header">
          <span class="bumper-badge ${isBoard ? 'badge-board' : 'badge-next'}">
            ${isBoard ? '📋 CARTELERA' : '🎬 A CONTINUACIÓN'}
          </span>
          <span class="bumper-date">${formatDate(item.mtime)}</span>
        </div>
        <div class="bumper-title">
          <strong>${escapeHtml(item.showTitle || item.filename)}</strong>
          ${item.time ? `<span class="bumper-time-tag">${escapeHtml(item.time)}</span>` : ''}
        </div>
        <div class="bumper-meta">
          <span class="meta-tag">Video 1080p MP4</span>
          <span class="meta-tag">${escapeHtml(item.sizeFormatted)}</span>
        </div>
        <div class="bumper-player video-player-wrap">
          <div class="bumper-video-placeholder" data-video-url="${escapeHtml(item.url)}" title="Haz clic para reproducir cortinilla">
            <div class="bumper-play-btn">
              <span class="play-icon">▶</span>
              <span class="play-label">Reproducir Video</span>
            </div>
            <span class="bumper-video-badge">1080p · MP4</span>
          </div>
        </div>
        <div class="bumper-footer">
          <span class="bumper-filename-sub" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
          <a href="${escapeHtml(item.url)}" download="${escapeHtml(item.filename)}" class="btn-studio btn-secondary btn-sm">⬇ Descargar MP4</a>
        </div>
      </div>
    `;
  }).join('');

  let paginationHtml = '';
  if (remaining > 0) {
    paginationHtml = `
      <div class="bumpers-pagination-bar">
        <div class="pagination-info">Mostrando ${visibleItems.length} de ${totalItems} grabaciones</div>
        <div class="pagination-actions">
          <button type="button" id="btnLoadMoreBumpers" class="btn-studio btn-primary">
            🔽 Cargar más (${Math.min(remaining, PAGE_SIZE)} siguientes · ${remaining} restantes)
          </button>
          <button type="button" id="btnLoadAllBumpers" class="btn-studio btn-secondary">
            Mostrar todos (${remaining})
          </button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html + paginationHtml;
}
