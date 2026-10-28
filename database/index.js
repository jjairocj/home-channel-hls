/**
 * Home Channel HLS - Base de datos (Fachada).
 *
 * PostgreSQL es la fuente oficial; todo se mantiene también en memoria (lecturas
 * sincrónicas e instantáneas) y en un respaldo JSON local por si Postgres cae.
 *
 *   LocalJsonStore     memoria + respaldo JSON
 *   PgConnection       pool, reconexión y escrituras tolerantes a fallos
 *   PgSync             Postgres ⇄ memoria
 *   repositories/      un Repository por agregado (series/episodios, comerciales,
 *                      parrilla, cola de transcodificación, ajustes y el programador:
 *                      preferencias por serie, reglas, historial de emisiones, propuestas)
 *   migrations.js      esquema versionado de Postgres
 *
 * Esta clase conserva la API histórica (getShows, addEpisodeToShow, …) para que el
 * resto del sistema y los scripts de mantenimiento no cambien.
 */

const fs = require('fs');
const path = require('path');
const LocalJsonStore = require('./LocalJsonStore');
const { PgConnection, configFromEnv } = require('./PgConnection');
const PgSync = require('./PgSync');
const ShowRepository = require('./repositories/ShowRepository');
const CommercialRepository = require('./repositories/CommercialRepository');
const ScheduleConfigRepository = require('./repositories/ScheduleConfigRepository');
const TranscodeJobRepository = require('./repositories/TranscodeJobRepository');
const SettingsRepository = require('./repositories/SettingsRepository');
const SeriesProgrammingRepository = require('./repositories/SeriesProgrammingRepository');
const ScheduleRuleRepository = require('./repositories/ScheduleRuleRepository');
const AiringLogRepository = require('./repositories/AiringLogRepository');
const AudienceRepository = require('./repositories/AudienceRepository');
const ProposalRepository = require('./repositories/ProposalRepository');

const CHANNEL_ROOT = path.resolve(__dirname, '..');

function findDataDir() {
  if (fs.existsSync(path.join(CHANNEL_ROOT, 'media'))) return path.join(CHANNEL_ROOT, 'media/data');
  if (fs.existsSync(path.join(CHANNEL_ROOT, '../media'))) return path.resolve(CHANNEL_ROOT, '../media/data');
  return path.join(CHANNEL_ROOT, 'data');
}

class Database {
  constructor(options = {}) {
    this.store = new LocalJsonStore(options.dataDir || findDataDir());
    this.pg = new PgConnection(options.pgConfig || configFromEnv());
    this.sync = new PgSync(this.store, this.pg);

    const deps = { store: this.store, pg: this.pg };
    this.settingsRepo = new SettingsRepository(deps);
    this.jobs = new TranscodeJobRepository(deps);
    this.shows = new ShowRepository({ ...deps, settings: this.settingsRepo, jobs: this.jobs });
    this.commercials = new CommercialRepository(deps);
    this.scheduleConfig = new ScheduleConfigRepository(deps);
    // Programador por reglas
    this.programming = {
      series: new SeriesProgrammingRepository(deps),
      rules: new ScheduleRuleRepository(deps),
      airings: new AiringLogRepository(deps),
      proposals: new ProposalRepository(deps)
    };
    this.audience = new AudienceRepository(deps);

    // Al (re)conectar: primero subir lo hecho sin conexión (si no, la recarga lo pisaría)
    this.pg.onConnected = async () => {
      if (this.pg.dirtyWhileOffline) await this.sync.push();
      await this.sync.refresh();
    };
    // Promesa resuelta tras el primer intento de conexión (éxito o fallo)
    this.ready = this.pg.connect();
  }

  /* ---------- Estado / compatibilidad ---------- */
  get data() { return this.store.data; }
  get pool() { return this.pg.pool; }
  get isPgConnected() { return this.pg.connected; }
  get dataDir() { return this.store.dataDir; }

  /** Recarga desde Postgres (no hace nada sin conexión). */
  refresh() { return this.sync.refresh(); }
  refreshJobs() { return this.sync.refreshJobs(); }
  refreshFromPostgres() { return this.sync.refresh(); }
  saveLocalJson() { this.store.save(); return true; }
  flushLocalJsonSync() { this.store.flushSync(); }

  /* ---------- Series y episodios ---------- */
  getShows() { return this.shows.all(); }
  getShow(showId) { return this.shows.find(showId); }
  createShow(data) { return this.shows.create(data); }
  updateShow(showId, data) { return this.shows.update(showId, data); }
  deleteShow(showId) { return this.shows.delete(showId); }
  updateShowProgress(showId, index) { return this.shows.setProgress(showId, index); }
  advanceShowProgress(showId) { return this.shows.advance(showId); }
  addEpisodeToShow(showId, data) { return this.shows.addEpisode(showId, data); }
  updateEpisode(showId, episodeId, data) { return this.shows.updateEpisode(showId, episodeId, data); }
  deleteEpisode(showId, episodeId) { return this.shows.deleteEpisode(showId, episodeId); }
  reorderEpisodes(showId, ids) { return this.shows.reorderEpisodes(showId, ids); }

  /**
   * Corrige la duración registrada de un archivo (episodio o comercial), p. ej. cuando
   * el auditor de duraciones detecta un valor heredado inexacto.
   */
  updateMediaDuration(filePath, seconds) {
    return this.shows.updateEpisodeDurationByPath(filePath, seconds) || this.commercials.updateDurationByPath(filePath, seconds);
  }

  /* ---------- Comerciales y cortinillas ---------- */
  getCommercials() { return this.commercials.all(); }
  addCommercial(data) { return this.commercials.add(data); }
  updateCommercial(id, data) { return this.commercials.update(id, data); }
  deleteCommercial(id) { return this.commercials.delete(id); }

  /* ---------- Parrilla ---------- */
  getScheduleConfig() { return this.scheduleConfig.get(); }
  updateScheduleConfig(config) { return this.scheduleConfig.update(config); }

  /* ---------- Cola de transcodificación ---------- */
  getTranscodeJobs() { return this.jobs.all(); }
  addTranscodeJob(job) { return this.jobs.add(job); }
  updateTranscodeJob(jobId, update) { return this.jobs.update(jobId, update); }
  hasPendingJobs(showId) { return this.jobs.hasPending(showId); }

  /* ---------- Ajustes del sistema ---------- */
  getJsonSetting(key, defaultValue = null) { return this.settingsRepo.getJson(key, defaultValue); }
  setJsonSetting(key, value) { return this.settingsRepo.setJson(key, value); }
  getSetting(key) { return this.settingsRepo.get(key); }
  setSetting(key, value) { return this.settingsRepo.set(key, value); }
}

module.exports = Database;
