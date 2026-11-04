/**
 * Home Channel HLS - Canal 101: Shuffle / Random 24/7 (Zapping Continuo).
 *
 * Motor de emisión continua aleatoria de la mediateca:
 * - Emisión continua 24/7 sin horarios fijos ni repeticiones en el mismo ciclo.
 * - Modo bajo demanda (On-Demand / Eco-Power): duerme cuando no hay televidentes.
 * - Intercala cortinillas / station IDs entre episodios.
 * - Salida HLS en /stream_random/channel.m3u8 para IPTV (CH-101) y reproductor web.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const PlayoutQueue = require('../playout/PlayoutQueue');
const FfmpegHlsProcess = require('../playout/FfmpegHlsProcess');
const { createEncoder } = require('../playout/EncoderFactory');
const { startSegmentJanitor } = require('../playout/SegmentJanitor');

const CHANNEL_ROOT = path.resolve(__dirname, '..');
const STREAM_DIR = path.join(CHANNEL_ROOT, 'stream_random');
const SETTING_CYCLE_KEY = 'random_247_cycle';

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

class RandomEngine extends EventEmitter {
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
    this.channelNumber = config.channelNumber || 101;
    this.channelName = config.channelName || process.env.RANDOM_CHANNEL_NAME || '24/7 Shuffle Channel';
    this.allEpisodes = [];

    startSegmentJanitor(this.streamDir);
  }

  get isRunning() {
    return !!(this.process && this.process.running);
  }

  get currentItem() {
    return this.queue.at(this.index);
  }

  /** Extrae todos los episodios listos de series autorizadas para el canal aleatorio. */
  loadAllEpisodes() {
    const shows = (this.db ? this.db.getShows() : []) || [];
    const profiles = (this.db && this.db.getJsonSetting) ? this.db.getJsonSetting('programming_profiles', {}) : {};
    const { detectSagas, isEpisodic } = require('../programming/sagas');
    const sagas = detectSagas(shows, profiles);

    // 1. Revisar si hay configuración personalizada de series seleccionadas en la DB
    const customConfig = (this.db && this.db.getJsonSetting) ? this.db.getJsonSetting('random_channel_config', null) : null;
    let episodicShowIds = new Set();

    if (customConfig && Array.isArray(customConfig.showIds) && customConfig.showIds.length > 0) {
      for (const id of customConfig.showIds) episodicShowIds.add(String(id));
    } else {
      // Por defecto: todas las series episódicas o todas si no hay filtro
      for (const show of shows) {
        const saga = sagas.find(s => s.shows.some(sh => String(sh.id) === String(show.id)));
        if (!saga || isEpisodic(saga) || shows.length <= 5) {
          episodicShowIds.add(String(show.id));
        }
      }
      if (episodicShowIds.size === 0) {
        for (const show of shows) episodicShowIds.add(String(show.id));
      }
    }

    const readyEpisodes = [];
    for (const show of shows) {
      if (!episodicShowIds.has(String(show.id))) continue;
      const episodes = show.episodes || [];
      for (const ep of episodes) {
        const videoPath = ep.path;
        if (!videoPath || !fs.existsSync(videoPath)) continue;
        readyEpisodes.push({
          id: ep.id,
          showId: show.id,
          showTitle: show.title || 'Serie',
          title: ep.title || `Capítulo ${ep.episode}`,
          season: ep.season || 1,
          episode: ep.episode || 1,
          duration: Math.round(ep.duration || 1320),
          path: videoPath
        });
      }
    }

    this.allEpisodes = readyEpisodes;
    return readyEpisodes;
  }

  loadBumpers() {
    const commercials = (this.db ? this.db.getCommercials() : []) || [];
    const ready = commercials.filter(c => c.type === 'bumper' && c.status === 'ready' && c.path && fs.existsSync(c.path));
    return ready.length ? ready : [{ id: 'default_bumper', title: 'Station ID', duration: 10, path: '' }];
  }

  /** Construye la cola de reproducción barajando todos los episodios sin repetir. */
  buildQueue(cycle = 1) {
    const episodes = this.loadAllEpisodes();
    if (!episodes.length) return new PlayoutQueue();

    const perm = permutation(`random_247_cycle_${cycle}`, episodes.length);
    // Solo cortinillas de Station ID (mosaico 3x3)
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
      // Insertar una cortinilla mosaico 3x3 breve entre episodios
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
    if (this.isRunning) return { success: true, message: 'Canal 103 ya emitiendo' };

    const episodes = this.loadAllEpisodes();
    if (!episodes.length) {
      console.warn('[Canal 103] No se encontraron episodios en la mediateca listos para emitir.');
      return { success: false, error: 'No hay episodios disponibles' };
    }

    if (this.db && this.db.getJsonSetting) {
      this.cycle = this.db.getJsonSetting(SETTING_CYCLE_KEY, 1);
    }

    this.queue = this.buildQueue(this.cycle);
    if (!this.queue.length) {
      console.warn('[Canal 103] La cola aleatoria está vacía.');
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
          console.log(`[Canal 103 / Random] 🎲 Ahora al aire: ${current.showTitle} - ${current.title} (Ciclo ${this.cycle})`);
        }
      }
    });

    this.process.on('exit', (code) => {
      if (this.process !== proc) return;
      this.process = null;
      if (this.shouldBeRunning) {
        console.warn(`[Canal 103] FFmpeg finalizó con código ${code}. Reiniciando emisión...`);
        if (this.index >= this.queue.length - 2) {
          this.cycle++;
          this.savedIndex = 0;
          this.savedOffset = 0;
          if (this.db && this.db.setJsonSetting) {
            this.db.setJsonSetting(SETTING_CYCLE_KEY, this.cycle);
          }
          console.log(`[Canal 103] 🔄 ¡Ciclo aleatorio completado! Iniciando Ciclo ${this.cycle}.`);
        }
        setTimeout(() => this.start(true), 1500);
      }
    });

    this.process.start(this.savedOffset || 0);
    console.log(`[Canal 103] 🚀 Random 24/7 al aire con ${episodes.length} episodios (Ciclo ${this.cycle}) en ${this.encoder.name}`);
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

  getShowsSelection() {
    const shows = (this.db ? this.db.getShows() : []) || [];
    const customConfig = (this.db && this.db.getJsonSetting) ? this.db.getJsonSetting('random_channel_config', null) : null;
    let currentAllowedIds = new Set();

    if (customConfig && Array.isArray(customConfig.showIds) && customConfig.showIds.length > 0) {
      for (const id of customConfig.showIds) currentAllowedIds.add(String(id));
    } else {
      const profiles = (this.db && this.db.getJsonSetting) ? this.db.getJsonSetting('programming_profiles', {}) : {};
      const { detectSagas, isEpisodic } = require('../programming/sagas');
      const sagas = detectSagas(shows, profiles);
      for (const show of shows) {
        const saga = sagas.find(s => s.shows && s.shows.some(sh => String(sh.id) === String(show.id)));
        if (!saga || isEpisodic(saga) || shows.length <= 5) {
          currentAllowedIds.add(String(show.id));
        }
      }
      if (currentAllowedIds.size === 0) {
        for (const show of shows) currentAllowedIds.add(String(show.id));
      }
    }

    return shows.map(s => ({
      id: s.id,
      title: s.title,
      category: s.category || 'General',
      color: s.color || '#00f0ff',
      episodesCount: (s.episodes || []).length,
      isIncluded: currentAllowedIds.has(String(s.id))
    }));
  }

  getStatus() {
    const idx = this.isRunning ? this.index : (this.savedIndex || 0);
    const cur = this.queue.at(idx);
    const startSec = (this.queue && this.queue.offsets) ? (this.queue.offsets[idx] || 0) : 0;
    const offset = this.isRunning ? this.outTimeSec : (this.savedOffset || 0);
    const elapsed = Math.max(0, offset - startSec);
    return {
      isRunning: this.isRunning,
      isOnDemand: true,
      channelId: 'random_24_7',
      channelNumber: this.channelNumber,
      channelName: this.channelName,
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
    if (!this.allEpisodes.length) this.loadAllEpisodes();
    if (!this.allEpisodes.length) return '';

    const pad = (n) => String(n).padStart(2, '0');
    const xmltvDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    const escapeXml = (s) => String(s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

    let currentStart = new Date(fromTime);
    let xml = '';
    const perm = permutation(`random_247_cycle_${this.cycle}`, this.allEpisodes.length);
    let permIdx = Math.max(0, (this.currentItem ? this.currentItem.episodeIndexInCycle : 0));

    for (let i = 0; i < count; i++) {
      const ep = this.allEpisodes[perm[(permIdx + i) % perm.length]];
      const durationSec = ep.duration || 1400;
      const end = new Date(currentStart.getTime() + durationSec * 1000);
      xml += `  <programme start="${xmltvDate(currentStart)}" stop="${xmltvDate(end)}" channel="random_tv">\n`;
      xml += `    <title lang="es">${escapeXml(ep.showTitle)}: ${escapeXml(ep.title)}</title>\n`;
      xml += `    <desc lang="es">Emisión continua y aleatoria de todas las series de la mediateca (Shuffle 24/7).</desc>\n`;
      xml += `    <category lang="es">Variedades</category>\n`;
      xml += `  </programme>\n`;
      currentStart = end;
    }
    return xml;
  }
}

module.exports = RandomEngine;
