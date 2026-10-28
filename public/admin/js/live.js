/**
 * Home Channel Master Control - Monitor en vivo y "master switcher": adelantar programa,
 * saltar segmento, sincronizar al reloj y poner una serie en el próximo bloque.
 */

import { $, on, setText } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { escapeHtml, formatSec } from '/shared/format.js';
import { store } from './store.js';
import { refreshScheduleBlocks } from './schedule/blocks.js';
import { setTrayLive } from './shell.js';

// ?src=admin: el monitor del panel no cuenta como audiencia
const STREAM_URL = '/live/channel.m3u8?src=admin';
const RELOAD_DELAY_MS = 1500;
const ROLE_LABELS = {
  main_show: '🎬 PROGRAMA: ',
  commercial: '📼 COMERCIAL RETRO: ',
  bumper: '📻 CORTINILLA: ',
  intro_bumper: '📻 CORTINILLA: ',
  outro_bumper: '📻 CORTINILLA: '
};

/* ---------- Monitor ---------- */

class Monitor {
  constructor() {
    this.hls = null;
  }

  start() {
    const video = $('adminLiveVideo');
    if (!video) return;
    video.muted = true;
    try {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        if (this.hls) this.hls.destroy();
        this.hls = new Hls({ liveSyncDurationCount: 3, enableWorker: true });
        this.hls.loadSource(STREAM_URL);
        this.hls.attachMedia(video);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = STREAM_URL;
        video.play().catch(() => {});
      }
    } catch (err) {
      console.warn('[Monitor] Error inicializando reproductor de monitor:', err.message);
    }
  }

  get started() {
    return !!this.hls;
  }
}

export const monitor = new Monitor();

/* ---------- Estado ---------- */

export async function refreshLiveStatus(onPower) {
  let data;
  try {
    data = await api.get('/api/status');
  } catch (e) {
    return;
  }
  const running = !!data.isRunning;
  const pill = $('adminLivePill');
  if (pill) pill.classList.toggle('stopped', !running);
  setTrayLive(running);
  const toggle = $('btnAdminTogglePlayout');
  if (toggle) {
    toggle.classList.toggle('btn-danger', running);
    toggle.classList.toggle('btn-primary', !running);
  }
  setText('adminLiveText', running ? 'AL AIRE (1080p)' : 'DETENIDO');
  setText('btnPlayoutStatusText', running ? '⏸ DETENER EMISIÓN' : '▶ INICIAR EMISIÓN');
  const label = $('lblPlayoutStatus');
  if (label) {
    label.textContent = running ? 'EN EMISIÓN' : 'DETENIDO';
    label.className = running ? 'green' : 'red';
  }
  if (running && data.uptimeSeconds) setText('adminStreamUptime', `UPTIME: ${formatSec(data.uptimeSeconds)}`);

  const track = data.currentTrack;
  const bar = $('liveProgressBar');
  if (track) {
    setText('liveNowTitle', track.blockTitle || track.name || 'Emisión en vivo');
    setText('liveNowSub', `${ROLE_LABELS[track.role] || ''}${track.name || ''}`);
    if (bar) bar.style.width = `${track.progressPercent || 0}%`;
    setText('liveElapsed', formatSec(track.elapsed || 0));
    setText('liveProgressPercent', `${track.progressPercent || 0}%`);
    setText('liveTotalDuration', formatSec(track.duration || 0));
  } else {
    setText('liveNowTitle', running ? 'Transmisión continua' : 'Emisión detenida');
    setText('liveNowSub', 'Sin segmento activo');
    if (bar) bar.style.width = '0%';
  }

  if (data.nextProgram) setText('liveNextProgramTitle', data.nextProgram.blockTitle || data.nextProgram.name);
  else if (data.nextTrack) setText('liveNextProgramTitle', `Siguiente segmento: ${data.nextTrack.name}`);
  else setText('liveNextProgramTitle', 'Parrilla cíclica activa');

  if (data.clockSync) {
    setText('lblClockSyncCountdown', `⏳ Próximo cambio: en ${data.clockSync.remainingFormatted}`);
    setText('lblClockSyncSlot', `Slot: ${data.clockSync.slotStartFormatted} - ${data.clockSync.slotEndFormatted}`);
  }
  if (data.power && onPower) onPower(data.power);
  return data;
}

/* ---------- Acciones del switcher ---------- */

/**
 * Ejecuta una acción de emisión con sus botones en estado ocupado; si sale bien,
 * re-sintoniza el monitor y refresca el estado.
 * @param {Array<[string, string]>} buttons - [idBoton, textoOcupado]
 */
async function playoutAction({ url, body, buttons, onSuccess, errorLabel, afterReload = () => {} }) {
  const saved = buttons.map(([id, busy]) => {
    const btn = $(id);
    if (!btn) return null;
    const idle = btn.textContent;
    btn.disabled = true;
    btn.textContent = busy;
    return { btn, idle };
  });
  try {
    const data = await api.post(url, body);
    if (!data.success) return alert(`${errorLabel}: ${data.error || 'Desconocido'}`);
    setTimeout(() => {
      if (monitor.started) monitor.start();
      refreshLiveStatus();
      afterReload();
    }, RELOAD_DELAY_MS);
    if (onSuccess) onSuccess(data);
  } catch (err) {
    alert('Error al comunicarse con el servidor: ' + err.message);
  } finally {
    saved.forEach(s => {
      if (!s) return;
      s.btn.disabled = false;
      s.btn.textContent = s.idle;
    });
  }
}

