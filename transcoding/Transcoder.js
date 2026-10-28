/**
 * Home Channel HLS - Cola de transcodificación.
 *
 * Reparte los trabajos entre "hilos" (2 GPU NVENC, o 2 CPU si no hay GPU). Comerciales
 * y bumpers van siempre al frente. Los trabajos pendientes se guardan en la base y se
 * reanudan solos tras un reinicio. Cada trabajo lo ejecuta TranscodeJobRunner.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { hasNvenc } = require('../lib/ffmpeg');
const TranscodeJobRunner = require('./TranscodeJobRunner');
const TranscodeMetrics = require('./TranscodeMetrics');

const CHANNEL_ROOT = path.resolve(__dirname, '..');
const RESUME_INTERVAL_MS = 10000;
const QUALITY = ['-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-b:v', '3500k', '-maxrate', '4500k', '-bufsize', '8000k', '-g', '60', '-keyint_min', '60'];

const ENCODERS = {
  gpu: { type: 'gpu', name: 'NVIDIA NVENC (GPU)', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', ...QUALITY] },
  cpu: { type: 'cpu', name: 'AMD Ryzen (CPU x264)', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-threads', '4', ...QUALITY] }
};

const isPriority = (job) => job.type === 'commercial' || job.type === 'bumper';

/**
 * Puntuación de prioridad de transcodificación:
 * - 100: Comerciales y bumpers (frente inmediato de cola)
 * - 70: JoJo’s Bizarre Adventure (Prioridad #1)
 * - 60: Invincible (Prioridad #2 - cualquier nuevo capítulo entra antes que Malcolm)
 * - 40: Dragon Ball Super
 * - 30: Futurama
 * - 10: Resto del catálogo estándar
 * - 2: Malcolm in the Middle (Prioridad diferida - después de que esté todo)
 * - 0: Prioridad Baja (Pasión de Gavilanes / Pedro el Escamoso)
 */
function getJobScore(job) {
  if (!job) return 0;
  if (isPriority(job)) return 100;

  const showId = (job.showId || '').toLowerCase();
  const title = (job.title || '').toLowerCase();

  // 1. JoJo's Bizarre Adventure (Prioridad Máxima #1)
  if (showId.includes('jojo')) {
    return 70;
  }
  // 2. Invincible (Prioridad #2 - nuevos archivos entran antes que Malcolm)
  if (showId.includes('invincible')) {
    return 60;
  }
  // 3. Dragon Ball Super
  if (showId.includes('dragon_ball_super') || showId.includes('dbs')) {
    return 40;
  }
  // 4. Futurama
  if (showId.includes('futurama')) {
    return 30;
  }

  // Malcolm in the Middle: después de que esté todo el resto
  if (showId.includes('malcolm')) {
    return 2;
  }

  if (job.priority === 'low' || showId.includes('gavilanes') || showId.includes('pedro')) {
    return 0;
  }
  return 10;
}

