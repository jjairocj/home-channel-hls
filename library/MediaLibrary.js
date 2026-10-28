/**
 * Home Channel HLS - Mediateca: series (desde la base), bumpers y comerciales (base + disco).
 *
 * scan() arma `cache` con:
 *   shows       episodios emitibles (planos)
 *   programs    series con sus episodios disponibles en disco
 *   bumpers     cortinillas
 *   commercials comerciales
 * Los archivos nuevos que aparecen en las carpetas de bumpers/comerciales se registran
 * solos en la base. Nada aquí bloquea el servidor: las duraciones desconocidas se
 * miden en segundo plano (DurationCatalog).
 */

const fs = require('fs');
const path = require('path');
const { formatDuration } = require('../core/time');

const VIDEO_EXT = /\.(mp4|mkv|ts)$/i;
/** Archivos modificados hace menos de esto se consideran aún en escritura. */
const MIN_FILE_AGE_MS = 90 * 1000;
const MIN_SHOW_BYTES = 15 * 1024 * 1024;

class MediaLibrary {
  /**
   * @param {Object} deps
   * @param {Object|null} deps.db
   * @param {import('./DurationCatalog')} deps.durations
   * @param {{customShowsDir, bumpersDir, commercialsDir}} deps.dirs
   */
  constructor({ db, durations, dirs }) {
    this.db = db;
    this.durations = durations;
    this.dirs = dirs;
    this.cache = { shows: [], programs: [], bumpers: [], commercials: [], lastScanned: null };
  }

  /** Índice ruta -> duración registrada en la base. */
  dbDurationIndex() {
    const idx = new Map();
    if (!this.db) return idx;
    for (const sh of this.db.getShows() || []) {
      for (const ep of sh.episodes || []) if (ep.path && ep.duration > 0) idx.set(ep.path, ep.duration);
    }
    for (const c of this.db.getCommercials() || []) if (c.path && c.duration > 0) idx.set(c.path, c.duration);
    return idx;
  }

  /** Videos terminados de una carpeta, con su duración conocida. */
  scanDir(dir, type, dbDurations) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { return []; }
    const now = Date.now();
    const out = [];

    for (const file of files) {
      if (!VIDEO_EXT.test(file) || file.includes('.tmp.')) continue;
      const fullPath = path.join(dir, file);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs < MIN_FILE_AGE_MS) continue;
        if (type === 'show' && stats.size < MIN_SHOW_BYTES) continue;

        const duration = this.durations.resolve(fullPath, dbDurations.get(fullPath));
        if (duration <= 0) continue;

