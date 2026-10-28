/**
 * Home Channel HLS - Scheduler (Facade).
 *
 * Punto de entrada único del dominio de programación. Compone:
 *   MediaLibrary + DurationCatalog  → qué hay para emitir y cuánto dura
 *   BumperCatalog + CommercialRotation + BlockComposer → cómo se arma cada bloque
 *   EpisodeResolver + SchedulePlanner → qué va en cada bloque
 *   NextUpDecorator → cortinillas "A continuación" personalizadas
 *   XmltvExporter → EPG
 *
 * Mantiene la interfaz pública histórica (scanMedia, mediaCache, schedule,
 * generate24hSchedule, planBlocks, planGuide, generateXmltv…) para rutas y playout.
 */

const fs = require('fs');
const path = require('path');

const DurationCatalog = require('../library/DurationCatalog');
const MediaLibrary = require('../library/MediaLibrary');
const BumperCatalog = require('../library/BumperCatalog');
const NextUpBumpers = require('../library/NextUpBumpers');
const CommercialRotation = require('./CommercialRotation');

/** Rotación elegida para cada comercial en el panel (normal, baja o pausado). */
const COMMERCIAL_ROTATION_KEY = 'commercial_rotation';
const COMMERCIAL_STATS_KEY = 'commercial_rotation_stats';
const COMMERCIAL_CONFIG_KEY = 'commercial_rotation_config';
const BlockComposer = require('./BlockComposer');
const EpisodeResolver = require('./EpisodeResolver');
const SchedulePlanner = require('./SchedulePlanner');
const { decorateWithNextUp, decorateWithBillboard } = require('./NextUpDecorator');
const { toXmltv, EPG_CHANNEL_ID } = require('./XmltvExporter');
const { alignToSlot, slotInfo, formatDuration, BLOCK_SECONDS } = require('../core/time');

const CHANNEL_ROOT = path.resolve(__dirname, '..');
const GUIDE_CACHE_MS = 30000;

