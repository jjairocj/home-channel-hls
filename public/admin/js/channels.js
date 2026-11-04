/**
 * Home Channel HLS Master Control - Gestión de Canales 24/7 (Multicanal).
 */

import { $, delegate } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { escapeHtml } from '/shared/format.js';

let channelsList = [];
let randomShowsList = [];
let randomSearchQuery = '';
let randomSearchDebounce = null;
let pollTimer = null;

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function channelCardHtml(c) {
  const isRunning = !!c.isRunning;
  let statusClass = isRunning ? 'active-green' : 'stopped-gray';
  let statusLabel = isRunning ? '● EN EMISIÓN' : '○ DETENIDO';
  if (!isRunning && c.isOnDemand) {
    statusClass = 'standby-blue';
    statusLabel = '💤 EN REPOSO (AUTO)';
  }
  const cur = c.currentProgram;

  let programHtml = '';
  if (isRunning && cur) {
    const dur = cur.duration || 1400;
    const el = Math.min(cur.elapsed || 0, dur);
    const pct = Math.min(100, Math.max(0, Math.round((el / dur) * 100)));
    programHtml = `
      <div class="channel-now-box">
        <div class="channel-now-header">
          <span class="channel-now-show">${escapeHtml(cur.showTitle || c.name)}</span>
          <span class="channel-now-times">${formatDuration(el)} / ${formatDuration(dur)}</span>
        </div>
        <div class="channel-now-title" title="${escapeHtml(cur.title || '')}">${escapeHtml(cur.title || 'Emisión continua')}</div>
        <div class="channel-progress-bar">
          <div class="channel-progress-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  } else if (isRunning) {
    programHtml = `
      <div class="channel-now-box muted">
        <span>Sincronizando señal HLS...</span>
      </div>`;
  } else if (c.isOnDemand) {
    programHtml = `
      <div class="channel-now-box muted">
        <span>💤 Modo bajo demanda: en reposo para ahorrar energía. Se activará automáticamente al sintonizarlo.</span>
      </div>`;
  } else {
    programHtml = `
      <div class="channel-now-box muted">
        <span>Canal detenido. Pulsa "Activar" para iniciar la emisión.</span>
      </div>`;
  }

  const cycleText = c.cycle
    ? `Ciclo ${c.cycle} · ${c.totalEpisodes || 0} capítulos en rotación`
    : `${c.totalEpisodes || 0} capítulos en biblioteca`;

  const resetBtn = c.id !== 'crhe'
    ? `<button type="button" class="btn-micro" data-action="reset-cycle" data-id="${escapeHtml(c.id)}" title="Barajar una nueva secuencia aleatoria">🔄 Nuevo Ciclo</button>`
    : '';

  return `
    <div class="channel-card" style="border-top: 4px solid ${getChannelColor(c.id)};">
      <div class="channel-card-header">
        <div class="channel-badge" style="background: ${getChannelColor(c.id)};">CH-${c.number || 100}</div>
        <div class="channel-meta">
          <h3 class="channel-name">${escapeHtml(c.name)}</h3>
          <span class="channel-desc">${escapeHtml(c.description || '')}</span>
        </div>
        <span class="channel-status-badge ${statusClass}">${statusLabel}</span>
      </div>

      ${programHtml}

      <div class="channel-card-footer">
        <span class="channel-cycle-info">🎲 ${cycleText}</span>
        <div class="channel-actions">
          <button type="button" class="btn-micro ${isRunning ? 'btn-micro-danger' : 'btn-micro-primary'}" data-action="toggle-channel" data-id="${escapeHtml(c.id)}">
            ${isRunning ? '⏸ Detener' : '▶ Reanudar'}
          </button>
          ${resetBtn}
          <a href="${c.hlsUrl || '#'}" target="_blank" rel="noopener" class="btn-micro btn-ghost" title="Ver señal HLS directa">🔗 HLS</a>
        </div>
      </div>
    </div>
  `;
}

function getChannelColor(id) {
  switch (id) {
    case 'crhe': return '#00f0ff';
    case 'simpsons': return '#ffe600';
    case 'futurama': return '#ff007f';
    case 'random': return '#39ff14';
    default: return '#3b82f6';
  }
}

function renderChannels() {
  const container = $('channelsGridContainer');
  if (!container) return;

  if (!channelsList || !channelsList.length) {
    container.innerHTML = '<div class="muted center">No se pudieron cargar los canales.</div>';
    return;
  }

  container.innerHTML = channelsList.map(channelCardHtml).join('');

  const summary = $('channelsStatusSummary');
  if (summary) {
    const runningCount = channelsList.filter(c => c.isRunning).length;
    summary.textContent = `${runningCount} de ${channelsList.length} canales al aire`;
  }
}

function updateSelectedRandomBadge() {
  const badge = $('randomSelectedCountBadge');
  if (!badge) return;
  const selected = randomShowsList.filter(s => s.isIncluded);
  const totalEps = selected.reduce((acc, s) => acc + (s.episodesCount || 0), 0);
  badge.textContent = `${selected.length} de ${randomShowsList.length} series seleccionadas (${totalEps} capítulos)`;
}

function renderRandomShows() {
  const container = $('randomShowsListContainer');
  if (!container) return;

  if (!randomShowsList || !randomShowsList.length) {
    container.innerHTML = '<div class="muted center" style="grid-column: 1 / -1;">No hay series disponibles para configurar.</div>';
    return;
  }

  let filtered = randomShowsList;
  if (randomSearchQuery) {
    filtered = filtered.filter(s => {
      const t = (s.title || '').toLowerCase();
      const c = (s.category || '').toLowerCase();
      return t.includes(randomSearchQuery) || c.includes(randomSearchQuery);
    });
  }

  updateSelectedRandomBadge();

  if (!filtered.length) {
    container.innerHTML = `<div class="muted center" style="grid-column: 1 / -1; padding: 14px;">No se encontraron series que coincidan con "${escapeHtml(randomSearchQuery)}".</div>`;
    return;
  }

  container.innerHTML = filtered.map(show => `
    <label class="random-show-check-card ${show.isIncluded ? 'selected' : ''}" style="--show-color: ${escapeHtml(show.color || '#00f0ff')};">
      <input type="checkbox" data-show-id="${escapeHtml(show.id)}" ${show.isIncluded ? 'checked' : ''}>
      <div class="random-show-info">
        <strong class="random-show-title">${escapeHtml(show.title)}</strong>
        <div class="random-show-meta">
          <span class="random-show-cat">${escapeHtml(show.category || 'General')}</span>
          <span class="random-show-eps">${show.episodesCount || 0} caps</span>
        </div>
      </div>
    </label>
  `).join('');
}

export async function refreshChannels(notify = false) {
  try {
    const data = await api.get('/api/admin/channels');
    if (data && data.success) {
      channelsList = data.channels || [];
      renderChannels();
      if (notify) alert('Estado de los canales actualizado.');
    }
  } catch (err) {
    console.error('[Channels] Error refrescando canales:', err);
  }
}

export async function refreshRandomShows() {
  try {
    const data = await api.get('/api/admin/channels/random/shows');
    if (data && data.success) {
      randomShowsList = data.shows || [];
      renderRandomShows();
    }
  } catch (err) {
    console.error('[Channels] Error cargando series de Canal 103:', err);
  }
}

export function initChannels() {
  const gridContainer = $('channelsGridContainer');
  if (gridContainer) {
    delegate(gridContainer, 'click', {
      'toggle-channel': async (el) => {
        const id = el.dataset.id;
        try {
          const res = await api.post(`/api/admin/channels/${id}/toggle`);
          if (res && res.success) {
            await refreshChannels();
          }
        } catch (e) {
          alert('Error al cambiar estado del canal: ' + e.message);
        }
      },
      'reset-cycle': async (el) => {
        const id = el.dataset.id;
        if (!confirm('¿Deseas reiniciar el ciclo y generar una nueva mezcla aleatoria de capítulos sin repetición?')) return;
        try {
          const res = await api.post(`/api/admin/channels/${id}/reset-cycle`);
          if (res && res.success) {
            alert(`¡Nuevo ciclo generado exitosamente para el canal! Ahora en Ciclo ${res.cycle}.`);
            await refreshChannels();
          }
        } catch (e) {
          alert('Error al reiniciar ciclo: ' + e.message);
        }
      }
    });
  }

  const btnRefresh = $('btnRefreshChannels');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => refreshChannels(true));
  }

  // Búsqueda en selector de series de Canal 103
  const searchInput = $('randomShowsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(randomSearchDebounce);
      randomSearchDebounce = setTimeout(() => {
        randomSearchQuery = (e.target.value || '').toLowerCase().trim();
        renderRandomShows();
      }, 150);
    });
  }

  // Cambio de checkbox individual
  const showsContainer = $('randomShowsListContainer');
  if (showsContainer) {
    showsContainer.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        const showId = e.target.dataset.showId;
        const show = randomShowsList.find(s => String(s.id) === String(showId));
        if (show) {
          show.isIncluded = e.target.checked;
          const card = e.target.closest('.random-show-check-card');
          if (card) card.classList.toggle('selected', show.isIncluded);
          updateSelectedRandomBadge();
        }
      }
    });
  }

  // Botones de selección rápida
  const btnSelectAll = $('btnSelectAllRandom');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      randomShowsList.forEach(s => { s.isIncluded = true; });
      renderRandomShows();
    });
  }

  const btnDeselectAll = $('btnDeselectAllRandom');
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      randomShowsList.forEach(s => { s.isIncluded = false; });
      renderRandomShows();
    });
  }

  const btnRecommended = $('btnRecommendedRandom');
  if (btnRecommended) {
    btnRecommended.addEventListener('click', () => {
      const EXCLUDED = ['simpson', 'futurama'];
      const INCLUDED = [
        'coraje', 'chicas superpoderosas', 'transformers', 'beast wars',
        'casa de los dibujos', 'rick y morty', 'smiling friends', 'critico',
        'the critic', 'escuadron del tiempo', 'time squad', 'motoratones',
        'biker mice', 'ren y stimpy', 'ren & stimpy', 'ren and stimpy'
      ];
      const isMatch = (str, keys) => {
        const norm = String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return keys.some(k => norm.includes(k));
      };
      randomShowsList.forEach(s => {
        const title = s.title || '';
        s.isIncluded = !isMatch(title, EXCLUDED) && isMatch(title, INCLUDED);
      });
      renderRandomShows();
    });
  }

  // Botón guardar
  const btnSave = $('btnSaveRandomShows');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const selectedIds = randomShowsList.filter(s => s.isIncluded).map(s => s.id);
      if (!selectedIds.length) {
        if (!confirm('No has seleccionado ninguna serie. ¿Seguro que deseas vaciar la rotación del Canal 103?')) return;
      }
      try {
        btnSave.disabled = true;
        btnSave.textContent = '⏳ Guardando...';
        const res = await api.post('/api/admin/channels/random/shows', { showIds: selectedIds });
        if (res && res.success) {
          alert(`¡Programación del Canal 103 actualizada con éxito!\n\n${res.count} series activas (${res.totalEpisodes} capítulos en la rotación aleatoria).`);
          await refreshChannels();
          await refreshRandomShows();
        }
      } catch (e) {
        alert('Error guardando programación de Canal 103: ' + e.message);
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = '💾 Guardar y Re-barajar Canal 103';
      }
    });
  }

  // Sondeo periódico cuando la pestaña está activa
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    const tab = $('tabChannels');
    if (tab && tab.classList.contains('active')) {
      refreshChannels();
    }
  }, 4000);
}
