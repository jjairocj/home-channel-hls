/**
 * Home Channel HLS - "Capítulo del día / de la semana", como en la TV tradicional.
 *
 * Cada serie (o grupo de temporadas) emite UN capítulo nuevo por periodo:
 *   - series diarias: por día de transmisión (06:00 → 06:00; lo de 05:00-06:00 son
 *     las repeticiones de madrugada del día anterior)
 *   - series semanales: por semana de transmisión (lunes 06:00 → lunes 06:00)
 * La primera emisión del periodo es el estreno y avanza el puntero; las demás de ese
 * periodo son repeticiones del mismo capítulo y no lo mueven.
 *
 * Los estrenos ya emitidos se guardan (setting `daily_airings`, historial de ~8 días)
 * para que una re-planificación siga repitiendo el mismo capítulo aunque el puntero
 * haya avanzado.
 *
 * Fin de semana (como en la TV colombiana): no hay estrenos. Las series en orden
 * repiten su último capítulo estrenado, y los maratones repasan seguidos los
 * capítulos estrenados de lunes a viernes de esa semana.
 *
 * Las series episódicas (p. ej. Los Simpsons) no siguen un orden: cada emisión toma un
 * capítulo al azar de una permutación fija de todos sus capítulos, indexada por el
 * número de emisión. Es determinista (la guía coincide con lo que sale al aire) y no
 * repite un capítulo hasta recorrerlos todos.
 */

const { broadcastDay, broadcastWeek } = require('../core/time');

/** ¿El día de transmisión (AAAA-MM-DD) cae en sábado o domingo? */
const isWeekendDay = (day) => [0, 6].includes(new Date(`${day}T12:00:00`).getDay());
/** Periodos de días (no de semanas) guardados en el historial. */
const isDayPeriod = (period) => /^\d{4}-\d{2}-\d{2}$/.test(period);
/** Entradas de historial que se conservan por serie. */
const HISTORY_LIMIT = 10;

const SETTING_KEY = 'daily_airings';
/** Formato corto: el "capítulo del día" son dos episodios en un mismo bloque. */
const SHORT_EPISODE_SECONDS = 850;
/** Los registros de estrenos se descartan pasada una semana y un día. */
const RECORD_TTL_MS = 8 * 24 * 3600 * 1000;

