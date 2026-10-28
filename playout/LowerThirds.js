/**
 * Home Channel HLS - Cuadro "lo que sigue" durante el capítulo (lower third).
 *
 * A la mitad del episodio: "MÁS TARDE EN Home Channel" con el siguiente programa (y el
 * que viene después). Al final (sobre los créditos, 90 s antes de terminar):
 * "A CONTINUACIÓN". Solo el nombre de la serie, nunca el capítulo.
 *
 * Durante la tanda comercial: "A CONTINUACIÓN" toda la tanda, y abajo la marquesina
 * con la programación de lo que queda del día (playout/Ticker.js).
 *
 * Cómo llega a la señal: al arrancar la emisión se arma una "pista" ffconcat de
 * imágenes PNG con transparencia (el cuadro en sus momentos exactos y una imagen
 * transparente en el resto) que FFmpeg superpone en la esquina inferior izquierda.
 * Los tiempos salen de la cola de emisión, así que quedan clavados al fotograma; los
 * cuadros que aún no están renderizados se omiten y entran en la próxima resincronización.
 */

const fs = require('fs');
const { clock12 } = require('../core/time');

const MID_SECONDS = 10;
const END_SECONDS = 12;
/** El cuadro final empieza cuando faltan estos segundos para que termine el episodio. */
const END_LEAD = 90;
/** Episodios más cortos que esto (p. ej. Smiling Friends) solo llevan el cuadro final. */
const SHORT_EPISODE = 8 * 60;
/** Fundido: una imagen semitransparente al entrar y al salir. */
const FADE = 0.3;
/** No arrancar un cuadro que ya pasó o está a punto de empezar al encender la emisión. */
const START_MARGIN = 1;

const BRAND = 'Home Channel';

/** Hora en formato 12 h: "6:30 PM", "12:00 AM". */
const clock = (iso) => clock12(new Date(iso));

/** Nombre de la serie a partir del título del bloque. */
function seriesName(blockTitle) {
  return String(blockTitle || '')
    .replace(/^Maratón:\s*/i, '')
    .replace(/\s*\((Doble Episodio|Especial 1 Hora)\)/gi, '')
    .trim();
}

const durationOf = (item) => item.targetDuration || item.duration || 0;

/** Bloques de la cola (en orden), con sus episodios y la posición de cada uno. */
function blocksOf(queue) {
  const blocks = [];
  queue.items.forEach((item, i) => {
    const prev = blocks[blocks.length - 1];
    if (!prev || prev.startTime !== item.slotStartTime) {
      blocks.push({
        startTime: item.slotStartTime,
        rawTitle: item.blockTitle || '',
        title: seriesName(item.blockTitle),
        offAir: /cierre/i.test(item.blockTitle || ''),
        firstOffset: queue.offsets[i],
        episodes: []
      });
    }
    if (item.role === 'main_show') {
      blocks[blocks.length - 1].episodes.push({ item, offset: queue.offsets[i], duration: durationOf(item) });
    }
  });
  return blocks;
}

function kindOf(block) {
  const main = block.episodes[0] && block.episodes[0].item;
  if (!main) return null;
  if (main.marathon || /^Maratón:/i.test(block.rawTitle)) return 'marathon';
  if (main.isRepeat) return 'repeat';
  if (main.dailyKey) return 'premiere';
  return null;
}

/** "MARATÓN · CAP. 3 DE 5" si el maratón completo está en la cola; si no, "MARATÓN". */
function marathonTag(blocks, index) {
  const same = (b) => b && b.title === blocks[index].title && kindOf(b) === 'marathon';
  let first = index;
  while (same(blocks[first - 1])) first--;
  let last = index;
  while (same(blocks[last + 1])) last++;
  if (first === 0 || last === blocks.length - 1) return 'MARATÓN';
  return `MARATÓN · CAP. ${index - first + 1} DE ${last - first + 1}`;
}

/**
 * Texto del cuadro para el episodio del bloque `index`.
 * @param {'mid'|'end'} moment
 */
