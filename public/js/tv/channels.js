/**
 * Home Channel HLS - "Canales" del televisor: identidades visuales de la misma señal.
 */

import { $ } from '../../shared/dom.js';

export const CHANNEL_PRESETS = [
  { id: 'radikal', name: 'RADIKAL', ch: 'CH-99', ticker: 'CANAL Home Channel HLS // TRANSMISIÓN SATELITAL 1999 // ANIME DE CULTO • ADULT SWIM • MÚSICA ELECTRÓNICA // ' },
  { id: 'cyber', name: 'CYBER', ch: 'CH-88', ticker: 'Home Channel HLS // FRECUENCIA ALTERNATIVA // EMISIÓN CONTINUA DE ANIME RETRO, CORTINILLAS Y RAREZAS // ' },
  { id: 'nocturna', name: 'NOCTURNA', ch: 'CH-69', ticker: 'Home Channel NOCTURNA // ANIME DE CULTO • ADULT SWIM • COMERCIALES RETRO // ' },
  { id: 'clasico', name: 'CLÁSICO', ch: 'CH-01', ticker: 'Home Channel HLS // SEÑAL SATELITAL TRANS-AMÉRICAS 1999 // ANIME Y ANIMACIÓN PARA ADULTOS // ' },
  { id: 'radio_fm', name: 'RADIO FM 99.1', ch: 'FM-99', isRadio: true, ticker: 'Home Channel RADIO 99.1 FM // EMISIÓN NOVENTERA // ROCK • METAL • ANIME OST • SYNTHWAVE // ' }
];

const BRAND = 'Home Channel';

/** Pinta la identidad del canal (el nombre siempre es Home Channel; cambia el "apellido"). */
export function paintPreset(preset, tv = null) {
  const set = (el, text) => { if (el) el.textContent = text; };
  set($('brandBoxText'), BRAND);
  set($('brandNameText'), preset.name);
  set($('osdChannel'), preset.ch);
  set($('channelDisplay7Seg'), preset.ch);
  set(document.querySelector('.billboard-brand'), BRAND);
  set($('tickerText'), `${preset.ticker} AUDIO MTS STEREO // EMISIÓN CONTINUA 24 HORAS // SEÑAL SATELITAL RADIKAL // `);
  const select = $('channelNameSelect');
  if (select) select.value = preset.id;

  // Manejo de pantalla y audio: Sintonizador de Radio FM vs Señal de Televisión
  const tuner = window._radioTuner;
  const video = $('liveVideo');
  const osd = $('screenOsd');
  const tvSet = tv || window._tvSet;

  if (preset.isRadio) {
    if (video) {
      video.style.opacity = '0';
      video.muted = true; // Silenciar por completo la emisión de TV
    }
    if (osd) osd.style.display = 'none';
    if (tuner) tuner.start();
  } else {
    if (tuner) tuner.stop();
    if (video) {
      video.style.opacity = '1';
      // Restaurar audio de la TV solo si el usuario ya lo había desmuteado
      if (tvSet && tvSet.userHasUnmuted) {
        video.muted = false;
        video.volume = tvSet.volume;
      }
    }
    if (osd) osd.style.display = '';
  }
}
