/**
 * Home Channel HLS - Reglas de presentación de los bloques de la guía (funciones puras).
 * Las horas se muestran en formato 12 h ("6:30 PM").
 */

import { clock12 } from '../../shared/format.js';

export const MAG_SECTIONS = {
  morning: { label: 'Mañana', range: '5:00 AM – 12:00 PM' },
  afternoon: { label: 'Tarde', range: '12:00 – 6:00 PM' },
  primetime: { label: 'Prime Time', range: '6:00 PM – 1:00 AM' },
  night: { label: 'Madrugada', range: '1:00 – 5:00 AM' }
};

/** Género por palabras clave del título (orden de prioridad). */
const GENRES = [
  { text: 'Anime', class: 'g-anime', keywords: ['evangelion', 'lain', 'bebop', 'dragon ball', 'digimon', 'naruto', 'inuyasha', 'nadesico', 'saikano', 'ergo proxy', 'death note', 'saber marionette', 'blue seed', 'jojo', 'anime'] },
  { text: 'Animación adulta', class: 'g-series', keywords: ['simpson', 'smiling', 'betty'] }
];
const DEFAULT_GENRE = { text: 'Selección retro', class: 'g-retro' };
const OFF_AIR_GENRE = { text: 'Cierre', class: 'g-offair' };

export function isBlockOffAir(block) {
  return !!block.isOffAir || !!(block.title && block.title.toLowerCase().includes('cierre'));
}

export function getBlockBadge(block) {
  if (isBlockOffAir(block)) return OFF_AIR_GENRE;
  const name = (block.title || '').toLowerCase();
  return GENRES.find(g => g.keywords.some(k => name.includes(k))) || DEFAULT_GENRE;
}

export function formatTimeSafely(value) {
  if (!value) return '--:--';
  return clock12(value);
}

function blockHour(block) {
  if (block.time) return parseInt(block.time.split(':')[0], 10);
  if (!block.startTime) return 0;
  const d = new Date(block.startTime);
  return isNaN(d.getTime()) ? 0 : d.getHours();
}

function sectionOf(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 1 && hour < 5) return 'night';
  return 'primetime';
}

/** Bloques con hora de inicio/fin legible, franja y si están al aire ahora. */
export function normalizeBlocks(schedule, isToday, now = Date.now()) {
  return schedule.map(block => {
    const start = block.time || formatTimeSafely(block.startTime);
    let end = '--:--';
    if (block.endTime) end = formatTimeSafely(block.endTime);

    let isCurrent = false;
    if (isToday && block.startTime && block.endTime) {
      const s = new Date(block.startTime).getTime();
      const e = new Date(block.endTime).getTime();
      if (!isNaN(s) && !isNaN(e)) isCurrent = now >= s && now < e;
    }
    const hour = blockHour(block);
    return { block, start, end, isCurrent, hour, section: sectionOf(hour), offAir: isBlockOffAir(block) };
  });
}

/** Une cierres de emisión consecutivos de la misma franja en una sola entrada. */
export function mergeOffAir(blocks) {
  const merged = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (b.offAir && prev && prev.offAir && prev.section === b.section) {
      prev.end = b.end;
      prev.durationSeconds += b.block.durationSeconds || 1800;
      prev.isCurrent = prev.isCurrent || b.isCurrent;
    } else {
      merged.push({ ...b, durationSeconds: b.block.durationSeconds || 1800 });
    }
  }
  return merged;
}

/**
 * Recuadro destacado. Hoy: lo que viene después del programa actual (el teletexto ya
 * muestra lo que está al aire). Otros días: el estreno de la noche.
 */
export function pickFeature(blocks, isToday) {
  let idx = -1;
  let kicker = 'No te lo pierdas esta noche';
  let burst = '¡ESTRENO!';
  if (isToday) {
    const curIdx = blocks.findIndex(b => b.isCurrent);
    const curTitle = curIdx !== -1 ? blocks[curIdx].block.title : null;
    idx = blocks.findIndex((b, i) => i > curIdx && !b.offAir && b.block.title !== curTitle);
    kicker = 'A continuación en Home Channel';
    burst = '¡NO TE LO PIERDAS!';
  }
  if (idx === -1) idx = blocks.findIndex(b => !b.offAir && b.hour >= 20);
  if (idx === -1) idx = blocks.findIndex(b => !b.offAir);
  if (idx === -1) return null;

  const current = blocks[idx];
  const next = blocks.slice(idx + 1).find(b => !b.offAir && b.block.title !== current.block.title);
  return { current, next, kicker, burst };
}
