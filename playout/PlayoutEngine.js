/**
 * Home Channel HLS - Motor de emisión 24/7 (orquestador).
 *
 * - Mantiene la cola al aire (PlayoutQueue) y el proceso FFmpeg (FfmpegHlsProcess).
 * - Sigue la posición REAL de emisión (-progress de FFmpeg) para saber qué está al aire.
 * - Si FFmpeg termina o se cae, se resincroniza con el reloj (:00 y :30).
 * - Los cambios de parrilla se aplican en el próximo cambio de bloque.
 *
 * Patrón Observer: emite 'episodeFinished' (item) cuando un episodio termina de
 * emitirse (o se salta). Quien escucha (server.js) avanza el puntero de la serie; así
 * el motor no depende de la base de datos.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const PlayoutQueue = require('./PlayoutQueue');
const FfmpegHlsProcess = require('./FfmpegHlsProcess');
const { LowerThirdTrack, planBreaks } = require('./LowerThirds');
const { TickerTrack } = require('./Ticker');
const StatusPresenter = require('./StatusPresenter');
const { createEncoder } = require('./EncoderFactory');
const { startSegmentJanitor } = require('./SegmentJanitor');
const { nextSlotBoundary, hhmm } = require('../core/time');

const CHANNEL_ROOT = path.resolve(__dirname, '..');
const TRACK_INTERVAL_MS = 1000;
/** Margen tolerado entre el reporte de FFmpeg y el reloj de pared. */
const MAX_AHEAD_SECONDS = 3;
const CRASH_WINDOW_MS = 120000;
const CRASH_LIMIT = 5;

class PlayoutEngine extends EventEmitter {
  constructor(scheduler, config = {}) {
    super();
    this.scheduler = scheduler;
    this.streamDir = config.streamDir || path.join(CHANNEL_ROOT, 'stream');
    this.playlistFile = path.join(this.streamDir, 'playlist.txt');
    fs.mkdirSync(this.streamDir, { recursive: true });
    this.encoder = config.encoder || createEncoder();
    this.watermarkFile = config.watermarkFile || path.join(CHANNEL_ROOT, 'watermark.png');

    this.process = null;
    this.shouldBeRunning = false;
    this.startedAt = null;

    this.queue = new PlayoutQueue();
    this.index = 0;
    this.seekOffset = 0;
    this.outTimeSec = null;
    this.processStartedAt = null;

    this.onAirBlocks = [];
    this.resyncTimer = null;
    this.resyncAt = null;
    this.pendingOverride = null;
    this.recentCrashes = [];

    this.presenter = new StatusPresenter({
      cleanTitle: (n) => this.scheduler.cleanShowTitle(n),
      blockFor: (item) => this.onAirBlocks.find(b => b.startTime === item.slotStartTime)
    });
    startSegmentJanitor(this.streamDir);
  }

  get isRunning() {
    return !!(this.process && this.process.running);
  }

  get currentTrack() {
    return this.queue.at(this.index);
  }

  /* ---------- Ciclo de vida del proceso ---------- */

  start(options = {}) {
    if (this.isRunning) return { success: true, message: 'El motor ya está emitiendo' };
    const seekOffset = Math.max(0, options.seekOffset || 0);

    if (!options.preserveQueue || !this.queue.length) {
      const schedule = this.scheduler.schedule.length ? this.scheduler.schedule : this.scheduler.generate24hSchedule();
      this.onAirBlocks = schedule;
      this.queue = PlayoutQueue.fromBlocks(schedule);
      this.index = 0;
    }

    // La lista de FFmpeg empieza siempre en el elemento actual
    this.queue = this.queue.from(this.index).withExistingFiles();
    this.index = 0;
    if (!this.queue.length) throw new Error('No hay elementos en la mediateca para reproducir.');
    this.queue.writeConcat(this.playlistFile);

    this.seekOffset = seekOffset;
    this.outTimeSec = null;
    this.processStartedAt = Date.now();
    this.startedAt = this.startedAt || Date.now();
    this.shouldBeRunning = true;

    const lowerThirds = this.buildLowerThirds(seekOffset);
    const ticker = this.buildTicker(seekOffset);
    this.process = new FfmpegHlsProcess({
      streamDir: this.streamDir,
      playlistFile: this.playlistFile,
      encoder: this.encoder,
      watermarkFile: this.watermarkFile,
      lowerThirdTrack: lowerThirds.file,
      tickerFilter: ticker.filter
    });
    const proc = this.process;
    this.process.on('progress', (sec) => { if (this.process === proc) this.outTimeSec = sec; });
    this.process.on('exit', (code) => this.onProcessExit(code));
    this.process.start(seekOffset);

    console.log(`[Playout] Iniciando FFmpeg con codificador: ${this.encoder.name} (Logo en emisión: ${this.process.watermarkFile ? 'SÍ' : 'NO'}, cuadros "lo que sigue": ${lowerThirds.ready}/${lowerThirds.planned}, tandas con marquesina: ${ticker.breaks}, ${this.queue.length} elementos, seek ${seekOffset.toFixed(1)}s)`);
    this.startTracker();
    return { success: true, encoder: this.encoder.name };
  }

