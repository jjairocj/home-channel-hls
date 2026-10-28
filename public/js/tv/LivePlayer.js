/**
 * Home Channel HLS - Reproductor HLS de la señal en vivo.
 *
 * Se re-sintoniza solo cuando el stream se congela (p. ej. tras el reinicio del
 * encoder en :00/:30), cuando hay un error fatal o un "stall" de más de 5 s.
 * Los listeners del <video> se registran una sola vez; re-sintonizar solo recrea Hls.
 */

import { showTuning, hideOsdAlert } from './osd.js';

// ?src=web: la audiencia cuenta este reproductor como "web" (ver audience/)
const STREAM_URL = '/live/channel.m3u8?src=web';
const STALL_MS = 5000;
const RETRY_MS = 2000;
const STUCK_SECONDS = 5;
const HLS_CONFIG = {
  liveSyncDurationCount: 4,
  liveMaxLatencyDurationCount: 10,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  enableWorker: true,
  lowLatencyMode: false
};

export class LivePlayer {
  /**
   * @param {HTMLVideoElement} video
   * @param {Function} isOn - () => el televisor está encendido
   */
  constructor(video, isOn) {
    this.video = video;
    this.isOn = isOn;
    this.hls = null;
    this.stallTimer = null;
    this.useHls = typeof Hls !== 'undefined' && Hls.isSupported();
  }

  start() {
    if (!this.video) return;
    this.watchBuffering();
    if (this.useHls) {
      this.connect();
      this.startWatchdog();
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.startNative();
    }
  }

  /* ---------- hls.js ---------- */

  connect() {
    if (this.hls) this.hls.destroy();
    const hls = new Hls(HLS_CONFIG);
    this.hls = hls;
    hls.loadSource(STREAM_URL);
    hls.attachMedia(this.video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.video.play().catch(e => console.warn('[Player] Esperando interacción para reproducir:', e));
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) this.onFatalError(data);
    });
  }

  onFatalError(data) {
    console.warn('[HLS] Manejo de error:', data.type, data.details);
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      setTimeout(() => this.hls && this.hls.loadSource(STREAM_URL), RETRY_MS);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      console.warn('[HLS] Error de media fatal, recuperando...');
      this.hls.recoverMediaError();
      setTimeout(() => {
        if (this.video.paused || this.video.readyState <= 2) this.retune('reinicio de stream');
      }, RETRY_MS);
    } else {
      setTimeout(() => this.retune('error fatal'), RETRY_MS);
    }
  }

  retune(reason) {
    console.warn(`[Player] Re-sintonizando (${reason})...`);
    if (this.useHls) {
      this.connect();
    } else {
      this.video.src = `${STREAM_URL}&t=${Date.now()}`;
      this.video.play().catch(() => {});
    }
  }

  /** El stream "congelado" (tiempo de video quieto 5 s) se re-sintoniza. */
  startWatchdog() {
    let lastTime = -1;
    let stuck = 0;
    setInterval(() => {
      const v = this.video;
      if (v.paused || !this.isOn()) {
        stuck = 0;
        return;
      }
      if (v.currentTime === lastTime && v.readyState >= 2) {
        if (++stuck >= STUCK_SECONDS) {
          stuck = 0;
          this.retune('stream detenido o reiniciado en el servidor');
        }
      } else {
        lastTime = v.currentTime;
        stuck = 0;
      }
    }, 1000);
  }

  /* ---------- Safari nativo ---------- */

  startNative() {
    const v = this.video;
    v.src = STREAM_URL;
    v.addEventListener('loadedmetadata', () => v.play().catch(() => {}));
    v.addEventListener('error', () => {
      console.warn('[Native Video] Error en reproducción nativa, reintentando...');
      setTimeout(() => this.retune('error nativo'), RETRY_MS);
    });
  }

  /* ---------- Buffering ---------- */

  watchBuffering() {
    const v = this.video;
    v.addEventListener('playing', () => {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
      hideOsdAlert();
    });
    v.addEventListener('waiting', () => {
      if (this.isOn()) showTuning();
      if (this.stallTimer) return;
      this.stallTimer = setTimeout(() => {
        this.stallTimer = null;
        if (this.isOn() && (v.paused || v.readyState < 3)) this.retune('stall prolongado (>5s)');
      }, STALL_MS);
    });
  }
}
