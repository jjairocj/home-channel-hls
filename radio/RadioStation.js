/**
 * Home Channel Radio - Una emisora al aire: un único stream HLS de audio para todos los oyentes.
 *
 * Programación (una hora por tanda; al terminar se arma la siguiente con lo nuevo):
 *   - música barajada sin repetir artista seguido
 *   - un jingle cada JINGLE_EVERY canciones
 *   - el DJ presenta una de cada DJ_EVERY canciones (versión pre-mezclada por DjStudio)
 *
 * FFmpeg lee la lista en tiempo real (-re) y escribe stream/radio/<id>/radio.m3u8.
 * "Lo que suena ahora" se calcula con la posición real de salida (-progress).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { startSegmentJanitor } = require('../playout/SegmentJanitor');

const BATCH_SECONDS = 60 * 60;
const JINGLE_EVERY = 4;
const DJ_EVERY = 3;
const RESTART_DELAY_MS = 1500;
const UPCOMING = 3;

const HLS_ARGS = [
  '-f', 'hls', '-hls_time', '6', '-hls_list_size', '10', '-hls_delete_threshold', '4',
  '-hls_start_number_source', 'epoch', '-hls_flags', 'delete_segments+independent_segments+discont_start'
];

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Baraja evitando que el mismo artista suene dos veces seguidas: en cada paso elige,
 * entre los artistas distintos del anterior, el que más temas pendientes tiene (así
 * nunca se encierra con varios temas del mismo artista al final, si se puede evitar).
 */
function shuffleAvoidingArtist(tracks, lastArtist = null) {
  const byArtist = new Map();
  for (const t of shuffle(tracks)) {
    if (!byArtist.has(t.artist)) byArtist.set(t.artist, []);
    byArtist.get(t.artist).push(t);
  }
  const out = [];
  let prev = lastArtist;
  while (byArtist.size) {
    const candidates = shuffle([...byArtist.keys()]);
    const pool = candidates.filter(a => a !== prev);
    const artist = (pool.length ? pool : candidates).sort((a, b) => byArtist.get(b).length - byArtist.get(a).length)[0];
    const list = byArtist.get(artist);
    out.push(list.pop());
    if (!list.length) byArtist.delete(artist);
    prev = artist;
  }
  return out;
}