function cardFor(blocks, index, moment) {
  const current = blocks[index];
  const next = blocks[index + 1];
  if (!next) return null;

  if (next.offAir) {
    const reopen = blocks.slice(index + 2).find(b => !b.offAir);
    return { label: 'ESTA NOCHE', time: clock(next.startTime), title: 'Cierre de emisión', tag: null, sub: reopen ? `Volvemos a las ${clock(reopen.startTime)}` : null };
  }

  const kind = kindOf(next);
  const sameSeries = next.title === current.title;
  let tag = null;
  if (kind === 'marathon') tag = marathonTag(blocks, index + 1);
  else if (sameSeries) tag = 'OTRO CAPÍTULO';
  else if (kind === 'premiere') tag = 'ESTRENO';
  else if (kind === 'repeat') tag = 'REPETICIÓN';

  if (moment === 'end') return { label: 'A CONTINUACIÓN', time: clock(next.startTime), title: next.title, tag, sub: null };

  const after = blocks[index + 2];
  const label = sameSeries && kind === 'marathon' ? 'SIGUE EL MARATÓN' : `MÁS TARDE EN ${BRAND}`;
  const sub = after ? `Después: ${clock(after.startTime)} ${after.offAir ? 'Cierre de emisión' : after.title}` : null;
  return { label, time: clock(next.startTime), title: next.title, tag, sub };
}

/**
 * Momentos y textos de los cuadros de toda la cola.
 * @param {import('./PlayoutQueue')} queue
 * @param {number} seekOffset - la emisión arranca en este segundo de la cola
 * @returns {Array<{ start: number, end: number, moment: string, card: Object }>}
 *   start/end en segundos de la salida de FFmpeg (0 = arranque de la emisión)
 */
function planLowerThirds(queue, seekOffset = 0) {
  const blocks = blocksOf(queue);
  const windows = [];
  blocks.forEach((block, index) => {
    if (block.offAir) return;
    block.episodes.forEach((ep, k) => {
      const firstOfTwo = block.episodes.length > 1 && k === 0;
      const add = (at, length, moment, card) => {
        const start = at - seekOffset;
        if (!card || start < START_MARGIN || at + length > ep.offset + ep.duration) return;
        windows.push({ start, end: start + length, moment, card });
      };

      if (firstOfTwo) {
        // Primer capítulo de un bloque de una hora: avisa que sigue otro capítulo
        if (ep.duration >= SHORT_EPISODE) {
          add(ep.offset + ep.duration / 2, MID_SECONDS, 'mid', { label: 'SIGUE EN ESTE BLOQUE', time: null, title: block.title, tag: 'OTRO CAPÍTULO', sub: null });
        }
        return;
      }
      if (ep.duration >= SHORT_EPISODE) add(ep.offset + ep.duration / 2, MID_SECONDS, 'mid', cardFor(blocks, index, 'mid'));
      const endAt = Math.max(ep.offset + ep.duration * 0.6, ep.offset + ep.duration - END_LEAD);
      add(endAt, END_SECONDS, 'end', cardFor(blocks, index, 'end'));
    });
  });
  for (const b of planBreaks(queue, seekOffset)) windows.push({ start: b.start, end: b.end, moment: 'break', card: b.card });
  return windows.sort((a, b) => a.start - b.start);
}

/** Roles que forman la tanda (el Station ID va en medio de las tandas largas). */
const BREAK_ROLES = new Set(['commercial', 'mid_bumper_station']);
/** Tandas más cortas que esto (al arrancar a mitad de una) no llevan recuadro ni marquesina. */
const MIN_BREAK_SECONDS = 8;
const DAY_START_HOUR = 6;

/** Fin del día de emisión (las 06:00 siguientes) para una hora dada. */
function broadcastDayEnd(date) {
  const end = new Date(date);
  end.setHours(DAY_START_HOUR, 0, 0, 0);
  if (end <= date) end.setDate(end.getDate() + 1);
  return end;
}

/**
 * Programación que queda del día después del bloque `index`: un renglón por programa
 * (los bloques seguidos de la misma serie se juntan), hasta el cierre de emisión
 * incluido o, si no hay cierre, hasta las 06:00.
 */
function dayRemaining(blocks, index) {
  const current = blocks[index];
  const dayEnd = broadcastDayEnd(new Date(current.startTime));
  const entries = [];
  for (const block of blocks.slice(index + 1)) {
    if (new Date(block.startTime) >= dayEnd) break;
    const title = block.offAir ? 'Cierre de emisión' : block.title;
    const prev = entries[entries.length - 1];
    if (!prev || prev.title !== title) entries.push({ time: clock(block.startTime), title });
    if (block.offAir) break;
  }
  return entries;
}

