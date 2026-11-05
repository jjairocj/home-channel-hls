/**
 * CrHe X-99 - Canal 102: Futurama 24/7.
 *
 * Motor de emisión continua dedicado exclusivamente a Futurama:
 * - Recorre todos los episodios disponibles de Futurama en orden pseudoaleatorio.
 * - Ciclo completo sin repeticiones: cada capítulo se emite una sola vez por ciclo.
 * - Al completar todas las temporadas, inicia un nuevo ciclo con una permutación fresca.
 * - Salida HLS en /app/stream_futurama/channel.m3u8 para IPTV y reproductor web.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const PlayoutQueue = require('../playout/PlayoutQueue');
const FfmpegHlsProcess = require('../playout/FfmpegHlsProcess');
const { createEncoder } = require('../playout/EncoderFactory');
const { startSegmentJanitor } = require('../playout/SegmentJanitor');

const CHANNEL_ROOT = path.resolve(__dirname, '..');
const STREAM_DIR = path.join(CHANNEL_ROOT, 'stream_futurama');
const PLAYLIST_FILE = path.join(STREAM_DIR, 'playlist.txt');
const SETTING_CYCLE_KEY = 'futurama_247_cycle';

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

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

function permutation(seed, n) {
  const order = Array.from({ length: n }, (_, i) => i);
  const random = seededRandom(hash(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

class FuturamaEngine extends EventEmitter {
  constructor(db, config = {}) {
    super();
    this.db = db;
    this.streamDir = config.streamDir || STREAM_DIR;
    this.playlistFile = path.join(this.streamDir, 'playlist.txt');
    fs.mkdirSync(this.streamDir, { recursive: true });

    this.encoder = config.encoder || createEncoder();
    this.watermarkFile = config.watermarkFile || path.join(CHANNEL_ROOT, 'watermark.png');
    this.process = null;
    this.shouldBeRunning = false;
    this.startedAt = null;

    this.cycle = 1;
    this.queue = new PlayoutQueue();
    this.index = 0;
    this.outTimeSec = 0;
    this.savedIndex = 0;
    this.savedOffset = 0;
    this.lastHitAt = 0;
    this.idleTimeoutMs = 3 * 60 * 1000;
    this.inactivityTimer = null;
    this.isOnDemand = config.isOnDemand !== undefined ? config.isOnDemand : true;
    this.channelName = 'Futurama 24/7';
    this.allEpisodes = [];

    startSegmentJanitor(this.streamDir);
  }

  get isRunning() {
    return !!(this.process && this.process.running);
  }

  get currentItem() {
    return this.queue.at(this.index);
  }

  /** Extrae todos los episodios de Futurama registrados en la mediateca. */
  loadFuturamaEpisodes() {
    const shows = (this.db ? this.db.getShows() : []) || [];
    const futuramaShows = shows.filter(s => String(s.title || '').toLowerCase().includes('futurama'));
    const episodes = [];
    for (const show of futuramaShows) {
      for (const ep of show.episodes || []) {
        if (!ep.path || !fs.existsSync(ep.path)) continue;
        episodes.push({
          id: ep.id,
          title: ep.title || ep.name || 'Futurama',
          showTitle: show.title,
          duration: ep.duration || 1350,
          path: ep.path,
          type: 'show'
        });
      }
    }
    this.allEpisodes = episodes;
    return episodes;
  }

  /** Construye la cola de reproducción barajando todos los episodios sin repetir. */
  buildQueue(cycle = 1) {
    const episodes = this.loadFuturamaEpisodes();
    if (!episodes.length) return new PlayoutQueue();

    const perm = permutation(`futurama_247_cycle_${cycle}`, episodes.length);
    // Solo cortinillas de Station ID (mosaico 3x3) para canales temáticos 24/7
    // Excluir "A continuación", "Estás viendo", "Cierre de emisión" y "Sincronizador"
    const isMosaicBumper = (b) => {
      const text = `${b.title || ''} ${b.filename || ''} ${b.id || ''}`.toLowerCase();
      return (text.includes('animestation') || text.includes('station_id') || text.includes('station id')) &&
             !text.includes('cierre') && !text.includes('continuacion') && !text.includes('viendo');
    };
    const bumpers = (this.db ? this.db.getCommercials() : [])
      .filter(c => c.type === 'bumper' && c.status === 'ready' && c.path && fs.existsSync(c.path) && isMosaicBumper(c));

    const items = [];
    for (let i = 0; i < perm.length; i++) {
      const ep = episodes[perm[i]];
      items.push({ ...ep, cycle, episodeIndexInCycle: i });
      // Insertar una cortinilla breve entre episodios si existe
      if (bumpers.length > 0) {
        const bumper = bumpers[i % bumpers.length];
        items.push({
          id: `bumper_${bumper.id}_${i}`,
          title: bumper.title || 'Cortinilla',
          showTitle: 'CrHe X-99 Retro',
          duration: bumper.duration || 10,
          path: bumper.path,
          type: 'bumper'
        });
      }
    }
    return new PlayoutQueue(items);
  }

  start(resume = true) {
    if (this.isRunning) return { success: true, message: 'Canal 102 ya emitiendo' };

    const episodes = this.loadFuturamaEpisodes();
    if (!episodes.length) {
      console.warn('[Canal 102] No se encontraron episodios de Futurama listos para emitir.');
      return { success: false, error: 'No hay episodios de Futurama disponibles' };
    }

    if (this.db && this.db.getJsonSetting) {
      this.cycle = this.db.getJsonSetting(SETTING_CYCLE_KEY, 1);
    }

    this.queue = this.buildQueue(this.cycle);
    if (!this.queue.length) {
      console.warn('[Canal 102] La cola de Futurama está vacía.');
      return { success: false, error: 'Cola vacía' };
    }

    if (resume && this.savedIndex < this.queue.length) {
      this.index = this.savedIndex;
      this.outTimeSec = this.savedOffset;
    } else {
      this.index = 0;
      this.outTimeSec = 0;
      this.savedIndex = 0;
      this.savedOffset = 0;
    }

    this.queue.writeConcat(this.playlistFile);

    this.shouldBeRunning = true;
    this.startedAt = Date.now();

    this.process = new FfmpegHlsProcess({
      streamDir: this.streamDir,
      playlistFile: this.playlistFile,
      encoder: this.encoder,
      watermarkFile: this.watermarkFile
    });

    const proc = this.process;
    this.process.on('progress', (sec) => {
      if (this.process !== proc) return;
      this.outTimeSec = sec;
      const newIdx = this.queue.indexAt(sec, this.index);
      if (newIdx !== this.index) {
        this.index = newIdx;
        this.savedIndex = newIdx;
        this.savedOffset = this.queue.offsets[newIdx] || sec;
        const current = this.currentItem;
        if (current && current.type === 'show') {
          console.log(`[Canal 102 / Futurama] 📺 Ahora al aire: ${current.showTitle} - ${current.title} (Ciclo ${this.cycle})`);
        }
      }
    });

    this.process.on('exit', (code) => {
      if (this.process !== proc) return;
      this.process = null;
      if (this.shouldBeRunning) {
        console.warn(`[Canal 102] FFmpeg finalizó con código ${code}. Reiniciando emisión...`);
        if (this.index >= this.queue.length - 2) {
          this.cycle++;
          this.savedIndex = 0;
          this.savedOffset = 0;
          if (this.db && this.db.setJsonSetting) {
            this.db.setJsonSetting(SETTING_CYCLE_KEY, this.cycle);
          }
          console.log(`[Canal 102] 🔄 ¡Ciclo completado! Iniciando Ciclo ${this.cycle}.`);
        }
        setTimeout(() => this.start(true), 1500);
      }
    });

    this.process.start(this.savedOffset || 0);
    console.log(`[Canal 102] 🚀 Futurama 24/7 al aire con ${episodes.length} episodios (Ciclo ${this.cycle}) en ${this.encoder.name}`);
    return { success: true, encoder: this.encoder.name };
  }

  stop() {
    this.shouldBeRunning = false;
    this.savedIndex = this.index;
    this.savedOffset = this.outTimeSec;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  touch() {
    this.lastHitAt = Date.now();
    if (!this.isRunning) {
      console.log(`[${this.channelName}] 📺 Espectador detectado. Despertando canal bajo demanda...`);
      this.start(true);
    }
  }

  startInactivityWatchdog(idleTimeoutMs = 3 * 60 * 1000) {
    this.idleTimeoutMs = idleTimeoutMs;
    if (this.inactivityTimer) clearInterval(this.inactivityTimer);
    this.inactivityTimer = setInterval(() => {
      if (this.isRunning && this.lastHitAt > 0 && (Date.now() - this.lastHitAt > this.idleTimeoutMs)) {
        console.log(`[${this.channelName}] 💤 Sin espectadores activos por ${Math.round(this.idleTimeoutMs / 60000)} min. Entrando en reposo.`);
        this.stop();
      }
    }, 15000);
  }

  rebuildAndRestart() {
    this.queue = this.buildQueue(this.cycle);
    this.index = 0;
    this.outTimeSec = 0;
    if (this.queue.length > 0) {
      this.queue.writeConcat(this.playlistFile);
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      if (this.shouldBeRunning) {
        this.start();
      }
    }
    return { success: true, cycle: this.cycle, totalEpisodes: this.allEpisodes.length };
  }

  resetCycle(newCycle = null) {
    this.cycle = newCycle || (this.cycle + 1);
    if (this.db && this.db.setJsonSetting) {
      this.db.setJsonSetting(SETTING_CYCLE_KEY, this.cycle);
    }
    return this.rebuildAndRestart();
  }

  toggleRunning() {
    if (this.isRunning) {
      this.stop();
      return { success: true, isRunning: false };
    } else {
      this.start();
      return { success: true, isRunning: true };
    }
  }

  getStatus() {
    const idx = this.isRunning ? this.index : (this.savedIndex || 0);
    const cur = this.queue.at(idx);
    const startSec = (this.queue && this.queue.offsets) ? (this.queue.offsets[idx] || 0) : 0;
    const offset = this.isRunning ? this.outTimeSec : (this.savedOffset || 0);
    const elapsed = Math.max(0, offset - startSec);
    return {
      isRunning: this.isRunning,
      isOnDemand: this.isOnDemand,
      channelId: 'futurama_24_7',
      channelNumber: 102,
      channelName: 'Futurama 24/7',
      cycle: this.cycle,
      totalEpisodes: this.allEpisodes.length,
      currentProgram: cur ? {
        title: cur.title,
        showTitle: cur.showTitle,
        duration: cur.duration,
        elapsed: Math.floor(elapsed)
      } : null
    };
  }

  /** Proyecta la programación para la guía XMLTV de las próximas horas. */
  getXmltvProgrammes(hostUrl, fromTime = new Date(), count = 24) {
    if (!this.allEpisodes.length) this.loadFuturamaEpisodes();
    if (!this.allEpisodes.length) return '';

    const pad = (n) => String(n).padStart(2, '0');
    const xmltvDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    const escapeXml = (s) => String(s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

    let currentStart = new Date(fromTime);
    let xml = '';
    const perm = permutation(`futurama_247_cycle_${this.cycle}`, this.allEpisodes.length);
    let permIdx = Math.max(0, (this.currentItem ? this.currentItem.episodeIndexInCycle : 0));

    for (let i = 0; i < count; i++) {
      const ep = this.allEpisodes[perm[(permIdx + i) % perm.length]];
      const durationSec = ep.duration || 1350;
      const end = new Date(currentStart.getTime() + durationSec * 1000);
      xml += `  <programme start="${xmltvDate(currentStart)}" stop="${xmltvDate(end)}" channel="futurama_tv">\n`;
      xml += `    <title lang="es">${escapeXml(ep.showTitle)}: ${escapeXml(ep.title)}</title>\n`;
      xml += `    <desc lang="es">Emisión continua de Futurama 24/7 en orden aleatorio sin repetición.</desc>\n`;
      xml += `    <category lang="es">Animación</category>\n`;
      xml += `  </programme>\n`;
      currentStart = end;
    }
    return xml;
  }
}

module.exports = FuturamaEngine;
