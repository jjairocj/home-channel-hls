/**
 * Home Channel Radio - Mediateca de la radio.
 *
 *   music/<emisora>/…   canciones originales (mp3, flac, m4a, wav, ogg, aac)
 *   jingles/            identificadores y cortinillas de la emisora
 *   dj_cache/           locuciones grabadas a mano (dj_<titulo>.mp3), opcionales
 *
 * Cada canción y jingle se normaliza UNA vez a ready/<id>.m4a (AAC 48 kHz estéreo,
 * loudness parejo): así no hay saltos de volumen entre temas y FFmpeg puede
 * encadenarlos sin cortes. Lo ya procesado se recuerda en library.json.
 *
 * Eventos: 'changed' (hay pistas nuevas listas para emitir).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { probeAudioTags, run } = require('../lib/ffmpeg');
const { STATIONS, GENERAL_FOLDER } = require('./stations');

const AUDIO_EXT = /\.(mp3|flac|m4a|wav|ogg|aac|opus)$/i;
const NORMALIZE_FILTER = 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000';
const DEFAULT_DURATION = 210;

const hashId = (prefix, text) => `${prefix}_${crypto.createHash('md5').update(text).digest('hex').slice(0, 12)}`;

/** "Artista - Título.mp3" → { artist, title } */
function parseFilename(filename) {
  const clean = filename.replace(/\.[^/.]+$/, '');
  const parts = clean.split(' - ');
  return parts.length >= 2
    ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
    : { artist: null, title: clean.trim() };
}

/** Clave de comparación de títulos: minúsculas, sin acentos ni signos. */
const slug = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile() && AUDIO_EXT.test(entry.name) && !entry.name.startsWith('.')) out.push(full);
  }
  return out;
}

class RadioLibrary extends EventEmitter {
  constructor({ baseDir }) {
    super();
    this.baseDir = baseDir;
    this.dirs = {
      music: path.join(baseDir, 'music'),
      jingles: path.join(baseDir, 'jingles'),
      manualVoices: path.join(baseDir, 'dj_cache'),
      ready: path.join(baseDir, 'ready'),
      voices: path.join(baseDir, 'dj_voices'),
      mixes: path.join(baseDir, 'dj_mixes')
    };
    this.cacheFile = path.join(baseDir, 'library.json');
    this.cache = this.loadCache();
    this.tracks = [];
    this.jingles = [];
    this.scanning = null;
    this.ensureDirs();
  }

  ensureDirs() {
    const dirs = [...Object.values(this.dirs), ...STATIONS.map(s => path.join(this.dirs.music, s.folder))];
    for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  }

