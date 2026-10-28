/**
 * Home Channel HLS - Reparto de la grilla semanal como un canal de cable colombiano.
 *
 * Dos tipos de serie (ver sagaFrequency):
 *   - Diarias (tira): un capítulo nuevo cada día de lunes a viernes, a la misma hora.
 *   - Semanales: un capítulo nuevo por semana (entre semana). Se agrupan en bloques
 *     temáticos de hasta WEEKLY_BLOCK_SIZE series seguidas la misma noche.
 * Los fines de semana no hay estrenos: maratones con los capítulos de la semana de las
 * series diarias y repeticiones de los bloques semanales.
 *
 * La franja elegida a mano en el panel se respeta: estreno y repeticiones de esa serie
 * van dentro de su franja (con "Automática" la serie puede moverse donde haya espacio).
 *
 * Orden del reparto:
 * 1. Estreno de las diarias (L-V): un horario fijo en su franja; si se llena, el horario
 *    libre más cercano (solo dentro de la franja si es fija); sin horarios, comparte en
 *    días alternos.
 * 2. Bloques semanales (L-V): los de mañana/tarde en su franja, los de prime, noche y
 *    madrugada entre las 18:00 y las 00:00 (salvo franja fija), en noches distintas.
 * 3. Repeticiones de las diarias (mismo capítulo del día), después del estreno, lejos de
 *    él y fuera del prime time: primero las largas, luego una para las demás.
 * 4. Maratones de fin de semana: los MARATHON_LENGTH capítulos de la semana seguidos.
 * 5. Repetición de cada bloque semanal (mejor el fin de semana, fuera del prime time).
 * 6. Huecos restantes: más repeticiones (con aviso).
 *
 * Las episódicas (capítulos al azar) se reparten igual, pero sin maratón.
 *
 * Las reglas manuales del administrador llegan como horarios ya ocupados: el reparto
 * los respeta y no repite lo que ya resuelven (una serie con estreno manual no recibe
 * otro automático). El resultado son reglas automáticas (ver RuleCompiler).
 */

const {
  DAY_KEYS, FRANJAS, MAX_DAILY_AIRINGS, MIN_REPEAT_GAP_MINUTES, WEEKLY_AIRINGS, WEEKLY_BLOCK_SIZE,
  MARATHON_LENGTH, MIN_MARATHON_LENGTH, franjaSlots, isOffAirTime
} = require('./constants');
const { broadcastMinutes } = require('../core/time');
const { cellsToRules } = require('./rules/RuleCompiler');

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Lunes a viernes: los únicos días con estrenos. */
const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
/** Al compartir horario: una serie lunes, miércoles y viernes; la otra martes y jueves. */
const SHARE_A = [0, 2, 4];
const SHARE_B = [1, 3];
const FRANJA_ORDER = Object.keys(FRANJAS);
const DAYTIME_FRANJAS = ['manana', 'tarde'];
/** Los bloques semanales nocturnos (prime, noche, madrugada) se estrenan entre las 18:00 y las 00:00. */
const NIGHT_BLOCK_FRANJAS = ['prime', 'noche'];
/** El prime time es la vitrina: estrenos y bloques semanales, no repeticiones. */
const SHOWCASE_FRANJA = 'prime';
/** Marcadores internos: celdas de maratón y celdas ocupadas por otra cosa (cierre). */
const MARATHON = 'm|';
const BLOCKED = '#|';

/** Horarios emitibles del día de transmisión (06:00 → 00:30, y 05:00-05:30 al final), con su franja. */
function broadcastPositions() {
  const franjaOf = {};
  for (const key of FRANJA_ORDER) for (const t of franjaSlots(key)) franjaOf[t] = key;
  return Object.keys(franjaOf)
    .filter(t => !isOffAirTime(t))
    .map(time => ({ time, minute: broadcastMinutes(time), franja: franjaOf[time], days: new Array(7).fill(null) }))
    .sort((a, b) => a.minute - b.minute);
}

/** Índices repartidos de forma pareja: n elementos sobre `size` posiciones. */
const spread = (n, size) => Array.from({ length: n }, (_, i) => Math.floor((i * size) / n));
const isFree = (pos, days) => days.every(d => !pos.days[d]);
const remainingOf = (e) => e.remainingBlocks || e.remaining || 0;
const byPriority = (a, b) => (a.rerun - b.rerun) || (remainingOf(b) - remainingOf(a)) || a.label.localeCompare(b.label);

