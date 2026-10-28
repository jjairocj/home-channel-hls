/**
 * Home Channel HLS - Controles del televisor (patrón Command).
 *
 * Cada acción tiene un nombre; el bisel, el control remoto y el teclado solo son
 * tablas que asignan botones/teclas a esas acciones.
 */

import { $ } from '../../shared/dom.js';
import { showOsdAlert } from './osd.js';

const BEZEL = {
  btnBezelPower: 'power',
  btnBezelChUp: 'channelUp',
  btnBezelChDown: 'channelDown',
  btnBezelVolUp: 'volumeUp',
  btnBezelVolDown: 'volumeDown',
  btnBezelMute: 'mute',
  btnBezelDegauss: 'degauss',
  btnBezelCrtFx: 'crt',
  btnBezelBillboard: 'billboard',
  btnBezelRadio: 'toggleRadio',
  btnBezelFullscreen: 'fullscreen'
};

const REMOTE = {
  rPowerBtn: 'power',
  rMuteBtn: 'mute',
  rFullscreenBtn: 'fullscreen',
  rFullscreenPillBtn: 'fullscreen',
  rChUpBtn: 'channelUp',
  rChDownBtn: 'channelDown',
  rVolUpBtn: 'volumeUp',
  rVolDownBtn: 'volumeDown',
  rOkBtn: 'unmute',
  rCrtToggleBtn: 'crt',
  rDegaussBtn: 'degauss',
  rTvGuideBtn: 'billboard',
  rGuidePillBtn: 'guide'
};

const KEYBOARD = {
  f: 'fullscreen',
  m: 'mute',
  c: 'crt',
  b: 'billboard',
  r: 'toggleRadio',
  d: 'degauss',
  arrowup: 'volumeUp',
  arrowdown: 'volumeDown',
  arrowright: 'channelUp',
  arrowleft: 'channelDown'
};

/**
 * @param {Object} deps
 * @param {TvSet} deps.tv
 * @param {CrtOverlays} deps.overlays
 * @param {Function} deps.openGuide - abre la pestaña de programación
 */
export function createCommands({ tv, overlays, openGuide }) {
  return {
    power: () => tv.togglePower(),
    mute: () => tv.toggleMute(),
    unmute: () => tv.unmute(),
    volumeUp: () => tv.volumeUp(),
    volumeDown: () => tv.volumeDown(),
    channelUp: () => tv.channelUp(),
    channelDown: () => tv.channelDown(),
    toggleRadio: () => tv.toggleRadio(),
    degauss: () => tv.degauss(),
    crt: () => tv.toggleCrt(),
    fullscreen: () => tv.toggleFullscreen(),
    billboard: () => overlays.toggleBillboard(),
    guide: () => openGuide()
  };
}

function flashIrSensor() {
  const sensor = document.querySelector('.remote-ir-sensor');
  if (!sensor) return;
  sensor.classList.add('firing');
  setTimeout(() => sensor.classList.remove('firing'), 150);
}

function bindButtons(table, commands) {
  for (const [id, command] of Object.entries(table)) {
    const el = $(id);
    if (el) el.addEventListener('click', commands[command]);
  }
}

export function bindControls(commands) {
  bindButtons(BEZEL, commands);
  bindButtons(REMOTE, commands);

  // Destello infrarrojo en cada botón del control remoto
  document.querySelectorAll('.remote-body .r-btn').forEach(btn => btn.addEventListener('click', flashIrSensor));

  // Teclas numéricas: solo muestran el canal "sintonizado"
  document.querySelectorAll('.remote-keypad .r-num').forEach(btn => {
    const label = btn.textContent.trim();
    if (['EPG', 'FULL'].includes(label)) return;
    btn.addEventListener('click', () => showOsdAlert(`CANAL SINTONIZADO: CH-${label.padStart(2, '0')}`));
  });

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const command = KEYBOARD[e.key.toLowerCase()];
    if (!command) return;
    e.preventDefault();
    commands[command]();
  });
}
