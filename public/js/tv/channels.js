/**
 * CrHe X-99 - "Canales" del televisor: identidades visuales de la misma señal.
 */

import { $ } from '../../shared/dom.js';

export const CHANNEL_PRESETS = [
  {
    id: 'crhe_tv',
    name: 'CrHe TV',
    ch: 'CH-100',
    display: '100',
    streamUrl: '/live/channel.m3u8?src=web',
    ticker: 'CANAL 100 // CrHe X-99 // TRANSMISIÓN SATELITAL 1999 // ANIME DE CULTO • ADULT SWIM • MÚSICA ELECTRÓNICA // '
  },
  {
    id: 'simpsons',
    name: 'LOS SIMPSONS',
    ch: 'CH-101',
    display: '101',
    streamUrl: '/simpsons/live/channel.m3u8?src=web',
    ticker: 'CANAL 101 // LOS SIMPSONS 24/7 // EMISIÓN CONTINUA ALEATORIA DE TODAS LAS TEMPORADAS // SPRINGFIELD SIN LÍMITES // '
  },
  {
    id: 'futurama',
    name: 'FUTURAMA',
    ch: 'CH-102',
    display: '102',
    streamUrl: '/futurama/live/channel.m3u8?src=web',
    ticker: 'CANAL 102 // FUTURAMA 24/7 // EMISIÓN CONTINUA ALEATORIA DE TODAS LAS TEMPORADAS // NUEVA NUEVA YORK SIGLO XXXI // '
  },
  {
    id: 'random',
    name: 'RANDOM 24/7',
    ch: 'CH-103',
    display: '103',
    streamUrl: '/random/live/channel.m3u8?src=web',
    ticker: 'CANAL 103 // RANDOM 24/7 // SHUFFLE DE SERIES ALEATORIAS // SPRINGFIELD • NUEVA YORK 3000 • MULTIVERSO // '
  }
];

const BRAND = 'CrHe X-99';

/** Pinta la identidad del canal (el nombre siempre es CrHe X-99; cambia el "apellido"). */
export function paintPreset(preset, tv = null) {
  const set = (el, text) => { if (el) el.textContent = text; };
  const brandName = preset.id === 'simpsons' ? 'SIMPSONS' : (preset.id === 'futurama' ? 'FUTURAMA' : (preset.id === 'random' ? 'RANDOM' : BRAND));
  const billboardName = preset.id === 'simpsons' ? 'Los Simpsons 24/7' : (preset.id === 'futurama' ? 'Futurama 24/7' : (preset.id === 'random' ? 'Random 24/7' : BRAND));
  set($('brandBoxText'), brandName);
  set($('brandNameText'), preset.name);
  set($('brandFreqText'), `${preset.ch} · BANDA KU`);
  set($('osdChannel'), preset.ch);
  set($('channelDisplay7Seg'), preset.display || preset.ch);
  set(document.querySelector('.billboard-brand'), billboardName);
  set($('tickerText'), `${preset.ticker} AUDIO MTS STEREO // EMISIÓN CONTINUA 24 HORAS // `);
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

    // Sintonizar la señal HLS del canal correspondiente
    if (preset.streamUrl && window._livePlayer) {
      window._livePlayer.loadStream(preset.streamUrl);
    }
  }
}