  /**
   * Pista del cuadro "lo que sigue" para esta emisión (LOWER_THIRDS=off la apaga).
   * Si falla, se emite sin cuadros: nunca debe impedir que salga la señal.
   */
  buildLowerThirds(seekOffset) {
    const none = { file: null, planned: 0, ready: 0 };
    const renderer = this.scheduler && this.scheduler.dynamicBumperManager;
    if (process.env.LOWER_THIRDS === 'off' || !renderer || !renderer.getOrCreateLowerThird) return none;
    try {
      if (!this.lowerThirds) this.lowerThirds = new LowerThirdTrack({ renderer, file: path.join(this.streamDir, 'lower_thirds.txt') });
      return this.lowerThirds.build(this.queue, seekOffset);
    } catch (e) {
      console.warn('[Playout] Cuadros "lo que sigue" omitidos:', e.message);
      return none;
    }
  }

  /**
   * Marquesina con la programación del día durante las tandas (TICKER=off la apaga).
   * Igual que los cuadros: si falla, se emite sin ella.
   */
  buildTicker(seekOffset) {
    const none = { filter: null, breaks: 0 };
    if (process.env.TICKER === 'off') return none;
    try {
      if (!this.ticker) {
        this.ticker = new TickerTrack({
          dir: path.join(this.streamDir, 'marquesina'),
          fontFile: path.resolve(__dirname, '..', 'assets', 'fonts', 'Oswald-Bold.ttf')
        });
      }
      return this.ticker.build(planBreaks(this.queue, seekOffset));
    } catch (e) {
      console.warn('[Playout] Marquesina omitida:', e.message);
      return none;
    }
  }

  onProcessExit(code) {
    console.log(`[Playout] Proceso FFmpeg finalizado con código ${code}`);
    this.stopTracker();
    if (!this.shouldBeRunning) return;

    // Fin de la parrilla o caída: volver a sincronizar con el reloj
    const now = Date.now();
    if (code !== 0) this.recentCrashes.push(now);
    this.recentCrashes = this.recentCrashes.filter(t => now - t < CRASH_WINDOW_MS);
    const delay = this.recentCrashes.length >= CRASH_LIMIT ? 30000 : 2000;
    console.log(`[Playout] Resincronizando emisión con el reloj en ${delay / 1000}s...`);
    setTimeout(() => {
      if (!this.shouldBeRunning || this.isRunning) return;
      try {
        this.syncToClock({ forceImmediate: true });
      } catch (err) {
        console.error('[Playout] No se pudo resincronizar:', err.message);
      }
    }, delay);
  }

  killProcess() {
    this.stopTracker();
    if (this.process) this.process.kill();
    this.process = null;
  }

  stop() {
    this.shouldBeRunning = false;
    this.cancelPendingResync();
    this.pendingOverride = null;
    this.killProcess();
    return { success: true };
  }

  restart(options = {}) {
    const opts = typeof options === 'boolean' ? { preserveQueue: options } : options;
    console.log(`[Playout] 🔄 Reiniciando emisión (preserveQueue: ${!!opts.preserveQueue}, seekOffset: ${opts.seekOffset || 0})...`);
    this.killProcess();
    return this.start(opts);
  }

  /* ---------- Posición de emisión ---------- */

