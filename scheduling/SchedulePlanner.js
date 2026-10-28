/**
 * Home Channel HLS - Planificador de bloques.
 *
 * Un solo algoritmo para la emisión (con comerciales), la guía de cualquier día y la
 * EPG (solo títulos): por construcción la guía coincide con lo que se emite.
 *
 * Para cada bloque de 30 min se elige el programa con una cadena de fuentes (Strategy):
 *   1. Pedido "al aire en el próximo bloque" del Master Control
 *   2. Grilla semanal
 *   3. Rotación entre series (modo aleatorio o franja sin serie disponible)
 *   4. Videos sueltos de custom_shows
 *
 * Cada serie emite un "capítulo del día" (DailyEpisodes): la primera aparición del día
 * es el estreno y las siguientes son repeticiones del mismo capítulo. Las series
 * episódicas (Los Simpsons…) emiten un capítulo al azar cada vez.
 */

const DAY_MS = 24 * 3600 * 1000;
/** Lunes de referencia para numerar semanas (hora local). */
const EPOCH_MONDAY = new Date(1970, 0, 5);

/** Minuto de la semana (lunes 00:00 = 0) de una fecha local. */
const weekMinute = (d) => ((d.getDay() + 6) % 7) * 1440 + d.getHours() * 60 + d.getMinutes();
const dayNumber = (d) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_MONDAY) / DAY_MS);

const { detectSagas, isEpisodic, sagaFrequency } = require('../programming');
const { loadProfiles } = require('../programming/profiles');
const { BLOCK_SECONDS, JS_DAY_KEYS, alignToSlot, hhmm } = require('../core/time');
const DailyEpisodes = require('./DailyEpisodes');
/**
 * Tiempo mínimo de cortinillas que necesita un bloque (corte + "a continuación").
 * Un episodio que no deja este margen en 30 min pasa a un bloque especial de 1 hora.
 */
const MIN_BREAK_SECONDS = 45;

/** Bloques de 30 min que necesita un programa de esta duración. */
function slotsNeededFor(showSeconds) {
  return Math.max(1, Math.ceil((showSeconds + MIN_BREAK_SECONDS) / BLOCK_SECONDS));
}

class SchedulePlanner {
  /**
   * @param {Object} deps
   * @param {Object|null} deps.db
   * @param {Function} deps.getMedia - () => mediaCache
   * @param {import('./BlockComposer')} deps.composer
   * @param {import('./CommercialRotation')} deps.rotation
   * @param {import('./EpisodeResolver')} deps.resolver
   * @param {Function} deps.cleanTitle
   */
  constructor({ db, getMedia, composer, rotation, resolver, cleanTitle }) {
    this.db = db;
    this.getMedia = getMedia;
    this.composer = composer;
    this.rotation = rotation;
    this.resolver = resolver;
    this.cleanTitle = cleanTitle;
  }

  /** Capítulos en cola de transcodificación por serie (cuentan para el largo total). */
  queueCounts() {
    const counts = {};
    const jobs = (this.db && this.db.getTranscodeJobs && this.db.getTranscodeJobs()) || [];
    for (const j of jobs) {
      if ((j.status === 'pending' || j.status === 'processing') && j.showId) counts[j.showId] = (counts[j.showId] || 0) + 1;
    }
    return counts;
  }

  programmingProfiles() {
    return loadProfiles(this.db);
  }

