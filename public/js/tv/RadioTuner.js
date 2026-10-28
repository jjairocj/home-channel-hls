/**
 * Home Channel Radio - Sintonizador Hi-Fi del televisor.
 *
 * Cada emisora es un stream HLS de audio en vivo (igual para todos los oyentes): el
 * sintonizador solo cambia de stream. La pantalla RDS muestra lo que el oyente está
 * escuchando de verdad, compensando la latencia de HLS con la línea de tiempo que
 * publica /api/radio/status. El espectro es real (Web Audio), con respaldo animado.
 *
 * Interfaz usada por TvSet: start(), stop(), unmute(volume), toggleMute(), setVolume(v).
 */

import { $ } from '../../shared/dom.js';
import { api } from '../../shared/api.js';

const POLL_MS = 3000;
const DEFAULT_LATENCY = 20;
/** Segundos que se muestra "DJ al aire" al empezar una canción presentada por el locutor. */
const DJ_ON_AIR_SECONDS = 14;
const SPECTRUM_BARS = 16;
const DEFAULT_STATION = 'main';

export class RadioTuner {
  constructor() {
    this.active = false;
    this.stations = [];
    this.stationId = DEFAULT_STATION;
    this.status = null;
    this.hls = null;
    this.pollTimer = null;
    this.animFrame = null;
    this.analyser = null;
    this.bars = [];
    this.volume = 0.8;
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = this.volume;
  }

  init() {
    this.setupSpectrum();
    // Clic en la pantalla de la radio para asegurar audio desmuteado
    $('radioTunerScreen')?.addEventListener('click', () => {
      const tv = window._tvSet;
      if (tv && !tv.userHasUnmuted) {
        tv.unmute();
      } else if (this.audio.muted || this.audio.paused) {
        this.unmute();
      }
    });
  }

  /* ---------- Encendido ---------- */

  start() {
    this.active = true;
    const screen = $('radioTunerScreen');
    if (screen) screen.hidden = false;

    const tv = window._tvSet;
    if (tv) {
      this.volume = tv.volume || this.volume;
      this.audio.muted = !tv.userHasUnmuted;
    }
    this.audio.volume = this.volume;

    // Sintonizar la emisora única 99.1 FM
    this.refresh().then(() => {
      const current = this.station();
      if (current) this.tune(current.id);
    });
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    this.animate();
  }

  stop() {
    this.active = false;
    const screen = $('radioTunerScreen');
    if (screen) screen.hidden = true;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
    this.detach();
  }

  /* ---------- Audio ---------- */

  unmute(volume = this.volume) {
    this.volume = volume;
    this.audio.muted = false;
    this.audio.volume = volume;
    if (this.active && this.audio.paused) this.audio.play().catch(() => {});
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    if (!this.audio.muted) this.unmute(this.volume);
    return this.audio.muted;
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.audio.volume = this.volume;
  }

