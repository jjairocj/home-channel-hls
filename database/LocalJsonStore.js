/**
 * Home Channel HLS - Respaldo local en JSON (copia de la base en memoria).
 *
 * Sirve como caché de arranque y respaldo si Postgres no está disponible. Las
 * escrituras se agrupan (1.5 s) y son asíncronas y atómicas (tmp + rename) para no
 * bloquear el servidor de video.
 */

const fs = require('fs');
const path = require('path');

const SAVE_DELAY_MS = 1500;

const DEFAULT_DATA = {
  shows: [
    {
      id: 'show_open_source_animation',
      title: 'Open Source Animation',
      description: 'Showcase of open-source 3D animated short films (Blender Foundation / CC-BY).',
      category: 'Animation',
      color: '#00f0ff',
      currentEpisodeIndex: 0,
      createdAt: '2026-10-28T00:00:00.000Z',
      episodes: [
        {
          id: 'ep_open_source_01',
          showId: 'show_open_source_animation',
          title: 'Big Buck Bunny - Short Film',
          season: 1,
          episode: 1,
          filename: 'big_buck_bunny_1080p.mp4',
          path: 'media/shows/show_open_source_animation/big_buck_bunny_1080p.mp4',
          duration: 30,
          durationFormatted: '00:30',
          sizeMB: 13.1,
          status: 'ready',
          createdAt: '2026-10-28T00:00:00.000Z'
        }
      ]
    }
  ],
  commercials: [],
  scheduleConfig: {
    mode: 'random',
    commercialsFrequency: 'medium',
    weeklyGrid: { monday: {}, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {}, sunday: {} }
  },
  transcodeJobs: [],
  settings: {},
  programmingSeries: [],
  scheduleRules: [],
  airingLog: [],
  proposals: []
};

class LocalJsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.data = this.load();
    this.dirty = false;
    this.writing = false;
    this.timer = null;
  }

  load() {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_DATA));
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.file)) return fresh;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const shows = Array.isArray(parsed.shows) && parsed.shows.length > 0 && parsed.shows.some(s => s.episodes && s.episodes.length > 0)
        ? parsed.shows
        : fresh.shows;
      return {
        ...fresh,
        ...parsed,
        shows,
        scheduleConfig: { ...fresh.scheduleConfig, ...(parsed.scheduleConfig || {}) }
      };
    } catch (e) {
      return fresh;
    }
  }

  /** Programa una escritura (agrupada). */
  save() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DELAY_MS);
  }

  flush() {
    if (this.writing) return this.save();
    if (!this.dirty) return;
    this.dirty = false;
    this.writing = true;
    const tmp = `${this.file}.tmp`;
    fs.mkdir(this.dataDir, { recursive: true }, () => {
      fs.writeFile(tmp, JSON.stringify(this.data), 'utf8', (err) => {
        if (err) {
          this.writing = false;
          console.warn('[DB/Local] No se pudo escribir el respaldo JSON:', err.message);
          return;
        }
        fs.rename(tmp, this.file, () => { this.writing = false; });
      });
    });
  }

  /** Escritura síncrona final (al apagar el proceso). */
  flushSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data), 'utf8');
    } catch (e) {}
  }
}

module.exports = LocalJsonStore;