  /**
   * Contexto de una planificación: sagas, grilla y el capítulo del día de cada
   * referencia (serie o grupo de temporadas).
   */
  createContext() {
    const media = this.getMedia();
    const programs = media.programs || [];
    const profiles = this.programmingProfiles();
    const sagas = detectSagas(programs, profiles);
    const sagaOf = {};
    for (const saga of sagas.values()) for (const m of saga.members) sagaOf[m.id] = saga;

    const config = (this.db ? this.db.getScheduleConfig() : null) || { mode: 'random', weeklyGrid: {} };
    // Referencias episódicas (al azar) y semanales: la saga y cada una de sus temporadas
    const episodicKeys = new Set();
    const weeklyKeys = new Set();
    const queueCounts = this.queueCounts();
    for (const saga of sagas.values()) {
      const keys = [`saga:${saga.key}`, ...saga.members.map(m => m.id)];
      if (isEpisodic(saga, profiles)) keys.forEach(k => episodicKeys.add(k));
      if (sagaFrequency(saga, { profiles, queueCounts }) === 'weekly') keys.forEach(k => weeklyKeys.add(k));
    }
    const daily = new DailyEpisodes({
      resolver: this.resolver,
      programs,
      flags: profiles.shows || {},
      records: DailyEpisodes.loadRecords(this.db),
      episodicRecords: DailyEpisodes.loadEpisodicRecords(this.db),
      isEpisodic: (ref) => episodicKeys.has(ref.key),
      isWeekly: (ref) => weeklyKeys.has(ref.key)
    });

    const ctx = {
      programs,
      looseShows: media.shows || [],
      sagas,
      sagaList: [...sagas.values()],
      sagaOf,
      weekly: config.mode === 'weekly' ? (config.weeklyGrid || {}) : null,
      rrIndex: 0,
      daily,
      sagaRef: (saga) => ({ key: `saga:${saga.key}`, saga })
    };

    ctx.refForValue = (value) => {
      if (!value || value === 'off_air') return null;
      if (value.startsWith('saga:')) {
        const saga = sagas.get(value.slice(5));
        return saga ? ctx.sagaRef(saga) : null;
      }
      const prog = programs.find(p => p.id === value);
      if (!prog) return null;
      const saga = sagaOf[prog.id];
      // Serie sin otras temporadas: comparte avance con su saga
      return saga && saga.members.length === 1 ? ctx.sagaRef(saga) : { key: prog.id, prog };
    };

    /**
     * Número de emisión de una referencia (para series episódicas): cuenta sus horarios
     * de la grilla semana tras semana, así cada emisión tiene un número único y estable
     * aunque la parrilla se recalcule. Fuera de la grilla, se usa el bloque del día.
     */
    let gridTimes = null;
    ctx.airingNumber = (ref, date) => {
      if (!gridTimes) {
        gridTimes = {};
        Object.entries(ctx.weekly || {}).forEach(([day, cells]) => {
          const d = JS_DAY_KEYS.indexOf(day);
          for (const [time, value] of Object.entries(cells || {})) {
            const r = ctx.refForValue(value);
            if (!r) continue;
            const [h, m] = time.split(':').map(Number);
            (gridTimes[r.key] = gridTimes[r.key] || []).push(((d + 6) % 7) * 1440 + h * 60 + m);
          }
        });
        for (const list of Object.values(gridTimes)) list.sort((a, b) => a - b);
      }
      const list = gridTimes[ref.key] || [];
      const idx = list.indexOf(weekMinute(date));
      if (idx !== -1) return Math.floor(dayNumber(date) / 7) * list.length + idx;
      return dayNumber(date) * 48 + date.getHours() * 2 + (date.getMinutes() >= 30 ? 1 : 0);
    };
    return ctx;
  }

  /* ---------- Fuentes de programa (Strategy, en orden de prioridad) ---------- */

  /**
   * 1. Pedido del Master Control para este bloque. El capítulo pedido pasa a ser el
   * capítulo del día de la serie (sus siguientes horarios de hoy lo repiten).
   */
  fromOverride(ctx, override, blockStart) {
    const prog = ctx.programs.find(p => p.id === override.showId);
    if (!prog || !prog.episodes.length) return null;

    const ptr = prog.currentEpisodeIndex || 0;
    const epIdx = override.episodeId ? prog.episodes.findIndex(e => e.id === override.episodeId) : -1;
    if (epIdx !== -1 && epIdx !== ptr) {
      // Capítulo fuera de orden: se emite sin mover el puntero de la serie
      return { picks: [{ prog, episode: prog.episodes[epIdx], outOfOrder: true }], ref: null };
    }
    const saga = ctx.sagaOf[prog.id];
    const sRef = saga ? ctx.sagaRef(saga) : null;
    const next = sRef ? ctx.daily.peekNext(sRef) : null;
    const ref = next && next.prog.id === prog.id ? sRef : { key: prog.id, prog };
    const pick = ctx.daily.takeNext(ref);
    if (!pick) return null;
    ctx.daily.setUnit(ref, blockStart, [pick]);
    return { picks: [pick], ref };
  }