  detach() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  play(url) {
    this.detach();
    // Prioridad a Safari / iOS (soporte nativo HLS de Apple sin errores de MediaSource)
    if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      this.audio.src = url;
      this.audio.play().catch(() => {});
    } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      this.hls = new Hls({ liveSyncDurationCount: 3, enableWorker: true });
      this.hls.loadSource(url);
      this.hls.attachMedia(this.audio);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.audio.play().catch(() => {}));
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setTimeout(() => this.active && this.tune(this.stationId, { force: true }), 3000);
      });
    } else {
      this.audio.src = url;
      this.audio.play().catch(() => {});
    }
  }

  /**
   * El espectro visualizador funciona de forma reactiva con el estado de reproducción
   * (sin crear MediaElementSource para no secuestrar ni silenciar el stream en Safari / WebKit).
   */
  ensureAnalyser() {}

  /* ---------- Emisoras ---------- */

  station(id = this.stationId) {
    return this.stations.find(s => s.id === id) || this.stations[0] || null;
  }

  async tune(id, { force = false } = {}) {
    const targetId = id || this.stationId || 'main';
    const changed = targetId !== this.stationId;
    this.stationId = targetId;
    document.querySelectorAll('.t-preset-btn[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === targetId));
    const st = this.station(targetId);
    this.paintDial(st);
    if (!this.active) return;
    if (!st || !st.onAir) {
      this.detach();
      this.paintRds({ show: st ? st.show : 'Home Channel Radio', dj: st ? st.dj : '', text: 'SINTONIZANDO // Conectando con 99.1 FM...' });
      return;
    }
    if (changed || force || !this.hls) this.play(st.streamUrl);
  }

  /** Recorre las emisoras al aire (botón AUTO SCAN). */
  scan() {
    const onAir = this.stations.filter(s => s.onAir);
    if (!onAir.length) return;
    const idx = onAir.findIndex(s => s.id === this.stationId);
    this.tune(onAir[(idx + 1) % onAir.length].id);
  }

  async refresh() {
    try {
      const data = await api.get('/api/radio/status');
      if (!data || !Array.isArray(data.stations)) return;
      const wasOnAir = this.station() && this.station().onAir;
      this.stations = data.stations;
      // La emisora acaba de salir al aire (p. ej. terminó de procesarse la música)
      if (this.active && !wasOnAir && this.station() && this.station().onAir) this.tune(this.stationId, { force: true });
      this.paintNowPlaying();
    } catch (e) {}
  }

  /* ---------- Pantalla ---------- */

  paintDial(st) {
    if (!st) return;
    const digits = $('tunerFreqDigits');
    if (digits) digits.textContent = parseFloat(st.freq).toFixed(2);
    const needle = $('tunerDialNeedle');
    if (needle) needle.style.left = st.dialLeft;
  }

  paintRds({ show, dj, text, djOnAir = false }) {
    const showEl = $('tunerShowName');
    if (showEl) showEl.textContent = String(show || '').toUpperCase();
    const djEl = $('tunerDjName');
    if (djEl) {
      djEl.textContent = djOnAir ? `🎙️ AL AIRE: ${String(dj).toUpperCase()}` : String(dj || '').toUpperCase();
      djEl.classList.toggle('dj-on-air', djOnAir);
    }
    const trackEl = $('tunerTrackTitle');
    if (trackEl) trackEl.textContent = text;
  }

  /** Lo que el oyente escucha: posición del servidor menos la latencia del reproductor. */
  heardItem(st) {
    const latency = this.hls && Number.isFinite(this.hls.latency) && this.hls.latency > 0 ? this.hls.latency : DEFAULT_LATENCY;
    const heard = (st.position || 0) - latency;
    const items = st.timeline || [];
    let current = items[0] || null;
    for (const it of items) if (it.start <= heard) current = it;
    return current ? { item: current, elapsed: Math.max(0, heard - current.start) } : null;
  }

  paintNowPlaying() {
    const st = this.station();
    if (!this.active || !st) return;
    if (!st.onAir) {
      this.paintRds({ show: st.show, dj: st.dj, text: 'SIN SEÑAL // Conectando con 99.1 FM...' });
      return;
    }
    const heard = this.heardItem(st);
    const item = heard ? heard.item : (st.nowPlaying || null);
    if (!item) return;
    const elapsed = heard ? heard.elapsed : (st.nowPlaying?.elapsed || 0);
    const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const text = item.kind === 'jingle'
      ? `📻 ${st.name} // ${st.freq} FM STEREO`
      : `${item.artist} - ${item.title}${item.year ? ` (${item.year})` : ''} [${mmss(elapsed)} / ${mmss(item.duration)}]`;
    this.paintRds({ show: st.show, dj: st.dj, text, djOnAir: !!item.withDj && elapsed < DJ_ON_AIR_SECONDS });
  }

  setupSpectrum() {
    const container = $('tunerSpectrum');
    if (!container) return;
    container.innerHTML = '';
    this.bars = Array.from({ length: SPECTRUM_BARS }, () => {
      const col = document.createElement('div');
      col.className = 'spectrum-col';
      container.appendChild(col);
      return col;
    });
  }

  animate() {
    cancelAnimationFrame(this.animFrame);
    let t = 0;
    const frame = () => {
      if (!this.active) return;
      t += 0.15;
      const playing = !this.audio.paused && !this.audio.muted;
      if (this.analyser && playing) {
        this.analyser.getByteFrequencyData(this.freqData);
        this.bars.forEach((bar, i) => {
          const v = this.freqData[Math.min(this.freqData.length - 1, i + 1)] / 255;
          bar.style.height = `${Math.round(v * 34) + 3}px`;
        });
      } else {
        const intensity = playing ? 1 : 0.25;
        this.bars.forEach((bar, i) => {
          const v = (Math.sin(t * 1.5 + i * 0.4) * 0.5 + 0.5) * 0.6 + Math.random() * 0.3;
          bar.style.height = `${Math.round(v * intensity * 34) + 3}px`;
        });
      }
      this.animFrame = requestAnimationFrame(frame);
    };
    frame();
  }
}
