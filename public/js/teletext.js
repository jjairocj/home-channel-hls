/**
 * Home Channel HLS - Teletexto bajo el televisor: pestañas P100–P400, "Ahora al aire",
 * "A continuación", indicador de señal y videoteca.
 */

import { $, setText } from '../shared/dom.js';
import { api } from '../shared/api.js';
import { cleanTitle, escapeHtml, formatSec } from '../shared/format.js';

/* ---------- Pestañas ---------- */

export function switchTab(tabId) {
  document.querySelectorAll('.tt-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
}

export function initTabs() {
  document.querySelectorAll('.tt-tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
}

/** Abre una pestaña y desplaza la ventana de la guía a la vista. */
export function openTab(tabId) {
  switchTab(tabId);
  $('guideWindow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Indicador AL AIRE ---------- */

export function paintSignal(status) {
  const running = !!(status && status.isRunning);
  $('onAirPill')?.classList.toggle('stopped', !running);
  setText('onAirText', running ? 'AL AIRE' : 'DETENIDO');
  setText('btnPlayoutText', running ? '■ Detener señal' : '► Iniciar señal');
  $('trayLed')?.classList.toggle('off', !running);
}

export function paintOffline() {
  if (!$('onAirPill')) return;
  $('onAirPill').classList.add('stopped');
  setText('onAirText', 'SIN SEÑAL');
  $('trayLed')?.classList.add('off');
}

/* ---------- Ahora al aire / A continuación ---------- */

function paintPill(id, text, className) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  if (className) el.className = className;
}

export function paintNowPlaying(status) {
  const program = status.currentProgram;
  const track = status.currentTrack;
  if (!status.isRunning || !(program || track)) {
    setText('nowPlayingTitle', 'Emisión en Standby');
    const bar = $('progressBar');
    if (bar) bar.style.width = '0%';
    setText('progressTime', '00:00 / 00:00');
    return;
  }

  if (program && program.isCommercialBreak) {
    // En la pausa se mantiene el programa del bloque
    setText('nowPlayingTitle', cleanTitle(program.name));
    paintPill('nowPlayingType', 'PAUSA COMERCIAL', 'meta-pill warning-pill');
    setText('nowPlayingBlock', program.blockTitle || 'BLOQUE 30M');
  } else if (track) {
    setText('nowPlayingTitle', cleanTitle(track.name));
    paintPill('nowPlayingType', 'PROGRAMA', 'meta-pill');
    setText('nowPlayingBlock', track.blockTitle || 'BLOQUE 30M');
  }

  const bar = $('progressBar');
  if (bar) bar.style.width = `${track ? track.progressPercent : 0}%`;
  setText('progressTime', `${formatSec(track ? track.elapsed : 0)} / ${formatSec(track ? track.duration : 0)}`);

  // "A continuación": siempre el próximo PROGRAMA (no el próximo comercial)
  const next = status.nextProgram || (status.nextTrack && status.nextTrack.role === 'main_show' ? status.nextTrack : null);
  if (next) {
    setText('nextPlayingTitle', cleanTitle(next.name));
    paintPill('nextPlayingType', 'PRÓXIMO PROGRAMA', 'meta-pill highlight');
    setText('nextPlayingDuration', formatSec(next.duration || 0));
  } else {
    setText('nextPlayingTitle', 'Calculando siguiente serie...');
    paintPill('nextPlayingType', 'PRÓXIMO PROGRAMA');
    setText('nextPlayingDuration', '--:--');
  }
}

export function paintUrls(urls) {
  const input = $('urlHlsInput');
  if (urls && input) input.value = urls.hls;
}

/* ---------- Videoteca ---------- */

function genreOf(show) {
  const text = `${show.category || ''} ${show.title || ''}`.toLowerCase();
  if (/simpson|smiling|betty|adulta|adult/.test(text)) return { key: 'series', label: 'Animación adulta' };
  if (/anime/.test(text)) return { key: 'anime', label: 'Anime' };
  return { key: 'retro', label: 'Selección retro' };
}

export class VideoLibrary {
  constructor() {
    this.media = { shows: [] };
    this.filter = 'all';
    this.onAirTitle = '';
  }

  init() {
    const buttons = document.querySelectorAll('.m-filter');
    buttons.forEach(btn => btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.toggle('active', b === btn));
      this.filter = btn.dataset.filter || 'all';
      this.render();
    }));
    this.load();
  }

  async load() {
    try {
      this.media = await api.get('/api/media');
      this.render();
    } catch (err) {
      console.error('Error al cargar videoteca:', err);
    }
  }

  setOnAir(title) {
    this.onAirTitle = String(title || '').toLowerCase();
    this.render();
  }

  render() {
    const grid = $('mediaGrid');
    if (!grid) return;
    const all = this.media.programs || this.media.shows || [];
    const items = this.filter === 'all' ? all : all.filter(s => genreOf(s).key === this.filter);
    if (!items.length) {
      grid.innerHTML = '<div class="media-empty">No hay series de este género en emisión.</div>';
      return;
    }
    grid.innerHTML = items.map(show => {
      const genre = genreOf(show);
      const onAir = this.onAirTitle && this.onAirTitle === String(show.title || '').toLowerCase();
      return `
      <div class="vhs-tape t-${genre.key}${onAir ? ' is-on-air' : ''}">
        ${onAir ? '<span class="vhs-onair-sticker">AL AIRE</span>' : ''}
        <div class="vhs-label">
          <div class="vhs-label-top">
            <span class="vhs-type">${escapeHtml(genre.label)}</span>
            <span class="vhs-dur">${show.totalEpisodes || 0} EPS</span>
          </div>
          <div class="media-title">${escapeHtml(show.title)}</div>
          <div class="media-meta-sub">
            <span>${escapeHtml(show.category || 'Animación')}</span>
            <span>Home Channel</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }
}