class GridBuilder {
  /**
   * @param {Array<{day: number, time: string, key: string}>} reserved - celdas de reglas
   *   manuales (key: clave de saga, 'm|clave' para maratón o '#|…' si no es una serie)
   */
  constructor(reserved = []) {
    this.positions = broadcastPositions();
    this.airings = new Map();
    this.warnings = [];
    this.reserved = new Set();
    // Una colocación por (horario, serie) con todos sus días, como las automáticas
    const groups = new Map();
    for (const cell of reserved) {
      const pos = this.positions.find(p => p.time === cell.time);
      if (!pos) continue;
      const g = `${cell.time}|${cell.key}`;
      if (!groups.has(g)) groups.set(g, { pos, key: cell.key, days: [] });
      groups.get(g).days.push(cell.day);
      this.reserved.add(`${cell.day}|${cell.time}`);
    }
    for (const { pos, key, days } of groups.values()) this.place(pos, key, days.sort((a, b) => a - b));
  }

  /** ¿La serie ya tiene estrenos entre semana (por una regla manual)? */
  hasWeekdayAirings(key) {
    return WEEKDAYS.some(d => this.airingsOn(key, d).length);
  }

  place(pos, key, days) {
    for (const d of days) pos.days[d] = key;
    if (!this.airings.has(key)) this.airings.set(key, []);
    this.airings.get(key).push({ pos, days });
  }

  /** Emisiones en la semana (cada celda cuenta). */
  weeklyAirings(key) {
    return (this.airings.get(key) || []).reduce((acc, a) => acc + a.days.length, 0);
  }

  airingsOn(key, day) {
    return (this.airings.get(key) || []).filter(a => a.days.includes(day));
  }

  /** ¿Puede la serie usar este horario? Con franja fija, solo los de su franja. */
  allowed(entry, pos) {
    return !entry.franjaLocked || pos.franja === entry.franja;
  }

  franjaCenter(franja) {
    const own = this.positions.filter(p => p.franja === franja);
    return own.length ? own.reduce((acc, p) => acc + p.minute, 0) / own.length : 0;
  }

  /** Posiciones permitidas para la serie, las de su franja primero y luego por cercanía. */
  nearFranja(entry) {
    const center = this.franjaCenter(entry.franja);
    return this.positions
      .filter(p => this.allowed(entry, p))
      .sort((a, b) => ((a.franja !== entry.franja) - (b.franja !== entry.franja)) || (Math.abs(a.minute - center) - Math.abs(b.minute - center)));
  }

  /* ---------- 1. Estrenos de las diarias (lunes a viernes) ---------- */

  placeDailyPremieres(daily) {
    const overflow = [];
    for (const franja of FRANJA_ORDER) {
      const list = daily.filter(e => e.franja === franja && !this.hasWeekdayAirings(e.key)).sort(byPriority);
      const own = this.positions.filter(p => p.franja === franja);
      // Solo los horarios de la franja libres toda la semana laboral
      const free = own.filter(p => isFree(p, WEEKDAYS));
      const fits = list.slice(0, free.length);
      spread(fits.length, free.length).forEach((idx, i) => this.place(free[idx], fits[i].key, WEEKDAYS));
      overflow.push(...list.slice(free.length));
    }
    for (const entry of overflow.sort(byPriority)) this.placeOverflow(entry);
  }

  placeOverflow(entry) {
    const near = this.nearFranja(entry);
    const free = near.find(p => isFree(p, WEEKDAYS));
    if (free) return this.place(free, entry.key, WEEKDAYS);

    // Sin horarios libres: comparte en días alternos con una serie que esté sola
    const shared = near.find(p => WEEKDAYS.every(d => p.days[d] === p.days[0]) && p.days[0] && this.airings.get(p.days[0]));
    if (!shared) {
      this.warnings.push(`${entry.label} no entró en la grilla${entry.franjaLocked ? ' (su franja fija está llena)' : ' (no quedan horarios)'}.`);
      return;
    }
    const owner = this.airings.get(shared.days[0]).find(a => a.pos === shared);
    owner.days = SHARE_A;
    for (const d of SHARE_B) shared.days[d] = null;
    this.place(shared, entry.key, SHARE_B);
    this.warnings.push(`${entry.label} comparte horario (${shared.time}) en días alternos: no quedan horarios diarios libres.`);
  }

  /* ---------- 2. Bloques semanales (lunes a viernes) ---------- */

