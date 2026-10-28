/**
 * Home Channel HLS - El televisor: encendido, audio, filtro CRT, degauss, pantalla completa y
 * canales. Guarda su propio estado; los controles (bisel, remoto, teclado) solo le
 * envían órdenes (ver commands.js).
 */

import { $ } from '../../shared/dom.js';
import { showOsdAlert, showVolumeMeter } from './osd.js';
import { toggleFullscreen } from './fullscreen.js';
import { CHANNEL_PRESETS, paintPreset } from './channels.js';

const VOLUME_STEP = 0.1;

export class TvSet {
  constructor() {
    this.poweredOn = true;
    this.volume = 0.8;
    this.userHasUnmuted = false;
    this.crtEnabled = true;
    this.presetIndex = 0;
    window._tvSet = this;
  }

  get video() {
    return $('liveVideo');
  }

  /** Eventos de la pantalla: clic activa audio, doble clic pantalla completa. */
  attachScreen() {
    const video = this.video;
    if (!video) return;
    video.muted = !this.userHasUnmuted;
    video.volume = this.volume;

    const banner = $('btnUnmuteBanner');
    if (banner) banner.addEventListener('click', () => this.unmute());
    video.addEventListener('click', () => { if (video.muted) this.unmute(); });
    video.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.toggleFullscreen();
    });
    // Safari en iPhone pausa el video al salir de la pantalla completa nativa
    video.addEventListener('webkitendfullscreen', () => {
      if (this.poweredOn && video.paused) video.play().catch(() => {});
    });
    video.addEventListener('playing', () => {
      if (!video.muted) this.paintMute(false);
    });
  }

  /* ---------- Encendido ---------- */

  togglePower() {
    this.poweredOn = !this.poweredOn;
    const on = this.poweredOn;
    const wrapper = $('crtScreenWrapper');
    const led = $('tvPowerLed');
    const display = $('channelDisplay7Seg');

    if (wrapper) wrapper.classList.toggle('tv-turned-off', !on);
    if (this.video) {
      if (on) this.video.play().catch(() => {});
      else this.video.pause();
    }
    if (led) led.className = on ? 'indicator-led red active' : 'indicator-led red';
    $('btnBezelPower')?.classList.toggle('active', on);
    if (display) display.style.opacity = on ? '1' : '0.2';
    if (on) this.degauss();
  }

  /* ---------- Audio ---------- */

  /** Botón de mute y banner "activar audio" según el estado. */
  paintMute(muted) {
    const btn = $('btnBezelMute');
    if (btn) {
      btn.classList.toggle('active', muted);
      btn.textContent = muted ? '🔇 MUTE' : '🔊 AUDIO';
    }
    $('btnUnmuteBanner')?.classList.toggle('hidden', !muted);
  }

  unmute() {
    this.userHasUnmuted = true;
    const isRadio = CHANNEL_PRESETS[this.presetIndex]?.isRadio;
    if (isRadio && window._radioTuner) {
      window._radioTuner.unmute(this.volume);
    } else {
      const video = this.video;
      if (video) {
        video.muted = false;
        video.volume = this.volume;
        video.play().catch(() => {});
      }
    }
    this.paintMute(false);
    showVolumeMeter(this.volume);
  }

  toggleMute() {
    const isRadio = CHANNEL_PRESETS[this.presetIndex]?.isRadio;
    if (isRadio && window._radioTuner) {
      const muted = window._radioTuner.toggleMute();
      this.userHasUnmuted = !muted;
      this.paintMute(muted);
      if (muted) {
        showOsdAlert('RADIO: SILENCIADA');
      } else {
        showVolumeMeter(this.volume);
      }
      return;
    }

    const video = this.video;
    if (!video) return;
    video.muted = !video.muted;
    this.userHasUnmuted = !video.muted;
    this.paintMute(video.muted);
    if (video.muted) {
      showOsdAlert('AUDIO: SILENCIADO');
    } else {
      video.play().catch(() => {});
      showVolumeMeter(this.volume);
    }
  }

  changeVolume(delta) {
    const isRadio = CHANNEL_PRESETS[this.presetIndex]?.isRadio;
    if (delta > 0 && !this.userHasUnmuted) {
      this.userHasUnmuted = true;
      this.paintMute(false);
    }
    this.volume = Math.min(1, Math.max(0, this.volume + delta));

    if (isRadio && window._radioTuner) {
      window._radioTuner.setVolume(this.volume);
    } else if (this.video) {
      if (delta > 0 && this.video.muted) {
        this.video.muted = false;
      }
      this.video.volume = this.volume;
    }
    showVolumeMeter(this.volume);
  }

  volumeUp() { this.changeVolume(VOLUME_STEP); }
  volumeDown() { this.changeVolume(-VOLUME_STEP); }

  /* ---------- Imagen ---------- */

  degauss() {
    const wrapper = $('crtScreenWrapper');
    if (!wrapper) return;
    wrapper.classList.remove('degauss-active');
    void wrapper.offsetWidth; // reinicia la animación
    wrapper.classList.add('degauss-active');
    showOsdAlert('⚡ DEGAUSS // REAJUSTANDO CAMPO MAGNÉTICO');
  }

  toggleCrt() {
    this.crtEnabled = !this.crtEnabled;
    $('crtScanlines')?.classList.toggle('active', this.crtEnabled);
    const btn = $('btnBezelCrtFx');
    if (btn) {
      btn.classList.toggle('active', this.crtEnabled);
      btn.textContent = this.crtEnabled ? '📼 CRT: ON' : '📺 CRT: OFF';
    }
    showOsdAlert(this.crtEnabled ? 'FILTRO CRT: ACTIVADO' : 'FILTRO CRT: DESACTIVADO');
  }

  toggleFullscreen() {
    toggleFullscreen($('crtScreenWrapper'), this.video);
  }

  /* ---------- Canales ---------- */

  tuneTo(index) {
    const n = CHANNEL_PRESETS.length;
    this.presetIndex = ((index % n) + n) % n;
    const preset = CHANNEL_PRESETS[this.presetIndex];
    paintPreset(preset, this);
    showOsdAlert(`SINTONIZANDO ${preset.ch} // ${preset.name}`);
  }

  channelUp() { this.tuneTo(this.presetIndex + 1); }
  channelDown() { this.tuneTo(this.presetIndex - 1); }

  toggleRadio() {
    const radioIndex = CHANNEL_PRESETS.findIndex(p => p.id === 'radio_fm');
    if (radioIndex === -1) return;
    if (this.presetIndex === radioIndex) {
      this.tuneTo(0);
    } else {
      this.tuneTo(radioIndex);
      this.unmute();
    }
  }

  tuneById(id) {
    const index = CHANNEL_PRESETS.findIndex(p => p.id === id);
    if (index !== -1) this.tuneTo(index);
  }
}