  /** 2. Grilla semanal. */
  fromGrid(ctx, gridValue, blockStart) {
    const ref = ctx.refForValue(gridValue);
    const picks = ref ? ctx.daily.unit(ref, blockStart, ctx.airingNumber(ref, blockStart)) : null;
    return picks ? { picks, ref } : null;
  }

  /**
   * 2b. Maratón de fin de semana ('maraton:<objetivo>@<n>'): el capítulo n estrenado de
   * lunes a viernes de esta semana. Si la semana tuvo menos estrenos, se repite el
   * último capítulo estrenado.
   */
  fromMarathon(ctx, gridValue, blockStart) {
    const m = /^maraton:(.+)@(\d+)$/.exec(gridValue);
    const ref = m ? ctx.refForValue(m[1]) : null;
    if (!ref) return null;
    const picks = ctx.daily.marathonUnit(ref, blockStart, parseInt(m[2], 10))
      || ctx.daily.unit(ref, blockStart, ctx.airingNumber(ref, blockStart));
    return picks ? { picks, ref, marathon: true } : null;
  }

  /** 3. Rotación entre todas las series. */
  fromRotation(ctx, blockStart) {
    for (let i = 0; i < ctx.sagaList.length; i++) {
      const ref = ctx.sagaRef(ctx.sagaList[ctx.rrIndex % ctx.sagaList.length]);
      ctx.rrIndex++;
      const picks = ctx.daily.unit(ref, blockStart, ctx.airingNumber(ref, blockStart));
      if (picks) return { picks, ref };
    }
    return null;
  }

  /** 4. Videos sueltos de custom_shows sin serie registrada. */
  fromLooseShows(ctx, slot) {
    if (!ctx.looseShows.length) return null;
    return { picks: [{ prog: null, episode: ctx.looseShows[slot % ctx.looseShows.length] }], ref: null };
  }

  /* ---------- Planificación ---------- */

  offAirBlock(slot, blockStart, withItems) {
    const blockEnd = new Date(blockStart.getTime() + BLOCK_SECONDS * 1000);
    const title = 'Home Channel HLS // Cierre de Emisión';
    const items = withItems ? this.composer.signoff(BLOCK_SECONDS).items : [];
    return {
      slotNumber: slot + 1,
      startTime: blockStart.toISOString(),
      endTime: blockEnd.toISOString(),
      title,
      showName: 'Transmisión OFF • Reanudación 05:00 AM',
      mainShow: null,
      secondShow: null,
      items: items.map(it => ({ ...it, blockTitle: title })),
      durationSeconds: BLOCK_SECONDS,
      totalDuration: BLOCK_SECONDS,
      isOffAir: true
    };
  }

  /**
   * Planifica `totalSlots` bloques desde startTime.
   * @param {Object} options
   * @param {boolean} options.withItems - true: emisión con comerciales; false: solo títulos
   * @param {Object} options.override - { showId, episodeId, applyAt }
   */
  plan(startTime = new Date(), totalSlots = 48, { withItems = true, override = null } = {}) {
    const ctx = this.createContext();
    let currentTime = alignToSlot(startTime);
    let overridePending = !!override;
    const blocks = [];

    for (let slot = 0; slot < totalSlots;) {
      const blockStart = new Date(currentTime);
      const hour = blockStart.getHours();
      const gridValue = ctx.weekly ? (ctx.weekly[JS_DAY_KEYS[blockStart.getDay()]] || {})[hhmm(blockStart)] : undefined;
      const overrideNow = overridePending &&
        (!override.applyAt || blockStart.getTime() >= new Date(override.applyAt).getTime() - 1000);

      let isOffAir = hour >= 1 && hour < 5;
      if (gridValue === 'off_air') isOffAir = true;
      else if (gridValue) isOffAir = false;
      if (overrideNow) isOffAir = false;

      if (isOffAir) {
        blocks.push(this.offAirBlock(slot, blockStart, withItems));
        slot += 1;
        currentTime = new Date(blockStart.getTime() + BLOCK_SECONDS * 1000);
        continue;
      }

      let choice = null;
      if (overrideNow) {
        overridePending = false;
        choice = this.fromOverride(ctx, override, blockStart);
      }
      choice = choice
        || (gridValue && gridValue.startsWith('maraton:') ? this.fromMarathon(ctx, gridValue, blockStart) : null)
        || (gridValue && !gridValue.startsWith('maraton:') ? this.fromGrid(ctx, gridValue, blockStart) : null)
        || this.fromRotation(ctx, blockStart)
        || this.fromLooseShows(ctx, slot);

      const block = this.buildBlock(ctx, slot, blockStart, choice, withItems);
      blocks.push(block);
      slot += block.durationSeconds / BLOCK_SECONDS;
      currentTime = new Date(block.endTime);
    }
    return blocks;
  }

