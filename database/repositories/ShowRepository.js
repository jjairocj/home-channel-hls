/**
 * Home Channel HLS - Series, sus episodios y el puntero de emisión (próximo capítulo).
 */

const SQL = require('../sql');
const { formatDuration } = require('../../core/time');

const PROFILES_KEY = 'programming_profiles';
const toInt = (v, fallback = 1) => parseInt(v, 10) || fallback;
const byEpisodeOrder = (a, b) => (toInt(a.season) - toInt(b.season)) || (toInt(a.episode) - toInt(b.episode));
const newId = (prefix, n = 6) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 2 + n)}`;

class ShowRepository {
  /**
   * @param {Object} deps
   * @param {LocalJsonStore} deps.store
   * @param {PgConnection} deps.pg
   * @param {SettingsRepository} deps.settings - marcas de serie terminada / en espera
   * @param {TranscodeJobRepository} deps.jobs - ¿quedan capítulos codificándose?
   */
  constructor({ store, pg, settings, jobs }) {
    this.store = store;
    this.pg = pg;
    this.settings = settings;
    this.jobs = jobs;
  }

  get shows() {
    if (!Array.isArray(this.store.data.shows)) this.store.data.shows = [];
    return this.store.data.shows;
  }

  all() {
    return this.shows;
  }

  find(showId) {
    return this.shows.find(s => s.id === showId);
  }

  /* ---------------- Series ---------------- */

  create(data) {
    const show = {
      id: data.id || newId('show', 5),
      title: data.title || 'Nuevo Programa',
      description: data.description || '',
      category: data.category || 'Animación',
      color: data.color || '#00f0ff',
      currentEpisodeIndex: 0,
      createdAt: new Date().toISOString(),
      episodes: []
    };
    this.shows.push(show);
    this.store.save();
    this.pg.write('createShow', SQL.CREATE_SHOW, [show.id, show.title, show.description, show.category, show.color, show.createdAt]);
    return show;
  }

  update(showId, data) {
    const show = this.find(showId);
    if (!show) return null;
    for (const key of ['title', 'description', 'category', 'color']) {
      if (data[key] !== undefined) show[key] = data[key];
    }
    this.store.save();
    this.pg.write('updateShow', SQL.UPDATE_SHOW, [data.title || null, data.description || null, data.category || null, data.color || null, showId]);
    return show;
  }

  delete(showId) {
    const idx = this.shows.findIndex(s => s.id === showId);
    if (idx === -1) return null;
    const removed = this.shows.splice(idx, 1)[0];
    this.store.save();
    this.pg.write('deleteShow', SQL.DELETE_SHOW, [showId]);
    return removed;
  }

  /* ---------------- Puntero de emisión ---------------- */

  saveProgress(show, label) {
    this.store.save();
    this.pg.write(label, SQL.UPDATE_SHOW_PROGRESS, [show.currentEpisodeIndex, show.id]);
  }

  /** Ajuste manual: reinicia las marcas de "terminada" / "en espera". */
  setProgress(showId, episodeIndex) {
    const show = this.find(showId);
    if (!show) return null;
    show.currentEpisodeIndex = Math.max(0, parseInt(episodeIndex, 10) || 0);

    const profiles = this.settings.getJson(PROFILES_KEY, {});
    const flags = profiles.shows && profiles.shows[showId];
    if (flags) {
      delete flags.completed;
      delete flags.waiting;
      this.settings.setJson(PROFILES_KEY, profiles);
    }
    this.saveProgress(show, 'updateShowProgress');
    return show;
  }

  /**
   * Avanza al siguiente episodio. Al llegar al final:
   * - si aún hay capítulos codificándose, la serie queda "en espera" (no vuelve al 1);
   * - si no, se marca como terminada y vuelve al inicio (la saga pasa a la siguiente
   *   temporada, o se repite si todas terminaron).
   */
  advance(showId) {
    const show = this.find(showId);
    if (!show || !show.episodes || !show.episodes.length) return 0;

    const len = show.episodes.length;
    let next = (show.currentEpisodeIndex || 0) + 1;
    if (next >= len) next = this.markEndOfSeries(show, len);

    show.currentEpisodeIndex = next;
    this.saveProgress(show, 'advanceShowProgress');
    return next;
  }

  /** Marca la serie como "en espera" o "terminada" y devuelve el nuevo índice. */
  markEndOfSeries(show, len) {
    const profiles = this.settings.getJson(PROFILES_KEY, {});
    profiles.shows = profiles.shows || {};
    const flags = { ...(profiles.shows[show.id] || {}) };
    let next;
    if (this.jobs.hasPending(show.id)) {
      next = len;
      flags.waiting = true;
      console.log(`[DB] ⏳ ${show.title}: se emitieron todos los capítulos listos; espera los que se están codificando.`);
    } else {
      next = 0;
      flags.completed = new Date().toISOString();
      delete flags.waiting;
      console.log(`[DB] 🏁 ${show.title}: serie completada.`);
    }
    profiles.shows[show.id] = flags;
    if (flags.completed) this.restartFinishedSagas(show.id, profiles);
    this.settings.setJson(PROFILES_KEY, profiles);
    return next;
  }

  /** Si terminaron todas las temporadas de la saga, se reinicia el ciclo (repetición). */
  restartFinishedSagas(showId, profiles) {
    const { detectSagas } = require('../../programming/sagas');
    for (const saga of detectSagas(this.shows, profiles).values()) {
      if (!saga.members.some(m => m.id === showId)) continue;
      if (saga.members.every(m => profiles.shows[m.id] && profiles.shows[m.id].completed)) {
        for (const m of saga.members) delete profiles.shows[m.id].completed;
        console.log(`[DB] 🔁 ${saga.label}: todas sus temporadas se emitieron; vuelve a empezar.`);
      }
    }
  }

  /* ---------------- Episodios ---------------- */

  /** Agrega un episodio; si ya existe (misma ruta o mismo T/E) lo actualiza. */
  addEpisode(showId, data) {
    const show = this.find(showId);
    if (!show) return null;
    if (!show.episodes) show.episodes = [];

    const season = toInt(data.season);
    const number = toInt(data.episode, show.episodes.length + 1);
    const existing = show.episodes.find(e => (data.path && e.path === data.path) || (e.season === season && e.episode === number));
    if (existing) return this.refreshEpisodeFile(existing, data);

    const episode = {
      id: data.id || newId('ep'),
      showId,
      title: data.title || `Episodio ${String(show.episodes.length + 1).padStart(2, '0')}`,
      season,
      episode: number,
      filename: data.filename,
      path: data.path,
      duration: Math.round(data.duration || 0),
      durationFormatted: data.durationFormatted || '00:00',
      sizeMB: String(data.sizeMB || '0'),
      status: 'ready',
      createdAt: new Date().toISOString()
    };
    show.episodes.push(episode);
    show.episodes.sort(byEpisodeOrder);
    this.store.save();

    this.pg.write('addEpisodeToShow', SQL.UPSERT_EPISODE, [
      episode.id, showId, episode.title, episode.season, episode.episode,
      episode.filename, episode.path, episode.duration, episode.durationFormatted,
      episode.sizeMB, episode.status, episode.createdAt
    ]);
    return episode;
  }

  refreshEpisodeFile(ep, data) {
    if (data.title) ep.title = data.title;
    if (data.duration) ep.duration = Math.round(data.duration);
    if (data.durationFormatted) ep.durationFormatted = data.durationFormatted;
    if (data.sizeMB) ep.sizeMB = String(data.sizeMB);
    if (data.filename) ep.filename = data.filename;
    if (data.path) ep.path = data.path;
    ep.status = 'ready';
    this.store.save();
    this.pg.write('updateEpisode in addEpisodeToShow', SQL.UPDATE_EPISODE_FILE, [
      ep.title, ep.season, ep.episode, ep.filename, ep.path, ep.duration, ep.durationFormatted, ep.sizeMB, ep.status, ep.id
    ]);
    return ep;
  }

  updateEpisode(showId, episodeId, data) {
    const show = this.find(showId);
    const ep = show && show.episodes.find(e => e.id === episodeId);
    if (!ep) return null;
    if (data.title !== undefined) ep.title = data.title;
    if (data.episode !== undefined) ep.episode = parseInt(data.episode, 10);
    if (data.season !== undefined) ep.season = parseInt(data.season, 10);
    show.episodes.sort(byEpisodeOrder);
    this.store.save();

    this.pg.write('updateEpisode', SQL.UPDATE_EPISODE_META, [
      data.title || null,
      data.season ? parseInt(data.season, 10) : null,
      data.episode ? parseInt(data.episode, 10) : null,
      episodeId
    ]);
    return ep;
  }

  /** Corrige la duración registrada de un archivo. Devuelve true si existía. */
  updateEpisodeDurationByPath(filePath, seconds) {
    for (const show of this.shows) {
      const ep = (show.episodes || []).find(e => e.path === filePath);
      if (!ep) continue;
      ep.duration = Math.round(seconds);
      ep.durationFormatted = formatDuration(seconds);
      this.store.save();
      this.pg.write('updateEpisodeDuration', SQL.UPDATE_EPISODE_DURATION, [ep.duration, ep.durationFormatted, filePath]);
      return true;
    }
    return false;
  }

  deleteEpisode(showId, episodeId) {
    const show = this.find(showId);
    if (!show) return null;
    const idx = show.episodes.findIndex(e => e.id === episodeId);
    if (idx === -1) return null;
    const removed = show.episodes.splice(idx, 1)[0];
    this.store.save();
    this.pg.write('deleteEpisode', SQL.DELETE_EPISODE, [episodeId]);
    return removed;
  }

  /** Reordena según la lista de ids; los que no vengan quedan al final. */
  reorderEpisodes(showId, episodeIds) {
    const show = this.find(showId);
    if (!show || !Array.isArray(episodeIds)) return null;

    const byId = new Map(show.episodes.map(e => [e.id, e]));
    const ordered = [];
    for (const id of episodeIds) {
      const ep = byId.get(id);
      if (!ep) continue;
      ordered.push(ep);
      byId.delete(id);
    }
    ordered.push(...byId.values());
    ordered.forEach((ep, i) => { ep.episode = i + 1; });
    show.episodes = ordered;
    this.store.save();

    if (ordered.length) {
      const ids = ordered.map(ep => ep.id);
      const nums = ordered.map(ep => ep.episode);
      this.pg.write('reorderEpisodes', SQL.UPDATE_EPISODE_NUMBERS_BATCH, [ids, nums]);
    }
    return show;
  }
}

module.exports = ShowRepository;