/** Hash FNV-1a de 32 bits (semilla de la permutación). */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Generador pseudoaleatorio reproducible (mulberry32). */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Permutación fija de 0..n-1 para una semilla. */
function permutation(seed, n) {
  const order = Array.from({ length: n }, (_, i) => i);
  const random = seededRandom(hash(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

class DailyEpisodes {
  /**
   * @param {Object} deps
   * @param {import('./EpisodeResolver')} deps.resolver
   * @param {Object[]} deps.programs - series de la mediateca
   * @param {Object} deps.flags - marcas por serie (completed / waiting)
   * @param {Object} deps.records - estrenos ya emitidos: { refKey: { history: [{ day, episodes: [{ showId, episodeId }] }] } }
   * @param {Object} [deps.episodicRecords] - progreso de ciclos aleatorios: { refKey: { cycle, seenEpisodeIds: [] } }
   * @param {Function} [deps.isEpisodic] - (ref) => ¿capítulos al azar?
   * @param {Function} [deps.isWeekly] - (ref) => ¿capítulo nuevo por semana (no por día)?
   */
  constructor({ resolver, programs, flags = {}, records = {}, episodicRecords = {}, isEpisodic = () => false, isWeekly = () => false }) {
    this.isWeekly = isWeekly;
    this.resolver = resolver;
    this.programs = programs;
    this.flags = flags;
    this.records = records;
    this.episodicRecords = episodicRecords;
    this.isEpisodic = isEpisodic;
    this.pools = new Map();
    this.offsets = {};
    this.units = new Map();
    /** refKey -> [{ period, picks }] estrenos en orden (guardados + los de esta planificación) */
    this.premiered = new Map();
    this.cyclePermutations = new Map();
  }

  /** Historial guardado de una referencia (acepta el formato anterior de un solo día). */
  historyOf(ref) {
    const record = this.records[ref.key];
    if (!record) return [];
    if (Array.isArray(record.history)) return record.history;
    return record.day ? [{ day: record.day, episodes: record.episodes || [] }] : [];
  }

  resolveEpisodes(list) {
    return (list || []).map(({ showId, episodeId }) => {
      const prog = this.programs.find(p => p.id === showId);
      const episode = prog && prog.episodes.find(e => e.id === episodeId);
      return episode ? { prog, episode, aired: true } : null;
    }).filter(Boolean);
  }

  /** Estrenos conocidos de la referencia, en orden cronológico. */
  premieresOf(ref) {
    if (!this.premiered.has(ref.key)) {
      this.premiered.set(ref.key, this.historyOf(ref)
        .map(h => ({ period: h.day, picks: this.resolveEpisodes(h.episodes) }))
        .filter(h => h.picks.length));
    }
    return this.premiered.get(ref.key);
  }

  notePremiere(ref, period, picks) {
    const list = this.premieresOf(ref);
    if (!list.some(h => h.period === period)) list.push({ period, picks });
  }

  /**
   * Capítulo `index` del maratón de fin de semana: los estrenos de lunes a viernes de
   * la semana de `date`, en orden. Siempre son repeticiones.
   */
  marathonUnit(ref, date, index) {
    const week = broadcastWeek(date);
    const premieres = this.premieresOf(ref).filter(h =>
      isDayPeriod(h.period) && !isWeekendDay(h.period) && broadcastWeek(new Date(`${h.period}T12:00:00`)) === week);
    const entry = premieres[index];
    return entry ? entry.picks.map(p => ({ ...p, repeat: true, marathon: true })) : null;
  }

  /** Próximo episodio sin estrenar de la referencia (avanza el offset de la planificación). */
  takeNext(ref) {
    const off = this.offsets[ref.key] || 0;
    const pick = this.resolver.resolve(ref, off, this.flags);
    if (pick) this.offsets[ref.key] = off + 1;
    return pick;
  }

  /** Lo que no se toca: el siguiente episodio sin consumirlo. */
  peekNext(ref) {
    return this.resolver.resolve(ref, this.offsets[ref.key] || 0, this.flags);
  }

  /** Periodo del capítulo de una referencia: su día o su semana de transmisión. */
  periodOf(ref, date) {
    return this.isWeekly(ref) ? broadcastWeek(date) : broadcastDay(date);
  }

  /** Episodios ya estrenados en el periodo (según lo guardado) que siguen en la mediateca. */
  airedInPeriod(ref, period) {
    const entry = this.historyOf(ref).find(h => h.day === period);
    return entry ? this.resolveEpisodes(entry.episodes) : [];
  }

  /**
   * Capítulo(s) del día de una referencia. La primera llamada del día decide el
   * capítulo (estreno); las siguientes devuelven el mismo marcado como repetición.
   * @param {number} [airing] - número de emisión (solo para series episódicas)
   * @returns {Array<{prog, episode, repeat}>|null}
   */
  unit(ref, date, airing = 0) {
    if (this.isEpisodic(ref)) return this.episodicUnit(ref, airing);
    const period = this.periodOf(ref, date);
    const key = `${ref.key}|${period}`;
    if (this.units.has(key)) return this.units.get(key).map(p => ({ ...p, repeat: true }));

    let picks = this.airedInPeriod(ref, period);
    // Fin de semana: sin estrenos, se repite el último capítulo estrenado
    if (!picks.length && isWeekendDay(broadcastDay(date))) {
      const list = this.premieresOf(ref);
      if (list.length) {
        const last = list[list.length - 1].picks.map(p => ({ ...p, aired: true }));
        this.units.set(key, last);
        return last.map(p => ({ ...p, repeat: true }));
      }
    }
    if (!picks.length) {
      const first = this.takeNext(ref);
      if (!first) return null;
      picks = [first];
    }
    // Formato corto: el segundo episodio también forma parte del capítulo del día
    if (picks.length === 1 && picks[0].episode.duration < SHORT_EPISODE_SECONDS) {
      const second = this.takeNext(ref);
      if (second && second.episode.id !== picks[0].episode.id) picks.push(second);
    }
    this.units.set(key, picks);
    if (!picks[0].aired) this.notePremiere(ref, period, picks);
    return picks.map(p => ({ ...p, repeat: !!p.aired }));
  }

  /** Todos los capítulos de una referencia episódica en su orden original. */
  episodicEpisodes(ref) {
    if (!this.pools.has(ref.key)) {
      const members = ref.saga ? ref.saga.members : [ref.prog];
      const all = members.flatMap(prog => prog.episodes.map(episode => ({ prog, episode })));
      this.pools.set(ref.key, all);
    }
    return this.pools.get(ref.key);
  }

  /** Permutación pseudoaleatoria para un ciclo específico de una referencia. */
  episodicPermutation(refKey, cycle, length) {
    const seed = cycle === 1 ? `${refKey}:${length}` : `${refKey}:cycle:${cycle}`;
    if (!this.cyclePermutations.has(seed)) {
      this.cyclePermutations.set(seed, permutation(seed, length));
    }
    return this.cyclePermutations.get(seed);
  }

  /** Compatibilidad: retorna los episodios de la referencia. */
  episodicPool(ref) {
    return this.episodicEpisodes(ref);
  }

  /**
   * Capítulo(s) de una serie episódica para su emisión número `airing` (contada según
   * la grilla y el ciclo actual). Recorre todos los episodios sin repetir ninguno en
   * el ciclo, y al agotarlos todos avanza automáticamente al siguiente ciclo con
   * una nueva permutación aleatoria.
   */
  episodicUnit(ref, airing = 0) {
    const all = this.episodicEpisodes(ref);
    if (!all.length) return null;

    // Formato corto: dos capítulos por emisión (pares distintos en cada emisión)
    const durations = all.map(p => p.episode.duration).sort((a, b) => a - b);
    const perAiring = durations[Math.floor(durations.length / 2)] < SHORT_EPISODE_SECONDS && all.length > 1 ? 2 : 1;

    const record = (this.episodicRecords && this.episodicRecords[ref.key]) || {};
    const cycle = Math.max(1, record.cycle || 1);
    const perm = this.episodicPermutation(ref.key, cycle, all.length);

    return Array.from({ length: perAiring }, (_, i) => {
      const indexInCycle = Math.abs((airing * perAiring + i) % all.length);
      const pick = all[perm[indexInCycle]];
      return { ...pick, episodic: true, cycle };
    });
  }

  /** Un pedido manual ("al aire en el próximo bloque") pasa a ser el capítulo del día. */
  setUnit(ref, date, picks) {
    const period = this.periodOf(ref, date);
    this.units.set(`${ref.key}|${period}`, picks);
    this.notePremiere(ref, period, picks);
  }
}

/**
 * Registra el estreno de un episodio (al terminar de emitirse) para que el resto del
 * periodo (día o semana) se repita ese mismo capítulo. `item.airDay` es el periodo.
 */
function recordPremiere(db, item) {
  if (!db || !item || !item.dailyKey || !item.airDay) return;
  const records = db.getJsonSetting(SETTING_KEY, {});
  const now = Date.now();
  for (const key of Object.keys(records)) {
    if (!records[key].at || now - records[key].at > RECORD_TTL_MS) delete records[key];
  }
  const previous = records[item.dailyKey] || {};
  // Formato anterior (un solo día) → historial
  const history = Array.isArray(previous.history)
    ? previous.history
    : (previous.day ? [{ day: previous.day, episodes: previous.episodes || [] }] : []);
  let entry = history.find(h => h.day === item.airDay);
  if (!entry) {
    entry = { day: item.airDay, episodes: [] };
    history.push(entry);
  }
  if (!entry.episodes.some(e => e.episodeId === item.id)) entry.episodes.push({ showId: item.showId, episodeId: item.id });
  records[item.dailyKey] = { history: history.slice(-HISTORY_LIMIT), at: now };
  db.setJsonSetting(SETTING_KEY, records);
}

/**
 * Estrenos recientes por referencia, en el formato que usa DailyEpisodes:
 * { refKey: { history: [{ day: periodo, episodes: [{ showId, episodeId }] }] } }.
 * Fuente: el historial de emisiones (tabla airing_log); sin él, el setting anterior.
 */
function loadRecords(db) {
  if (db && db.programming && db.programming.airings) {
    const records = {};
    for (const a of db.programming.airings.recent()) {
      if (a.kind !== 'premiere') continue;
      const rec = records[a.refKey] || (records[a.refKey] = { history: [] });
      let entry = rec.history.find(h => h.day === a.period);
      if (!entry) rec.history.push(entry = { day: a.period, episodes: [] });
      if (!entry.episodes.some(e => e.episodeId === a.episodeId)) entry.episodes.push({ showId: a.showId, episodeId: a.episodeId });
    }
    for (const rec of Object.values(records)) rec.history = rec.history.slice(-HISTORY_LIMIT);
    return records;
  }
  return (db && db.getJsonSetting && db.getJsonSetting(SETTING_KEY, {})) || {};
}

/** Tipo de una emisión de serie para el historial. */
function airingKind(item) {
  if (item.marathon) return 'marathon';
  if (item.episodic) return 'random';
  if (item.isRepeat || item.noAdvance) return 'repeat';
  return 'premiere';
}

/**
 * Registra en el historial una emisión de serie (al terminar de salir al aire). Los
 * estrenos registrados son los que se repiten el resto del periodo y los que forman
 * el maratón del fin de semana.
 */
function logAiring(db, item) {
  if (!db || !db.programming || !item || !item.refKey || !item.airDay || !item.showId) return null;
  return db.programming.airings.log({
    refKey: item.refKey,
    showId: item.showId,
    episodeId: item.id,
    period: item.airDay,
    kind: airingKind(item)
  });
}

const EPISODIC_PROGRESS_KEY = 'episodic_cycle_progress';

function loadEpisodicRecords(db) {
  return (db && db.getJsonSetting && db.getJsonSetting(EPISODIC_PROGRESS_KEY, {})) || {};
}

function canonicalEpisodicKey(refOrItem, sagas) {
  if (!refOrItem) return null;
  if (refOrItem.refKey && refOrItem.refKey.startsWith('saga:')) return refOrItem.refKey;
  if (refOrItem.key && refOrItem.key.startsWith('saga:')) return refOrItem.key;
  if (refOrItem.saga && refOrItem.saga.key) return `saga:${refOrItem.saga.key}`;
  if (sagas) {
    const showId = refOrItem.showId || refOrItem.key || (refOrItem.prog && refOrItem.prog.id);
    const list = Array.isArray(sagas) ? sagas : (sagas.values ? [...sagas.values()] : Object.values(sagas));
    for (const saga of list) {
      if (saga.members && saga.members.some(m => m.id === showId)) {
        return `saga:${saga.key}`;
      }
    }
  }
  return refOrItem.refKey || refOrItem.key || (refOrItem.prog && refOrItem.prog.id) || (refOrItem.showId ? `show:${refOrItem.showId}` : null);
}

function recordEpisodicAiring(db, item, { sagas = [], programs = [] } = {}) {
  if (!db || !item || !item.id) return null;
  const key = canonicalEpisodicKey(item, sagas);
  if (!key) return null;

  const records = loadEpisodicRecords(db);
  const record = records[key] || {
    cycle: 1,
    cycleAiringOffset: 0,
    seenEpisodeIds: [],
    totalAiredCount: 0
  };

  if (!Array.isArray(record.seenEpisodeIds)) record.seenEpisodeIds = [];
  if (!record.seenEpisodeIds.includes(item.id)) {
    record.seenEpisodeIds.push(item.id);
  }
  record.totalAiredCount = (record.totalAiredCount || 0) + 1;
  record.lastAiredEpisodeId = item.id;
  record.lastAiredEpisodeTitle = item.title || item.name || '';
  record.lastAiredAt = new Date().toISOString();

  // Buscar total de episodios para comprobar si completó el ciclo
  let totalEpisodes = 0;
  let sagaList = Array.isArray(sagas) && sagas.length ? sagas : (sagas.values ? [...sagas.values()] : []);
  if (!sagaList.length && programs.length) {
    const { detectSagas } = require('../programming/sagas');
    sagaList = [...detectSagas(programs).values()];
  }
  if (key.startsWith('saga:')) {
    const sagaKey = key.slice(5);
    const saga = sagaList.find(s => s.key === sagaKey);
    if (saga && saga.members) {
      totalEpisodes = saga.members.reduce((sum, m) => sum + ((m.episodes && m.episodes.length) || 0), 0);
    }
  }
  if (!totalEpisodes && item.showId) {
    const show = (programs || []).find(p => p.id === item.showId) || (db.getShow ? db.getShow(item.showId) : null);
    if (show && show.episodes) totalEpisodes = show.episodes.length;
  }

  if (totalEpisodes > 0 && record.seenEpisodeIds.length >= totalEpisodes) {
    const completedCycle = record.cycle || 1;
    console.log(`[Playout] 🔄 ${key}: ¡Todos los capítulos (${totalEpisodes}) fueron emitidos! Ciclo ${completedCycle} completado. Iniciando Ciclo ${completedCycle + 1}.`);
    record.cycle = completedCycle + 1;
    record.seenEpisodeIds = [];
    if (item.airingNumber != null) {
      record.cycleAiringOffset = item.airingNumber + 1;
    }
  }

  records[key] = record;
  if (db.setJsonSetting) db.setJsonSetting(EPISODIC_PROGRESS_KEY, records);
  return record;
}

function resetEpisodicCycle(db, key, currentAiring = null) {
  if (!db || !key) return null;
  const records = loadEpisodicRecords(db);
  const current = records[key] || { cycle: 1 };
  const nextCycle = (current.cycle || 1) + 1;
  records[key] = {
    ...current,
    cycle: nextCycle,
    seenEpisodeIds: [],
    cycleAiringOffset: currentAiring != null ? currentAiring : (current.cycleAiringOffset || 0),
    resetAt: new Date().toISOString()
  };
  if (db.setJsonSetting) db.setJsonSetting(EPISODIC_PROGRESS_KEY, records);
  return records[key];
}

function getEpisodicOverview(db, { sagas = new Map(), programs = [], profiles = {} } = {}) {
  const records = loadEpisodicRecords(db);
  const { isEpisodic } = require('../programming/sagas');
  const sagaList = Array.isArray(sagas) ? sagas : (sagas.values ? [...sagas.values()] : Object.values(sagas));
  const result = [];

  for (const saga of sagaList) {
    if (!isEpisodic(saga, profiles)) continue;
    const key = `saga:${saga.key}`;
    const allEpisodes = (saga.members || []).flatMap(m => m.episodes || []);
    const totalEpisodes = allEpisodes.length;
    const allIds = new Set(allEpisodes.map(e => e.id));

    const rec = records[key] || {};
    const seen = (rec.seenEpisodeIds || []).filter(id => allIds.has(id));
    const cycle = Math.max(1, rec.cycle || 1);
    const seenCount = seen.length;
    const remainingCount = Math.max(0, totalEpisodes - seenCount);
    const percent = totalEpisodes > 0 ? Math.round((seenCount / totalEpisodes) * 100) : 0;

    result.push({
      key,
      sagaKey: saga.key,
      label: saga.label,
      cycle,
      totalEpisodes,
      seenCount,
      remainingCount,
      percent,
      seenEpisodeIds: seen,
      lastAiredEpisodeId: rec.lastAiredEpisodeId || null,
      lastAiredEpisodeTitle: rec.lastAiredEpisodeTitle || null,
      lastAiredAt: rec.lastAiredAt || null,
      totalAiredCount: rec.totalAiredCount || 0
    });
  }
  return result;
}

module.exports = DailyEpisodes;
module.exports.recordPremiere = recordPremiere;
module.exports.logAiring = logAiring;
module.exports.airingKind = airingKind;
module.exports.loadRecords = loadRecords;
module.exports.loadEpisodicRecords = loadEpisodicRecords;
module.exports.recordEpisodicAiring = recordEpisodicAiring;
module.exports.resetEpisodicCycle = resetEpisodicCycle;
module.exports.getEpisodicOverview = getEpisodicOverview;
module.exports.canonicalEpisodicKey = canonicalEpisodicKey;
module.exports.EPISODIC_PROGRESS_KEY = EPISODIC_PROGRESS_KEY;
module.exports.SHORT_EPISODE_SECONDS = SHORT_EPISODE_SECONDS;
module.exports.isWeekendDay = isWeekendDay;