  /**
   * Episodio listo para emitir. Las repeticiones, los capítulos fuera de orden y los de
   * series episódicas no mueven el puntero (noAdvance); los estrenos llevan la
   * referencia y el día para registrarse al terminar.
   */
  airing(ctx, pick, ref, blockStart) {
    const episode = { ...pick.episode };
    if (pick.repeat) episode.isRepeat = true;
    if (pick.marathon) episode.marathon = true;
    if (pick.episodic) episode.episodic = true;
    if (pick.repeat || pick.outOfOrder || pick.episodic) episode.noAdvance = true;
    if (ref) {
      // Para el historial de emisiones (y el capítulo del día de las series en orden)
      episode.refKey = ref.key;
      episode.airDay = ctx.daily.periodOf(ref, blockStart);
      if (!pick.episodic) episode.dailyKey = ref.key;
      if (pick.episodic) {
        episode.airingNumber = ctx.airingNumber(ref, blockStart);
        if (pick.cycle) episode.episodicCycle = pick.cycle;
      }
    }
    return episode;
  }

  buildBlock(ctx, slot, blockStart, choice, withItems) {
    const picks = choice ? choice.picks : [];
    const ref = choice ? choice.ref : null;
    const show = picks[0] ? this.airing(ctx, picks[0], ref, blockStart) : null;
    // Formato corto (< 14 min): dos episodios por bloque
    const secondShow = picks[1] ? this.airing(ctx, picks[1], ref, blockStart) : null;
    const pick = picks[0] || null;

    const saga = (ref && ref.saga) || (pick && pick.prog && ctx.sagaOf && ctx.sagaOf[pick.prog.id]);
    if (show && saga && saga.label) show.showTitle = saga.label;
    if (secondShow && saga && saga.label) secondShow.showTitle = saga.label;

    const showSeconds = (show ? show.duration : 1400) + (secondShow ? secondShow.duration : 0);
    const slots = slotsNeededFor(showSeconds);
    const duration = slots * BLOCK_SECONDS;
    const blockEnd = new Date(blockStart.getTime() + duration * 1000);

    const base = (saga && saga.label) || (show ? (show.showTitle || this.cleanTitle(show.name)) : 'Home Channel Broadcast');
    let title = secondShow ? `${base} (Doble Episodio)` : (slots > 1 ? `${base} (Especial 1 Hora)` : base);
    if (choice && choice.marathon) title = `Maratón: ${title}`;

    let items = [];
    if (withItems) {
      this.rotation.nextBlock();
      items = this.composer.compose(show, duration, secondShow).items;
      // Sin contenido disponible: señal de ajuste para que el bloque ocupe su tiempo
      if (!items.length) items = this.composer.signoff(duration).items;
    }

    const record = pick && pick.prog && this.db ? this.db.getShow(pick.prog.id) : null;
    return {
      slotNumber: slot + 1,
      startTime: blockStart.toISOString(),
      endTime: blockEnd.toISOString(),
      title,
      showName: secondShow ? `${show.name} + ${secondShow.name}` : (show ? show.name : 'Transmisión Continua'),
      mainShow: show,
      secondShow,
      category: record ? record.category : undefined,
      items: items.map(it => ({ ...it, blockTitle: title })),
      durationSeconds: duration,
      totalDuration: duration,
      isRepeat: !!(show && show.isRepeat && (!secondShow || secondShow.isRepeat))
    };
  }
}

module.exports = SchedulePlanner;
module.exports.slotsNeededFor = slotsNeededFor;
module.exports.MIN_BREAK_SECONDS = MIN_BREAK_SECONDS;
