/**
 * Home Channel HLS - Resúmenes de audiencia (funciones puras): puntos de la gráfica por
 * intervalo, pico, promedio, espectadores únicos, tiempo promedio y programas más vistos.
 *
 * "Espectadores" = web + TV/IPTV. La radio se informa aparte.
 */

const RANGES = {
  '24h': { hours: 24, bucketMinutes: 5 },
  '7d': { hours: 24 * 7, bucketMinutes: 60 },
  '30d': { hours: 24 * 30, bucketMinutes: 24 * 60 }
};

/** Programas con menos minutos de muestras no entran en el ranking (poco representativos). */
const MIN_PROGRAM_MINUTES = 15;
const TOP_PROGRAMS = 10;

const round1 = (n) => Math.round(n * 10) / 10;
const viewersOf = (s) => (s.web || 0) + (s.tv || 0);

/** Lo de cierre de emisión no es un programa para el ranking. */
const isProgram = (title) => !!title && !/cierre/i.test(title);

/** Título legible del bloque al aire (sin "Maratón:", "(Doble Episodio)", etc.). */
function programName(blockTitle) {
  if (!blockTitle) return null;
  if (/cierre/i.test(blockTitle)) return 'Cierre de emisión';
  return String(blockTitle)
    .replace(/^Maratón:\s*/i, '')
    .replace(/\s*\((Doble Episodio|Especial 1 Hora)\)/gi, '')
    .trim() || null;
}

/**
 * Puntos de la gráfica: promedio de espectadores por intervalo (null si no hay
 * muestras, p. ej. con el servidor apagado), con su pico y desglose.
 */
function buckets(samples, from, to, bucketMinutes) {
  const size = bucketMinutes * 60 * 1000;
  const start = Math.floor(new Date(from).getTime() / size) * size;
  const end = new Date(to).getTime();
  const slots = new Map();
  for (const s of samples) {
    const t = new Date(s.at).getTime();
    if (t < start || t >= end) continue;
    const k = Math.floor((t - start) / size);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(s);
  }
  const points = [];
  for (let k = 0, t = start; t < end; k++, t += size) {
    const list = slots.get(k) || [];
    if (!list.length) {
      points.push({ at: new Date(t).toISOString(), viewers: null, peak: null, web: null, tv: null, radio: null, program: null });
      continue;
    }
    const avg = (f) => round1(list.reduce((n, s) => n + f(s), 0) / list.length);
    const programs = new Map();
    list.forEach(s => { if (s.program) programs.set(s.program, (programs.get(s.program) || 0) + 1); });
    const program = [...programs.entries()].sort((a, b) => b[1] - a[1])[0];
    points.push({
      at: new Date(t).toISOString(),
      viewers: avg(viewersOf),
      peak: Math.max(...list.map(viewersOf)),
      web: avg(s => s.web || 0),
      tv: avg(s => s.tv || 0),
      radio: avg(s => s.radio || 0),
      program: program ? program[0] : null
    });
  }
  return points;
}

/** Programas por promedio de espectadores mientras estaban al aire. */
function topPrograms(samples) {
  const by = new Map();
  for (const s of samples) {
    if (!isProgram(s.program)) continue;
    if (!by.has(s.program)) by.set(s.program, { title: s.program, total: 0, peak: 0, minutes: 0 });
    const p = by.get(s.program);
    const v = viewersOf(s);
    p.total += v;
    p.peak = Math.max(p.peak, v);
    p.minutes++;
  }
  return [...by.values()]
    .filter(p => p.minutes >= MIN_PROGRAM_MINUTES)
    .map(p => ({ title: p.title, avg: round1(p.total / p.minutes), peak: p.peak, minutes: p.minutes }))
    .sort((a, b) => b.avg - a.avg || b.peak - a.peak || a.title.localeCompare(b.title))
    .slice(0, TOP_PROGRAMS);
}

/**
 * Resumen de un periodo.
 * @param {Object} input
 * @param {Array} input.samples - { at, web, tv, radio, program }
 * @param {Array} input.sessions - { clientHash, kind, seconds } (cerradas y abiertas)
 * @param {string|Date} input.from
 * @param {string|Date} input.to
 * @param {number} input.bucketMinutes
 */
function summarize({ samples, sessions, from, to, bucketMinutes }) {
  let peak = 0;
  let peakAt = null;
  let total = 0;
  let radioPeak = 0;
  for (const s of samples) {
    const v = viewersOf(s);
    total += v;
    if (v > peak) { peak = v; peakAt = s.at; }
    radioPeak = Math.max(radioPeak, s.radio || 0);
  }
  const viewing = sessions.filter(s => s.kind !== 'radio');
  const unique = new Set(viewing.map(s => s.clientHash)).size;
  const avgMinutes = viewing.length ? round1(viewing.reduce((n, s) => n + (s.seconds || 0), 0) / viewing.length / 60) : 0;
  return {
    points: buckets(samples, from, to, bucketMinutes),
    stats: {
      peak,
      peakAt,
      avg: samples.length ? round1(total / samples.length) : 0,
      unique,
      sessions: viewing.length,
      avgMinutes,
      radioPeak,
      radioUnique: new Set(sessions.filter(s => s.kind === 'radio').map(s => s.clientHash)).size
    },
    programs: topPrograms(samples)
  };
}

module.exports = { summarize, buckets, topPrograms, programName, RANGES };
