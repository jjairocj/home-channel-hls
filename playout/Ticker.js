/**
 * Home Channel HLS - Marquesina de la tanda comercial: una franja abajo con la programación
 * que queda del día ("6:30 PM Naruto • 7:00 PM Yo soy Betty, la fea • …") corriendo
 * de derecha a izquierda, solo mientras pasan los comerciales.
 *
 * Se dibuja con filtros de FFmpeg (drawbox + drawtext) en la misma emisión: la franja y
 * la pestaña "HOY EN Home Channel" quedan fijas, y cada tanda tiene su propio texto (un
 * archivo, así no hay que escapar títulos) que solo se habilita en sus segundos. Los
 * tiempos salen de planBreaks (playout/LowerThirds.js), igual que el recuadro.
 */

const fs = require('fs');
const path = require('path');

const BRAND = 'Home Channel';
/** Franja: debajo del recuadro "A continuación" (que termina en H-100). */
const BAND_Y = 992;
const BAND_H = 52;
const TAB_W = 320;
const FONT_SIZE = 28;
/** Píxeles por segundo: cruza la pantalla de 1920 en unos 22 s. */
const SPEED = 88;
const SEPARATOR = '     •     ';

const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const between = (windows) => windows.map(w => `between(t,${w.start.toFixed(2)},${w.end.toFixed(2)})`).join('+');

/** Texto de una tanda: hora y programa, separados por viñetas. */
function tickerText(entries) {
  return entries.map(e => `${e.time}  ${e.title}`).join(SEPARATOR);
}

/**
 * Cadena de filtros para FFmpeg (se aplica sobre el video ya escalado a 1080p).
 * Estética Windows Aero Glass con pestaña zafiro, brillo superior y sin "X-99".
 * @param {Array<{ start, end, file }>} windows - tandas con el archivo de su texto
 * @param {string} fontFile
 */
function tickerFilter(windows, fontFile) {
  if (!windows.length) return null;
  const on = quote(between(windows));
  const font = `fontfile=${quote(fontFile)}`;
  const textY = BAND_Y + 11;
  const startX = TAB_W + 30;
  return [
    // Barra base de cristal azul noche (~78% opacidad)
    `drawbox=x=0:y=${BAND_Y}:w=iw:h=${BAND_H}:color=0x061427@0.78:t=fill:enable=${on}`,
    // Borde superior iluminado en cian hielo
    `drawbox=x=0:y=${BAND_Y}:w=iw:h=2:color=0x64d2ff@0.85:t=fill:enable=${on}`,
    // Franja de brillo especular superior en el cristal
    `drawbox=x=0:y=${BAND_Y + 2}:w=iw:h=12:color=white@0.08:t=fill:enable=${on}`,
    // Cada tanda arranca con el texto pegado a la pestaña y da la vuelta al salir por la izquierda
    ...windows.map(w => `drawtext=${font}:textfile=${quote(w.file)}:expansion=none:fontsize=${FONT_SIZE}:fontcolor=white:y=${textY}`
      + `:x=${quote(`w-mod((t-${w.start.toFixed(2)})*${SPEED}+(w-${startX}),w+tw)`)}:enable=${quote(`between(t,${w.start.toFixed(2)},${w.end.toFixed(2)})`)}`),
    // Pestaña izquierda en cristal zafiro Aero
    `drawbox=x=0:y=${BAND_Y}:w=${TAB_W}:h=${BAND_H}:color=0x004e8c@0.86:t=fill:enable=${on}`,
    // Brillo superior de la pestaña
    `drawbox=x=0:y=${BAND_Y}:w=${TAB_W}:h=22:color=white@0.14:t=fill:enable=${on}`,
    // Línea divisoria derecha de cristal
    `drawbox=x=${TAB_W - 1}:y=${BAND_Y}:w=2:h=${BAND_H}:color=0x80e5ff@0.8:t=fill:enable=${on}`,
    // Texto de la pestaña en blanco puro nítido
    `drawtext=${font}:text=${quote(`HOY EN ${BRAND}`)}:expansion=none:fontsize=${FONT_SIZE}:fontcolor=white:x=60:y=${textY}:enable=${on}`
  ].join(',');
}

/** Escribe los textos de las tandas y arma los filtros de la emisión. */
class TickerTrack {
  /**
   * @param {Object} deps
   * @param {string} deps.dir - carpeta para los textos (se vacía en cada armado)
   * @param {string} deps.fontFile
   */
  constructor({ dir, fontFile }) {
    this.dir = dir;
    this.fontFile = fontFile;
  }

  /** @param {Array} breaks - de planBreaks */
  build(breaks) {
    if (!fs.existsSync(this.fontFile)) return { filter: null, breaks: 0 };
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    const windows = breaks
      .filter(b => b.entries.length)
      .map((b, i) => {
        const file = path.join(this.dir, `tanda_${i}.txt`);
        fs.writeFileSync(file, tickerText(b.entries), 'utf8');
        return { start: b.start, end: b.end, file };
      });
    return { filter: tickerFilter(windows, this.fontFile), breaks: windows.length };
  }
}

module.exports = { TickerTrack, tickerFilter, tickerText, BAND_Y, BAND_H };
