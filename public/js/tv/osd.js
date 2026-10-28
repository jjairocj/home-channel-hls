/**
 * Home Channel HLS - Gráficos en pantalla (OSD) del televisor: avisos y medidor de volumen.
 */

import { $ } from '../../shared/dom.js';

const ALERT_MS = 2500;
const VOLUME_MS = 2200;
const VOLUME_BARS = 10;
let volumeTimer = null;

function setAlert(text) {
  const banner = $('osdAlertBanner');
  if (!banner) return null;
  const span = document.createElement('span');
  span.className = 'blink-text';
  span.textContent = text;
  banner.replaceChildren(span);
  banner.classList.add('show');
  return banner;
}

/** Aviso temporal (cambio de canal, mute, degauss…). */
export function showOsdAlert(text) {
  const banner = setAlert(text);
  if (banner) setTimeout(() => banner.classList.remove('show'), ALERT_MS);
}

/** Aviso fijo mientras el video se re-sintoniza (lo quita hideOsdAlert). */
export function showTuning() {
  setAlert('SINTONIZANDO SEÑAL...');
}

export function hideOsdAlert() {
  const banner = $('osdAlertBanner');
  if (banner) banner.classList.remove('show');
}

export function showVolumeMeter(volume) {
  const meter = $('osdVolumeMeter');
  const bars = $('osdVolBars');
  if (!meter || !bars) return;
  const active = Math.round(volume * VOLUME_BARS);
  bars.textContent = '■'.repeat(active) + '□'.repeat(VOLUME_BARS - active);
  meter.classList.add('show');
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => meter.classList.remove('show'), VOLUME_MS);
}