class RadioStation extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {Object} deps.station - definición de stations.js
   * @param {import('./RadioLibrary')} deps.library
   * @param {string} deps.streamRoot - carpeta stream/radio
   */
  constructor({ station, library, streamRoot }) {
    super();
    this.station = station;
    this.library = library;
    this.dir = path.join(streamRoot, station.id);
    // La lista de FFmpeg tiene rutas del servidor: fuera de la carpeta pública del stream
    this.listFile = path.join(os.tmpdir(), `channel-radio-${station.id}.ffconcat`);
    this.proc = null;
    this.queue = [];
    this.offsets = [];
    this.position = 0;
    this.startedAt = null;
    this.stopped = true;
    this.counters = { sinceJingle: 0, sinceDj: DJ_EVERY - 1 };
    this.lastArtist = null;
    fs.mkdirSync(this.dir, { recursive: true });
    this.janitor = startSegmentJanitor(this.dir);
  }

  get streamUrl() {
    return `/live/radio/${this.station.id}/radio.m3u8`;
  }

  get onAir() {
    return !!this.proc;
  }

  /** Arma la próxima tanda (~1 hora) con lo que haya listo en la mediateca. */
  buildBatch() {
    const tracks = this.library.readyTracksFor(this.station);
    if (!tracks.length) return [];
    const jingles = shuffle(this.library.readyJingles());
    const items = [];
    let total = 0;
    let j = 0;
    while (total < BATCH_SECONDS) {
      for (const track of shuffleAvoidingArtist(tracks, this.lastArtist)) {
        if (jingles.length && this.counters.sinceJingle >= JINGLE_EVERY) {
          const jingle = jingles[j++ % jingles.length];
          items.push({ kind: 'jingle', id: jingle.id, title: jingle.title, file: jingle.ready, duration: jingle.duration || 8 });
          total += jingle.duration || 8;
          this.counters.sinceJingle = 0;
        }
        const withDj = track.dj && this.counters.sinceDj >= DJ_EVERY - 1;
        items.push({
          kind: 'track', id: track.id, artist: track.artist, title: track.title, album: track.album, year: track.year,
          file: withDj ? track.dj.mix : track.ready, duration: track.duration, withDj: !!withDj, dj: withDj ? track.dj.dj : null
        });
        total += track.duration;
        this.counters.sinceJingle++;
        this.counters.sinceDj = withDj ? 0 : this.counters.sinceDj + 1;
        this.lastArtist = track.artist;
        if (total >= BATCH_SECONDS) break;
      }
    }
    return items;
  }

  writeConcat(items) {
    const esc = (p) => p.replace(/'/g, "'\\''");
    const body = items.map(it => `file '${esc(it.file)}'\nduration ${it.duration.toFixed(3)}`).join('\n');
    fs.writeFileSync(this.listFile, `ffconcat version 1.0\n${body}\n`);
  }

  start() {
    this.stopped = false;
    if (this.proc) return;
    const items = this.buildBatch();
    if (!items.length) {
      this.queue = [];
      return;
    }
    this.queue = items;
    let acc = 0;
    this.offsets = items.map(it => { const s = acc; acc += it.duration; return s; });
    this.position = 0;
    this.startedAt = Date.now();
    this.writeConcat(items);

    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:1', '-stats_period', '1',
      '-re', '-f', 'concat', '-safe', '0', '-i', this.listFile,
      '-vn', '-af', 'aresample=48000:async=1', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000',
      ...HLS_ARGS, '-hls_segment_filename', path.join(this.dir, 'seg_%d.ts'), path.join(this.dir, 'radio.m3u8')
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    console.log(`[Radio] 📡 ${this.station.freq} ${this.station.name} al aire: ${items.length} elementos (${Math.round(acc / 60)} min).`);

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('out_time_us=')) continue;
        const us = parseInt(line.slice(12), 10);
        if (!isNaN(us) && us >= 0) this.position = us / 1e6;
      }
    });
    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.warn(`[Radio ${this.station.id}] ${msg.slice(0, 300)}`);
    });
    proc.on('close', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      // Fin de la tanda (o caída): la siguiente, con lo que haya de nuevo
      if (!this.stopped) setTimeout(() => this.start(), RESTART_DELAY_MS);
    });
  }

  stop() {
    this.stopped = true;
    const proc = this.proc;
    this.proc = null;
    if (proc) try { proc.kill('SIGKILL'); } catch (e) {}
  }

  /** Índice del elemento que suena según la posición de FFmpeg. */
  currentIndex() {
    let i = 0;
    while (i + 1 < this.offsets.length && this.position >= this.offsets[i + 1]) i++;
    return i;
  }

  describe(item, elapsed = null) {
    if (!item) return null;
    const base = item.kind === 'jingle'
      ? { kind: 'jingle', title: item.title, artist: 'Home Channel Radio' }
      : { kind: 'track', id: item.id, artist: item.artist, title: item.title, album: item.album, year: item.year, withDj: item.withDj, dj: item.dj };
    return { ...base, duration: Math.round(item.duration), ...(elapsed !== null ? { elapsed: Math.max(0, Math.round(elapsed)) } : {}) };
  }

  status() {
    const s = this.station;
    const base = { id: s.id, freq: s.freq, name: s.name, show: s.show, dj: s.dj, dialLeft: s.dialLeft, streamUrl: this.streamUrl };
    if (!this.onAir || !this.queue.length) {
      return { ...base, onAir: false, tracks: this.library.readyTracksFor(s).length, nowPlaying: null, upcoming: [] };
    }
    const i = this.currentIndex();
    // Línea de tiempo alrededor de lo que sale ahora: el oyente escucha con la latencia
    // de HLS (~20 s) y el sintonizador elige qué mostrar según su propio retraso
    const from = Math.max(0, i - 1);
    const timeline = this.queue.slice(from, i + 1 + UPCOMING).map((it, k) => ({ ...this.describe(it), start: Math.round(this.offsets[from + k] * 10) / 10 }));
    return {
      ...base,
      onAir: true,
      tracks: this.library.readyTracksFor(s).length,
      position: Math.round(this.position * 10) / 10,
      timeline,
      nowPlaying: this.describe(this.queue[i], this.position - this.offsets[i]),
      upcoming: this.queue.slice(i + 1, i + 1 + UPCOMING).map(it => this.describe(it))
    };
  }
}

module.exports = RadioStation;
module.exports.shuffleAvoidingArtist = shuffleAvoidingArtist;