  /**
   * Segundos desde el inicio de la cola según FFmpeg (reloj de pared como respaldo).
   * Con -re FFmpeg nunca va más rápido que el reloj: un reporte por delante del tiempo
   * transcurrido es un dato erróneo y se recorta.
   */
  currentPosition() {
    const wall = this.processStartedAt ? (Date.now() - this.processStartedAt) / 1000 : 0;
    if (this.outTimeSec !== null) return this.seekOffset + Math.min(this.outTimeSec, wall + MAX_AHEAD_SECONDS);
    return this.processStartedAt ? this.seekOffset + wall : 0;
  }

  startTracker() {
    this.stopTracker();
    this.tracker = setInterval(() => this.track(), TRACK_INTERVAL_MS);
  }

  stopTracker() {
    if (this.tracker) clearInterval(this.tracker);
    this.tracker = null;
  }

  track() {
    if (!this.isRunning || !this.queue.length) return;
    const position = this.currentPosition();
    // Si el índice quedó por delante de la emisión real, se recoloca (sin avisar de nuevo)
    if (position < this.queue.offsets[this.index] - MAX_AHEAD_SECONDS) this.index = this.queue.indexAt(position, 0);
    const newIndex = this.queue.indexAt(position, this.index);
    if (newIndex === this.index) return;
    for (let i = this.index; i < newIndex; i++) this.finishItem(this.queue.at(i));
    this.index = newIndex;
    console.log(`[Playout] Cambio de segmento -> Ahora al aire: ${this.currentTrack.name}`);
  }

  /** Avisa que un episodio terminó (los capítulos pedidos fuera de orden no cuentan). */
  finishItem(item) {
    if (!item) return;
    if (item.role === 'main_show' && item.showId) {
      // Toda emisión de serie (estreno, repetición, maratón, al azar) va al historial
      this.emit('showAired', item);
      if (!item.noAdvance) this.emit('episodeFinished', item);
      return;
    }
    if (item.role === 'commercial' || item.type === 'commercial' || item.type === 'bumper') {
      this.emit('commercialAired', item);
    }
  }

  /* ---------- Sincronización con el reloj ---------- */

  /**
   * Regenera la parrilla desde el bloque actual y arranca en el segundo exacto que
   * corresponde según el reloj.
   */
  syncToClock({ forceImmediate = true } = {}) {
    const now = new Date();
    console.log(`[Playout] 🕒 Sincronizando transmisión con reloj (:00 y :30, immediate: ${forceImmediate})...`);
    this.cancelPendingResync();

    const override = this.pendingOverride;
    this.pendingOverride = null;
    const schedule = this.scheduler.generate24hSchedule(now, { override });
    this.scheduler.invalidateGuide();
    const slotInfo = this.scheduler.getCurrentSlotInfo(now);

    let startIdx = 0;
    let seekOffset = 0;
    if (forceImmediate && slotInfo.elapsedSeconds > 0 && schedule.length) {
      let acc = 0;
      const items = schedule[0].items;
      for (let i = 0; i < items.length; i++) {
        const dur = PlayoutQueue.durationOf(items[i]);
        if (slotInfo.elapsedSeconds < acc + dur) {
          startIdx = i;
          seekOffset = slotInfo.elapsedSeconds - acc;
          break;
        }
        acc += dur;
      }
      console.log(`[Playout] ⏱️ Slot ${slotInfo.slotStartFormatted}-${slotInfo.slotEndFormatted} (transcurridos: ${slotInfo.elapsedSeconds}s). Iniciando en item ${startIdx} (${items[startIdx] && items[startIdx].name}) con offset ${seekOffset.toFixed(1)}s.`);
    }

    this.onAirBlocks = schedule;
    this.queue = PlayoutQueue.fromBlocks(schedule).from(startIdx);
    this.index = 0;
    this.restart({ preserveQueue: true, seekOffset });

    const status = this.getStatus();
    return {
      success: true,
      message: 'Emisión sincronizada al horario en punto (:00 y :30)',
      slotInfo,
      currentTrack: status.currentTrack,
      nextProgram: status.nextProgram
    };
  }

