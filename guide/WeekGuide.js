/**
 * Home Channel HLS - Programación de la semana para la revista impresa (TeleGuía en PDF).
 *
 * Usa el mismo planificador que la emisión y la guía web, por días de transmisión
 * (de las 06:00 a las 06:00 del día siguiente): la madrugada se lista en el día que la
 * empieza, como en las revistas de TV. Los bloques seguidos de la misma serie y del
 * mismo tipo (maratón, especial de una hora) se agrupan en una sola entrada.
 */

const { DAY_KEYS, BROADCAST_DAY_START_HOUR } = require('../core/time');

const SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Franjas, en el orden en que aparecen en un día de transmisión. */
const SECTIONS = {
  morning: { label: 'Mañana', range: '06:00 – 12:00', color: '#16a8c7' },
  afternoon: { label: 'Tarde', range: '12:00 – 18:00', color: '#3fa34d' },
  primetime: { label: 'Prime Time', range: '18:00 – 01:00', color: '#d7261e' },
  night: { label: 'Madrugada', range: '01:00 – 06:00', color: '#4b3f8f' }
};

/** Mismas reglas de género que la guía web (public/js/guide/blocks.js). */
const GENRES = [
  { text: 'Anime', color: '#e8298a', keywords: ['evangelion', 'lain', 'bebop', 'dragon ball', 'digimon', 'naruto', 'inuyasha', 'nadesico', 'saikano', 'ergo proxy', 'death note', 'saber marionette', 'blue seed', 'jojo', 'anime'] },
  { text: 'Animación adulta', color: '#16a8c7', keywords: ['simpson', 'smiling', 'betty'] }
];
const DEFAULT_GENRE = { text: 'Selección retro', color: '#7a5a1e' };
const OFF_AIR_GENRE = { text: 'Cierre', color: '#777777' };

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function sectionOf(hour) {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 1 && hour < 6) return 'night';
  return 'primetime';
}

function genreOf(title, offAir) {
  if (offAir) return OFF_AIR_GENRE;
  const name = title.toLowerCase();
  return GENRES.find(g => g.keywords.some(k => name.includes(k))) || DEFAULT_GENRE;
}

/** Inicio del día de transmisión que contiene `date`. */
function broadcastDayStart(date) {
  const d = new Date(date);
  if (d.getHours() < BROADCAST_DAY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(BROADCAST_DAY_START_HOUR, 0, 0, 0);
  return d;
}

/**
 * Estreno, repetición o maratón de un bloque. Estreno solo para series que se emiten
 * en orden (las episódicas y los videos sueltos no tienen "capítulo del día").
 */
function kindOf(block) {
  const show = block.mainShow || {};
  if (block.isOffAir) return 'off';
  if (show.marathon || /^Maratón:/i.test(block.title || '')) return 'marathon';
  if (block.isRepeat) return 'repeat';
  if (show.dailyKey) return 'premiere';
  return 'regular';
}

function cleanTitle(block) {
  if (block.isOffAir) return 'Cierre de emisión';
  return String(block.title || 'Home Channel Broadcast')
    .replace(/^Maratón:\s*/i, '')
    .replace(/\s*\((Doble Episodio|Especial 1 Hora)\)/gi, '')
    .trim();
}

/** Agrupa bloques seguidos de la misma serie y tipo. */
function toEntries(blocks) {
  const entries = [];
  for (const block of blocks) {
    const start = new Date(block.startTime);
    const end = new Date(block.endTime);
    const title = cleanTitle(block);
    const kind = kindOf(block);
    const prev = entries[entries.length - 1];
    const groupable = kind === 'marathon' || kind === 'off' || (block.durationSeconds || 1800) > 1800;
    if (prev && prev.title === title && prev.kind === kind && groupable && prev.end.getTime() === start.getTime()
      && sectionOf(start.getHours()) === prev.section) {
      prev.end = end;
      prev.slots++;
      continue;
    }
    const offAir = !!block.isOffAir;
    entries.push({
      start,
      end,
      title,
      kind,
      offAir,
      slots: 1,
      section: sectionOf(start.getHours()),
      genre: genreOf(title, offAir)
    });
  }
  return entries.map(e => ({ ...e, startLabel: hhmm(e.start), endLabel: hhmm(e.end), minutes: Math.round((e.end - e.start) / 60000) }));
}

/** Lo destacado del día: el estreno de la noche (o, si no hay, el primero del prime time). */
function featureOf(entries) {
  const prime = entries.filter(e => e.section === 'primetime' && !e.offAir);
  return prime.find(e => e.kind === 'premiere' && e.start.getHours() >= 19)
    || prime.find(e => e.kind === 'premiere')
    || prime.find(e => e.kind === 'marathon')
    || prime[0]
    || entries.find(e => !e.offAir)
    || null;
}

/**
 * @param {Object} scheduler - con planBlocks(start, slots, { withItems: false })
 * @param {Date} [now]
 * @param {number} [days]
 * @returns {{ from: Date, to: Date, days: Array<{ key, date, entries, feature }> }}
 */
function buildWeekGuide(scheduler, now = new Date(), days = 7) {
  const from = broadcastDayStart(now);
  const to = new Date(from.getTime() + days * DAY_MS);
  const blocks = scheduler.planBlocks(from, Math.round((to - from) / SLOT_MS), { withItems: false }) || [];

  const out = [];
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(from.getTime() + i * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const dayBlocks = blocks.filter(b => {
      const t = new Date(b.startTime);
      return t >= dayStart && t < dayEnd;
    });
    const entries = toEntries(dayBlocks);
    out.push({
      key: DAY_KEYS[(dayStart.getDay() + 6) % 7],
      date: dayStart,
      entries,
      feature: featureOf(entries)
    });
  }
  return { from, to, days: out };
}

/**
 * Resumen para la portada: estrenos de la semana (serie, días y hora) y maratones.
 */
function coverHighlights(week) {
  const premieres = new Map();
  const marathons = [];
  for (const day of week.days) {
    for (const e of day.entries) {
      if (e.kind === 'premiere') {
        const key = `${e.title}|${e.startLabel}`;
        if (!premieres.has(key)) premieres.set(key, { title: e.title, time: e.startLabel, days: [], genre: e.genre });
        premieres.get(key).days.push(day.key);
      } else if (e.kind === 'marathon') {
        marathons.push({ title: e.title, day: day.key, startLabel: e.startLabel, endLabel: e.endLabel, episodes: e.slots, genre: e.genre });
      }
    }
  }
  // Una línea por serie: el horario en que más días estrena
  const bySeries = new Map();
  for (const p of premieres.values()) {
    const cur = bySeries.get(p.title);
    if (!cur || p.days.length > cur.days.length) bySeries.set(p.title, p);
  }
  return {
    // Primero las tiras (estrenan más días), luego por hora
    premieres: [...bySeries.values()].sort((a, b) => b.days.length - a.days.length || a.time.localeCompare(b.time) || a.title.localeCompare(b.title)),
    marathons
  };
}

module.exports = { buildWeekGuide, coverHighlights, broadcastDayStart, SECTIONS, toEntries };