function findDir(rel) {
  const p1 = path.resolve(CHANNEL_ROOT, rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(CHANNEL_ROOT, '..', rel);
  return fs.existsSync(p2) ? p2 : p1;
}

/** Eventos: 'jobCompleted' (job) cuando un video terminó y ya está registrado. */
class Transcoder extends EventEmitter {
  /**
   * @param {Object} db
   * @param {Object} scheduler - para re-escanear la mediateca al terminar cada trabajo
   */
  constructor(db, scheduler) {
    super();
    this.db = db;
    this.scheduler = scheduler;
    this.queue = [];
    this.draining = false;
    this.metrics = new TranscodeMetrics();

    this.dirs = {
      shows: findDir('media/custom_shows'),
      commercials: findDir('media/commercials'),
      bumpers: findDir('media/bumpers'),
      temp: findDir('media/uploads_temp')
    };
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });

    const kind = hasNvenc() ? 'gpu' : 'cpu';
    console.log(kind === 'gpu'
      ? '[Transcoder] 🚀 Aceleración GPU activa: 2 hilos paralelos NVIDIA NVENC'
      : '[Transcoder] ℹ️ Acelerador GPU no detectado, operando con codificador universal CPU: libx264');
    this.encoder = ENCODERS[kind];
    this.slots = [1, 2].map(id => ({ id, type: kind, label: `Hilo ${id} [${kind.toUpperCase()}]`, encoder: this.encoder, activeJob: null, proc: null }));
    this.concurrency = this.slots.length;

    this.runner = new TranscodeJobRunner({
      db,
      dirs: this.dirs,
      scratchDir: process.env.TRANSCODE_SCRATCH_DIR || '/tmp/transcode_scratch'
    });

    if (this.db) {
      setTimeout(() => this.resumePending(), 2000);
      setInterval(() => this.resumePending(), RESUME_INTERVAL_MS);
    }
  }

  get activeJobs() {
    return this.slots.filter(s => s.activeJob).map(s => s.activeJob);
  }

  get activeJob() {
    return this.activeJobs[0] || null;
  }

  get isProcessing() {
    return this.activeJobs.length > 0;
  }

  resortQueue() {
    this.queue.sort((a, b) => {
      const scoreDiff = getJobScore(b) - getJobScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const sA = parseInt(a.season, 10) || 0;
      const sB = parseInt(b.season, 10) || 0;
      if (sA !== sB) return sA - sB;
      const eA = parseInt(a.episode, 10) || 0;
      const eB = parseInt(b.episode, 10) || 0;
      if (eA !== eB) return eA - eB;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
  }

  /** Inserta respetando la prioridad personalizada. */
  enqueue(job) {
    this.queue.push(job);
    this.resortQueue();
    return this.queue.findIndex(j => j.id === job.id) + 1;
  }

  /** Sincroniza con la base los trabajos pendientes que aún no están en la cola. */
  async resumePending() {
    if (!this.db || this.draining) return;
    try {
      if (typeof this.db.refreshJobs === 'function') await this.db.refreshJobs().catch(() => {});
      else if (typeof this.db.refresh === 'function') await this.db.refresh().catch(() => {});
      const known = new Set([...this.queue.map(j => j.id), ...this.activeJobs.map(j => j.id)]);
      const pending = (this.db.getTranscodeJobs() || [])
        .filter(j => (j.status === 'pending' || j.status === 'processing') && !known.has(j.id));
      if (pending.length) {
        if (typeof this.db.refresh === 'function') await this.db.refresh().catch(() => {});
        pending.forEach(j => this.queue.push(j));
        this.resortQueue();
        console.log(`[Transcoder] 🔄 Sincronizados ${pending.length} trabajos pendientes a la cola activa (Total en cola: ${this.queue.length}).`);
      } else {
        this.resortQueue();
      }
      this.processNext();
    } catch (e) {
      console.warn('[Transcoder] Error al reanudar cola:', e.message);
    }
  }

  queueJob(jobData) {
    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      inputPath: jobData.inputPath,
      originalFilename: jobData.originalFilename || path.basename(jobData.inputPath),
      type: jobData.type || 'show',
      showId: jobData.showId || null,
      title: jobData.title || 'Video Transcodificado',
      season: parseInt(jobData.season, 10) || 1,
      episode: parseInt(jobData.episode, 10) || 1,
      progress: 0,
      fps: 0,
      status: 'pending',
      error: null,
      createdAt: new Date().toISOString()
    };
    this.db.addTranscodeJob(job);
    const position = this.enqueue(job);
    if (isPriority(job)) console.log(`[Transcoder] ⚡ Prioridad ALTA: ${job.type.toUpperCase()} "${job.title}" colocado al frente de la cola (Posición #${position}).`);
    this.processNext();
    return job;
  }

  processNext() {
    if (this.draining) return;
    for (const slot of this.slots) {
      if (slot.activeJob || !this.queue.length) continue;
      const job = this.queue.shift();
      slot.activeJob = job;
      Object.assign(job, { slotId: slot.id, workerType: slot.type, workerLabel: slot.label, workerName: slot.encoder.name });
      this.runJob(job, slot);
    }
  }

  async runJob(job, slot) {
    job.startedAt = Date.now();
    this.db.updateTranscodeJob(job.id, { status: 'processing', progress: 1 });
    console.log(`[Transcoder] 🚀 [${slot.label} · ${slot.encoder.name}] Iniciando transcodificación de ${job.originalFilename} (Job: ${job.id})`);

    try {
      if (!fs.existsSync(job.inputPath)) {
        console.warn(`[Transcoder] ⚠️ Archivo origen inexistente o ya procesado: ${job.inputPath}. Omitiendo trabajo.`);
        this.fail(job, 'Archivo origen no encontrado en disco');
        return;
      }

      const result = await this.runner.run(job, slot);
      const tookSec = Math.round((Date.now() - job.startedAt) / 1000);
      if (tookSec >= 5) this.metrics.record(tookSec, job);
      Object.assign(job, { status: 'completed', progress: 100 });
      this.db.updateTranscodeJob(job.id, { status: 'completed', progress: 100, outputFilename: result.outputFilename, outputPath: result.outputPath });
      console.log(`[Transcoder] ✅ Transcodificación completada: ${result.outputFilename} (${result.sizeMB} MB, tomado: ${tookSec}s)`);
      if (this.scheduler) this.scheduler.scanMedia();
      this.emit('jobCompleted', job);
    } catch (err) {
      if (this.draining) {
        // Cortado por el apagado ordenado: vuelve a la cola al reiniciar
        console.warn(`[Transcoder] ⏸ ${job.originalFilename} interrumpido por apagado; queda pendiente.`);
        job.status = 'pending';
        this.db.updateTranscodeJob(job.id, { status: 'pending', progress: 0 });
      } else {
        console.error(`[Transcoder] ❌ Error transcodificando ${job.originalFilename}:`, err.message);
        this.fail(job, err.message);
      }
    } finally {
      slot.activeJob = null;
      this.processNext();
    }
  }

  fail(job, message) {
    job.status = 'error';
    job.error = message;
    this.db.updateTranscodeJob(job.id, { status: 'error', error: message });
  }

  /**
   * Apagado ordenado: no toma trabajos nuevos y espera a que terminen los activos
   * (hasta timeoutMs). Si se agota el tiempo, detiene FFmpeg; esos trabajos quedan
   * pendientes en la base y se reanudan al volver a arrancar.
   */
  drain(timeoutMs = 280000) {
    this.draining = true;
    this.queue = [];
    if (!this.activeJobs.length) return Promise.resolve(true);

    console.log(`[Transcoder] ⏳ Apagado ordenado: esperando ${this.activeJobs.length} trabajo(s) activo(s) (máx. ${Math.round(timeoutMs / 1000)}s)...`);
    const started = Date.now();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!this.activeJobs.length) {
          clearInterval(check);
          console.log('[Transcoder] ✅ Trabajos activos terminados.');
          resolve(true);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(check);
          console.warn('[Transcoder] ⚠️ Tiempo agotado; se reanudarán al reiniciar.');
          this.slots.forEach(s => { if (s.proc) try { s.proc.kill('SIGKILL'); } catch (e) {} });
          resolve(false);
        }
      }, 1000);
    });
  }

  getMetrics() {
    return this.metrics.snapshot({ queueCount: this.queue.length, activeJobs: this.activeJobs, concurrency: this.slots.length });
  }
}

module.exports = Transcoder;