  /**
   * Aplica cambios de parrilla en el próximo :00/:30 (el corte coincide con el inicio
   * de un programa). Varias peticiones seguidas se agrupan.
   */
  requestResync(reason = 'cambio de parrilla') {
    if (!this.shouldBeRunning) return null;
    if (this.resyncTimer) return this.resyncAt;

    const next = nextSlotBoundary();
    this.resyncAt = next.toISOString();
    console.log(`[Playout] 📅 ${reason}: se aplicará en el próximo bloque (${hhmm(next)}).`);
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      this.resyncAt = null;
      try {
        this.scheduler.scanMedia();
        this.syncToClock({ forceImmediate: true });
      } catch (err) {
        console.error('[Playout] Error aplicando cambio de parrilla:', err.message);
      }
    }, Math.max(1000, next - Date.now() + 500));
    return this.resyncAt;
  }

  cancelPendingResync() {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
    this.resyncAt = null;
  }

  /** Bloques al aire desde el actual (guía de hoy y EPG). */
  getOnAirBlocks() {
    const now = Date.now();
    const source = this.onAirBlocks.length ? this.onAirBlocks : this.scheduler.schedule;
    return (source || []).filter(b => new Date(b.endTime).getTime() > now);
  }

  /* ---------- Controles del Master Control ---------- */

  /** Salta al índice dado; la cola queda adelantada y se realinea en el próximo bloque. */
  jumpTo(targetIndex, reason) {
    this.finishItem(this.currentTrack);
    this.index = targetIndex;
    this.restart({ preserveQueue: true });
    this.requestResync(reason);
    return this.getStatus();
  }

  skipToNextProgram() {
    if (!this.isRunning || !this.queue.length) return this.start();
    const current = this.currentTrack;
    let target = -1;
    for (let i = this.index + 1; i < this.queue.length; i++) {
      if (this.queue.at(i).slotStartTime !== current.slotStartTime) { target = i; break; }
    }
    if (target === -1) target = Math.min(this.index + 1, this.queue.length - 1);
    console.log(`[Playout] ⏭ Adelantando al siguiente programa: ${this.queue.at(target).blockTitle || this.queue.at(target).name}`);

    const status = this.jumpTo(target, 'Realineación tras saltar programa');
    return { success: true, message: `Emisión adelantada a: ${this.currentTrack.blockTitle || this.currentTrack.name}`, currentTrack: status.currentTrack, nextProgram: status.nextProgram };
  }

  skipToNextSegment() {
    if (!this.isRunning || !this.queue.length) return this.start();
    const target = Math.min(this.index + 1, this.queue.length - 1);
    console.log(`[Playout] ⏭ Saltando al siguiente segmento: ${this.queue.at(target).name}`);
    const status = this.jumpTo(target, 'Realineación tras saltar segmento');
    return { success: true, message: `Segmento adelantado a: ${this.currentTrack.name}`, currentTrack: status.currentTrack, nextTrack: status.nextTrack };
  }

  /**
   * "Al aire en el próximo bloque": la serie (y capítulo) entra exacto en el siguiente
   * :00/:30 sin cortar lo que está al aire.
   */
  playShowNow(showId, episodeId = null) {
    const prog = (this.scheduler.mediaCache.programs || []).find(p => p.id === showId);
    if (!prog || !prog.episodes.length) throw new Error('No se encontraron episodios listos para este programa en la mediateca.');
    const episode = episodeId ? prog.episodes.find(e => e.id === episodeId) : null;
    if (episodeId && !episode) throw new Error('El capítulo elegido no está disponible.');

    const applyAt = this.requestResync(`Programa solicitado: ${prog.title}`) || new Date().toISOString();
    this.pendingOverride = { showId, episodeId: episodeId || null, applyAt };

    const label = episode ? `${prog.title} — ${episode.title}` : prog.title;
    const at = hhmm(new Date(applyAt));
    console.log(`[Playout] 📌 ${label} entrará al aire a las ${at}.`);
    return { success: true, applyAt, message: `${label} entrará al aire a las ${at} (próximo bloque).` };
  }

  cancelPendingOverride() {
    this.pendingOverride = null;
  }

  getStatus() {
    return this.presenter.present({
      queue: this.queue,
      index: this.index,
      position: this.currentPosition(),
      running: this.isRunning,
      startedAt: this.startedAt,
      encoderName: this.encoder.name,
      resyncAt: this.resyncAt,
      override: this.pendingOverride,
      clock: this.scheduler.getCurrentSlotInfo()
    });
  }
}

module.exports = PlayoutEngine;