        out.push({
          id: `${type}_${Buffer.from(file).toString('base64').substring(0, 10)}`,
          name: file.replace(/\.[^/.]+$/, ''),
          filename: file,
          path: fullPath,
          sizeBytes: stats.size,
          sizeMB: (stats.size / (1024 * 1024)).toFixed(1),
          duration: Math.round(duration * 1000) / 1000,
          durationFormatted: formatDuration(duration),
          type
        });
      } catch (e) {}
    }
    return out;
  }

  /** Series de la base con sus episodios presentes en disco. */
  loadPrograms(knownCustomPaths = null) {
    const episodes = [];
    const programs = [];
    if (!this.db) return { episodes, programs };

    const CHANNEL_ROOT = path.resolve(__dirname, '..');
    for (const s of this.db.getShows() || []) {
      const progEps = [];
      for (const ep of s.episodes || []) {
        if (!ep.path) continue;
        let actualPath = ep.path;
        if (!fs.existsSync(actualPath)) {
          const alt1 = path.resolve(CHANNEL_ROOT, ep.path);
          const alt2 = path.resolve(CHANNEL_ROOT, 'media', ep.path);
          const alt3 = path.resolve(CHANNEL_ROOT, 'media/shows', s.id, ep.filename || path.basename(ep.path));
          if (fs.existsSync(alt1)) actualPath = alt1;
          else if (fs.existsSync(alt2)) actualPath = alt2;
          else if (fs.existsSync(alt3)) actualPath = alt3;
        }
        const exists = (knownCustomPaths && knownCustomPaths.has(actualPath)) || fs.existsSync(actualPath);
        if (!exists) continue;
        const item = {
          id: ep.id,
          name: `${s.title} - ${ep.title}`,
          showTitle: s.title,
          showId: s.id,
          filename: ep.filename,
          path: actualPath,
          sizeBytes: 0,
          sizeMB: ep.sizeMB || '0',
          duration: this.durations.precise(ep.path, ep.duration),
          durationFormatted: ep.durationFormatted,
          type: 'show'
        };
        episodes.push(item);
        progEps.push(item);
      }
      if (progEps.length) {
        programs.push({ id: s.id, title: s.title, currentEpisodeIndex: s.currentEpisodeIndex || 0, episodes: progEps });
      }
    }
    return { episodes, programs };
  }

  /** Título legible para un archivo nuevo ("bumper_02_a_continuacion" → "Bumper 02: A Continuacion"). */
  static titleFromFilename(name) {
    let t = name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    t = t.replace(/^Bumper\s*(\d+)/i, 'Bumper $1:')
      .replace(/^Comercial\s*(\d+)/i, 'Comercial $1:')
      .replace(/^Seccion\s*(\d+)/i, 'Sección $1:');
    return t;
  }

  /** Bumpers y comerciales: los de la base + los nuevos del disco (que se registran). */
  loadSpots(diskItems) {
    const fromDb = { bumper: [], commercial: [] };
    if (!this.db) return fromDb;

    const diskPaths = new Set(diskItems.map(i => i.path));
    const registered = this.db.getCommercials() || [];
    for (const c of registered) {
      if (!c.path || !(diskPaths.has(c.path) || fs.existsSync(c.path))) continue;
      fromDb[c.type === 'bumper' ? 'bumper' : 'commercial'].push({
        id: c.id,
        name: c.title,
        filename: c.filename,
        path: c.path,
        sizeMB: c.sizeMB || '0',
        duration: this.durations.precise(c.path, c.duration),
        durationFormatted: c.durationFormatted,
        type: c.type
      });
    }

    for (const item of diskItems) {
      if (registered.some(c => c.path === item.path || c.filename === item.filename)) continue;
      const title = MediaLibrary.titleFromFilename(item.name);
      const slug = path.parse(item.filename).name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      const saved = this.db.addCommercial({
        id: `comm_${slug}`,
        title,
        type: item.type,
        filename: item.filename,
        path: item.path,
        duration: item.duration,
        durationFormatted: item.durationFormatted,
        sizeMB: item.sizeMB
      });
      fromDb[item.type === 'bumper' ? 'bumper' : 'commercial'].push({ ...item, id: saved.id, name: saved.title });
      console.log(`[Mediateca] 📥 Comercial/Bumper físico indexado en DB: ${title}`);
    }
    return fromDb;
  }

  scan() {
    const dbDurations = this.dbDurationIndex();
    const looseShows = this.scanDir(this.dirs.customShowsDir, 'show', dbDurations);
    let knownCustomPaths = null;
    try {
      const files = fs.readdirSync(this.dirs.customShowsDir);
      knownCustomPaths = new Set(files.map(f => path.join(this.dirs.customShowsDir, f)));
    } catch (e) {}
    const { episodes, programs } = this.loadPrograms(knownCustomPaths);

    const bumpersOnDisk = this.scanDir(this.dirs.bumpersDir, 'bumper', dbDurations);
    const commercialsOnDisk = this.scanDir(this.dirs.commercialsDir, 'commercial', dbDurations);
    const spots = this.loadSpots([...bumpersOnDisk, ...commercialsOnDisk]);

    this.cache = {
      shows: uniqueByPath([...episodes, ...looseShows]),
      programs,
      bumpers: uniqueByPath([...spots.bumper, ...bumpersOnDisk]),
      commercials: uniqueByPath([...spots.commercial, ...commercialsOnDisk]),
      lastScanned: new Date().toISOString()
    };
    return this.cache;
  }

  /** Todas las rutas de video conocidas (para auditar duraciones). */
  allPaths() {
    const c = this.cache;
    return [...c.shows, ...c.bumpers, ...c.commercials].map(i => i.path);
  }
}

function uniqueByPath(items) {
  const seen = new Set();
  return items.filter(i => (seen.has(i.path) ? false : seen.add(i.path)));
}

module.exports = MediaLibrary;