/**
 * Tandas comerciales de la cola: el recuadro "A CONTINUACIÓN" y la programación que
 * queda del día para la marquesina.
 * @returns {Array<{ start: number, end: number, card: Object, entries: Array }>}
 *   start/end en segundos de la salida de FFmpeg (como planLowerThirds)
 */
function planBreaks(queue, seekOffset = 0) {
  const blocks = blocksOf(queue);
  const blockIndex = new Map(blocks.map((b, i) => [b.startTime, i]));
  const breaks = [];
  let run = null;
  queue.items.forEach((item, i) => {
    if (!BREAK_ROLES.has(item.role)) { run = null; return; }
    if (run) { run.last = i; return; }
    run = { first: i, last: i };
    breaks.push(run);
  });

  return breaks.map(({ first, last }) => {
    const index = blockIndex.get(queue.items[first].slotStartTime);
    const block = blocks[index];
    if (!block || block.offAir) return null;
    const startAbs = queue.offsets[first];
    const endAbs = queue.offsets[last] + durationOf(queue.items[last]);
    const start = Math.max(startAbs - seekOffset, START_MARGIN);
    const end = endAbs - seekOffset;
    if (end - start < MIN_BREAK_SECONDS) return null;

    // Bloque de una hora: después de la tanda viene otro capítulo de la misma serie
    const nextEp = block.episodes.find(ep => ep.offset > startAbs);
    const card = nextEp
      ? { label: 'A CONTINUACIÓN', time: clock(new Date(new Date(block.startTime).getTime() + (nextEp.offset - block.firstOffset) * 1000)), title: block.title, tag: 'OTRO CAPÍTULO', sub: null }
      : cardFor(blocks, index, 'end');
    if (!card) return null;
    return { start, end, card, entries: dayRemaining(blocks, index) };
  }).filter(Boolean);
}

/**
 * Pista ffconcat de imágenes: transparente, cuadro (con fundido) y otra vez transparente.
 * @param {Array} windows - con `png` y `half` (rutas) listos
 * @param {string} blank - PNG transparente del mismo tamaño
 */
function trackConcat(windows, blank) {
  const quote = (p) => `'${p.replace(/'/g, "'\\''")}'`;
  const lines = ['ffconcat version 1.0'];
  const add = (file, seconds) => {
    if (seconds <= 0.001) return;
    lines.push(`file ${quote(file)}`, `duration ${seconds.toFixed(3)}`);
  };
  let t = 0;
  for (const w of windows) {
    if (w.start < t) continue; // no se pisan (por si acaso)
    add(blank, w.start - t);
    const length = w.end - w.start;
    add(w.half, FADE);
    add(w.png, length - 2 * FADE);
    add(w.half, FADE);
    t = w.end;
  }
  add(blank, 1);
  // El demuxer concat ignora la duración de la última entrada: se repite al final
  lines.push(`file ${quote(blank)}`);
  return `${lines.join('\n')}\n`;
}

/** Arma y escribe la pista de la emisión (o null si no hay cuadros listos). */
class LowerThirdTrack {
  /**
   * @param {Object} deps
   * @param {Object} deps.renderer - NextUpBumpers (getOrCreateLowerThird, lowerThirdBlank)
   * @param {string} deps.file - dónde escribir la pista ffconcat
   */
  constructor({ renderer, file }) {
    this.renderer = renderer;
    this.file = file;
  }

  build(queue, seekOffset = 0) {
    const planned = planLowerThirds(queue, seekOffset);
    const blank = this.renderer.lowerThirdBlank();
    const ready = planned
      .map(w => ({ ...w, ...(this.renderer.getOrCreateLowerThird(w.card) || {}) }))
      .filter(w => w.png && w.half);
    if (!blank || !ready.length) return { file: null, planned: planned.length, ready: 0 };
    fs.writeFileSync(this.file, trackConcat(ready, blank), 'utf8');
    return { file: this.file, planned: planned.length, ready: ready.length };
  }
}

module.exports = { planLowerThirds, planBreaks, dayRemaining, clock, cardFor, blocksOf, trackConcat, LowerThirdTrack, seriesName, END_LEAD, SHORT_EPISODE };