  /** Tramo de `len` horarios seguidos y libres el día `day` dentro de `candidates`. */
  findRun(candidates, day, len) {
    for (let i = 0; i + len <= candidates.length; i++) {
      const run = candidates.slice(i, i + len);
      const contiguous = run.every((p, k) => k === 0 || p.minute - run[k - 1].minute === 30);
      if (contiguous && run.every(p => !p.days[day])) return run;
    }
    return null;
  }

  /** Franjas donde se estrena un bloque semanal. */
  blockFranjas(entry) {
    if (entry.franjaLocked || DAYTIME_FRANJAS.includes(entry.franja)) return [entry.franja];
    return NIGHT_BLOCK_FRANJAS;
  }

  placeWeeklyBlocks(weekly) {
    const blocks = [];
    let cursor = 0;
    // Se agrupan por franja (y fija/automática): las de la misma franja forman el bloque
    const groups = new Map();
    for (const e of [...weekly].filter(x => !this.airings.has(x.key)).sort((a, b) => a.label.localeCompare(b.label))) {
      const key = `${e.franja}|${e.franjaLocked ? 'fija' : 'auto'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const ordered = [...groups.values()].sort((a, b) => FRANJA_ORDER.indexOf(a[0].franja) - FRANJA_ORDER.indexOf(b[0].franja));
    for (const list of ordered) {
      for (let i = 0; i < list.length; i += WEEKLY_BLOCK_SIZE) {
        const members = list.slice(i, i + WEEKLY_BLOCK_SIZE);
        const placed = this.placeBlock(members, cursor);
        if (placed) {
          blocks.push(placed);
          cursor = (WEEKDAYS.indexOf(placed.day) + 1) % WEEKDAYS.length;
        } else {
          members.forEach(e => this.placeWeeklyAlone(e));
        }
      }
    }
    return blocks;
  }

  /** Un bloque el primer día de semana (desde `start`) con espacio en su franja. */
  placeBlock(members, start) {
    const franjas = this.blockFranjas(members[0]);
    const own = this.positions.filter(p => franjas.includes(p.franja));
    for (let k = 0; k < WEEKDAYS.length; k++) {
      const day = WEEKDAYS[(start + k) % WEEKDAYS.length];
      const run = this.findRun(own, day, members.length);
      if (!run) continue;
      run.forEach((p, idx) => this.place(p, members[idx].key, [day]));
      return { members, day, run };
    }
    return null;
  }

  /** Semanal que no cupo en un bloque: el hueco libre más cercano entre semana. */
  placeWeeklyAlone(entry) {
    for (const p of this.nearFranja(entry)) {
      const day = WEEKDAYS.find(d => !p.days[d]);
      if (day !== undefined) return this.place(p, entry.key, [day]);
    }
    this.warnings.push(`${entry.label} no entró en la grilla${entry.franjaLocked ? ' (su franja fija está llena)' : ''}.`);
  }

  /* ---------- 3. Repeticiones de las diarias ---------- */

  /**
   * Repetición en la posición libre (en los días del estreno) más conveniente.
   * Sin `allowShowcase` no usa el prime time (queda para estrenos y bloques semanales).
   */
  repeatDaily(entry, gap, allowShowcase = true) {
    const mine = this.airings.get(entry.key);
    const premiere = mine[0];
    const best = this.positions
      .filter(p => this.allowed(entry, p) && isFree(p, premiere.days))
      .filter(p => allowShowcase || p.franja !== SHOWCASE_FRANJA || entry.franja === SHOWCASE_FRANJA)
      .map(p => {
        const distance = Math.min(...mine.map(a => Math.abs(a.pos.minute - p.minute)));
        const sameFranja = mine.some(a => a.pos.franja === p.franja);
        // La primera emisión del día es la que estrena: la repetición va después
        const after = p.minute > premiere.pos.minute;
        const showcase = p.franja === SHOWCASE_FRANJA && entry.franja !== SHOWCASE_FRANJA;
        const franjaPenalty = sameFranja && !entry.franjaLocked ? 120 : 0;
        return { p, distance, score: distance - franjaPenalty + (after ? 1440 : 0) - (showcase ? 4000 : 0) };
      })
      .filter(c => c.distance >= (entry.franjaLocked ? Math.min(gap, 60) : gap))
      .sort((a, b) => b.score - a.score)[0];
    if (!best) return false;
    this.place(best.p, entry.key, premiere.days);
    return true;
  }

  /**
   * Las series largas tienen asegurada una repetición (aunque sea en prime time); su
   * tercera emisión y la repetición de las demás solo van fuera del prime time.
   */
  fillDailyRepeats(daily) {
    const placed = daily.filter(e => this.airings.has(e.key)).sort(byPriority);
    const long = placed.filter(e => e.long);
    const upTo = (list, limitOf, allowShowcase) => {
      for (let progress = true; progress;) {
        progress = false;
        for (const e of list) {
          if (this.airings.get(e.key).length < limitOf(e) && this.repeatDaily(e, MIN_REPEAT_GAP_MINUTES, allowShowcase)) progress = true;
        }
      }
    };
    upTo(long, () => 2, true);
    upTo(long, e => e.maxDaily || MAX_DAILY_AIRINGS, false);
    upTo(placed.filter(e => !e.long), e => e.maxDaily || MAX_DAILY_AIRINGS, false);
  }

  /* ---------- 4. Maratones de fin de semana ---------- */

  /** Franjas preferidas para un maratón: la suya si es fija; si no, mañana y tarde. */
  marathonPositions(entry) {
    if (entry.franjaLocked) return this.positions.filter(p => p.franja === entry.franja);
    const daytime = this.positions.filter(p => DAYTIME_FRANJAS.includes(p.franja));
    return [...daytime, ...this.positions.filter(p => !DAYTIME_FRANJAS.includes(p.franja))];
  }

  freeCells(day) {
    return this.positions.filter(p => !p.days[day]).length;
  }

  /**
   * Cada serie diaria (en orden, no episódica) repasa sus capítulos de la semana
   * seguidos el sábado o el domingo (el día con más espacio).
   */
  placeMarathons(daily) {
    const candidates = daily
      .filter(e => !e.episodic && e.marathon !== false && this.airings.has(e.key) && !this.airings.has(`${MARATHON}${e.key}`))
      .sort(byPriority);
    for (const entry of candidates) {
      const premieres = Math.min(MARATHON_LENGTH, WEEKDAYS.filter(d => this.airingsOn(entry.key, d).length).length);
      if (premieres < MIN_MARATHON_LENGTH) continue;
      const days = [...WEEKEND].sort((a, b) => this.freeCells(b) - this.freeCells(a));
      let placed = false;
      for (let len = premieres; len >= MIN_MARATHON_LENGTH && !placed; len--) {
        for (const day of days) {
          const run = this.findContiguousRun(this.marathonPositions(entry), day, len);
          if (!run) continue;
          run.forEach(p => this.place(p, `${MARATHON}${entry.key}`, [day]));
          placed = true;
          break;
        }
      }
    }
  }

  /** Tramo de `len` horarios seguidos y libres (en orden horario) dentro de `candidates`. */
  findContiguousRun(candidates, day, len) {
    const sorted = [...new Set(candidates)].sort((a, b) => a.minute - b.minute);
    const pref = candidates.slice(0, Math.max(1, candidates.length));
    for (const start of pref) {
      const i = sorted.indexOf(start);
      const run = sorted.slice(i, i + len);
      if (run.length < len) continue;
      const contiguous = run.every((p, k) => k === 0 || p.minute - run[k - 1].minute === 30);
      if (contiguous && run.every(p => !p.days[day])) return run;
    }
    return null;
  }

  /* ---------- 5. Repetición de los bloques semanales ---------- */

  repeatWeeklyBlock(block) {
    const len = block.members.length;
    const premiereFranja = block.run[0].franja;
    const locked = block.members[0].franjaLocked;
    let best = null;
    for (const day of ALL_DAYS) {
      if (day === block.day) continue;
      const run = this.bestRunOn(day, len, premiereFranja, locked ? premiereFranja : null);
      if (!run) continue;
      const score = (day > block.day ? 1000 : 0) + (run[0].franja !== SHOWCASE_FRANJA ? 500 : 0) +
        (WEEKEND.includes(day) ? 300 : 0) + (run[0].franja !== premiereFranja ? 100 : 0) - Math.abs(day - block.day - 3);
      if (!best || score > best.score) best = { run, day, score };
    }
    if (!best) return block.members.forEach(e => this.repeatWeeklyAlone(e));
    best.run.forEach((p, idx) => this.place(p, block.members[idx].key, [best.day]));
  }

  /** Tramo libre de `len` horarios un día; prefiere la tarde y otra franja que el estreno. */
  bestRunOn(day, len, avoidFranja, onlyFranja = null) {
    const positions = onlyFranja ? this.positions.filter(p => p.franja === onlyFranja) : this.positions;
    const runs = [];
    for (let i = 0; i + len <= positions.length; i++) {
      const run = this.findRun(positions.slice(i, i + len), day, len);
      if (run) runs.push(run);
    }
    const rank = (run) => (run[0].franja === SHOWCASE_FRANJA ? 2 : 0) + (run[0].franja === avoidFranja ? 1 : 0);
    return runs.sort((a, b) => (rank(a) - rank(b)) || (b[0].minute - a[0].minute))[0] || null;
  }

  repeatWeeklyAlone(entry) {
    const premiere = (this.airings.get(entry.key) || [])[0];
    if (!premiere) return;
    for (const p of this.positions.filter(pos => this.allowed(entry, pos))) {
      const day = [...WEEKEND, ...WEEKDAYS].find(d => d !== premiere.days[0] && !p.days[d]);
      if (day !== undefined) return this.place(p, entry.key, [day]);
    }
  }

  /* ---------- 6. Huecos ---------- */

  /** ¿Puede `entry` salir en `p` el día `day` (a más de una hora de sus otras emisiones)? */
  fitsGap(entry, p, day) {
    if (!this.allowed(entry, p)) return false;
    if (entry.frequency === 'weekly' && this.weeklyAirings(entry.key) > WEEKLY_AIRINGS) return false;
    const near = [...this.airingsOn(entry.key, day), ...this.airingsOn(`${MARATHON}${entry.key}`, day)];
    return near.every(a => Math.abs(a.pos.minute - p.minute) >= 60);
  }

  /**
   * Horarios aún vacíos: una repetición más de una serie diaria (la que menos sale), a
   * la misma hora en todos los días libres de ese horario para que la grilla sea
   * regular. Las semanales solo si no hay otra: su capítulo es el de toda la semana.
   */
  fillGaps(entries) {
    let filled = 0;
    const placed = entries.filter(e => this.airings.has(e.key));
    const rank = (a, b) => ((a.frequency === 'weekly') - (b.frequency === 'weekly')) ||
      (this.weeklyAirings(a.key) - this.weeklyAirings(b.key)) || byPriority(a, b);

    for (const p of this.positions) {
      let free = ALL_DAYS.filter(d => !p.days[d]);
      while (free.length) {
        // La serie que cabe en más días libres de este horario (y que menos sale)
        const best = placed
          .map(e => ({ e, days: free.filter(d => this.fitsGap(e, p, d)) }))
          .filter(c => c.days.length)
          .sort((a, b) => (b.days.length - a.days.length) || rank(a.e, b.e))[0];
        if (!best) break;
        const days = best.e.frequency === 'weekly' ? [best.days[0]] : best.days;
        this.place(p, best.e.key, days);
        filled += days.length;
        free = free.filter(d => !days.includes(d));
      }
    }
    if (filled) {
      this.warnings.push(`Hay más horarios que series: ${filled} horarios por semana repiten capítulos adicionales. Con más series listas la grilla se reparte mejor.`);
    }
  }

  /** Reglas automáticas con lo colocado por el reparto (sin las celdas manuales). */
  toRules() {
    const grid = {};
    DAY_KEYS.forEach((day, d) => {
      grid[day] = {};
      for (const p of this.positions) {
        const v = p.days[d];
        if (!v || v.startsWith(BLOCKED) || this.reserved.has(`${d}|${p.time}`)) continue;
        grid[day][p.time] = v.startsWith(MARATHON) ? `maraton:saga:${v.slice(MARATHON.length)}@0` : `saga:${v}`;
      }
    });
    return cellsToRules(grid, 'auto');
  }
}

/**
 * @param {Array<{key, label, franja, franjaLocked, frequency, episodic, marathon, rerun, long, maxDaily, remainingBlocks, remaining}>} entries - sagas elegibles
 * @param {Object} [opts]
 * @param {Array} [opts.reserved] - celdas de reglas manuales (ver GridBuilder)
 * @returns {{ rules: Object[], warnings: string[] }}
 */
function allocateGrid(entries, { reserved = [] } = {}) {
  const builder = new GridBuilder(reserved);
  const daily = entries.filter(e => e.frequency !== 'weekly');
  const weekly = entries.filter(e => e.frequency === 'weekly');

  builder.placeDailyPremieres(daily);
  const blocks = builder.placeWeeklyBlocks(weekly);
  builder.fillDailyRepeats(daily);
  builder.placeMarathons(daily);
  if (WEEKLY_AIRINGS > 1) blocks.forEach(b => builder.repeatWeeklyBlock(b));
  builder.fillGaps(entries);
  return { rules: builder.toRules(), warnings: builder.warnings };
}

module.exports = { allocateGrid, broadcastPositions, WEEKDAYS, WEEKEND, MARATHON, BLOCKED };
