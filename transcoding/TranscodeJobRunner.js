/**
 * Home Channel HLS - Ejecución de UN trabajo de transcodificación.
 *
 * Patrón Template Method: run() fija el orden de las etapas y cada etapa es un método:
 *   1. stage()     copia el original al SSD (scratch) si hay espacio
 *   2. encode()    FFmpeg → 1080p H.264 30 fps, AAC 48 kHz estéreo normalizado (EBU R128)
 *   3. publish()   copia el MP4 al disco 2TB con nombre temporal y lo renombra
 *   4. register()  lo agrega a la serie (episodio) o a comerciales/bumpers
 *   5. cleanup()   borra el original (salvo grabaciones) y los temporales
 *
 * Todo el disco se maneja de forma asíncrona: este proceso también sirve la emisión.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { probeDuration, probeAudioStreams } = require('../lib/ffmpeg');
const { selectAudioTrack } = require('./AudioTrackSelector');
const { formatDuration } = require('../core/time');

const VIDEO_FILTER = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p';
const AUDIO_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const MIN_SCRATCH_FREE_GB = 12;
const PROGRESS_SAVE_MS = 2500;

class TranscodeJobRunner {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   * @param {{shows, commercials, bumpers}} deps.dirs - carpetas de destino
   * @param {string} deps.scratchDir
   */
  constructor({ db, dirs, scratchDir }) {
    this.db = db;
    this.dirs = dirs;
    this.scratchDir = scratchDir;
  }

  /** Ejecuta todas las etapas. `slot` recibe el proceso FFmpeg (para poder detenerlo). */
  async run(job, slot) {
    const ctx = { job, slot, scratchInput: null };
    try {
      ctx.totalDuration = await probeDuration(job.inputPath);
      ctx.output = this.outputPathFor(job);
      ctx.input = await this.stage(ctx);
      ctx.tempOutput = path.join(this.scratchDir, `${path.basename(ctx.output)}.tmp.mp4`);
      await this.encode(ctx);
      // Medir duración e información del archivo cuando aún está en el SSD/RAM antes de moverlo al HDD
      ctx.encodedDuration = (await probeDuration(ctx.tempOutput)) || ctx.totalDuration;
      await this.publish(ctx);
      const result = await this.register(ctx);
      await this.removeOriginal(job);
      return result;
    } finally {
      await this.cleanup(ctx);
    }
  }

  outputPathFor(job) {
    const base = job.title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 40);
    const name = `${job.type}_${base}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.mp4`;
    const dir = job.type === 'commercial' ? this.dirs.commercials : (job.type === 'bumper' ? this.dirs.bumpers : this.dirs.shows);
    return path.join(dir, name);
  }

  freeScratchGB() {
    try {
      if (typeof fs.statfsSync === 'function') {
        const s = fs.statfsSync(this.scratchDir);
        return (s.bavail * s.bsize) / (1024 ** 3);
      }
    } catch (e) {}
    return 50;
  }

  /** 1. Copiar el original al SSD para no leer del disco mecánico mientras se codifica. */
  async stage(ctx) {
    const { job } = ctx;
    await fs.promises.mkdir(this.scratchDir, { recursive: true }).catch(() => {});
    if (this.freeScratchGB() <= MIN_SCRATCH_FREE_GB || job.inputPath.startsWith(this.scratchDir)) return job.inputPath;

    const scratchInput = path.join(this.scratchDir, `in_${job.id}_${path.basename(job.inputPath)}`);
    try {
      const sizeMB = ((await fs.promises.stat(job.inputPath)).size / (1024 * 1024)).toFixed(0);
      console.log(`[Transcoder] ⚡ [M.2 NVMe] Copiando ${job.originalFilename} (${sizeMB} MB) al SSD M.2 para eliminar cuello de botella I/O en HDD...`);
      await fs.promises.copyFile(job.inputPath, scratchInput);
      ctx.scratchInput = scratchInput;
      console.log('[Transcoder] ⚡ [M.2 NVMe] Archivo en SSD M.2 listo. FFmpeg operará a máxima velocidad NVENC.');
      return scratchInput;
    } catch (e) {
      console.warn(`[Transcoder] ⚠️ No se pudo copiar a scratch M.2 (${e.message}), leyendo directo del HDD.`);
      return job.inputPath;
    }
  }

  /** 2. Codificar con FFmpeg reportando progreso. */
  async encode(ctx) {
    const { job, slot } = ctx;
    const audio = selectAudioTrack(await probeAudioStreams(ctx.input));
    if (audio.map !== '0:a:0') console.log(`[Transcoder] 🔊 Pista de audio seleccionada: ${audio.map} (${audio.reason})`);

    const args = [
      '-hide_banner', '-y', '-i', ctx.input,
      '-map', '0:v:0', '-map', `${audio.map}?`,
      '-vf', VIDEO_FILTER, '-r', '30',
      ...slot.encoder.args,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-af', AUDIO_FILTER,
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      ctx.tempOutput
    ];

    await new Promise((resolve, reject) => {
      // Ejecutar con nice -n 10 para que la emisión HLS en vivo y las 4 radios tengan siempre prioridad de CPU/I/O
      const proc = process.platform !== 'win32'
        ? spawn('nice', ['-n', '10', 'ffmpeg', ...args])
        : spawn('ffmpeg', args);
      slot.proc = proc;
      let lastSaved = 0;

      proc.stdout.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.startsWith('fps=')) job.fps = parseFloat(line.split('=')[1]) || 0;
          if (!line.startsWith('out_time_ms=') || !(ctx.totalDuration > 0)) continue;
          const sec = parseInt(line.split('=')[1], 10) / 1e6;
          if (isNaN(sec)) continue;
          this.updateProgress(job, Math.min(99, Math.round((sec / ctx.totalDuration) * 100)));
          if (Date.now() - lastSaved > PROGRESS_SAVE_MS || job.progress >= 99) {
            lastSaved = Date.now();
            this.db.updateTranscodeJob(job.id, { progress: job.progress, fps: job.fps });
          }
        }
      });
      proc.stderr.on('data', () => {});
      proc.on('error', (err) => { slot.proc = null; reject(err); });
      proc.on('close', (code) => {
        slot.proc = null;
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg falló con código ${code}`));
      });
    });
  }

  updateProgress(job, percent) {
    job.progress = percent;
    if (!job.startedAt || percent <= 0) return;
    const elapsedSec = (Date.now() - job.startedAt) / 1000;
    job.remainingSec = Math.max(0, Math.round((elapsedSec / percent) * 100 - elapsedSec));
    const m = Math.floor(job.remainingSec / 60);
    job.remainingFormatted = m > 0 ? `${m}m ${job.remainingSec % 60}s` : `${job.remainingSec}s`;
    job.elapsedSec = Math.round(elapsedSec);
  }

  /** 3. Copiar al disco 2TB con nombre temporal (la mediateca ignora ".tmp.") y renombrar. */
  async publish(ctx) {
    const hddTemp = `${ctx.output}.tmp.mp4`;
    const sizeMB = ((await fs.promises.stat(ctx.tempOutput)).size / (1024 * 1024)).toFixed(1);
    console.log(`[Transcoder] ⚡ [M.2 NVMe -> HDD 2TB] Copiando MP4 final (${sizeMB} MB) al almacenamiento 2TB...`);
    await fs.promises.copyFile(ctx.tempOutput, hddTemp);
    await fs.promises.rename(hddTemp, ctx.output);
  }

  /** 4. Registrar el resultado en la base. */
  async register(ctx) {
    const { job, output } = ctx;
    const stat = await fs.promises.stat(output);
    const duration = ctx.encodedDuration || (await probeDuration(output)) || ctx.totalDuration;
    const record = {
      title: job.title,
      filename: path.basename(output),
      path: output,
      duration,
      durationFormatted: formatDuration(duration),
      sizeMB: (stat.size / (1024 * 1024)).toFixed(1)
    };

    if (job.type === 'show') {
      let showId = job.showId;
      if (!showId) {
        const shows = this.db.getShows();
        showId = shows.length ? shows[0].id : this.db.createShow({ title: 'Programación General' }).id;
      }
      this.db.addEpisodeToShow(showId, { ...record, season: job.season, episode: job.episode });
    } else {
      this.db.addCommercial({ ...record, type: job.type });
    }
    return { outputFilename: record.filename, outputPath: output, duration, sizeMB: record.sizeMB };
  }

  /** 5a. Borrar el original para liberar espacio (las grabaciones son de solo lectura). */
  async removeOriginal(job) {
    if (job.inputPath.includes('grabaciones')) return;
    try {
      await fs.promises.unlink(job.inputPath);
      console.log(`[Transcoder] 🗑️ Archivo origen eliminado para liberar espacio: ${job.inputPath}`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[Transcoder] Error al eliminar archivo origen ${job.inputPath}:`, e.message);
    }
  }

  /** 5b. Temporales (siempre, haya salido bien o mal). */
  async cleanup(ctx) {
    if (ctx.tempOutput) await fs.promises.unlink(ctx.tempOutput).catch(() => {});
    if (ctx.scratchInput) await fs.promises.unlink(ctx.scratchInput).catch(() => {});
  }
}

module.exports = TranscodeJobRunner;