/** Carpeta relativa al canal o, si no existe, al directorio padre (desarrollo local). */
function findDir(rel) {
  const p1 = path.resolve(CHANNEL_ROOT, rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(CHANNEL_ROOT, '..', rel);
  return fs.existsSync(p2) ? p2 : p1;
}

class Scheduler {
  constructor(database = null, config = {}) {
    this.db = database;
    this.config = {
      recordingsDir: config.recordingsDir || process.env.RECORDINGS_DIR || findDir('grabaciones'),
      customShowsDir: config.customShowsDir || findDir('media/custom_shows'),
      bumpersDir: config.bumpersDir || findDir('media/bumpers'),
      commercialsDir: config.commercialsDir || findDir('media/commercials'),
      blockDurationSeconds: BLOCK_SECONDS,
      ...config
    };

    this.durations = new DurationCatalog({
      cacheFile: path.resolve(CHANNEL_ROOT, 'media/data/duration_cache.json'),
      onMeasured: () => this.scanMediaSoon()
    });
    this.library = new MediaLibrary({ db: this.db, durations: this.durations, dirs: this.config });
    this.bumpers = new BumperCatalog(() => this.mediaCache.bumpers);
    const rotationConfig = (this.db && this.db.getJsonSetting && this.db.getJsonSetting(COMMERCIAL_CONFIG_KEY, null)) || { minSeparationBlocks: 6, maxSpotsPerBreak: 0 };
    const rotationStats = (this.db && this.db.getJsonSetting && this.db.getJsonSetting(COMMERCIAL_STATS_KEY, null)) || {};
    this.rotation = new CommercialRotation(
      () => this.commercialsWithRotation(),
      {
        config: rotationConfig,
        stats: rotationStats
      }
    );
    this.composer = new BlockComposer({
      bumpers: this.bumpers,
      rotation: this.rotation,
      getCommercials: () => this.mediaCache.commercials,
      bumpersDir: this.config.bumpersDir
    });
    this.resolver = new EpisodeResolver((showId) => !!(this.db && this.db.hasPendingJobs && this.db.hasPendingJobs(showId)));
    this.planner = new SchedulePlanner({
      db: this.db,
      getMedia: () => this.mediaCache,
      composer: this.composer,
      rotation: this.rotation,
      resolver: this.resolver,
      cleanTitle: (n) => this.cleanShowTitle(n)
    });
    this.dynamicBumperManager = new NextUpBumpers({
      mediaDir: path.resolve(CHANNEL_ROOT, 'media'),
      bumpersDir: this.config.bumpersDir,
      onBatchReady: (count) => this.emitClipsReady(count)
    });
    /** Se llama cuando hay cortinillas o carteleras nuevas listas (lo conecta server.js). */
    this.onClipsReady = null;

    this.schedule = [];
    this.guideCache = null;
  }

  /* ---------- Mediateca ---------- */

  get mediaCache() {
    return this.library.cache;
  }

  set mediaCache(value) {
    this.library.cache = value;
  }

  /**
   * Comerciales de la mediateca con su rotación elegida en el panel
   * (setting `commercial_rotation`: id -> 'low' | 'paused').
   */
  commercialsWithRotation() {
    const choices = (this.db && this.db.getJsonSetting && this.db.getJsonSetting(COMMERCIAL_ROTATION_KEY, {})) || {};
    return (this.mediaCache.commercials || []).map(c => (choices[c.id] ? { ...c, rotation: choices[c.id] } : c));
  }

  scanMedia() {
    return this.library.scan();
  }

  scanMediaSoon() {
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => this.scanMedia(), 1000);
  }

  /**
   * Revisa las duraciones registradas contra los archivos reales (ffprobe, en segundo
   * plano) y corrige caché y base. Devuelve las correcciones aplicadas.
   */
  async auditDurations() {
    const fixes = await this.durations.audit(this.library.allPaths());
    if (fixes.length && this.db && this.db.updateMediaDuration) {
      for (const f of fixes) this.db.updateMediaDuration(f.path, f.after);
    }
    if (fixes.length) {
      this.scanMedia();
      this.invalidateGuide();
    }
    return fixes;
  }

  /* ---------- Planificación ---------- */

  /** Bloques planificados (ver SchedulePlanner#plan). */
  planBlocks(startTime = new Date(), totalSlots = 48, options = {}) {
    const blocks = this.planner.plan(startTime, totalSlots, options);
    if (options.withItems !== false) {
      const clean = (n) => this.cleanShowTitle(n);
      decorateWithNextUp(blocks, this.dynamicBumperManager, clean);
      decorateWithBillboard(blocks, this.dynamicBumperManager, clean);
    }
    return blocks;
  }

  /** Parrilla de emisión de 24 h (con comerciales), anclada al bloque actual. */
  generate24hSchedule(startTime = new Date(), options = {}) {
    this.schedule = this.planBlocks(startTime, 48, { withItems: true, override: options.override });
    return this.schedule;
  }

  /** Guía (solo títulos) para varios días; se cachea 30 s. */
  planGuide(startTime = new Date(), totalSlots = 48 * 3) {
    const start = alignToSlot(startTime);
    const key = `${start.toISOString()}|${totalSlots}`;
    if (this.guideCache && this.guideCache.key === key && Date.now() - this.guideCache.at < GUIDE_CACHE_MS) {
      return this.guideCache.blocks;
    }
    const blocks = this.planBlocks(start, totalSlots, { withItems: false });
    this.guideCache = { key, blocks, at: Date.now() };
    return blocks;
  }

  emitClipsReady(count) {
    if (this.onClipsReady) this.onClipsReady(count);
  }

  invalidateGuide() {
    this.guideCache = null;
  }

  getCurrentSlotInfo(now = new Date()) {
    return slotInfo(now);
  }

  /* ---------- Utilidades expuestas ---------- */

  /** XMLTV de los bloques dados (por defecto la parrilla actual). */
  generateXmltv(hostUrl = 'http://localhost:3000', blocks = null) {
    if (!blocks && !this.schedule.length) this.generate24hSchedule();
    return toXmltv(hostUrl, blocks || this.schedule);
  }

  /** Título legible de un archivo de grabación ("Tape_..." → "Home Channel Clásicos"). */
  cleanShowTitle(rawName = '') {
    if (rawName.startsWith('Tape_') || rawName.startsWith('Channel_')) {
      const parts = rawName.split('_');
      if (parts.length >= 3) return `Home Channel Clásicos (Bloque ${parts[2].substring(0, 2)}:${parts[2].substring(2, 4)})`;
      return 'Home Channel Classic Broadcast';
    }
    return rawName.replace(/_/g, ' ');
  }

  formatTime(seconds) {
    return formatDuration(seconds);
  }
}

Scheduler.EPG_CHANNEL_ID = EPG_CHANNEL_ID;
module.exports = Scheduler;
module.exports.COMMERCIAL_ROTATION_KEY = COMMERCIAL_ROTATION_KEY;
module.exports.COMMERCIAL_STATS_KEY = COMMERCIAL_STATS_KEY;
module.exports.COMMERCIAL_CONFIG_KEY = COMMERCIAL_CONFIG_KEY;
