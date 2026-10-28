/**
 * Home Channel HLS - Gráficas de "lo que sigue" quemadas en la señal.
 *
 * Patrón Decorator: recibe bloques ya planificados y
 *   - reemplaza los bumpers genéricos "A continuación" (al abrir la tanda final y al
 *     cerrarla) por el clip con el siguiente programa, solo si el clip ya existe y dura
 *     lo mismo;
 *   - pone la "Cartelera de hoy" (lo que sigue y los próximos programas) al comienzo
 *     del relleno sincronizador, recortada al hueco del bloque.
 * Si un clip aún no existe se encola su render y el bloque queda como estaba.
 */

const { clock12 } = require('../core/time');

const SAME_LENGTH_TOLERANCE = 0.5;
/** Bumpers "A continuación" que se personalizan con el siguiente programa. */
const NEXT_UP_ROLES = ['next_up_bumper', 'outro_bumper'];
/** Relleno mínimo para mostrar la cartelera (como en la web). */
const BILLBOARD_MIN_SECONDS = 8;
/** Lo que sobre del relleno después de la cartelera dura 0 o al menos esto (sin cortes de 1 s). */
const BILLBOARD_MIN_TAIL = 2;
const BILLBOARD_ROWS = 4;

const WEEKDAYS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function nextUpInfo(nextBlock, cleanTitle) {
  if (nextBlock.isOffAir) {
    return { showTitle: 'Cierre de Emisión', episodeTitle: 'Transmisión OFF • Reanudación 05:00 AM' };
  }
  if (nextBlock.mainShow) {
    const ms = nextBlock.mainShow;
    const blockTitle = nextBlock.title ? nextBlock.title.replace(/\s*\(Doble Episodio\)|\s*\(Especial 1 Hora\)/i, '').trim() : null;
    return {
      showTitle: blockTitle || ms.showTitle || cleanTitle(ms.name),
      episodeTitle: nextBlock.secondShow ? `${ms.name} + ${nextBlock.secondShow.name}` : ms.name
    };
  }
  return { showTitle: 'Home Channel Broadcast', episodeTitle: 'Emisión Regular' };
}

/**
 * @param {Array} blocks - bloques con items (se modifican en el lugar)
 * @param {Object|null} renderer - NextUpBumpers (o null para no decorar)
 * @param {Function} cleanTitle
 */
function decorateWithNextUp(blocks, renderer, cleanTitle) {
  if (!renderer) return blocks;
  blocks.forEach((block, i) => {
    const nextBlock = blocks[(i + 1) % blocks.length];
    if (!nextBlock) return;
    block.items.forEach((original, idx) => {
      if (!NEXT_UP_ROLES.includes(original.role)) return;
      const length = original.targetDuration || original.duration;
      const clip = renderer.getOrCreateNextBumper({
        ...nextUpInfo(nextBlock, cleanTitle),
        startTime: clock12(new Date(nextBlock.startTime)),
        duration: length,
        channelBrand: 'Home Channel'
      });
      if (clip && clip.path && Math.abs(length - clip.duration) < SAME_LENGTH_TOLERANCE) {
        block.items[idx] = { ...original, ...clip, slotOffset: original.slotOffset, role: original.role, blockTitle: block.title };
      }
    });
  });
  return blocks;
}

const lengthOf = (item) => item.targetDuration || item.duration || 0;

/** Próximos programas después del bloque `index` (cierres seguidos en una sola fila). */
function upcomingEntries(blocks, index, cleanTitle) {
  const entries = [];
  for (let j = index + 1; j < blocks.length && entries.length < BILLBOARD_ROWS; j++) {
    const b = blocks[j];
    const prev = entries[entries.length - 1];
    if (b.isOffAir && prev && prev.offAir) continue;
    entries.push({ time: clock12(new Date(b.startTime)), title: nextUpInfo(b, cleanTitle).showTitle, offAir: !!b.isOffAir });
  }
  return entries;
}

/**
 * Cartelera al comienzo del relleno: el clip se recorta al hueco y, si el relleno es
 * más largo que el clip, el resto de los bumpers de relleno sigue recortado para
 * terminar exacto en el :00/:30.
 */
function decorateWithBillboard(blocks, renderer, cleanTitle) {
  if (!renderer || !renderer.getOrCreateBillboard) return blocks;
  blocks.forEach((block, i) => {
    if (block.isOffAir || !block.items) return;
    const first = block.items.findIndex(it => it.role === 'filler_pad');
    if (first === -1) return;
    const pads = block.items.slice(first).filter(it => it.role === 'filler_pad');
    if (pads.length !== block.items.length - first) return; // el relleno siempre va al final
    const total = pads.reduce((sum, it) => sum + lengthOf(it), 0);
    if (total < BILLBOARD_MIN_SECONDS) return;

    const entries = upcomingEntries(blocks, i, cleanTitle);
    if (!entries.length) return;
    const next = new Date(blocks[i + 1].startTime);
    const dateLabel = `${WEEKDAYS[next.getDay()]} ${next.getDate()} ${MONTHS[next.getMonth()]}`;
    const clip = renderer.getOrCreateBillboard(entries, { dateLabel, channelBrand: 'Home Channel' });
    if (!clip || !clip.path) return;

    // Sin "astillas": lo que sobre después de la cartelera dura 0 o al menos BILLBOARD_MIN_TAIL
    let boardLength = Math.min(total, clip.duration);
    const tail = total - boardLength;
    if (tail > 0 && tail < BILLBOARD_MIN_TAIL) boardLength = total - BILLBOARD_MIN_TAIL;
    const start = pads[0].slotOffset || 0;
    const items = [{
      ...clip,
      role: 'filler_pad',
      billboard: true,
      duration: Math.round(boardLength),
      targetDuration: boardLength,
      slotOffset: start,
      blockTitle: block.title
    }];

    // El resto del relleno, con los mismos bumpers recortados al tiempo que queda
    // (los bumpers suman `total`, así que siempre alcanzan)
    let remaining = total - boardLength;
    let offset = start + boardLength;
    for (const pad of pads) {
      if (remaining <= 0.05) break;
      const piece = Math.min(remaining, lengthOf(pad));
      items.push({ ...pad, duration: Math.round(piece), targetDuration: piece, slotOffset: offset });
      offset += piece;
      remaining -= piece;
    }
    block.items.splice(first, pads.length, ...items);
  });
  return blocks;
}

module.exports = { decorateWithNextUp, decorateWithBillboard };