function skipProgram() {
  if (!confirm('¿Deseas adelantar la emisión en vivo al siguiente programa de la parrilla?')) return;
  playoutAction({
    url: '/api/playout/next-program',
    buttons: [['btnHeaderNextProgram', '⏳ ADELANTANDO...'], ['btnSkipToNextProgram', '⏳ ADELANTANDO AL SIGUIENTE PROGRAMA...']],
    errorLabel: 'Error al adelantar programa',
    onSuccess: (data) => alert(`✅ ¡Emisión adelantada con éxito!\nAhora al aire: ${data.message || 'Siguiente programa'}`)
  });
}

function syncClock() {
  if (!confirm('¿Deseas forzar la sincronización horaria de la transmisión?\nTodos los programas arrancarán exactamente a las horas en punto (:00) y a las y media (:30) de nuestro reloj.')) return;
  playoutAction({
    url: '/api/playout/sync-clock',
    body: { forceImmediate: true },
    buttons: [['btnSyncClockNow', '⏳ FORZANDO SINCRONIZACIÓN...'], ['btnHeaderSyncClock', '⏳ SINCRONIZANDO...']],
    errorLabel: 'Error al sincronizar',
    afterReload: refreshScheduleBlocks,
    onSuccess: (data) => {
      const slot = data.slotInfo ? `${data.slotInfo.slotStartFormatted} - ${data.slotInfo.slotEndFormatted}` : '30 min';
      alert(`✅ ¡Emisión sincronizada al horario oficial!\n\n🕒 Slot actual: ${slot}\n📺 Al aire: ${data.currentTrack ? data.currentTrack.name : 'Transmisión continua'}\n\nLos siguientes programas iniciarán con precisión absoluta en punto (:00 y :30).`);
    }
  });
}

function skipSegment() {
  playoutAction({
    url: '/api/playout/next-segment',
    buttons: [['btnSkipToNextSegment', '⏳ SALTANDO SEGMENTO...']],
    errorLabel: 'Error al saltar segmento'
  });
}

function playShowNow() {
  const showId = $('selLiveShowSwitch')?.value;
  const episodeId = $('selLiveEpisodeSwitch')?.value;
  if (!showId) return alert('Por favor selecciona una serie de la lista.');
  if (!episodeId) return alert('Por favor selecciona un capítulo para emitir.');

  const show = store.findShow(showId);
  const showTitle = show ? show.title : 'Serie seleccionada';
  const ep = show && show.episodes ? show.episodes.find(e => e.id === episodeId) : null;
  const epTitle = ep ? `Ep ${ep.episode || ''}: ${ep.title}` : 'Capítulo seleccionado';
  if (!confirm(`¿Programar en el próximo bloque (:00 o :30)?\n"${showTitle}"\n${epTitle}\n\nEl programa en curso no se corta.`)) return;

  playoutAction({
    url: '/api/playout/play-show-now',
    body: { showId, episodeId },
    buttons: [['btnPlayShowNow', '⏳ PROGRAMANDO...']],
    errorLabel: 'Error',
    onSuccess: (data) => alert(`📌 ${data.message || `${showTitle} - ${epTitle} entrará en el próximo bloque.`}`)
  });
}

async function togglePlayout() {
  try {
    const status = await api.get('/api/status');
    await api.post(status.isRunning ? '/api/playout/stop' : '/api/playout/start');
    refreshLiveStatus();
  } catch (e) {}
}

/* ---------- Selector "al aire en el próximo bloque" ---------- */

function paintEpisodeSelect() {
  const showSelect = $('selLiveShowSwitch');
  const epSelect = $('selLiveEpisodeSwitch');
  const btn = $('btnPlayShowNow');
  if (!showSelect || !epSelect) return;
  const disable = (text) => {
    epSelect.innerHTML = `<option value="">${text}</option>`;
    epSelect.disabled = true;
    if (btn) btn.disabled = true;
  };

  if (!showSelect.value) return disable('-- Selecciona una serie primero --');
  const show = store.findShow(showSelect.value);
  if (!show || !(show.episodes || []).length) return disable('Esta serie no tiene capítulos listos');

  const next = show.currentEpisodeIndex || 0;
  epSelect.innerHTML = show.episodes.map((ep, i) => {
    const label = `Ep ${ep.episode || (i + 1)}: ${ep.title}${ep.durationFormatted ? ` (${ep.durationFormatted})` : ''}${i === next ? ' [Próximo en secuencia]' : ''}`;
    return `<option value="${escapeHtml(ep.id)}" ${i === next ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  epSelect.disabled = false;
  if (btn) btn.disabled = false;
}

function paintShowSelect() {
  const select = $('selLiveShowSwitch');
  if (!select) return;
  const ready = store.readyShows();
  if (!ready.length) {
    select.innerHTML = '<option value="">No hay programas con episodios listos</option>';
    const ep = $('selLiveEpisodeSwitch');
    if (ep) {
      ep.innerHTML = '<option value="">-- Sin episodios disponibles --</option>';
      ep.disabled = true;
    }
    if ($('btnPlayShowNow')) $('btnPlayShowNow').disabled = true;
    return;
  }
  const current = select.value;
  select.innerHTML = '<option value="">-- Selecciona una serie para emitir --</option>' +
    ready.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)} (${s.episodes.length} caps listos)</option>`).join('');
  if (current && ready.some(s => s.id === current)) select.value = current;
  paintEpisodeSelect();
}

export function initLive() {
  on('btnHeaderNextProgram', 'click', skipProgram);
  on('btnSkipToNextProgram', 'click', skipProgram);
  on('btnSkipToNextSegment', 'click', skipSegment);
  on('btnPlayShowNow', 'click', playShowNow);
  on('btnSyncClockNow', 'click', syncClock);
  on('btnHeaderSyncClock', 'click', syncClock);
  on('btnAdminTogglePlayout', 'click', togglePlayout);
  on('selLiveShowSwitch', 'change', paintEpisodeSelect);
  store.on('shows', paintShowSelect);
  monitor.start();
}