  loadCache() {
    try {
      return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch (e) {
      return { tracks: {}, jingles: {} };
    }
  }

  saveCache() {
    const tmp = `${this.cacheFile}.tmp`;
    fs.promises.writeFile(tmp, JSON.stringify(this.cache, null, 1))
      .then(() => fs.promises.rename(tmp, this.cacheFile))
      .catch(e => console.warn('[Radio] No se pudo guardar library.json:', e.message));
  }

  /** Pistas listas (normalizadas) de la emisora (o todas las pistas si folder es vacío). */
  readyTracksFor(station) {
    if (!station || !station.folder) return this.tracks.filter(t => t.ready);
    return this.tracks.filter(t => t.ready && (t.folder === station.folder || t.folder === GENERAL_FOLDER));
  }

  readyJingles() {
    return this.jingles.filter(j => j.ready);
  }

  findTrack(id) {
    return this.tracks.find(t => t.id === id) || null;
  }

  /** Locución grabada a mano para una canción (dj_<título>.mp3 o dj_<id>.mp3). */
  manualVoiceFor(track, files) {
    const wanted = new Set([`dj${slug(track.title)}`, `dj${slug(track.id)}`]);
    const match = files.find(f => wanted.has(slug(f.replace(/\.[^/.]+$/, ''))));
    return match ? path.join(this.dirs.manualVoices, match) : null;
  }

  /** Escanea la mediateca (una sola vez a la vez) y normaliza lo nuevo en segundo plano. */
  scan() {
    if (!this.scanning) {
      this.scanning = this.doScan().finally(() => { this.scanning = null; });
    }
    return this.scanning;
  }

  async doScan() {
    this.ensureDirs();
    const voiceFiles = await fs.promises.readdir(this.dirs.manualVoices).catch(() => []);
    const tracks = [];
    for (const file of await walk(this.dirs.music)) {
      const rel = path.relative(this.dirs.music, file);
      const folder = path.dirname(rel) === '.' ? GENERAL_FOLDER : rel.split(path.sep)[0];
      tracks.push(await this.describeTrack(file, rel, folder));
    }
    for (const t of tracks) t.manualVoice = this.manualVoiceFor(t, voiceFiles);

    const jingles = [];
    for (const file of await walk(this.dirs.jingles)) {
      const rel = path.relative(this.dirs.jingles, file);
      const id = hashId('jng', rel);
      const cached = this.cache.jingles[rel] || {};
      jingles.push({ id, rel, path: file, title: rel.replace(/\.[^/.]+$/, ''), ready: cached.ready && fs.existsSync(cached.ready) ? cached.ready : null, duration: cached.duration || 0 });
    }

    this.tracks = tracks;
    this.jingles = jingles;
    this.saveCache();
    console.log(`[Radio] 📻 Mediateca: ${tracks.length} canciones (${tracks.filter(t => t.ready).length} listas), ${jingles.length} jingles.`);
    this.emit('changed');
    this.normalizePending();
    return this.tracks;
  }

  /** Datos de una canción: de la caché si el archivo no cambió, si no con ffprobe. */
  async describeTrack(file, rel, folder) {
    const stat = await fs.promises.stat(file);
    const id = hashId('trk', rel);
    let entry = this.cache.tracks[rel];
    if (!entry || entry.size !== stat.size || entry.mtime !== stat.mtimeMs) {
      const tags = (await probeAudioTags(file)) || {};
      const fromName = parseFilename(path.basename(file));
      entry = {
        size: stat.size,
        mtime: stat.mtimeMs,
        artist: tags.artist || fromName.artist || 'Home Channel Selection',
        title: tags.title || fromName.title,
        album: tags.album || null,
        year: tags.year ? String(tags.year).slice(0, 4) : null,
        duration: tags.duration || DEFAULT_DURATION
      };
      this.cache.tracks[rel] = entry;
    }
    const ready = entry.ready && fs.existsSync(entry.ready) ? entry.ready : null;
    const dj = entry.dj && entry.dj.mix && fs.existsSync(entry.dj.mix) ? entry.dj : null;
    return { id, rel, path: file, folder, ...entry, ready, dj, filename: path.basename(file) };
  }

  /** Guarda en la caché los datos de DJ de una canción (los escribe DjStudio). */
  setDj(track, dj) {
    track.dj = dj;
    this.cache.tracks[track.rel] = { ...this.cache.tracks[track.rel], dj };
    this.saveCache();
    this.emit('changed');
  }

  /** Normaliza en segundo plano (de a una, con nice) las pistas que aún no están listas. */
  async normalizePending() {
    if (this.normalizing) return;
    this.normalizing = true;
    try {
      const pending = [...this.jingles.filter(j => !j.ready), ...this.tracks.filter(t => !t.ready)];
      let done = 0;
      for (const item of pending) {
        const out = path.join(this.dirs.ready, `${item.id}.m4a`);
        try {
          await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', item.path,
            '-vn', '-map', '0:a:0', '-af', NORMALIZE_FILTER, '-ac', '2', '-c:a', 'aac', '-b:a', '192k', out],
          { timeoutMs: 10 * 60 * 1000, lowPriority: true });
          item.ready = out;
          const store = item.id.startsWith('jng') ? this.cache.jingles : this.cache.tracks;
          store[item.rel] = { ...(store[item.rel] || {}), ready: out };
          // La duración que cuenta es la del archivo que se emite
          const tags = await probeAudioTags(out);
          item.duration = (tags && tags.duration) || item.duration;
          store[item.rel].duration = item.duration;
          done++;
        } catch (e) {
          console.warn(`[Radio] No se pudo normalizar ${item.rel}:`, e.message.split('\n')[0]);
        }
      }
      if (done) {
        this.saveCache();
        console.log(`[Radio] 🎚️ ${done} pistas normalizadas para emisión.`);
        this.emit('changed');
      }
    } finally {
      this.normalizing = false;
    }
  }
}

module.exports = RadioLibrary;
module.exports.slug = slug;
